/**
 * marketmaker.ts — demo liquidity bot
 *
 * Quotes bid and ask at the oracle mark price for every market so the demo
 * user's limit orders always fill immediately. Re-quotes every 30 s.
 *
 * Self-trade prevention is in the on-chain program, so quoting both sides at
 * the same price is safe — the bot's own bid/ask will never cross each other.
 *
 * Env vars required (same .env as the oracle keeper):
 *   KEYPAIR_PATH   — path to a funded devnet keypair JSON
 *   RPC_URL        — devnet RPC endpoint (defaults to public devnet)
 *
 * Deposit:
 *   INITIAL_DEPOSIT_USDC — how much USDC to deposit on first run (default 100)
 */

import { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
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

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

// Initial margin ratio at 50x leverage = 2% = 200 bps.
const INIT_MARGIN_BPS = 200;
// USDC to deposit on first run.
const INITIAL_DEPOSIT_USDC = parseInt(process.env.INITIAL_DEPOSIT_USDC ?? '100', 10);
// Requote interval — longer than oracle's 30s so they don't burst simultaneously.
const REQUOTE_INTERVAL_MS = 60_000;

// ── PDA helpers (mirrors app/src/lib/constants.ts) ─────────────────────────

function marginPda(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('margin'), owner.toBuffer()],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

function positionPda(market: PublicKey, trader: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), market.toBuffer(), trader.toBuffer()],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

function vaultAuthorityPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

// ── Market account byte parsing ─────────────────────────────────────────────
//
// Layout (with 8-byte Anchor discriminator):
//   Bids start at offset 8 + 88 = 96
//   Asks start at offset 8 + 4696 = 4704
//   num_bids at offset 8 + 9312 = 9320
//   num_asks at offset 8 + 9313 = 9321
//
// Each Order is 72 bytes:
//   0:  price u64 LE
//   8:  size  u64 LE
//   16: sequence_number u64 LE
//   32: trader [u8;32]
//   64: active u8

const BIDS_OFFSET = 8 + 88;
const ASKS_OFFSET = 8 + 4696;
const NUM_BIDS_OFFSET = 8 + 9312;
const NUM_ASKS_OFFSET = 8 + 9313;
const ORDER_BYTES = 72;

interface BotOrder {
  side: 'long' | 'short';
  sequenceNumber: BN;
}

function parseBotOrders(data: Buffer, bot: PublicKey): BotOrder[] {
  const orders: BotOrder[] = [];
  const botBytes = bot.toBytes();
  const numBids = data[NUM_BIDS_OFFSET];
  const numAsks = data[NUM_ASKS_OFFSET];

  for (let i = 0; i < numBids; i++) {
    const base = BIDS_OFFSET + i * ORDER_BYTES;
    if (!data[base + 64]) continue; // inactive
    const trader = data.slice(base + 32, base + 64);
    if (Buffer.compare(trader, Buffer.from(botBytes)) !== 0) continue;
    const seq = new BN(data.slice(base + 16, base + 24), 'le');
    orders.push({ side: 'long', sequenceNumber: seq });
  }

  for (let i = 0; i < numAsks; i++) {
    const base = ASKS_OFFSET + i * ORDER_BYTES;
    if (!data[base + 64]) continue; // inactive
    const trader = data.slice(base + 32, base + 64);
    if (Buffer.compare(trader, Buffer.from(botBytes)) !== 0) continue;
    const seq = new BN(data.slice(base + 16, base + 24), 'le');
    orders.push({ side: 'short', sequenceNumber: seq });
  }

  return orders;
}

// ── Oracle price reading ────────────────────────────────────────────────────

async function readOraclePrice(
  connection: Connection,
  marketPubkey: PublicKey,
): Promise<number | null> {
  const oracle = oraclePda(marketPubkey);
  const info = await connection.getAccountInfo(oracle, 'confirmed');
  if (!info || info.data.length < 136) return null;
  const d = info.data;
  const view = new DataView(d.buffer, d.byteOffset);
  // price: u64 LE at discriminator(8) + struct offset 72 = byte 80
  const priceLo = view.getUint32(80, true);
  const priceHi = view.getUint32(84, true);
  return priceHi * 0x100000000 + priceLo;
}

// ── Sleep ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Wallet factory (mirrors oracle.ts) ─────────────────────────────────────

function makeWallet(keypair: Keypair) {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T): Promise<T> => {
      if ('version' in tx) {
        (tx as import('@solana/web3.js').VersionedTransaction).sign([keypair]);
      } else {
        (tx as import('@solana/web3.js').Transaction).sign(keypair);
      }
      return tx;
    },
    signAllTransactions: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(txs: T[]): Promise<T[]> => {
      return Promise.all(txs.map(tx => makeWallet(keypair).signTransaction(tx)));
    },
  };
}

// ── Last-quoted price per market (to skip unnecessary re-quotes) ───────────
const lastQuotedPrice = new Map<string, number>();
const REQUOTE_THRESHOLD = 0.001; // only requote if price moved > 0.1%

// ── Core bot logic ──────────────────────────────────────────────────────────

async function ensureUsdc(
  connection: Connection,
  bot: Keypair,
  program: Program,
): Promise<void> {
  const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, bot.publicKey);
  const marginAcct = marginPda(bot.publicKey);

  // Create USDC ATA if missing.
  const ataInfo = await connection.getAccountInfo(userUsdc);
  if (!ataInfo) {
    console.log('[mm] creating USDC ATA…');
    const ix = createAssociatedTokenAccountInstruction(
      bot.publicKey, userUsdc, bot.publicKey, USDC_MINT,
    );
    await (program.provider as AnchorProvider).sendAndConfirm(
      new (require('@solana/web3.js').Transaction)().add(ix),
    );
    console.log('[mm] USDC ATA created');
  }

  // Check margin balance; deposit if near zero.
  let freeMargin = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const margin = await (program.account as any).marginAccount.fetch(marginAcct);
    freeMargin = (margin.usdcDeposited as BN).sub(margin.usdcLocked as BN).toNumber();
  } catch {
    // account doesn't exist yet → deposit initialises it
  }

  const threshold = INITIAL_DEPOSIT_USDC * PRICE_PRECISION * 0.5;
  if (freeMargin < threshold) {
    // Cap deposit at actual ATA balance to avoid insufficient-funds errors.
    const ataBalance = ataInfo
      ? await connection.getTokenAccountBalance(userUsdc).then(r => r.value.amount).catch(() => '0')
      : '0';
    const availableRaw = parseInt(ataBalance, 10);
    const depositRaw = Math.min(INITIAL_DEPOSIT_USDC * PRICE_PRECISION, availableRaw);
    if (depositRaw <= 0) {
      console.warn('[mm] ATA has no USDC to deposit — running with existing margin');
      return;
    }
    const amount = new BN(depositRaw);
    const vaultAuth = vaultAuthorityPda();
    const vault = getAssociatedTokenAddressSync(USDC_MINT, vaultAuth, true);
    const depositUsdc = (depositRaw / PRICE_PRECISION).toFixed(2);
    console.log(`[mm] depositing ${depositUsdc} USDC…`);
    try {
      await program.methods
        .depositCollateral(amount)
        .accounts({
          owner: bot.publicKey,
          marginAccount: marginAcct,
          userUsdc,
          vaultAuthority: vaultAuth,
          vault,
          usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SYSTEM_PROGRAM_ID,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .rpc();
      console.log(`[mm] deposited ${depositUsdc} USDC`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mm] deposit failed (${msg.slice(0, 80)}) — continuing with existing margin`);
    }
  } else {
    console.log(`[mm] free margin: $${(freeMargin / PRICE_PRECISION).toFixed(2)}`);
  }
}

async function cancelBotOrders(
  connection: Connection,
  program: Program,
  bot: Keypair,
  market: MarketConfig,
): Promise<void> {
  const info = await connection.getAccountInfo(market.marketPubkey, 'confirmed');
  if (!info) return;
  const botOrders = parseBotOrders(info.data as Buffer, bot.publicKey);
  if (botOrders.length === 0) return;

  const marginAcct = marginPda(bot.publicKey);
  for (const order of botOrders) {
    try {
      await program.methods
        .cancelOrder({
          side: order.side === 'long' ? { long: {} } : { short: {} },
          sequenceNumber: order.sequenceNumber,
        })
        .accounts({
          trader: bot.publicKey,
          market: market.marketPubkey,
          traderMargin: marginAcct,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .rpc();
      console.log(`[mm] cancelled ${order.side} seq=${order.sequenceNumber.toString()} on ${market.name}`);
    } catch (err) {
      // Order may have been filled since we read the account — ignore.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('OrderNotFound')) {
        console.error(`[mm] cancel failed (${market.name} ${order.side}): ${msg.slice(0, 80)}`);
      }
    }
  }
}

async function quoteBothSides(
  program: Program,
  bot: Keypair,
  market: MarketConfig,
  markPrice: number,
  quoteSizeUsd: number,
): Promise<void> {
  const marginAcct = marginPda(bot.publicKey);
  const posPda = positionPda(market.marketPubkey, bot.publicKey);
  const oracle = oraclePda(market.marketPubkey);

  // size in LOT_PRECISION units = (quoteSizeUsd * LOT_PRECISION * PRICE_PRECISION) / markPrice
  const LOT_PRECISION = 1_000_000;
  const rawSize = Math.floor((quoteSizeUsd * LOT_PRECISION * PRICE_PRECISION) / markPrice);
  if (rawSize <= 0) return;

  const size = new BN(rawSize);
  const price = new BN(markPrice);

  for (const side of ['long', 'short'] as const) {
    try {
      await program.methods
        .placeOrder({
          side: side === 'long' ? { long: {} } : { short: {} },
          orderType: { limit: {} },
          price,
          size,
        })
        .accounts({
          taker: bot.publicKey,
          market: market.marketPubkey,
          takerPosition: posPda,
          takerMargin: marginAcct,
          systemProgram: SYSTEM_PROGRAM_ID,
          oracleFeed: oracle,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .remainingAccounts([])
        .rpc();
      console.log(`[mm] quoted ${side} $${(markPrice / PRICE_PRECISION).toFixed(2)} size=${rawSize} ($${quoteSizeUsd.toFixed(0)} notional) on ${market.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mm] place failed (${market.name} ${side}): ${msg.slice(0, 120)}`);
    }
  }
}

async function getFreeMarginUsd(program: Program, bot: Keypair): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const margin = await (program.account as any).marginAccount.fetch(marginPda(bot.publicKey));
    const deposited = Number(margin.usdcDeposited?.toString() ?? margin.usdc_deposited?.toString() ?? 0);
    const locked   = Number(margin.usdcLocked?.toString()   ?? margin.usdc_locked?.toString()   ?? 0);
    return Math.max(0, (deposited - locked)) / PRICE_PRECISION;
  } catch {
    return 0;
  }
}

async function tick(
  connection: Connection,
  program: Program,
  bot: Keypair,
): Promise<void> {
  // Size each quote so that all 14 resting orders together use ~70% of free margin.
  // quoteSizeUsd = (freeMargin × 0.7) / (numMarkets × 2 sides) / marginRatio
  const freeMarginUsd = await getFreeMarginUsd(program, bot);
  // Each quote uses (INIT_MARGIN_BPS/10000) of its notional as margin.
  // Spread 70% of free margin across all 14 resting orders, cap at $500/side.
  const perSideMarginUsd = (freeMarginUsd * 0.7) / (MARKETS.length * 2);
  const quoteSizeUsd = Math.min(500, Math.max(10, perSideMarginUsd / (INIT_MARGIN_BPS / 10_000)));
  console.log(`[mm] free margin $${freeMarginUsd.toFixed(2)} → quoting $${quoteSizeUsd.toFixed(0)} notional/side`);

  for (const market of MARKETS) {
    try {
      const markPrice = await readOraclePrice(connection, market.marketPubkey);
      if (!markPrice || markPrice <= 0) {
        console.log(`[mm] no oracle price for ${market.name}, skipping`);
        continue;
      }
      const last = lastQuotedPrice.get(market.name) ?? 0;
      const moved = last === 0 ? 1 : Math.abs(markPrice - last) / last;
      if (moved < REQUOTE_THRESHOLD) {
        continue; // price stable — leave existing quotes in place
      }
      await cancelBotOrders(connection, program, bot, market);
      await quoteBothSides(program, bot, market, markPrice, quoteSizeUsd);
      lastQuotedPrice.set(market.name, markPrice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mm] tick error (${market.name}): ${msg.slice(0, 120)}`);
    }
    // Stagger markets to stay under RPC rate limit.
    await sleep(2500);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runMarketMaker(): Promise<void> {
  const keypairPath = process.env.KEEPER_MM_KEYPAIR_PATH ?? process.env.KEYPAIR_PATH;
  if (!keypairPath) throw new Error('KEYPAIR_PATH env var is not set');
  const raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const bot = Keypair.fromSecretKey(Uint8Array.from(raw));

  const rpcUrl = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const wallet = makeWallet(bot);
  const provider = new AnchorProvider(connection, wallet as never, { commitment: 'confirmed' });

  const idlPath = path.resolve(__dirname, '../../target/idl/protoperps.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`Protoperps IDL not found at ${idlPath}. Run: anchor build`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require(idlPath) as import('@coral-xyz/anchor').Idl;
  const program = new Program(idl, provider);

  console.log('[mm] market maker starting');
  console.log(`  bot       : ${bot.publicKey.toBase58()}`);
  console.log(`  rpc       : ${rpcUrl}`);
  console.log(`  interval  : ${REQUOTE_INTERVAL_MS}ms`);
  console.log(`  markets   : ${MARKETS.map(m => m.name).join(', ')}`);
  console.log('');

  await ensureUsdc(connection, bot, program);

  for (;;) {
    const start = Date.now();
    await tick(connection, program, bot);
    const elapsed = Date.now() - start;
    const wait = Math.max(0, REQUOTE_INTERVAL_MS - elapsed);
    console.log(`[mm] tick done in ${elapsed}ms, sleeping ${wait}ms`);
    if (wait > 0) await sleep(wait);
  }
}
