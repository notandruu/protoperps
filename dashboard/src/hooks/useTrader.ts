'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'trader_id';

export function useTrader() {
  const [traderId, setTraderIdState] = useState<string>('');

  useEffect(() => {
    setTraderIdState(localStorage.getItem(STORAGE_KEY) ?? '');
  }, []);

  const setTraderId = useCallback((id: string) => {
    const trimmed = id.trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    setTraderIdState(trimmed);
  }, []);

  return { traderId, setTraderId };
}
