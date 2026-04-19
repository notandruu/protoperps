'use client';

import { useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { PROTOPERPS_PROGRAM_ID, ORACLE_PROGRAM_ID } from '@/lib/constants';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const protoperpsIdl = require('@/lib/protoperps.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracleIdl = require('@/lib/oracle.json');

export function usePrograms() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null;
    }
    return new AnchorProvider(
      connection,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wallet as any,
      { commitment: 'confirmed' },
    );
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Program(protoperpsIdl as any, provider);
  }, [provider]);

  const oracleProgram = useMemo(() => {
    if (!provider) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Program(oracleIdl as any, provider);
  }, [provider]);

  return { connection, provider, program, oracleProgram };
}
