/**
 * setup-devnet.ts
 *
 * One-shot devnet bootstrap:
 *  1. Uses existing USDC mint (USDC_MINT env var) or creates a fresh one
 *  2. Mints 10,000 USDC to the target wallet if we have mint authority
 *  3. Initializes all 7 protoperps markets
 *  4. Initializes oracle feeds with starting prices
 *
 * Usage:
 *   USDC_MINT=<mint> npx ts-node scripts/setup-devnet.ts <WALLET_ADDRESS>
 *
 * Env vars:
 *   USDC_MINT      — existing USDC mint to reuse (skips mint creation)
 *   KEYPAIR_PATH   — path to authority keypair JSON  (default: ~/.config/solana/id.json)
 *   RPC_URL        — devnet RPC endpoint             (default: https://api.devnet.solana.com)
 */

import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const PRICE_PRECISION = 1_000_000;
const USDC_DECIMALS = 6;
const USDC_AMOUNT = 10_000;

const PROTOPERPS_PROGRAM_ID = new PublicKey('J65U84LyKvCtv76ynd4MBCfjQqTXLjHvFbpieVqRUjbW');
const ORACLE_PROGRAM_ID = new PublicKey('Bk1ao9hgiYxubch1XtrtaWTsYFscMqbH5QnahB6WLMZV');

// ── Markets ───────────────────────────────────────────────────────────────────

interface MarketSetup {
  name: string;
  symbol: string;
  priceUsd: number;
}

const MARKETS: MarketSetup[] = [
  { name: 'SpaceX',     symbol: 'SPACEX', priceUsd: 715  },
  { name: 'OpenAI',     symbol: 'OPENAI', priceUsd: 1259 },
  { name: 'Anthropic',  symbol: 'ANTHRP', priceUsd: 1017 },
  { name: 'Anduril',    symbol: 'ANDURL', priceUsd: 140  },
  { name: 'Neuralink',  symbol: 'NRLNK',  priceUsd: 332  },
  { name: 'Kalshi',     symbol: 'KALSHI', priceUsd: 554  },
  { name: 'Polymarket', symbol: 'POLMKT', priceUsd: 178  },
];

// ── PDA helpers ───────────────────────────────────────────────────────────────

function marketPda(baseSymbol: string): PublicKey {
  const symbolBytes = Buffer.alloc(16);
  Buffer.from(baseSymbol, 'ascii').copy(symbolBytes);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), symbolBytes],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

function oraclePda(marketPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle'), marketPubkey.toBuffer()],
    ORACLE_PROGRAM_ID,
  );
  return pda;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function symbolBytes(symbol: string): number[] {
  const buf = Buffer.alloc(16, 0);
  Buffer.from(symbol, 'ascii').copy(buf);
  return Array.from(buf);
}

async function accountExists(connection: Connection, pubkey: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(pubkey);
  return info !== null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const walletArg = process.argv[2];
  if (!walletArg) {
    console.error('Usage: USDC_MINT=<mint> npx ts-node scripts/setup-devnet.ts <WALLET_ADDRESS>');
    process.exit(1);
  }

  let walletAddress: PublicKey;
  try {
    walletAddress = new PublicKey(walletArg);
  } catch {
    console.error(`Invalid wallet address: ${walletArg}`);
    process.exit(1);
  }

  // Load authority keypair
  const keypairPath =
    process.env.KEYPAIR_PATH ?? `${process.env.HOME}/.config/solana/id.json`;
  if (!fs.existsSync(keypairPath)) {
    console.error(`Keypair not found at ${keypairPath}`);
    process.exit(1);
  }
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8'))),
  );

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         protoperps devnet setup                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`Authority : ${authority.publicKey.toBase58()}`);
  console.log(`Wallet    : ${walletAddress.toBase58()}`);
  console.log(`RPC       : ${RPC_URL}`);

  const connection = new Connection(RPC_URL, 'confirmed');

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`SOL bal   : ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.3e9) {
    console.error('\nAuthority needs ≥ 0.3 SOL for rent + fees.');
    process.exit(1);
  }

  // ── Step 1: Resolve USDC mint ─────────────────────────────────────────────
  let usdcMint: PublicKey;
  if (process.env.USDC_MINT) {
    usdcMint = new PublicKey(process.env.USDC_MINT);
    console.log(`\n[1/3] Using existing USDC mint: ${usdcMint.toBase58()}`);
  } else {
    console.log('\n[1/3] Creating test USDC mint...');
    usdcMint = await createMint(
      connection,
      authority,
      authority.publicKey,
      authority.publicKey,
      USDC_DECIMALS,
    );
    console.log(`      Mint: ${usdcMint.toBase58()}`);
  }

  // ── Step 2: Mint USDC to target wallet ────────────────────────────────────
  console.log(`\n[2/3] Minting ${USDC_AMOUNT.toLocaleString()} USDC → ${walletAddress.toBase58()}...`);
  try {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      usdcMint,
      walletAddress,
    );
    await mintTo(
      connection,
      authority,
      usdcMint,
      ata.address,
      authority,
      BigInt(USDC_AMOUNT) * BigInt(10 ** USDC_DECIMALS),
    );
    console.log(`      ATA : ${ata.address.toBase58()}`);
    console.log(`      Minted ${USDC_AMOUNT.toLocaleString()} USDC ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`      Mint skipped (no authority?): ${msg.slice(0, 80)}`);
  }

  // ── Step 3: Initialize markets + oracle feeds ─────────────────────────────
  console.log('\n[3/3] Initializing markets and oracle feeds...');

  const protoperpsIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'target', 'idl', 'protoperps.json'), 'utf-8'),
  );
  const oracleIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'target', 'idl', 'oracle.json'), 'utf-8'),
  );

  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perpsProgram = new Program(protoperpsIdl as any, provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oracleProgram = new Program(oracleIdl as any, provider);

  for (const market of MARKETS) {
    const marketKey = marketPda(market.symbol);
    const oracleKey = oraclePda(marketKey);
    const price = market.priceUsd * PRICE_PRECISION;
    const confidence = Math.floor(price * 0.005);

    process.stdout.write(`  ${market.symbol.padEnd(6)} `);

    if (!(await accountExists(connection, marketKey))) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (perpsProgram.methods as any)
        .initializeMarket({
          baseSymbol: symbolBytes(market.symbol),
          oracle: oracleKey,
          tickSize: new BN(1_000),
          lotSize: new BN(1_000_000),
          maxLeverage: new BN(5),
          initialMarginRatio: new BN(2_000),
          maintenanceMarginRatio: new BN(1_000),
          liquidationRewardBps: new BN(500),
          takerFeeBps: new BN(10),
          makerFeeBps: new BN(5),
          fundingInterval: new BN(3_600),
        })
        .accounts({
          authority: authority.publicKey,
          market: marketKey,
          usdcMint,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      process.stdout.write('market ✓  ');
    } else {
      process.stdout.write('market —  ');
    }

    if (!(await accountExists(connection, oracleKey))) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (oracleProgram.methods as any)
        .initializeFeed({
          initialPrice: new BN(price),
          confidence: new BN(confidence),
          source: 1,
        })
        .accounts({
          authority: authority.publicKey,
          market: marketKey,
          oracle: oracleKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      process.stdout.write(`oracle @ $${market.priceUsd} ✓`);
    } else {
      process.stdout.write(`oracle —`);
    }

    console.log();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  Setup complete!                                     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\nUSDC mint: ${usdcMint.toBase58()}`);
  console.log('\nAdd to app/.env.local and Vercel env vars:');
  console.log(`  NEXT_PUBLIC_USDC_MINT=${usdcMint.toBase58()}`);
  console.log('\nMarket PDAs:');
  for (const market of MARKETS) {
    const mk = marketPda(market.symbol);
    const ok = oraclePda(mk);
    console.log(`  ${market.symbol.padEnd(6)} market=${mk.toBase58()}`);
    console.log(`         oracle=${ok.toBase58()}`);
  }
}

main().catch(err => {
  console.error('\nSetup failed:', err.message ?? err);
  process.exit(1);
});
