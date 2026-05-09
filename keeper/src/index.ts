import { runOracleKeeper } from './oracle';
import { runMarketMaker } from './marketmaker';
import { runVolumeBot } from './volumebot';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Three services only — oracle + market maker + volume bot.
// Funding and liquidator disabled to stay within Helius free-tier RPC limits.
async function main() {
  runOracleKeeper().catch(err => {
    console.error('[oracle keeper] fatal error:', err);
    process.exit(1);
  });

  await sleep(8_000);
  runMarketMaker().catch(err => {
    console.error('[market maker] fatal error:', err);
    process.exit(1);
  });

  await sleep(12_000);
  runVolumeBot().catch(err => {
    console.error('[volume bot] fatal error:', err);
  });
}

main();
