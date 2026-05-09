import { runOracleKeeper } from './oracle';
import { runMarketMaker } from './marketmaker';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  runOracleKeeper().catch(err => {
    console.error('[oracle keeper] fatal error:', err);
    process.exit(1);
  });

  await sleep(20_000);
  runMarketMaker().catch(err => {
    console.error('[market maker] fatal error:', err);
    process.exit(1);
  });
}

main();
