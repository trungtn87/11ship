import { DesignViewer } from './viewer.js';
import { SCREENS } from './screens.js';

// Entry of the design preview page (design.html). Design-only: the real build removes this folder and design.html.

const root = document.getElementById('app');
if (root !== null) {
  new DesignViewer(root, 'Web quản trị 11Ship', SCREENS, 'overview').mount();
}
