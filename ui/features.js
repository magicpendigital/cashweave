// Core capabilities added by the redesign (plan section 4.4). This is the only file that binds them,
// so the screens depend on one small surface rather than on each core module's layout.
import { RECIPE_PRESETS as PRESETS } from '../core/recipes.js';
import { netWorth } from '../core/reports.js';
export const RECIPE_PRESETS = PRESETS;
export const coreNetWorth = netWorth;
export const FEATURES = Object.freeze({ presets: true, investmentAccounts: true, valuations: true, netWorth: true });
