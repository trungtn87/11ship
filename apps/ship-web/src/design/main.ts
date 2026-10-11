import { SHIP_BRAND } from '../../../client-shared/src/brand.js';
import { galleryScreens, stateScreens } from '../../../client-shared/src/design/foundation.js';
import { SAMPLE } from '../../../client-shared/src/design/samples.js';
import { startDesign } from '../../../client-shared/src/design/start.js';
import { AccountView, ScreenDef } from '../../../client-shared/src/screen.js';
import { SHIP_DEFINITION } from '../screens.js';

// Design preview of 11Ship. Sample data only, shown with the "Dữ liệu minh họa" label. No session, no backend.
const PENDING: AccountView = { ...SAMPLE.person, roles: ['CUSTOMER', 'DRIVER'], driver: { status: 'PENDING', kind: 'EXTERNAL', legalName: SAMPLE.person.fullName, plate: null } };
const NO_PROFILE: AccountView = { ...SAMPLE.person, roles: ['CUSTOMER'], driver: { status: 'NONE' } };

function sampleAccount(screen: ScreenDef, variant: string): AccountView | undefined {
  if (screen.id === 'home' || screen.id === 'account') {
    return variant === 'pending' ? PENDING : variant === 'no-profile' ? NO_PROFILE : variant === 'logout-dialog' ? PENDING : undefined;
  }
  if (screen.id === 'driver-status') {
    return PENDING;
  }
  if (screen.id === 'driver-onboarding') {
    return NO_PROFILE;
  }
  return undefined;
}

const root = document.getElementById('app');
if (root !== null) {
  startDesign(root, {
    definition: SHIP_DEFINITION,
    title: '11Ship',
    subtitle: 'Xế · M01',
    extras: [...stateScreens(SHIP_BRAND), ...galleryScreens()],
    account: sampleAccount,
  });
}
