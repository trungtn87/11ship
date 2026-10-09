import { describeDriver, describeShop } from '../core/projection.js';
import { Badge, Button } from '../ui/components.js';
import { h } from '../ui/dom.js';

const SHOP_REQUIREMENTS = 'Cần: tên quán, số điện thoại liên hệ, địa chỉ, vị trí lấy hàng (GPS) và khu vực phục vụ.';
const DRIVER_REQUIREMENTS = 'Cần: họ tên. Biển số xe có thể bổ sung. Hồ sơ sẽ chờ vận hành duyệt.';

/**
 * The profile status of both roles from the server projection: badge with text, what is still needed, and the next
 * action only when the API allows one (start / continue). Nothing here is a button that does nothing.
 */
export function profilePanel(ctx, { emphasize = false } = {}) {
  const me = ctx.state.me;
  const shop = describeShop(me);
  const driver = describeDriver(me);

  const shopAction =
    shop.action === null
      ? null
      : Button({
          label: shop.action === 'start' ? 'Tạo hồ sơ quán' : 'Tiếp tục hồ sơ quán',
          variant: emphasize ? 'primary' : 'secondary',
          onClick: () => ctx.go('shop-onboarding'),
        });
  const driverAction =
    driver.action === null
      ? null
      : Button({
          label: 'Đăng ký làm xế',
          variant: emphasize ? 'primary' : 'secondary',
          onClick: () => ctx.go('driver-onboarding'),
        });

  const shopNote =
    me.shop === 'COMPLETED' && !me.availableRoles.includes('SHOP')
      ? 'Quán đã có hồ sơ nhưng chưa dùng được vai trò Quán. Liên hệ đội vận hành 11Ship.'
      : me.shop === 'COMPLETED'
        ? null
        : SHOP_REQUIREMENTS;
  const driverNote =
    me.driver === 'NOT_STARTED'
      ? DRIVER_REQUIREMENTS
      : me.driver === 'PENDING_APPROVAL'
        ? 'Hồ sơ đã gửi. Bạn chưa nhận đơn được cho tới khi vận hành duyệt.'
        : null;

  return {
    hasAction: shopAction !== null || driverAction !== null,
    el: h(
      'div',
      { class: 'profile-panel' },
      h(
        'article',
        { class: 'profile-row', 'aria-labelledby': 'profile-shop-title' },
        h('div', { class: 'profile-head' }, h('h2', { id: 'profile-shop-title', class: 'h3' }, 'Hồ sơ Quán'), Badge({ tone: shop.tone, label: shop.label })),
        shopNote ? h('p', { class: 'help' }, shopNote) : null,
        shopAction,
      ),
      h(
        'article',
        { class: 'profile-row', 'aria-labelledby': 'profile-driver-title' },
        h('div', { class: 'profile-head' }, h('h2', { id: 'profile-driver-title', class: 'h3' }, 'Hồ sơ Xế'), Badge({ tone: driver.tone, label: driver.label })),
        driverNote ? h('p', { class: 'help' }, driverNote) : null,
        driverAction,
      ),
    ),
  };
}
