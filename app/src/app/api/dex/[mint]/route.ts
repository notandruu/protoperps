import { NextResponse } from 'next/server';

interface DexPair {
  chainId: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  txns?: { h24?: { buys?: number; sells?: number } };
}

export async function GET(_: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;

  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
    next: { revalidate: 30 },
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `dexscreener ${res.status}` }, { status: res.status });
  }

  const json = await res.json() as { pairs?: DexPair[] };
  const pairs: DexPair[] = json.pairs ?? [];

  const solanaPairs = pairs
    .filter(p => p.chainId === 'solana' && p.priceUsd)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

  if (!solanaPairs.length) {
    return NextResponse.json({ error: 'no solana pairs' }, { status: 404 });
  }

  const p = solanaPairs[0];
  return NextResponse.json({
    price:     parseFloat(p.priceUsd!),
    change24h: p.priceChange?.h24 ?? 0,
    volume24h: p.volume?.h24 ?? 0,
    liquidity: p.liquidity?.usd ?? 0,
    marketCap: p.marketCap ?? p.fdv ?? 0,
    txns24h:   (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
  });
}
