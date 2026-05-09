/**
 * set_leverage.ts — one-shot script to update all 7 markets to 50x leverage.
 *
 * New params:
 *   max_leverage       = 50
 *   initial_margin_ratio  = 200  (2%  in BPS)
 *   maintenance_margin_ratio = 100  (1%  in BPS)
 *
 * Usage:
 *   ts-node -r dotenv/config src/set_leverage.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, BN, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { MARKETS, PROTOPERPS_PROGRAM_ID } from './config';

// ── Config ─────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

const KEYPAIR_PATH =
  process.env.KEEPER_KEYPAIR ??
  path.join(process.env.HOME ?? '~', '.config/solana/id.json');

const MAX_LEVERAGE = new BN(50);
const INITIAL_MARGIN_RATIO = new BN(200);   // 2% in BPS
const MAINTENANCE_MARGIN_RATIO = new BN(100); // 1% in BPS

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load keypair
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8')) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log('Authority:', keypair.publicKey.toBase58());

  const connection = new Connection(RPC_URL, 'confirmed');

  const provider = new AnchorProvider(
    connection,
    new Wallet(keypair),
    { commitment: 'confirmed', preflightCommitment: 'confirmed' },
  );

  // Load IDL
  const idlPath = path.join(
    __dirname,
    '../../target/idl/protoperps.json',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as any;

  const program = new Program(idl, provider);

  // Process each market
  for (const market of MARKETS) {
    const marketPubkey = market.marketPubkey;
    console.log(`\n[${market.name}] market=${marketPubkey.toBase58()}`);

    try {
      const sig = await (program.methods as any)
        .updateMarketParams({
          maxLeverage: MAX_LEVERAGE,
          initialMarginRatio: INITIAL_MARGIN_RATIO,
          maintenanceMarginRatio: MAINTENANCE_MARGIN_RATIO,
        })
        .accounts({
          authority: keypair.publicKey,
          market: marketPubkey,
        })
        .rpc();

      console.log(`  ✓ tx: ${sig}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ failed: ${msg}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
