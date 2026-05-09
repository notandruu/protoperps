import { runOracleKeeper } from './oracle';
import { runFundingKeeper } from './funding';
import { runLiquidatorKeeper } from './liquidator';
import { runMarketMaker } from './marketmaker';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Stagger service starts to avoid simultaneous RPC bursts at startup.
async function main() {
  runOracleKeeper().catch(err => {
    console.error('[oracle keeper] fatal error:', err);
    process.exit(1);
  });

  await sleep(5_000);
  runMarketMaker().catch(err => {
    console.error('[market maker] fatal error:', err);
    process.exit(1);
  });

  await sleep(5_000);
  runFundingKeeper().catch(err => {
    console.error('[funding keeper] fatal error:', err);
    process.exit(1);
  });

  await sleep(5_000);
  runLiquidatorKeeper().catch(err => {
    console.error('[liquidator keeper] fatal error:', err);
    process.exit(1);
  });
}

main();
