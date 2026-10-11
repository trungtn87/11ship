import { startLive } from '../../client-shared/src/app.js';
import { FOOD_DEFINITION } from './screens.js';

// Real 11Food app: router + real paths. Nobody can be signed in yet (no login backend), so only guest screens are reachable.
const root = document.getElementById('app');
if (root !== null) {
  startLive(root, FOOD_DEFINITION);
}
