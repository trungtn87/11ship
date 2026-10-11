import { startDesign } from '../../../client-shared/src/design/start.js';
import { galleryScreens, stateScreens } from '../../../client-shared/src/design/foundation.js';
import { FOOD_BRAND } from '../../../client-shared/src/brand.js';
import { SAMPLE } from '../../../client-shared/src/design/samples.js';
import { AccountView, ScreenDef } from '../../../client-shared/src/screen.js';
import { FOOD_DEFINITION } from '../screens.js';

// Design preview of 11Food. Sample data only, shown with the "Dữ liệu minh họa" label. No session, no backend.
const SIGNED_SCREENS = new Set(['profile', 'shop-start', 'shop-onboarding', 'shop-location', 'shop-home']);

function sampleAccount(screen: ScreenDef, variant: string): AccountView | undefined {
  const base = { ...SAMPLE.person, roles: ['CUSTOMER'] as readonly string[] };
  if (screen.id === 'account') {
    if (variant === 'default' || variant === 'guest') {
      return undefined;
    }
    if (variant === 'shop-draft') {
      return { ...base, roles: ['CUSTOMER', 'SHOP_OWNER'], shop: { state: 'DRAFT' } };
    }
    if (variant === 'shop-complete') {
      return { ...base, roles: ['CUSTOMER', 'SHOP_OWNER'], shop: { state: 'COMPLETE', name: `${SAMPLE.shop.name} (mẫu)` } };
    }
    return base;
  }
  if (screen.id === 'home' || screen.id === 'orders') {
    return variant === 'signed-in' ? base : undefined;
  }
  if (screen.id === 'shop-home') {
    return { ...base, roles: ['CUSTOMER', 'SHOP_OWNER'], shop: { state: 'COMPLETE', name: `${SAMPLE.shop.name} (mẫu)` } };
  }
  return SIGNED_SCREENS.has(screen.id) ? base : undefined;
}

const root = document.getElementById('app');
if (root !== null) {
  startDesign(root, {
    definition: FOOD_DEFINITION,
    title: '11Food',
    subtitle: 'Khách hàng và chủ quán · M01',
    extras: [...stateScreens(FOOD_BRAND), ...galleryScreens()],
    account: sampleAccount,
  });
}
