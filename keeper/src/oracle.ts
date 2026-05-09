/**
 * oracle.ts — keeper service that fetches live prestocks prices from Dexscreener
 * and pushes them to the oracle program every 30 seconds.
 *
 * Flow per tick:
 *   1. Fetch price for each market from Dexscreener (highest-liquidity Solana pair)
 *   2. Clamp to ±9% of the current on-chain price to satisfy the deviation guard
 *      (on-chain program rejects updates >10% from previous_price)
 *   3. Record in rolling 30-sample buffer → compute simple-average TWAP
 *   4. Convert float price to u64 (PRICE_PRECISION = 1_000_000)
 *   5. Call oracle::update_price with exponential backoff on RPC failures
 *
 * If Dexscreener is unavailable, the last successfully fetched price is reused
 * so the oracle stays fresh. On the very first tick (no history), the market's
 * fallbackPriceUsd is used only if Dexscreener has no data.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import {
  MARKETS,
  ORACLE_PROGRAM_ID,
  PRICE_PRECISION,
  oraclePda,
  type MarketConfig,
} from './config';

// ── Dexscreener Price API ──────────────────────────────────────────────────

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';

interface DexscreenerPair {
  chainId: string;
  priceUsd?: string;
  liquidity?: { usd: number };
}

interface DexscreenerResponse {
  pairs?: DexscreenerPair[];
}

/**
 * Fetch the current USD price for a token mint from Dexscreener.
 * Picks the Solana pair with the highest USD liquidity.
 * Returns null if no Solana pair with a price is found.
 * Throws on HTTP errors.
 */
async function fetchDexscreenerPrice(mint: string): Promise<number | null> {
  const url = `${DEXSCREENER_URL}/${mint}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Dexscreener HTTP ${res.status} for mint ${mint}`);
  }
  const json = (await res.json()) as DexscreenerResponse;
  if (!json.pairs || json.pairs.length === 0) return null;

  const solanaPairs = json.pairs
    .filter(p => p.chainId === 'solana' && p.priceUsd)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

  if (solanaPairs.length === 0) return null;

  const price = parseFloat(solanaPairs[0].priceUsd!);
  return Number.isFinite(price) && price > 0 ? price : null;
}

// ── Last-fetched price cache (used as fallback when Dexscreener fails) ─────

const lastKnownPrice = new Map<string, number>(); // market name → last USD price

// ── On-chain oracle price reader ───────────────────────────────────────────
//
// OraclePrice layout (with 8-byte discriminator):
//   offset 80: price u64 LE  (8 discriminator + 72 struct offset)

// OraclePrice account layout (with 8-byte discriminator):
//   offset 80:  price          u64 LE   (current)
//   offset 104: previous_price u64 LE   (used by the deviation guard)

async function readOnchainPreviousPrice(
  connection: Connection,
  market: MarketConfig,
): Promise<number | null> {
  try {
    const oracle = oraclePda(market.marketPubkey);
    const info = await connection.getAccountInfo(oracle, 'confirmed');
    if (!info || info.data.length < 112) return null;
    const view = new DataView(info.data.buffer, info.data.byteOffset);
    const lo = view.getUint32(104, true);
    const hi = view.getUint32(108, true);
    const raw = hi * 0x100000000 + lo;
    return raw > 0 ? raw / PRICE_PRECISION : null;
  } catch {
    return null;
  }
}

// ── Exponential backoff ────────────────────────────────────────────────────

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

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

// ── In-memory price buffer for TWAP ───────────────────────────────────────

const BUFFER_SIZE = 30;
const priceBuffers = new Map<string, number[]>(); // mint → recent prices

function recordPrice(mint: string, price: number): void {
  const buf = priceBuffers.get(mint) ?? [];
  buf.push(price);
  if (buf.length > BUFFER_SIZE) buf.shift();
  priceBuffers.set(mint, buf);
}

function computeTwap(mint: string): number {
  const buf = priceBuffers.get(mint);
  if (!buf || buf.length === 0) return 0;
  return buf.reduce((sum, p) => sum + p, 0) / buf.length;
}

// ── Oracle program interaction ─────────────────────────────────────────────

function toU64(usd: number): BN {
  const raw = Math.round(usd * PRICE_PRECISION);
  return new BN(Math.max(1, raw));
}

async function updateOracleFeed(
  program: Program,
  authority: Keypair,
  market: MarketConfig,
  price: number,
): Promise<string> {
  const twap = computeTwap(market.tokenMint);
  const priceU64 = toU64(price);
  // Confidence = |price − twap|, floored at $0.001 so it's never zero.
  const confidence = twap > 0 ? Math.max(Math.abs(price - twap), 0.001) : price * 0.01;
  const confidenceU64 = toU64(confidence);

  const oracle = oraclePda(market.marketPubkey);

  const sig = await program.methods
    .updatePrice({
      price: priceU64,
      confidence: confidenceU64,
      source: 0, // OracleSource::DEXPool
    })
    .accounts({
      authority: authority.publicKey,
      market: market.marketPubkey,
      oracle,
    } as never)
    .signers([authority])
    .rpc();

  return sig;
}

// ── Main tick ─────────────────────────────────────────────────────────────

const MAX_STEP = 0.09; // stay under the on-chain 10% deviation guard

async function tick(
  connection: Connection,
  program: Program,
  authority: Keypair,
): Promise<void> {
  for (const market of MARKETS) {
    try {
      // 1. Fetch live price from Dexscreener.
      let price: number | null = null;
      try {
        price = await fetchDexscreenerPrice(market.tokenMint);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[oracle/${market.name}] Dexscreener error: ${msg.slice(0, 80)}`);
      }

      if (price !== null) {
        lastKnownPrice.set(market.name, price);
      } else {
        price = lastKnownPrice.get(market.name) ?? market.fallbackPriceUsd;
        console.warn(`[oracle/${market.name}] Dexscreener unavailable → using $${price.toFixed(2)}`);
      }

      // 2. Clamp to ±9% of the on-chain previous_price to satisfy the deviation guard.
      const onchainPrice = await readOnchainPreviousPrice(connection, market);
      if (onchainPrice !== null && onchainPrice > 0) {
        const lo = onchainPrice * (1 - MAX_STEP);
        const hi = onchainPrice * (1 + MAX_STEP);
        const clamped = Math.max(lo, Math.min(hi, price));
        if (clamped !== price) {
          console.log(
            `[oracle/${market.name}] price clamped $${price.toFixed(2)} → $${clamped.toFixed(2)} (on-chain $${onchainPrice.toFixed(2)})`,
          );
        }
        price = clamped;
      }

      // 3. Record in buffer before updating the feed so TWAP includes this sample.
      recordPrice(market.tokenMint, price);
      const twap = computeTwap(market.tokenMint);

      // 4. Push to oracle program with RPC backoff.
      const sig = await withBackoff(`update_price:${market.name}`, () =>
        updateOracleFeed(program, authority, market, price as number),
      );

      console.log(
        `[oracle/${market.name}] price=$${price.toFixed(2)}  twap=$${twap.toFixed(2)}  sig=${sig.slice(0, 16)}…`,
      );
    } catch (err) {
      console.error(`[oracle/${market.name}] unhandled error:`, err);
    }
    // Stagger market updates to stay within RPC rate limits.
    await sleep(2500);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runOracleKeeper(): Promise<void> {
  const keypairPath = process.env.KEEPER_ORACLE_KEYPAIR_PATH ?? process.env.KEYPAIR_PATH;
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

  const idlPath = path.resolve(__dirname, '../../target/idl/oracle.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`Oracle IDL not found at ${idlPath}. Run: anchor build`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require(idlPath) as import('@coral-xyz/anchor').Idl;
  const program = new Program(idl, provider);

  if (program.programId.toBase58() !== ORACLE_PROGRAM_ID.toBase58()) {
    throw new Error(
      `IDL program ID ${program.programId.toBase58()} does not match ORACLE_PROGRAM_ID ${ORACLE_PROGRAM_ID.toBase58()}`,
    );
  }

  const intervalMs = parseInt(process.env.PRICE_PUSH_INTERVAL_MS ?? '30000', 10);

  console.log('[oracle keeper] starting');
  console.log(`  authority : ${authority.publicKey.toBase58()}`);
  console.log(`  rpc       : ${rpcUrl}`);
  console.log(`  interval  : ${intervalMs}ms`);
  console.log(`  markets   : ${MARKETS.map(m => m.name).join(', ')}`);
  console.log('');

  for (;;) {
    const start = Date.now();
    await tick(connection, program, authority);
    const elapsed = Date.now() - start;
    const wait = Math.max(0, intervalMs - elapsed);
    if (wait > 0) await sleep(wait);
  }
}
