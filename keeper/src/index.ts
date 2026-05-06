import { runOracleKeeper } from './oracle';
import { runFundingKeeper } from './funding';
import { runLiquidatorKeeper } from './liquidator';
import { runMarketMaker } from './marketmaker';

Promise.all([
  runOracleKeeper().catch(err => {
    console.error('[oracle keeper] fatal error:', err);
    process.exit(1);
  }),
  runFundingKeeper().catch(err => {
    console.error('[funding keeper] fatal error:', err);
    process.exit(1);
  }),
  runLiquidatorKeeper().catch(err => {
    console.error('[liquidator keeper] fatal error:', err);
    process.exit(1);
  }),
  runMarketMaker().catch(err => {
    console.error('[market maker] fatal error:', err);
    process.exit(1);
  }),
]);
