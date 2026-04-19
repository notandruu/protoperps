/**
 * liquidator.ts — keeper service that monitors all open positions and
 * liquidates any that fall below the maintenance margin ratio.
 *
 * Flow per tick:
 *   1. For each market, load its on-chain params (maint_margin_ratio, liq_reward_bps)
 *      and the current oracle price.
 *   2. Fetch all Position accounts via getProgramAccounts with a memcmp filter
 *      on the market pubkey.
 *   3. For each open position, compute unrealized PnL and margin ratio.
 *   4. If margin_ratio < maint_margin_ratio, call protoperps::liquidate.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  GetProgramAccountsConfig,
} from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import {
  MARKETS,
  PROTOPERPS_PROGRAM_ID,
  oraclePda,
  type MarketConfig,
} from './config';

// ── Constants ──────────────────────────────────────────────────────────────

/** How often to scan for liquidatable positions. */
const SCAN_INTERVAL_MS = parseInt(
  process.env.LIQUIDATOR_SCAN_INTERVAL_MS ?? '10000',
  10,
);

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

// On-chain precision constants (must match programs/protoperps/src/math/mod.rs)
const LOT_PRECISION = 1_000_000n;
const BPS_PRECISION = 10_000n;

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

// ── Math helpers (pure bigint — mirrors programs/protoperps/src/math/pnl.rs) ─

/** 0 = Long, 1 = Short (matches Side enum on-chain) */
type Side = 0 | 1;

function calcUnrealizedPnl(
  entryPrice: bigint,
  markPrice: bigint,
  size: bigint,
  side: Side,
): bigint {
  const diff = side === 0
    ? markPrice - entryPrice   // Long: profit when price goes up
    : entryPrice - markPrice;  // Short: profit when price goes down
  return (diff * size) / LOT_PRECISION;
}

/** Returns margin ratio in basis points, or 0 for insolvent/zero-notional. */
function calcMarginRatio(
  collateral: bigint,
  upnl: bigint,
  markNotional: bigint,
): bigint {
  if (markNotional === 0n) return 0n;
  const equity = collateral + upnl;
  if (equity <= 0n) return 0n;
  return (equity * BPS_PRECISION) / markNotional;
}

// ── Oracle reader ──────────────────────────────────────────────────────────

/**
 * Read the oracle account and return { price, status } where status is:
 *   0 = Active, 1 = ReduceOnly, 2 = Paused.
 *
 * Layout (after 8-byte discriminator):
 *   offset 2  → status (u8)
 *   offset 72 → price  (u64, little-endian)
 *   offset 120→ last_update_timestamp (i64, little-endian)
 */
interface OracleSnapshot {
  price: bigint;
  status: number;
  lastUpdateTimestamp: bigint;
}

async function readOracle(
  connection: Connection,
  market: MarketConfig,
): Promise<OracleSnapshot | null> {
  try {
    const oracle = oraclePda(market.marketPubkey);
    const info = await connection.getAccountInfo(oracle, 'confirmed');
    if (!info || info.data.length < 8 + 128) return null;
    const d = info.data;
    const status = d[8 + 2];
    const priceLo = d.readUInt32LE(8 + 72);
    const priceHi = d.readUInt32LE(8 + 72 + 4);
    const price = BigInt(priceHi) * 0x100000000n + BigInt(priceLo);
    const tsLo = d.readUInt32LE(8 + 120);
    const tsHi = d.readInt32LE(8 + 120 + 4); // signed high word
    const lastUpdateTimestamp = BigInt(tsHi) * 0x100000000n + BigInt(tsLo);
    return { price, status, lastUpdateTimestamp };
  } catch {
    return null;
  }
}

/** Returns the effective status given oracle snapshot and current unix time. */
function effectiveStatus(oracle: OracleSnapshot, nowSecs: bigint): number {
  const age = nowSecs - oracle.lastUpdateTimestamp;
  const byStale = age >= 900n ? 2 : age >= 300n ? 1 : 0;
  return Math.max(oracle.status, byStale);
}

// ── Market params reader ───────────────────────────────────────────────────

interface MarketParams {
  maintMarginRatio: bigint;
}

async function readMarketParams(
  program: Program,
  market: MarketConfig,
): Promise<MarketParams | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mkt = await (program.account as any).market.fetch(market.marketPubkey);
    return {
      maintMarginRatio: BigInt(mkt.maintenanceMarginRatio.toString()),
    };
  } catch {
    return null;
  }
}

// ── Position scanning ──────────────────────────────────────────────────────

/**
 * Fetch all Position accounts for a given market using a memcmp filter on
 * the market pubkey field.
 *
 * Position account layout (after 8-byte discriminator):
 *   offset 8  → market    (Pubkey, 32 bytes)
 *   offset 40 → trader    (Pubkey, 32 bytes)
 *   offset 72 → entry_price (u64)
 *   offset 80 → size        (u64)
 *   offset 88 → collateral  (u64)
 *   offset 96 → side        (u8;  0=Long, 1=Short)
 *   ...
 *
 * We use the Anchor Program client for decoding rather than byte offsets.
 */
interface PositionRecord {
  pubkey: PublicKey;
  trader: PublicKey;
  entryPrice: bigint;
  size: bigint;
  collateral: bigint;
  side: Side;
}

async function fetchPositions(
  program: Program,
  market: MarketConfig,
): Promise<PositionRecord[]> {
  // Derive the Position account discriminator bytes to filter by.
  // We also filter by market pubkey at the known offset.
  const filters: GetProgramAccountsConfig['filters'] = [
    // Account size filter: Position discriminator prefix exists at offset 0.
    // Anchor memcmp on the market pubkey starting at byte 8.
    {
      memcmp: {
        offset: 8,
        bytes: market.marketPubkey.toBase58(),
      },
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (program.account as any).position.all(filters);

  const positions: PositionRecord[] = [];
  for (const { publicKey, account } of accounts) {
    // Skip closed positions (size == 0)
    const size = BigInt(account.size.toString());
    if (size === 0n) continue;

    const side = account.side.long !== undefined ? 0 : 1;

    positions.push({
      pubkey: publicKey as PublicKey,
      trader: account.trader as PublicKey,
      entryPrice: BigInt(account.entryPrice.toString()),
      size,
      collateral: BigInt(account.collateral.toString()),
      side,
    });
  }

  return positions;
}

// ── Liquidation logic ──────────────────────────────────────────────────────

async function liquidatePosition(
  program: Program,
  authority: Keypair,
  liquidatorMarginPda: PublicKey,
  market: MarketConfig,
  position: PositionRecord,
): Promise<void> {
  // Derive trader margin account PDA
  const [traderMarginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('margin'), position.trader.toBuffer()],
    PROTOPERPS_PROGRAM_ID,
  );

  const oracle = oraclePda(market.marketPubkey);

  const sig = await withBackoff(`liquidate:${market.name}:${position.pubkey.toBase58().slice(0, 8)}`, () =>
    program.methods
      .liquidate()
      .accounts({
        liquidator: authority.publicKey,
        market: market.marketPubkey,
        position: position.pubkey,
        traderMargin: traderMarginPda,
        liquidatorMargin: liquidatorMarginPda,
        oracleFeed: oracle,
      } as never)
      .signers([authority])
      .rpc(),
  );

  console.log(
    `[liquidator/${market.name}] liquidated ${position.pubkey.toBase58().slice(0, 8)}… trader=${position.trader.toBase58().slice(0, 8)}…  sig=${sig.slice(0, 16)}…`,
  );
}

// ── Per-market scan ────────────────────────────────────────────────────────

async function scanMarket(
  program: Program,
  connection: Connection,
  authority: Keypair,
  liquidatorMarginPda: PublicKey,
  market: MarketConfig,
): Promise<void> {
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));

  // 1. Oracle state
  const oracle = await readOracle(connection, market);
  if (!oracle) {
    console.warn(`[liquidator/${market.name}] oracle not found  →  skipping`);
    return;
  }
  const oracleStatus = effectiveStatus(oracle, nowSecs);
  if (oracleStatus === 2) {
    // Oracle Paused — liquidation not allowed by the program
    console.warn(`[liquidator/${market.name}] oracle Paused  →  skipping`);
    return;
  }
  const markPrice = oracle.price;
  if (markPrice === 0n) return;

  // 2. Market params
  const params = await readMarketParams(program, market);
  if (!params) {
    console.warn(`[liquidator/${market.name}] market not found  →  skipping`);
    return;
  }

  // 3. Positions
  const positions = await fetchPositions(program, market);
  if (positions.length === 0) return;

  // 4. Check each position
  const liquidations = positions.filter(pos => {
    const upnl = calcUnrealizedPnl(pos.entryPrice, markPrice, pos.size, pos.side);
    const markNotional = (markPrice * pos.size) / LOT_PRECISION;
    const marginRatio = calcMarginRatio(pos.collateral, upnl, markNotional);
    return marginRatio < params.maintMarginRatio;
  });

  if (liquidations.length > 0) {
    console.log(
      `[liquidator/${market.name}] found ${liquidations.length} liquidatable position(s)`,
    );
    await Promise.allSettled(
      liquidations.map(pos =>
        liquidatePosition(program, authority, liquidatorMarginPda, market, pos),
      ),
    );
  }
}

// ── Main tick ──────────────────────────────────────────────────────────────

async function tick(
  program: Program,
  connection: Connection,
  authority: Keypair,
  liquidatorMarginPda: PublicKey,
): Promise<void> {
  await Promise.allSettled(
    MARKETS.map(market =>
      scanMarket(program, connection, authority, liquidatorMarginPda, market),
    ),
  );
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runLiquidatorKeeper(): Promise<void> {
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

  // Derive the liquidator's own margin PDA (must be pre-created on-chain).
  const [liquidatorMarginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('margin'), authority.publicKey.toBuffer()],
    PROTOPERPS_PROGRAM_ID,
  );

  console.log('[liquidator keeper] starting');
  console.log(`  authority : ${authority.publicKey.toBase58()}`);
  console.log(`  margin    : ${liquidatorMarginPda.toBase58()}`);
  console.log(`  rpc       : ${rpcUrl}`);
  console.log(`  interval  : ${SCAN_INTERVAL_MS}ms`);
  console.log(`  markets   : ${MARKETS.map(m => m.name).join(', ')}`);
  console.log('');

  for (;;) {
    const start = Date.now();
    await tick(program, connection, authority, liquidatorMarginPda);
    const elapsed = Date.now() - start;
    const wait = Math.max(0, SCAN_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }
}
