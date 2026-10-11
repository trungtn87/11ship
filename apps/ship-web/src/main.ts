import { startLive } from '../../client-shared/src/app.js';
import { SHIP_DEFINITION } from './screens.js';

// Real 11Ship app: router + real paths. Nobody can be signed in yet (no login backend), so only guest screens are reachable.
const root = document.getElementById('app');
if (root !== null) {
  startLive(root, SHIP_DEFINITION);
}
