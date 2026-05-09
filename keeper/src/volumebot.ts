/**
 * volumebot.ts — demo volume bot
 *
 * Simulates active trading by continuously opening and closing positions
 * across random markets. Creates real on-chain fills against the market
 * maker's resting quotes, producing visible volume and open-interest changes.
 *
 * Flow per tick:
 *   1. For each market: read fresh orderbook + current position.
 *   2. If no open position → place a taker order crossing the MM's quote.
 *   3. If position open   → place the opposing taker order to close it.
 *
 * The bot funds itself on first run:
 *   - Airdrops devnet SOL if balance < 0.5 SOL.
 *   - Mints devnet USDC via the mm-keypair mint authority.
 *   - Deposits USDC into a margin account.
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, BN, Wallet } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
  getAccount,
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

const TICK_INTERVAL_MS = parseInt(process.env.VOLUME_BOT_INTERVAL_MS ?? '8000', 10);
const DEPOSIT_USDC = parseInt(process.env.VOLUME_BOT_DEPOSIT_USDC ?? '500', 10);
// Notional USD per trade leg. Small enough to not exhaust margin quickly.
const TRADE_SIZE_USD = parseFloat(process.env.VOLUME_BOT_TRADE_SIZE_USD ?? '3');
const LOT_PRECISION = 1_000_000;

// Keypair file for the volume bot wallet.
const VOLUME_BOT_KEYPAIR_PATH =
  process.env.VOLUME_BOT_KEYPAIR_PATH ??
  path.join(__dirname, '../volume-bot-keypair.json');

// ── PDA helpers ────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Oracle price reader ────────────────────────────────────────────────────

async function readOraclePrice(
  connection: Connection,
  market: MarketConfig,
): Promise<number | null> {
  try {
    const oracle = oraclePda(market.marketPubkey);
    const info = await connection.getAccountInfo(oracle, 'confirmed');
    if (!info || info.data.length < 88) return null;
    const view = new DataView(info.data.buffer, info.data.byteOffset);
    const lo = view.getUint32(80, true);
    const hi = view.getUint32(84, true);
    const raw = hi * 0x100000000 + lo;
    return raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

// ── Wallet setup ───────────────────────────────────────────────────────────

function loadOrCreateKeypair(): Keypair {
  if (fs.existsSync(VOLUME_BOT_KEYPAIR_PATH)) {
    const raw = JSON.parse(fs.readFileSync(VOLUME_BOT_KEYPAIR_PATH, 'utf-8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(VOLUME_BOT_KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)));
  console.log('[vol] generated new keypair:', kp.publicKey.toBase58());
  return kp;
}

async function ensureSol(connection: Connection, bot: Keypair): Promise<void> {
  const bal = await connection.getBalance(bot.publicKey);
  if (bal >= 0.5e9) return;
  console.log('[vol] airdropping devnet SOL…');
  try {
    const sig = await connection.requestAirdrop(bot.publicKey, 2e9);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('[vol] airdrop confirmed');
  } catch (err) {
    console.warn('[vol] airdrop failed:', err instanceof Error ? err.message : err);
  }
}

async function ensureUsdc(
  connection: Connection,
  bot: Keypair,
  program: Program,
): Promise<void> {
  const botUsdc = getAssociatedTokenAddressSync(USDC_MINT, bot.publicKey);
  const marginAcct = marginPda(bot.publicKey);

  // Create USDC ATA if missing.
  const ataInfo = await connection.getAccountInfo(botUsdc);
  if (!ataInfo) {
    console.log('[vol] creating USDC ATA…');
    const ix = createAssociatedTokenAccountInstruction(
      bot.publicKey, botUsdc, bot.publicKey, USDC_MINT,
    );
    await (program.provider as AnchorProvider).sendAndConfirm(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (require('@solana/web3.js').Transaction)().add(ix),
    );
  }

  // Check current USDC balance — mint more if under 100.
  let usdcBalance = 0;
  try {
    const acct = await getAccount(connection, botUsdc);
    usdcBalance = Number(acct.amount) / 1e6;
  } catch { /* not yet created */ }

  if (usdcBalance < 100) {
    console.log(`[vol] minting ${DEPOSIT_USDC} USDC to volume bot…`);
    try {
      // Use mm-keypair as mint authority (same as faucet).
      const mmPath = process.env.KEYPAIR_PATH ?? path.join(__dirname, '../mm-keypair.json');
      const mmRaw = JSON.parse(fs.readFileSync(mmPath, 'utf-8')) as number[];
      const mmKeypair = Keypair.fromSecretKey(Uint8Array.from(mmRaw));

      await mintTo(
        connection,
        mmKeypair,
        USDC_MINT,
        botUsdc,
        mmKeypair,
        BigInt(DEPOSIT_USDC) * BigInt(1_000_000),
      );
      console.log(`[vol] minted ${DEPOSIT_USDC} USDC`);
    } catch (err) {
      console.warn('[vol] mint failed:', err instanceof Error ? err.message : err);
    }
  }

  // Check margin balance; deposit if low.
  let freeMargin = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const margin = await (program.account as any).marginAccount.fetch(marginAcct);
    freeMargin = (margin.usdcDeposited as BN).sub(margin.usdcLocked as BN).toNumber();
  } catch { /* doesn't exist yet */ }

  if (freeMargin < DEPOSIT_USDC * 0.2 * 1e6) {
    const depositAmount = DEPOSIT_USDC * 1e6;
    console.log(`[vol] depositing $${DEPOSIT_USDC} USDC into margin…`);
    try {
      const vaultAuthority = PublicKey.findProgramAddressSync(
        [Buffer.from('vault')],
        PROTOPERPS_PROGRAM_ID,
      )[0];
      const vault = getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);

      await program.methods
        .depositCollateral(new BN(depositAmount))
        .accounts({
          owner: bot.publicKey,
          marginAccount: marginAcct,
          userUsdc: botUsdc,
          vault,
          vaultAuthority,
          usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SYSTEM_PROGRAM_ID,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .rpc();
      console.log(`[vol] deposited $${DEPOSIT_USDC} USDC`);
    } catch (err) {
      console.warn('[vol] deposit failed:', err instanceof Error ? err.message : err);
    }
  }
}

// ── Orderbook reader ───────────────────────────────────────────────────────

interface RawOrder {
  price: number;
  size: number;
  trader: PublicKey;
  active: boolean;
}

async function fetchBook(
  program: Program,
  market: MarketConfig,
): Promise<{ bids: RawOrder[]; asks: RawOrder[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mkt = await (program.account as any).market.fetch(market.marketPubkey);
  const numBids: number = mkt.numBids ?? 0;
  const numAsks: number = mkt.numAsks ?? 0;

  const parse = (raw: Record<string, unknown>): RawOrder => ({
    price: Number((raw.price as BN)?.toString() ?? 0),
    size: Number((raw.size as BN)?.toString() ?? 0),
    trader: raw.trader as PublicKey,
    active: Boolean(raw.active),
  });

  const bids: RawOrder[] = (mkt.bids as Record<string, unknown>[])
    .slice(0, numBids)
    .filter((o: Record<string, unknown>) => Boolean(o.active))
    .map(parse);

  const asks: RawOrder[] = (mkt.asks as Record<string, unknown>[])
    .slice(0, numAsks)
    .filter((o: Record<string, unknown>) => Boolean(o.active))
    .map(parse);

  return { bids, asks };
}

// ── Position reader ────────────────────────────────────────────────────────

interface PositionState {
  size: number;
  side: number; // 0=Long, 1=Short
}

async function fetchPosition(
  program: Program,
  market: MarketConfig,
  trader: PublicKey,
): Promise<PositionState | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = await (program.account as any).position.fetch(
      positionPda(market.marketPubkey, trader),
    );
    const size = Number((pos.size as BN).toString());
    if (size === 0) return null;
    const sideVal = typeof pos.side === 'object'
      ? ('short' in pos.side ? 1 : 0)
      : Number(pos.side);
    return { size, side: sideVal };
  } catch {
    return null;
  }
}

// ── Trade execution ────────────────────────────────────────────────────────

async function placeTaker(
  program: Program,
  bot: Keypair,
  market: MarketConfig,
  side: 'long' | 'short',
  price: number,
  size: number,
  makerTrader: PublicKey,
): Promise<string> {
  const oracle = oraclePda(market.marketPubkey);
  const takerPos = positionPda(market.marketPubkey, bot.publicKey);
  const takerMargin = marginPda(bot.publicKey);
  const makerPos = positionPda(market.marketPubkey, makerTrader);

  const sig = await program.methods
    .placeOrder({
      side: side === 'long' ? { long: {} } : { short: {} },
      orderType: { limit: {} },
      price: new BN(price),
      size: new BN(size),
    })
    .accounts({
      taker: bot.publicKey,
      market: market.marketPubkey,
      takerPosition: takerPos,
      takerMargin,
      systemProgram: SYSTEM_PROGRAM_ID,
      oracleFeed: oracle,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .remainingAccounts([{ pubkey: makerPos, isWritable: true, isSigner: false }])
    .rpc();

  return sig;
}

// ── Main tick ──────────────────────────────────────────────────────────────

async function tick(
  connection: Connection,
  program: Program,
  bot: Keypair,
): Promise<void> {
  // Shuffle markets so we hit different ones each tick.
  const shuffled = [...MARKETS].sort(() => Math.random() - 0.5);

  for (const market of shuffled.slice(0, 3)) {
    try {
      const markPrice = await readOraclePrice(connection, market);
      if (!markPrice || markPrice <= 0) continue;

      const { bids, asks } = await fetchBook(program, market);
      const position = await fetchPosition(program, market, bot.publicKey);

      if (!position) {
        // Open a new position — pick a side based on which book side has liquidity.
        const canLong = asks.length > 0;
        const canShort = bids.length > 0;
        if (!canLong && !canShort) continue;

        const goLong = canLong && (!canShort || Math.random() < 0.5);
        const side = goLong ? 'long' : 'short';
        const maker = goLong ? asks[0] : bids[0];

        const rawSize = Math.floor((TRADE_SIZE_USD * LOT_PRECISION * PRICE_PRECISION) / markPrice);
        if (rawSize <= 0) continue;

        const sig = await placeTaker(program, bot, market, side, maker.price, rawSize, maker.trader);
        console.log(`[vol] opened ${side} on ${market.name} @ $${(maker.price / PRICE_PRECISION).toFixed(2)}  sig=${sig.slice(0, 16)}…`);

      } else {
        // Close existing position — flip the side.
        const closeSide = position.side === 0 ? 'short' : 'long';
        const maker = closeSide === 'long' ? asks[0] : bids[0];
        if (!maker) continue;

        const sig = await placeTaker(program, bot, market, closeSide, maker.price, position.size, maker.trader);
        console.log(`[vol] closed ${closeSide} on ${market.name} @ $${(maker.price / PRICE_PRECISION).toFixed(2)}  sig=${sig.slice(0, 16)}…`);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('FundingTooEarly') && !msg.includes('429')) {
        console.warn(`[vol/${market.name}] ${msg.slice(0, 100)}`);
      }
    }

    await sleep(1_500);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runVolumeBot(): Promise<void> {
  const bot = loadOrCreateKeypair();
  const rpcUrl = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const provider = new AnchorProvider(
    connection,
    new Wallet(bot),
    { commitment: 'confirmed', preflightCommitment: 'confirmed' },
  );

  const idlPath = path.resolve(__dirname, '../../target/idl/protoperps.json');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require(idlPath) as import('@coral-xyz/anchor').Idl;
  const program = new Program(idl, provider);

  console.log('[vol] volume bot starting');
  console.log(`  wallet   : ${bot.publicKey.toBase58()}`);
  console.log(`  rpc      : ${rpcUrl}`);
  console.log(`  interval : ${TICK_INTERVAL_MS}ms`);
  console.log('');

  await ensureSol(connection, bot);
  await ensureUsdc(connection, bot, program);

  for (;;) {
    const start = Date.now();
    await tick(connection, program, bot);
    const elapsed = Date.now() - start;
    const wait = Math.max(0, TICK_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }
}
