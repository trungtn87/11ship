import { AppDefinition } from '../../../client-shared/src/app.js';
import { FOOD_BRAND } from '../../../client-shared/src/brand.js';
import { startDesign } from '../../../client-shared/src/design/start.js';
import { galleryScreens, stateScreens } from '../../../client-shared/src/design/foundation.js';
import { emptyState } from '../../../client-shared/src/components.js';
import { ScreenDef } from '../../../client-shared/src/screen.js';
import { authScreens } from '../../../client-shared/src/screens/auth.js';
import { appPage } from '../../../client-shared/src/screens/layout.js';

// Design preview of the shared UI foundation (tokens, components, shared Auth screens, common states). Design-only app: it
// has no live entry. The two real apps (11Food, 11Ship) add their own screens on top of this.

const home: ScreenDef = {
  id: 'home',
  code: '—',
  title: 'Trang chủ (mẫu)',
  group: 'Tài khoản',
  path: '/home',
  access: 'public',
  variants: [{ id: 'default', label: 'Mặc định' }],
  render: (env) =>
    appPage({
      title: 'Trang chủ',
      body: [emptyState({ icon: 'home', title: 'Trang chủ của ứng dụng', text: 'Màn thật nằm trong từng app (11Food, 11Ship). Màn này chỉ là điểm đến mẫu của nền UI.', action: { label: 'Về màn chào', onClick: () => env.go('welcome') } })],
    }),
};

const routes = { afterLogin: { id: 'home' }, afterRegister: { id: 'home' }, guestHome: { id: 'home' } };

const definition: AppDefinition = {
  brand: FOOD_BRAND,
  screens: [...authScreens(FOOD_BRAND, routes), home],
  homeId: 'welcome',
  fallbackPath: '/welcome',
  loginPath: '/login',
  flowStart: {},
  testSmsNotice: true,
};

const root = document.getElementById('app');
if (root !== null) {
  startDesign(root, {
    definition,
    title: 'Nền UI dùng chung',
    subtitle: 'Màu, font, thành phần và màn Auth dùng chung của 11Food và 11Ship',
    extras: [...stateScreens(FOOD_BRAND), ...galleryScreens()],
    account: () => undefined,
  });
}
