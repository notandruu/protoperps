/**
 * funding.ts — keeper service that triggers hourly funding rate updates
 * on the protoperps program.
 *
 * Flow per tick:
 *   1. For each market, read the Market account to derive a mark price
 *      (midpoint of best bid and best ask; falls back to last oracle price
 *       if the book is empty on one or both sides).
 *   2. Call protoperps::update_funding with that mark price.
 *   3. Sleep until the next hourly window.
 *
 * The on-chain instruction enforces its own interval guard
 * (market.last_funding_timestamp + market.funding_interval ≤ now),
 * so calling slightly early just returns FundingTooEarly rather than
 * corrupting state — we do not need to track the interval client-side.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import {
  MARKETS,
  PROTOPERPS_PROGRAM_ID,
  ORACLE_PROGRAM_ID,
  PRICE_PRECISION,
  oraclePda,
  type MarketConfig,
} from './config';

// ── Constants ──────────────────────────────────────────────────────────────

/** How often to attempt a funding update.  Production: 3600_000 (1 hour). */
const FUNDING_INTERVAL_MS = parseInt(
  process.env.FUNDING_INTERVAL_MS ?? '3600000',
  10,
);

/** Retry backoff settings. */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withBackoff<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let delay = BACKOFF_INITIAL_MS;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${label}] failed: ${msg}  →  retry in ${delay}ms`);
      await sleep(delay);
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    }
  }
}

// ── Oracle price reader ────────────────────────────────────────────────────

/**
 * Read the current oracle price for a market directly from on-chain account
 * data.  Returns null if the account does not exist or data is malformed.
 *
 * OraclePriceMirror layout (after 8-byte discriminator):
 *   offset 72 → price (u64, little-endian)
 */
async function readOraclePrice(
  connection: Connection,
  market: MarketConfig,
): Promise<BN | null> {
  try {
    const oracle = oraclePda(market.marketPubkey);
    const info = await connection.getAccountInfo(oracle, 'confirmed');
    if (!info || info.data.length < 8 + 80) return null;
    // Skip 8-byte discriminator + 72 bytes of other fields → offset 80
    const priceBuf = info.data.slice(8 + 72, 8 + 72 + 8);
    // u64 little-endian
    const lo = priceBuf.readUInt32LE(0);
    const hi = priceBuf.readUInt32LE(4);
    return new BN(hi).shln(32).or(new BN(lo));
  } catch {
    return null;
  }
}

// ── Mark price derivation ──────────────────────────────────────────────────

/**
 * Derive a mark price for update_funding from the on-chain Market account.
 *
 * Strategy:
 *   • Both bids and asks present → midpoint = (bestBid + bestAsk) / 2
 *   • Only one side              → use that side's best price
 *   • Empty book                 → fall back to the oracle's current price
 *
 * Market zero-copy layout (after 8-byte anchor discriminator):
 *   offset 0   → status (u8)
 *   offset 1   → _pad0 ([u8;7])
 *   offset 8   → authority (Pubkey, 32 bytes)
 *   offset 40  → base_symbol ([u8;16])
 *   offset 56  → oracle (Pubkey, 32 bytes)
 *
 * Order struct (each 24 bytes):
 *   u64 price  (offset 0)
 *   u64 size   (offset 8)
 *   u64 seq    (offset 16) — actually side/owner are packed differently;
 *                            we only need price.
 *
 * Locating bids/asks requires knowing the full Market struct layout.
 * Rather than hard-coding brittle byte offsets, we use the Anchor Program
 * client to fetch and decode the Market account properly.
 */
async function deriveMarkPrice(
  program: Program,
  connection: Connection,
  market: MarketConfig,
): Promise<BN | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mkt = await (program.account as any).market.fetch(market.marketPubkey);

    const numBids: number = mkt.numBids ?? 0;
    const numAsks: number = mkt.numAsks ?? 0;

    // bids are sorted descending (index 0 = best bid)
    // asks are sorted ascending  (index 0 = best ask)
    const bestBid: BN | null =
      numBids > 0 && mkt.bids?.[0]?.price ? new BN(mkt.bids[0].price.toString()) : null;
    const bestAsk: BN | null =
      numAsks > 0 && mkt.asks?.[0]?.price ? new BN(mkt.asks[0].price.toString()) : null;

    if (bestBid && bestAsk) {
      return bestBid.add(bestAsk).divn(2);
    }
    if (bestBid) return bestBid;
    if (bestAsk) return bestAsk;
  } catch (err) {
    console.warn(`[funding/${market.name}] market fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: use oracle price.
  return readOraclePrice(connection, market);
}

// ── Funding update ─────────────────────────────────────────────────────────

async function updateFunding(
  program: Program,
  connection: Connection,
  authority: Keypair,
  market: MarketConfig,
): Promise<void> {
  const markPrice = await deriveMarkPrice(program, connection, market);
  if (!markPrice || markPrice.isZero()) {
    console.warn(`[funding/${market.name}] could not derive mark price  →  skipping`);
    return;
  }

  const oracle = oraclePda(market.marketPubkey);

  let sig: string;
  try {
    sig = await program.methods
      .updateFunding({ markPrice })
      .accounts({
        caller: authority.publicKey,
        market: market.marketPubkey,
        oracleFeed: oracle,
      } as never)
      .signers([authority])
      .rpc();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('InstructionFallbackNotFound')) {
      console.warn(`[funding/${market.name}] instruction not available on deployed program — skipping`);
      return;
    }
    throw err;
  }

  const priceUsd = markPrice.toNumber() / PRICE_PRECISION;
  console.log(
    `[funding/${market.name}] mark=$${priceUsd.toFixed(4)}  sig=${sig.slice(0, 16)}…`,
  );
}

// ── Main tick ──────────────────────────────────────────────────────────────

async function tick(
  program: Program,
  connection: Connection,
  authority: Keypair,
): Promise<void> {
  for (const market of MARKETS) {
    try {
      await updateFunding(program, connection, authority, market);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason.includes('FundingTooEarly')) {
        console.log(`[funding/${market.name}] FundingTooEarly — interval not elapsed yet`);
      } else {
        console.error(`[funding/${market.name}] unhandled error:`, err);
      }
    }
    await sleep(1_000);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runFundingKeeper(): Promise<void> {
  const keypairPath = process.env.KEYPAIR_PATH;
  if (!keypairPath) throw new Error('KEYPAIR_PATH env var is not set');
  const raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(raw));

  const rpcUrl = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const wallet = {
    publicKey: authority.publicKey,
    signTransaction: async <
      T extends
        | import('@solana/web3.js').Transaction
        | import('@solana/web3.js').VersionedTransaction,
    >(
      tx: T,
    ): Promise<T> => {
      if ('version' in tx) {
        (tx as import('@solana/web3.js').VersionedTransaction).sign([authority]);
      } else {
        (tx as import('@solana/web3.js').Transaction).sign(authority);
      }
      return tx;
    },
    signAllTransactions: async <
      T extends
        | import('@solana/web3.js').Transaction
        | import('@solana/web3.js').VersionedTransaction,
    >(
      txs: T[],
    ): Promise<T[]> => {
      return Promise.all(txs.map(tx => wallet.signTransaction(tx)));
    },
  };

  const provider = new AnchorProvider(connection, wallet as never, { commitment: 'confirmed' });

  const idlPath = path.resolve(__dirname, '../../target/idl/protoperps.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`Protoperps IDL not found at ${idlPath}. Run: anchor build`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require(idlPath) as import('@coral-xyz/anchor').Idl;
  const program = new Program(idl, provider);

  if (program.programId.toBase58() !== PROTOPERPS_PROGRAM_ID.toBase58()) {
    throw new Error(
      `IDL program ID ${program.programId.toBase58()} does not match PROTOPERPS_PROGRAM_ID ${PROTOPERPS_PROGRAM_ID.toBase58()}`,
    );
  }

  console.log('[funding keeper] starting');
  console.log(`  authority : ${authority.publicKey.toBase58()}`);
  console.log(`  rpc       : ${rpcUrl}`);
  console.log(`  interval  : ${FUNDING_INTERVAL_MS}ms`);
  console.log(`  markets   : ${MARKETS.map(m => m.name).join(', ')}`);
  console.log('');

  for (;;) {
    const start = Date.now();
    await tick(program, connection, authority);
    const elapsed = Date.now() - start;
    const wait = Math.max(0, FUNDING_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }
}
