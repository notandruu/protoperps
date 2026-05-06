import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from '@solana/spl-token';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';
const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT ?? 'EKdgVqQVivDRiXeQfK2k2Yx1W2BZZdYJ8D1KEaouriEM';
const FAUCET_AMOUNT_USDC = 1_000;
// Rate limit: one drip per wallet every 24 h (in-memory; resets on redeploy)
const drips = new Map<string, number>();

function loadMintAuthority(): Keypair {
  const raw = process.env.FAUCET_KEYPAIR_BASE64;
  if (!raw) throw new Error('FAUCET_KEYPAIR_BASE64 env var not set');
  return Keypair.fromSecretKey(Buffer.from(raw, 'base64'));
}

export async function POST(req: NextRequest) {
  let wallet: string;
  try {
    const body = (await req.json()) as { wallet?: string };
    wallet = body.wallet ?? '';
    new PublicKey(wallet); // validates
  } catch {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  }

  // 24-hour rate limit per wallet
  const last = drips.get(wallet) ?? 0;
  const now = Date.now();
  if (now - last < 24 * 60 * 60 * 1000) {
    const hoursLeft = ((24 * 60 * 60 * 1000 - (now - last)) / 3_600_000).toFixed(1);
    return NextResponse.json(
      { error: `Already dripped. Try again in ${hoursLeft}h.` },
      { status: 429 },
    );
  }

  try {
    const authority = loadMintAuthority();
    const connection = new Connection(RPC_URL, 'confirmed');
    const usdcMint = new PublicKey(USDC_MINT_STR);

    const mintInfo = await getMint(connection, usdcMint);
    const decimals = mintInfo.decimals;

    const dest = new PublicKey(wallet);
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      usdcMint,
      dest,
    );

    const sig = await mintTo(
      connection,
      authority,
      usdcMint,
      ata.address,
      authority,
      BigInt(FAUCET_AMOUNT_USDC) * BigInt(10 ** decimals),
    );

    drips.set(wallet, now);

    return NextResponse.json({ sig, amount: FAUCET_AMOUNT_USDC });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[faucet] error:', msg);
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
