import { Alert, Button, Card, Heading, Skeleton } from '../ui/components.js';
import { h } from '../ui/dom.js';
import { failureAlert } from './shared.js';

export function renderResolving() {
  return {
    title: 'Đang kiểm tra tài khoản',
    layout: 'auth',
    el: Card({
      className: 'card-auth',
      children: [
        Heading({ text: 'Đang kiểm tra tài khoản…' }),
        h('p', { class: 'lead' }, 'Chờ một chút, 11Ship đang tải thông tin của bạn.'),
        Skeleton({ lines: 3 }),
      ],
    }),
  };
}

/** The server answered something the client does not understand, or the projection could not be read: fail closed. */
export function renderUnsupported(ctx) {
  const failure = ctx.state.params.failure;
  const retry = Button({ label: 'Thử lại', onClick: () => ctx.resolveAndRoute() });
  const back = Button({ label: 'Về đăng nhập', variant: 'secondary', onClick: () => ctx.signOutLocal(null) });
  return {
    title: 'Chưa đọc được tài khoản',
    layout: 'auth',
    el: Card({
      className: 'card-auth',
      children: [
        Heading({ text: 'Chưa đọc được trạng thái tài khoản' }),
        failure
          ? failureAlert(failure, { tone: 'warning' })
          : Alert({ tone: 'warning', message: 'Thông tin tài khoản trả về chưa đúng định dạng. 11Ship không tự đoán vai trò của bạn.' }),
        h('div', { class: 'actions' }, retry, back),
      ],
    }),
  };
}

/** ACCOUNT_DISABLED: a typed refusal, not a retryable error. */
export function renderRefusal(ctx) {
  const failure = ctx.state.params.failure;
  return {
    title: 'Tài khoản đang bị khóa',
    layout: 'auth',
    el: Card({
      className: 'card-auth',
      children: [
        Heading({ text: 'Tài khoản đang bị khóa' }),
        failure ? failureAlert(failure, { tone: 'danger' }) : null,
        h('div', { class: 'actions' }, Button({ label: 'Về đăng nhập', variant: 'secondary', onClick: () => ctx.signOutLocal(null) })),
      ],
    }),
  };
}
