import { Alert, Card, Heading } from '../ui/components.js';
import { h } from '../ui/dom.js';
import { profilePanel } from './profile-panel.js';

/** No role the user can use yet: show both profiles and the next step the API allows. */
export function renderOnboardingHub(ctx) {
  const panel = profilePanel(ctx, { emphasize: true });
  const el = Card({
    className: 'card-wide',
    children: [
      Heading({ text: 'Hoàn tất hồ sơ' }),
      h('p', { class: 'lead' }, 'Tài khoản của bạn chưa có vai trò dùng được. Một tài khoản có thể có cả Quán và Xế, bạn có thể làm lần lượt từng hồ sơ.'),
      panel.el,
      panel.hasAction
        ? null
        : Alert({
            tone: 'warning',
            message: 'Hiện chưa có hồ sơ nào bạn có thể tạo hoặc tiếp tục. Liên hệ đội vận hành 11Ship để được hỗ trợ.',
          }),
    ],
  });
  return { title: 'Hoàn tất hồ sơ', el, layout: 'app' };
}
