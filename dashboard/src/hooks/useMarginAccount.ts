'use client';

// No separate margin account in the REST engine — each position
// carries its own collateral. This stub keeps the MarginCard compiling.
export interface MarginAccountData {
  owner: string;
  usdcDeposited: number;
  usdcLocked: number;
  free: number;
}

export function useMarginAccount() {
  return { data: null as MarginAccountData | null, isLoading: false, error: null };
}
