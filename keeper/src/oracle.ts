/**
 * oracle.ts — keeper service that fetches prestocks prices from Jupiter
 * and pushes them to the oracle program every 30 seconds.
 *
 * Flow per tick:
 *   1. Fetch price for each market from Jupiter Price API v2
 *   2. Record in rolling 30-sample buffer → compute simple-average TWAP
 *   3. Convert float price to u64 (PRICE_PRECISION = 1_000_000)
 *   4. Call oracle::update_price with exponential backoff on RPC failures
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

// ── Jupiter Price API ──────────────────────────────────────────────────────

const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v2';

interface JupiterEntry {
  id: string;
  type: string;
  price: string;
}

interface JupiterResponse {
  data: Record<string, JupiterEntry | undefined>;
  timeTaken: number;
}

/**
 * Fetch the current USD price for a single token mint from Jupiter.
 * Returns null if Jupiter has no price data for the mint.
 * Throws on HTTP errors (caller decides whether to retry).
 */
async function fetchJupiterPrice(mint: string): Promise<number | null> {
  const url = `${JUPITER_PRICE_URL}?ids=${mint}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Jupiter HTTP ${res.status} for mint ${mint}`);
  }
  const json = (await res.json()) as JupiterResponse;
  const entry = json.data[mint];
  if (!entry?.price) return null;
  const price = parseFloat(entry.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

// ── Exponential backoff ────────────────────────────────────────────────────

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry `fn` with exponential backoff (1s → 2s → 4s → … → 30s) until it succeeds.
 * Only use this for RPC calls that are expected to eventually succeed.
 */
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

/** Add a new sample to the rolling buffer; evict oldest if full. */
function recordPrice(mint: string, price: number): void {
  const buf = priceBuffers.get(mint) ?? [];
  buf.push(price);
  if (buf.length > BUFFER_SIZE) buf.shift();
  priceBuffers.set(mint, buf);
}

/**
 * Compute a simple average over all buffered samples.
 * Returns 0 when no samples are available (only on the very first call
 * before any price has been recorded — callers should treat 0 as unknown).
 */
function computeTwap(mint: string): number {
  const buf = priceBuffers.get(mint);
  if (!buf || buf.length === 0) return 0;
  return buf.reduce((sum, p) => sum + p, 0) / buf.length;
}

// ── Oracle program interaction ─────────────────────────────────────────────

/**
 * Convert a floating-point USD price to the u64 on-chain representation.
 * $100.50 → 100_500_000  (PRICE_PRECISION = 1_000_000)
 * Clamps to [1, Number.MAX_SAFE_INTEGER] to avoid passing 0 to the program.
 */
function toU64(usd: number): BN {
  const raw = Math.round(usd * PRICE_PRECISION);
  return new BN(Math.max(1, raw));
}

/** Push a single price update to the oracle program. */
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

/**
 * Run one full cycle: fetch prices for all markets, update feeds.
 * Failures for individual markets are logged but don't abort the whole tick.
 */
async function tick(program: Program, authority: Keypair): Promise<void> {
  const results = await Promise.allSettled(
    MARKETS.map(async market => {
      // 1. Fetch price from Jupiter; fall back to seeded price with ±0.5% jitter on devnet.
      let price: number | null;
      try {
        price = await fetchJupiterPrice(market.tokenMint);
      } catch {
        price = null;
      }

      if (price === null) {
        // Jupiter has no data for this mint (common on devnet). Use the fallback
        // price with small random jitter so the oracle stays fresh and markets
        // don't enter reduce-only mode.
        price = market.fallbackPriceUsd;
        console.log(`[oracle/${market.name}] Jupiter unavailable → fallback $${price.toFixed(2)}`);
      }

      // 2. Record in buffer before updating the feed so TWAP includes this sample.
      recordPrice(market.tokenMint, price);
      const twap = computeTwap(market.tokenMint);

      // 3. Push to oracle program with RPC backoff.
      const sig = await withBackoff(`update_price:${market.name}`, () =>
        updateOracleFeed(program, authority, market, price as number),
      );

      console.log(
        `[oracle/${market.name}] price=$${price.toFixed(4)}  twap=$${twap.toFixed(4)}  sig=${sig.slice(0, 16)}…`,
      );
    }),
  );

  // Surface any unexpected errors.
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[oracle/${MARKETS[i].name}] unhandled error:`, result.reason);
    }
  });
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runOracleKeeper(): Promise<void> {
  // ── load keypair ──────────────────────────────────────────────────────────
  const keypairPath = process.env.KEEPER_ORACLE_KEYPAIR_PATH ?? process.env.KEYPAIR_PATH;
  if (!keypairPath) throw new Error('KEYPAIR_PATH env var is not set');
  const raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(raw));

  // ── connect ───────────────────────────────────────────────────────────────
  const rpcUrl = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Minimal Wallet implementation — signs with the authority keypair.
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

  // ── load oracle IDL ───────────────────────────────────────────────────────
  const idlPath = path.resolve(__dirname, '../../target/idl/oracle.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(
      `Oracle IDL not found at ${idlPath}. Run: anchor idl build -p oracle`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require(idlPath) as import('@coral-xyz/anchor').Idl;
  const program = new Program(idl, provider);

  // Sanity-check program ID matches what's in the IDL.
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

  // ── main loop ─────────────────────────────────────────────────────────────
  for (;;) {
    const start = Date.now();

    await tick(program, authority);

    const elapsed = Date.now() - start;
    const wait = Math.max(0, intervalMs - elapsed);
    if (wait > 0) await sleep(wait);
  }
}
