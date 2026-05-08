import { PRICE_PRECISION, LOT_PRECISION, BPS_PRECISION } from './constants';

/** Format a u64 price (scaled by PRICE_PRECISION) as a dollar string. */
export function formatPrice(price: number | bigint, decimals = 2): string {
  const n = typeof price === 'bigint' ? Number(price) : price;
  return '$' + (n / PRICE_PRECISION).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a u64 USDC amount (scaled by PRICE_PRECISION) as a dollar string. */
export function formatUsdc(amount: number | bigint, decimals = 2): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount;
  return '$' + (n / PRICE_PRECISION).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a u64 size (scaled by LOT_PRECISION) as a decimal quantity. */
export function formatSize(size: number | bigint, decimals = 4): string {
  const n = typeof size === 'bigint' ? Number(size) : size;
  return (n / LOT_PRECISION).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a funding rate (in FUNDING_PRECISION units) as a percentage string. */
export function formatFundingRate(rate: number | bigint): string {
  const n = typeof rate === 'bigint' ? Number(rate) : rate;
  const pct = (n / 1_000_000_000) * 100;
  return pct.toFixed(4) + '%';
}

/** Format an i64 PnL (in PRICE_PRECISION units) with sign and colour class. */
export function formatPnl(pnl: number | bigint, decimals = 2): string {
  const n = typeof pnl === 'bigint' ? Number(pnl) : pnl;
  const usd = n / PRICE_PRECISION;
  const sign = usd >= 0 ? '+' : '';
  return sign + '$' + usd.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function pnlClass(pnl: number | bigint): string {
  const n = typeof pnl === 'bigint' ? Number(pnl) : pnl;
  return n >= 0 ? 'text-emerald-500' : 'text-red-500';
}

/**
 * Calculate unrealized PnL in PRICE_PRECISION units.
 * Mirrors programs/protoperps/src/math/pnl.rs
 */
export function calcUnrealizedPnl(
  entryPrice: number,
  markPrice: number,
  size: number,
  side: 'long' | 'short',
): number {
  const diff = side === 'long'
    ? markPrice - entryPrice
    : entryPrice - markPrice;
  return (diff * size) / LOT_PRECISION;
}

/**
 * Calculate margin ratio in basis points.
 * Returns 0 for insolvent or zero-notional positions.
 */
export function calcMarginRatio(
  collateral: number,
  upnl: number,
  markNotional: number,
): number {
  if (markNotional === 0) return 0;
  const equity = collateral + upnl;
  if (equity <= 0) return 0;
  return (equity * BPS_PRECISION) / markNotional;
}

/**
 * Calculate the liquidation price for a position.
 * maintMarginRatioBps defaults to 1000 (10%).
 */
export function calcLiquidationPrice(
  entryPrice: number,
  size: number,
  collateral: number,
  side: 'long' | 'short',
  maintMarginRatioBps = 1000,
): number {
  const B = BPS_PRECISION;
  const L = LOT_PRECISION;
  const M = maintMarginRatioBps;
  const C = collateral;
  const E = entryPrice;
  const S = size;

  if (S === 0) return 0;

  if (side === 'long') {
    // P = B * (C * L - E * S) / (S * (M - B))
    return (B * (C * L - E * S)) / (S * (M - B));
  } else {
    // P = B * (C * L + E * S) / (S * (M + B))
    return (B * (C * L + E * S)) / (S * (M + B));
  }
}

/**
 * Calculate effective leverage for a position.
 * leverage = notional / collateral
 */
export function calcLeverage(
  entryPrice: number,
  size: number,
  collateral: number,
): number {
  if (collateral === 0) return 0;
  const notional = (entryPrice * size) / LOT_PRECISION;
  return notional / collateral;
}

/**
 * Convert a user-facing dollar amount to the on-chain u64 representation.
 * e.g. "100.50" → 100_500_000
 */
export function usdToRaw(dollars: number): number {
  return Math.round(dollars * PRICE_PRECISION);
}

/**
 * Convert a user-facing size to the on-chain u64 representation.
 * e.g. "1.5" → 1_500_000
 */
export function sizeToRaw(size: number): number {
  return Math.round(size * LOT_PRECISION);
}
