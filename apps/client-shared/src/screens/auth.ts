import { AppBrand, logo } from '../brand.js';
import { banner, checkbox, countdown, button, otpField, passwordField, setBusy, setButtonLabel, textField, textLink } from '../components.js';
import { FOOD_TEST_CONSENT } from '../consent.js';
import { formatCountdown, h } from '../dom.js';
import { icon, IconName } from '../icons.js';
import { ScreenDef, ScreenEnv, VariantDef } from '../screen.js';
import { STATE_COPY } from '../states.js';
import { isCompleteOtp, isValidPassword, isValidPhone, maskPhone, normalizePersonName } from '../validation.js';
import { failureBanner } from './feedback.js';
import { actionButton, appPage, designOnly, guardForm } from './layout.js';
import { liveRegisterOtp } from './register-live.js';
import { liveResetScreen } from './reset-live.js';

// Auth screens shared by 11Food and 11Ship (register, login, OTP, forgot and reset password). Display + form validation
// only. Every business action is gated until its backend exists (features.ts); in the preview it runs as a harmless demo.
// Rules of the approved design applied here: no Google login, no OTP login, no "remember me" (the session is a fixed
// 7 days with no refresh), password 8-128 characters with no composition rule, reset (not change) password, OTP never shown.

export interface Target {
  readonly id: string;
  readonly variant?: string;
}

export interface AuthRoutes {
  /** Where a successful login goes. */
  readonly afterLogin: Target;
  /** Where a verified register goes (Food: signed-in home, Ship: driver profile form). */
  readonly afterRegister: Target;
  /** The guest home. */
  readonly guestHome: Target;
}

const v = (id: string, label: string): VariantDef => ({ id, label });

function go(env: ScreenEnv, target: Target): void {
  env.go(target.id, target.variant);
}

function phoneError(value: string): string | undefined {
  return isValidPhone(value) ? undefined : STATE_COPY.invalidPhone;
}

/** Brand block at the top of the public auth screens: logo slot and slogan. */
function brandBlock(brand: AppBrand): HTMLElement {
  return h('div', { class: 'c-hero' }, logo(brand, true), h('p', { class: 'c-slogan' }, brand.slogan));
}

function codes(brand: AppBrand): { readonly welcome: string; readonly login: string; readonly register: string; readonly registerOtp: string; readonly reset: string; readonly resetOtp: string; readonly resetPassword: string } {
  return brand.id === 'FOOD'
    ? { welcome: 'F00', login: 'F10', register: 'F11', registerOtp: 'F12', reset: 'F13', resetOtp: 'F14', resetPassword: 'F15' }
    : { welcome: 'S00', login: 'S10', register: 'S11', registerOtp: 'S18', reset: 'S15', resetOtp: 'S16', resetPassword: 'S17' };
}

// ---- Welcome ------------------------------------------------------------------------------------------------------

function welcomeScreen(brand: AppBrand, routes: AuthRoutes): ScreenDef {
  const food = brand.id === 'FOOD';
  const points: readonly { readonly icon: IconName; readonly text: string }[] = food
    ? [
        { icon: 'utensils', text: 'Đa dạng món ngon' },
        { icon: 'truck', text: 'Giao nhanh tận nơi' },
        { icon: 'mapPin', text: 'Phủ khắp Cao Bằng' },
      ]
    : [
        { icon: 'truck', text: 'Giao nhanh' },
        { icon: 'wallet', text: 'Thu nhập tốt' },
      ];
  return {
    id: 'welcome',
    code: codes(brand).welcome,
    title: 'Chào mừng',
    group: 'Tài khoản',
    path: '/welcome',
    access: 'public',
    variants: [v('default', 'Mặc định')],
    render(env) {
      const head = food ? 'Món ngon gần bạn, chỉ vài chạm' : 'Kết nối mọi hành trình';
      const sub = food ? 'Đặt món, theo dõi đơn hàng, ngay trên điện thoại.' : 'Giao nhanh – Thu nhập tốt.';
      return appPage({
        bodyClass: 'c-stack c-stack--loose',
        body: [
          h('div', { class: 'c-hero c-hero--tall' }, logo(brand, true), h('p', { class: 'c-slogan' }, brand.slogan)),
          h('div', { class: 'c-stack c-stack--tight c-center' }, h('h1', { class: 'c-title' }, head), h('p', { class: 'c-lead' }, sub)),
          h('ul', { class: 'c-summary' }, ...points.map((point) => h('li', { class: 'c-row-flex' }, h('span', { class: 'c-item__icon' }, icon(point.icon, 22)), h('span', {}, point.text)))),
          h(
            'div',
            { class: 'c-stack' },
            button({ label: 'Đăng nhập', kind: 'primary', id: 'welcome-login', onClick: () => env.go('login') }),
            button({ label: food ? 'Đăng ký' : 'Đăng ký làm xế', kind: 'secondary', id: 'welcome-register', onClick: () => env.go('register') }),
            h('div', { class: 'c-center' }, textLink(food ? 'Tiếp tục với tư cách khách' : 'Tiếp tục xem ứng dụng', () => go(env, routes.guestHome))),
          ),
        ],
      });
    },
  };
}

// ---- Login --------------------------------------------------------------------------------------------------------

function loginScreen(brand: AppBrand, routes: AuthRoutes): ScreenDef {
  return {
    id: 'login',
    code: codes(brand).login,
    title: 'Đăng nhập',
    group: 'Tài khoản',
    path: '/login',
    access: 'public',
    variants: [v('default', 'Mặc định'), v('invalid-phone', 'Số điện thoại sai'), v('wrong-credentials', 'Sai thông tin'), v('rate-limited', 'Giới hạn thử'), v('offline', 'Mất kết nối'), v('submitting', 'Đang gửi')],
    render(env, variant) {
      const phone = textField({ id: 'phone', label: 'Số điện thoại', icon: 'phone', type: 'tel', inputMode: 'tel', autocomplete: 'username', placeholder: 'Nhập số điện thoại' });
      const password = passwordField({ id: 'password', label: 'Mật khẩu', autocomplete: 'current-password', placeholder: 'Nhập mật khẩu' });
      const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
      const submit = actionButton(env, 'auth.login', {
        label: 'Đăng nhập',
        type: 'submit',
        id: 'login-submit',
        onBlocked: () => {
          check();
        },
      });
      const forgot = h('div', { class: 'c-row-flex c-justify-end' }, textLink('Quên mật khẩu?', () => env.go('reset'), '/reset'));

      const check = (): boolean => {
        const phoneProblem = phoneError(phone.input.value);
        const passwordProblem = password.input.value === '' ? STATE_COPY.required : undefined;
        phone.setError(phoneProblem);
        password.setError(passwordProblem);
        if (phoneProblem !== undefined) {
          phone.input.focus();
        } else if (passwordProblem !== undefined) {
          password.input.focus();
        }
        return phoneProblem === undefined && passwordProblem === undefined;
      };
      phone.input.addEventListener('blur', () => phone.setError(phone.input.value === '' ? undefined : phoneError(phone.input.value)));
      phone.input.addEventListener('input', () => {
        if (phone.error() !== undefined) {
          phone.setError(phoneError(phone.input.value));
        }
      });

      const run = async (): Promise<void> => {
        if (!check()) {
          return;
        }
        if (env.mode === 'design') {
          designOnly(env, STATE_COPY.designNoSend);
          guard.release();
          go(env, routes.afterLogin);
          return;
        }
        if (env.auth !== undefined) {
          // Connected login (local https runtime): the adapter keeps ONE Idempotency-Key + body for an attempt whose outcome is unknown,
          // so "Thử lại" (or pressing the button again with the same input) re-sends the SAME request; nothing is re-sent by itself.
          if (signingIn) {
            return;
          }
          signingIn = true;
          feedback.replaceChildren();
          setBusy(submit.button, true, 'Đăng nhập', 'Đang kiểm tra…');
          const typed = { phone: phone.input.value.trim(), password: password.input.value };
          const answer = await env.auth.login(typed);
          signingIn = false;
          setBusy(submit.button, false, 'Đăng nhập', 'Đang kiểm tra…');
          if (answer.kind === 'stale') {
            return;
          }
          if (answer.kind === 'ok') {
            // The password never outlives the submit.
            password.input.value = '';
            guard.release();
            go(env, routes.afterLogin);
            return;
          }
          // A wrong password is a login failure shown here, never "the session expired". The typed password stays for a retry only
          // when the outcome is unknown (the same request is re-sent); a definite refusal asks for it again.
          if (!answer.unresolved) {
            password.input.value = '';
          }
          feedback.replaceChildren(failureBanner(answer.code, { retryAfterSeconds: answer.retryAfterSeconds, ...(answer.unresolved ? { onRetry: () => void run() } : {}) }));
          return;
        }
        setBusy(submit.button, true, 'Đăng nhập', 'Đang kiểm tra…');
        const outcome = await env.ports.auth.login({ phone: phone.input.value.trim(), password: password.input.value });
        // The password never outlives the submit.
        password.input.value = '';
        setBusy(submit.button, false, 'Đăng nhập', 'Đang kiểm tra…');
        if (outcome.kind === 'ok') {
          guard.release();
          go(env, routes.afterLogin);
          return;
        }
        feedback.replaceChildren(failureBanner(outcome.code, { retryAfterSeconds: outcome.retryAfterSeconds }));
      };
      let signingIn = false;
      const form = h('form', { class: 'c-stack', novalidate: true }, phone.root, password.root, forgot, feedback, submit.node);
      // C08: typed phone/password are asked about before leaving and wiped on exit.
      const guard = guardForm(env, form);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void run();
      });

      const food = brand.id === 'FOOD';
      const root = appPage({
        title: food ? 'Đăng nhập' : undefined,
        onBack: () => go(env, routes.guestHome),
        body: [
          food ? brandBlock(brand) : h('div', { class: 'c-stack c-stack--tight c-center' }, logo(brand, true), h('h1', { class: 'c-title' }, 'Chào mừng bạn trở lại'), h('p', { class: 'c-lead' }, 'Đăng nhập để tiếp tục')),
          form,
          h('p', { class: 'c-center c-lead' }, 'Chưa có tài khoản? ', textLink(food ? 'Tạo tài khoản mới' : 'Đăng ký ngay', () => env.go('register'), '/register')),
        ],
        bodyClass: 'c-stack c-stack--loose',
      });

      if (variant === 'invalid-phone') {
        phone.input.value = '09123456';
        phone.setError(STATE_COPY.invalidPhone);
      } else if (variant === 'wrong-credentials') {
        phone.input.value = '0981234123';
        password.input.value = 'matkhau-sai';
        feedback.replaceChildren(failureBanner('INVALID_CREDENTIALS'));
      } else if (variant === 'rate-limited') {
        phone.input.value = '0981234123';
        const note = h('p', { class: 'c-banner__text' });
        feedback.replaceChildren(banner({ kind: 'warn', title: 'Thử quá nhiều lần', text: note }));
        submit.button.setAttribute('aria-disabled', 'true');
        countdown(252, (remaining) => (note.textContent = STATE_COPY.rateLimited(formatCountdown(remaining))), () => submit.button.removeAttribute('aria-disabled'));
      } else if (variant === 'offline') {
        phone.input.value = '0981234123';
        feedback.replaceChildren(failureBanner('OFFLINE', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
      } else if (variant === 'submitting') {
        phone.input.value = '0981234123';
        password.input.value = 'matkhau123';
        setBusy(submit.button, true, 'Đăng nhập', 'Đang kiểm tra…');
      }
      return root;
    },
  };
}

// ---- Register -----------------------------------------------------------------------------------------------------

function registerScreen(brand: AppBrand, routes: AuthRoutes): ScreenDef {
  const food = brand.id === 'FOOD';
  return {
    id: 'register',
    code: codes(brand).register,
    title: food ? 'Đăng ký' : 'Đăng ký tài xế',
    group: 'Tài khoản',
    path: '/register',
    access: 'public',
    variants: [v('default', 'Mặc định'), v('errors', 'Lỗi nhập liệu'), v('consent', 'Chưa đồng ý'), v('phone-registered', 'SĐT đã có'), v('offline', 'Mất kết nối')],
    render(env, variant) {
      const name = textField({ id: 'full-name', label: 'Họ và tên', icon: 'user', autocomplete: 'name', placeholder: 'Nhập họ và tên của bạn', maxLength: 240 });
      const phone = textField({ id: 'phone', label: 'Số điện thoại', icon: 'phone', type: 'tel', inputMode: 'tel', autocomplete: 'username', placeholder: 'Nhập số điện thoại để nhận mã xác thực' });
      const password = passwordField({ id: 'password', label: 'Mật khẩu', autocomplete: 'new-password', placeholder: 'Tạo mật khẩu', hint: '8 đến 128 ký tự.' });
      const confirm = passwordField({ id: 'password-confirm', label: 'Nhập lại mật khẩu', autocomplete: 'new-password', placeholder: 'Nhập lại mật khẩu' });
      // 11Food: the two texts the Owner approved for the test build are shown IN FULL above the checkbox, which starts unchecked
      // (consent.ts). 11Ship has no approved text yet, so it keeps its label and the "chờ duyệt" note (no link to an empty page).
      // The approved test texts cover 11Ship as well ("bản thử nghiệm 11Ship/11Food"): a connected register shows them in either app.
      const offer = food ? env.register?.consent ?? FOOD_TEST_CONSENT : env.register?.consent;
      const consent = checkbox({ id: 'consent', label: offer?.checkboxLabel ?? 'Tôi đồng ý với Điều khoản dịch vụ và Chính sách bảo mật của 11Ship' });
      const consentBlock =
        offer === undefined
          ? h('p', { class: 'c-hint' }, 'Nội dung Điều khoản đang chờ duyệt, liên kết sẽ có khi được duyệt.')
          : h(
              'div',
              { class: 'c-stack c-stack--tight', id: 'consent-texts' },
              h('section', { class: 'c-card c-card--soft c-stack c-stack--tight' }, h('h2', { class: 'c-h2' }, offer.termsTitle), h('p', { class: 'c-lead' }, offer.termsText)),
              h('section', { class: 'c-card c-card--soft c-stack c-stack--tight' }, h('h2', { class: 'c-h2' }, offer.privacyTitle), h('p', { class: 'c-lead' }, offer.privacyText)),
            );
      const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
      // Connected register (live Food): the server says how a registration is verified (GET /v1/client-auth/config). Until it
      // answers - and after any failed answer - the submit stays locked: nothing is guessed, no default is assumed.
      const connected = env.mode === 'live' && env.register !== undefined;
      const modeStatus = h('p', { class: 'c-caption', id: 'register-mode-status', 'aria-live': 'polite' });
      const modeNote = h('p', { class: 'c-hint', id: 'register-mode-note' }, 'Bản test: tạm không xác minh số điện thoại');
      modeNote.hidden = true;
      const submit = actionButton(env, 'auth.register', {
        label: food ? 'Tiếp tục' : 'Đăng ký',
        type: 'submit',
        id: 'register-submit',
        onBlocked: () => {
          validate();
        },
      });

      const validate = (): boolean => {
        const nameOk = normalizePersonName(name.input.value) !== undefined;
        const phoneProblem = phoneError(phone.input.value);
        const passwordOk = isValidPassword(password.input.value);
        const matches = confirm.input.value === password.input.value;
        name.setError(nameOk ? undefined : STATE_COPY.nameInvalid);
        phone.setError(phoneProblem);
        password.setError(passwordOk ? undefined : STATE_COPY.passwordRule);
        confirm.setError(matches && confirm.input.value !== '' ? undefined : STATE_COPY.passwordMismatch);
        consent.setError(consent.input.checked ? undefined : STATE_COPY.consentRequired);
        const first: HTMLInputElement | undefined = !nameOk ? name.input : phoneProblem !== undefined ? phone.input : !passwordOk ? password.input : !(matches && confirm.input.value !== '') ? confirm.input : !consent.input.checked ? consent.input : undefined;
        first?.focus();
        return first === undefined;
      };
      let submitting = false;
      // Set just before the screen hands over on purpose (to the code step, or signed in): the guard's wipe then must not cancel the
      // flow that was just started. A real exit (a confirmed "leave", or the screen being replaced) leaves it false and cancels.
      let proceeding = false;
      const run = async (): Promise<void> => {
        if (!validate()) {
          return;
        }
        if (env.mode === 'design') {
          designOnly(env, STATE_COPY.designNoSend);
          env.flows.start('register-otp', { phone: phone.input.value.trim() });
          guard.release();
          env.go('register-otp');
          return;
        }
        if (env.register !== undefined) {
          const serverMode = env.register.mode();
          if (serverMode === undefined) {
            // The server's configuration has not been read (or could not be): the form is locked, nothing is sent.
            return;
          }
          if (submitting) {
            return;
          }
          if (serverMode === 'DISABLED_TEST') {
            // Test build without phone verification: ONE call registers straight from this form (no code, no F12). The same form
            // submitted again after an unknown answer re-sends the SAME request (same key and body).
            submitting = true;
            feedback.replaceChildren();
            setBusy(submit.button, true, 'Đăng ký', 'Đang xử lý…');
            const step = await env.register.registerDirect({ fullName: normalizePersonName(name.input.value) ?? name.input.value, phone: phone.input.value.trim(), password: password.input.value });
            submitting = false;
            if (step.kind === 'stale') {
              return;
            }
            if (step.kind === 'ok') {
              password.input.value = '';
              confirm.input.value = '';
              proceeding = true;
              guard.release();
              go(env, routes.afterRegister);
              return;
            }
            setBusy(submit.button, false, 'Đăng ký', 'Đang xử lý…');
            if (step.code === 'PHONE_ALREADY_REGISTERED') {
              phone.setError(STATE_COPY.phoneRegistered);
              phone.input.focus();
              return;
            }
            feedback.replaceChildren(failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds, ...(step.unresolved ? { onRetry: () => void run() } : {}) }));
            return;
          }
          // Real flow: the controller keeps the form (name, phone, password, consent pair) in memory while the code is asked for
          // and verified, so the final register sends exactly what was typed here. The fields are wiped when this screen is left.
          submitting = true;
          feedback.replaceChildren();
          setBusy(submit.button, true, 'Tiếp tục', 'Đang xử lý…');
          const started = await env.register.begin({ fullName: normalizePersonName(name.input.value) ?? name.input.value, phone: phone.input.value.trim(), password: password.input.value });
          submitting = false;
          if (started.kind === 'stale') {
            return;
          }
          setBusy(submit.button, false, 'Tiếp tục', 'Đang xử lý…');
          if (started.kind === 'ok') {
            proceeding = true;
            guard.release();
            env.go('register-otp');
            return;
          }
          if (started.code === 'PHONE_ALREADY_REGISTERED') {
            phone.setError(STATE_COPY.phoneRegistered);
            phone.input.focus();
            return;
          }
          feedback.replaceChildren(failureBanner(started.code, { retryAfterSeconds: started.retryAfterSeconds }));
          return;
        }
        setBusy(submit.button, true, food ? 'Tiếp tục' : 'Đăng ký', 'Đang xử lý…');
        const outcome = await env.ports.auth.requestRegisterOtp({ phone: phone.input.value.trim() });
        password.input.value = '';
        confirm.input.value = '';
        setBusy(submit.button, false, food ? 'Tiếp tục' : 'Đăng ký', 'Đang xử lý…');
        if (outcome.kind === 'ok') {
          env.flows.start('register-otp', { phone: phone.input.value.trim() });
          guard.release();
          env.go('register-otp');
          return;
        }
        if (outcome.code === 'PHONE_ALREADY_REGISTERED') {
          phone.setError(STATE_COPY.phoneRegistered);
          phone.input.focus();
          return;
        }
        feedback.replaceChildren(failureBanner(outcome.code, { retryAfterSeconds: outcome.retryAfterSeconds }));
      };
      const form = h(
        'form',
        { class: 'c-stack', novalidate: true },
        name.root,
        phone.root,
        password.root,
        confirm.root,
        h('div', { class: 'c-stack c-stack--tight' }, consentBlock, consent.root),
        ...(connected ? [modeStatus, modeNote] : []),
        feedback,
        submit.node,
      );
      // Leaving the screen drops what a direct register kept in memory and makes its answer stale (no session from it).
      const guard = guardForm(env, form, {
        onWipe: () => {
          if (!proceeding) {
            env.register?.cancel();
          }
        },
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void run();
      });
      // Live validation: a field is checked when the person leaves it (only if it has something in it) and re-checked while typing
      // once it shows an error. Empty required fields are reported when the form is submitted or the blocked button is pressed.
      const live = (field: typeof name, rule: () => string | undefined): void => {
        field.input.addEventListener('blur', () => field.setError(field.input.value === '' ? undefined : rule()));
        field.input.addEventListener('input', () => {
          if (field.error() !== undefined) {
            field.setError(rule());
          }
        });
      };
      live(name, () => (normalizePersonName(name.input.value) === undefined ? STATE_COPY.nameInvalid : undefined));
      live(phone, () => phoneError(phone.input.value));
      live(password, () => (isValidPassword(password.input.value) ? undefined : STATE_COPY.passwordRule));
      live(confirm, () => (confirm.input.value === password.input.value ? undefined : STATE_COPY.passwordMismatch));
      consent.input.addEventListener('change', () => consent.setError(consent.input.checked ? undefined : STATE_COPY.consentRequired));

      // Asks the server how a registration is verified and shapes the screen by the answer. Locked until a valid answer; a failed
      // answer shows the error with "Thử lại" and keeps the form locked.
      const applyMode = (): void => {
        const registerController = env.register;
        if (!connected || registerController === undefined) {
          return;
        }
        submit.button.disabled = true;
        modeNote.hidden = true;
        modeStatus.textContent = 'Đang kiểm tra cấu hình đăng ký…';
        void registerController.loadMode().then((result) => {
          if (result.kind === 'stale') {
            return;
          }
          if (result.kind === 'failure') {
            modeStatus.textContent = '';
            feedback.replaceChildren(failureBanner(result.code, { onRetry: () => { feedback.replaceChildren(); applyMode(); } }));
            return;
          }
          modeStatus.textContent = '';
          feedback.replaceChildren();
          const direct = result.value === 'DISABLED_TEST';
          modeNote.hidden = !direct;
          setButtonLabel(submit.button, direct ? 'Đăng ký' : 'Tiếp tục');
          phone.input.placeholder = direct ? 'Nhập số điện thoại' : 'Nhập số điện thoại để nhận mã xác thực';
          submit.button.disabled = false;
        });
      };
      applyMode();

      const intro = food
        ? h('p', { class: 'c-lead' }, 'Đăng ký để đặt món hoặc quản lý cửa hàng.')
        : banner({ kind: 'info', title: 'Đăng ký tài khoản, rồi gửi hồ sơ xế', text: 'Hồ sơ xế được gửi ở bước tiếp theo và cần được duyệt trước khi nhận đơn.' });
      const root = appPage({
        title: food ? 'Đăng ký' : 'Đăng ký tài xế',
        onBack: () => env.go('login'),
        bodyClass: 'c-stack c-stack--loose',
        body: [
          food ? h('div', { class: 'c-stack c-stack--tight' }, h('h1', { class: 'c-title' }, 'Tạo tài khoản'), intro) : h('div', { class: 'c-stack c-stack--tight' }, h('h1', { class: 'c-title' }, 'Tạo tài khoản để bắt đầu cùng 11Ship'), intro),
          form,
          h('p', { class: 'c-center c-lead' }, 'Đã có tài khoản? ', textLink('Đăng nhập', () => env.go('login'), '/login')),
        ],
      });

      if (variant === 'errors') {
        name.input.value = '';
        phone.input.value = '0912 345';
        password.input.value = 'abc';
        confirm.input.value = 'abd';
        name.setError(STATE_COPY.nameInvalid);
        phone.setError(STATE_COPY.invalidPhone);
        password.setError(STATE_COPY.passwordRule);
        confirm.setError(STATE_COPY.passwordMismatch);
      } else if (variant === 'consent') {
        name.input.value = env.sample?.person.fullName ?? '';
        phone.input.value = '0981234123';
        password.input.value = 'matkhau-dai-hon-8';
        confirm.input.value = 'matkhau-dai-hon-8';
        consent.setError(STATE_COPY.consentRequired);
      } else if (variant === 'phone-registered') {
        name.input.value = env.sample?.person.fullName ?? '';
        phone.input.value = '0981234123';
        password.input.value = 'matkhau-dai-hon-8';
        confirm.input.value = 'matkhau-dai-hon-8';
        consent.input.checked = true;
        phone.setError(STATE_COPY.phoneRegistered);
      } else if (variant === 'offline') {
        feedback.replaceChildren(failureBanner('OFFLINE', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
      }
      return root;
    },
  };
}

// ---- OTP (register and reset) -------------------------------------------------------------------------------------

interface OtpConfig {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly path: string;
  readonly flow: string;
  readonly feature: 'auth.registerOtp' | 'auth.resetOtp';
  readonly back: string;
  readonly onVerified: (env: ScreenEnv) => void;
}

const EXPIRES_SECONDS = 179;
const RESEND_SECONDS = 59;

function otpScreen(config: OtpConfig): ScreenDef {
  return {
    id: config.id,
    code: config.code,
    title: config.title,
    group: 'Tài khoản',
    path: config.path,
    access: 'flow',
    flow: config.flow,
    variants: [v('default', 'Mặc định'), v('wrong', 'Mã sai'), v('expired', 'Mã hết hạn'), v('locked', 'Nhập sai nhiều lần'), v('rate-limited', 'Giới hạn gửi mã'), v('verifying', 'Đang xác minh')],
    render(env, variant) {
      // Connected register flow (M01.07): its own screen body, driven by the server's answers.
      if (env.mode === 'live' && config.feature === 'auth.registerOtp' && env.register !== undefined) {
        return liveRegisterOtp(env, env.register, { back: config.back, onDone: config.onVerified });
      }
      const flowData = env.flows.data<{ phone: string }>(config.flow);
      const masked = (flowData === undefined ? undefined : maskPhone(flowData.phone)) ?? env.sample?.person.phoneMasked ?? '••• •••• •••';
      const otp = otpField({ id: 'otp', label: 'Mã OTP 6 số' });
      const status = h('p', { class: 'c-caption c-center', 'aria-live': 'off' });
      const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
      const verify = actionButton(env, config.feature, {
        label: 'Xác minh',
        type: 'submit',
        id: 'otp-submit',
        onBlocked: () => {
          if (!isCompleteOtp(otp.value())) {
            otp.setError(STATE_COPY.otpInvalid);
            otp.focus();
          }
        },
      });
      const resend = button({ label: STATE_COPY.resendIn(formatCountdown(RESEND_SECONDS)), kind: 'secondary', id: 'otp-resend' });
      resend.setAttribute('aria-disabled', 'true');

      let expired = false;
      let stopExpiry: { stop(): void } | undefined;
      let stopResend: { stop(): void } | undefined;
      const startTimers = (expiry: number, resendIn: number): void => {
        stopExpiry?.stop();
        stopResend?.stop();
        expired = false;
        stopExpiry = countdown(
          expiry,
          (remaining) => {
            status.textContent = `Mã OTP có hiệu lực trong ${formatCountdown(remaining)}`;
          },
          () => {
            expired = true;
            status.textContent = '';
            feedback.replaceChildren(failureBanner('OTP_EXPIRED'));
          },
        );
        stopResend = countdown(
          resendIn,
          (remaining) => setButtonLabel(resend, remaining > 0 ? STATE_COPY.resendIn(formatCountdown(remaining)) : 'Gửi lại mã'),
          () => resend.removeAttribute('aria-disabled'),
        );
      };

      resend.addEventListener('click', () => {
        if (resend.getAttribute('aria-disabled') === 'true') {
          return;
        }
        if (env.mode === 'design') {
          designOnly(env, STATE_COPY.designNoSend);
          otp.clear();
          feedback.replaceChildren();
          resend.setAttribute('aria-disabled', 'true');
          startTimers(EXPIRES_SECONDS, RESEND_SECONDS);
          return;
        }
        designOnly(env, env.featureReason(config.feature));
      });

      const run = async (): Promise<void> => {
        const value = otp.value();
        if (!isCompleteOtp(value)) {
          otp.setError(STATE_COPY.otpInvalid);
          otp.focus();
          return;
        }
        otp.setError(undefined);
        if (expired) {
          feedback.replaceChildren(failureBanner('OTP_EXPIRED'));
          return;
        }
        if (env.mode === 'design') {
          designOnly(env, STATE_COPY.designNoSend);
          guard.release();
          config.onVerified(env);
          return;
        }
        const phone = flowData?.phone ?? '';
        setBusy(verify.button, true, 'Xác minh', 'Đang xác minh…');
        const outcome = config.feature === 'auth.registerOtp' ? await env.ports.auth.verifyRegisterOtp({ phone, code: value }) : await env.ports.auth.verifyResetOtp({ phone, code: value });
        otp.clear();
        setBusy(verify.button, false, 'Xác minh', 'Đang xác minh…');
        if (outcome.kind === 'ok') {
          guard.release();
          config.onVerified(env);
          return;
        }
        if (outcome.code === 'OTP_INVALID') {
          otp.setError(STATE_COPY.otpInvalid);
          otp.focus();
          return;
        }
        feedback.replaceChildren(failureBanner(outcome.code, { retryAfterSeconds: outcome.retryAfterSeconds }));
      };
      const form = h('form', { class: 'c-stack', novalidate: true }, otp.root, status, feedback, verify.node);
      // C08: leaving the OTP step wipes the code and ends this OTP flow (back to the start of the flow).
      const guard = guardForm(env, form, { flows: [config.flow] });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void run();
      });

      const children = [
        h('div', { class: 'c-stack c-stack--tight c-center' }, h('h1', { class: 'c-title' }, 'Xác minh mã OTP'), h('p', { class: 'c-lead' }, 'Chúng tôi đã gửi mã OTP đến số điện thoại'), h('p', { class: 'c-h2' }, masked)),
        env.testSmsNotice
          ? banner({ kind: 'test', title: 'SMS mô phỏng — môi trường thử', text: 'Mã không gửi tin nhắn thật và không hiện trên màn hình này. Lấy mã bằng công cụ trên máy tính.' })
          : undefined,
        form,
        h('div', { class: 'c-stack c-stack--tight c-center' }, h('p', { class: 'c-caption' }, 'Chưa nhận được mã?'), resend),
        h('div', { class: 'c-center' }, textLink('Đổi số điện thoại', () => env.go(config.back))),
      ];
      const root = appPage({ onBack: () => env.go(config.back), bodyClass: 'c-stack c-stack--loose', body: children });

      startTimers(EXPIRES_SECONDS, RESEND_SECONDS);
      if (variant === 'wrong') {
        otp.input.value = '123456';
        otp.input.dispatchEvent(new Event('input'));
        otp.setError(STATE_COPY.otpInvalid);
      } else if (variant === 'expired') {
        stopExpiry?.stop();
        stopResend?.stop();
        expired = true;
        status.textContent = '';
        feedback.replaceChildren(failureBanner('OTP_EXPIRED'));
        resend.setAttribute('aria-disabled', 'true');
        stopResend = countdown(
          30,
          (remaining) => setButtonLabel(resend, remaining > 0 ? STATE_COPY.resendIn(formatCountdown(remaining)) : 'Gửi lại mã'),
          () => resend.removeAttribute('aria-disabled'),
        );
        resend.after(h('p', { class: 'c-caption c-center' }, STATE_COPY.resendHint(30)));
      } else if (variant === 'locked') {
        feedback.replaceChildren(failureBanner('OTP_LOCKED'));
        verify.button.setAttribute('aria-disabled', 'true');
      } else if (variant === 'rate-limited') {
        const note = h('p', { class: 'c-banner__text' });
        feedback.replaceChildren(banner({ kind: 'warn', title: 'Thử quá nhiều lần', text: note }));
        countdown(180, (remaining) => (note.textContent = STATE_COPY.rateLimited(formatCountdown(remaining))), () => undefined);
      } else if (variant === 'verifying') {
        otp.input.value = '123456';
        otp.input.dispatchEvent(new Event('input'));
        setBusy(verify.button, true, 'Xác minh', 'Đang xác minh…');
      }
      return root;
    },
  };
}

// ---- Forgot password ----------------------------------------------------------------------------------------------

function resetScreen(brand: AppBrand): ScreenDef {
  return {
    id: 'reset',
    code: codes(brand).reset,
    title: 'Quên mật khẩu',
    group: 'Tài khoản',
    path: '/reset',
    access: 'public',
    variants: [v('default', 'Mặc định'), v('invalid-phone', 'Số điện thoại sai'), v('rate-limited', 'Giới hạn gửi mã'), v('provider-down', 'Chưa gửi được mã')],
    render(env, variant) {
      // Connected (local https runtime): the no-OTP test reset is ONE form and the code screens are never opened (M01-RESET).
      if (env.mode === 'live' && env.recovery !== undefined) {
        return liveResetScreen(env, env.recovery);
      }
      const phone = textField({ id: 'phone', label: 'Số điện thoại', icon: 'phone', type: 'tel', inputMode: 'tel', autocomplete: 'username', placeholder: 'Nhập số điện thoại' });
      const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
      const submit = actionButton(env, 'auth.resetRequest', {
        label: 'Gửi mã OTP',
        type: 'submit',
        id: 'reset-submit',
        onBlocked: () => {
          const problem = phoneError(phone.input.value);
          phone.setError(problem);
          if (problem !== undefined) {
            phone.input.focus();
          }
        },
      });
      const run = async (): Promise<void> => {
        const problem = phoneError(phone.input.value);
        phone.setError(problem);
        if (problem !== undefined) {
          phone.input.focus();
          return;
        }
        if (env.mode === 'design') {
          designOnly(env, STATE_COPY.designNoSend);
          env.flows.start('reset-otp', { phone: phone.input.value.trim() });
          guard.release();
          env.go('reset-otp');
          return;
        }
        setBusy(submit.button, true, 'Gửi mã OTP', 'Đang gửi…');
        const outcome = await env.ports.auth.requestResetOtp({ phone: phone.input.value.trim() });
        setBusy(submit.button, false, 'Gửi mã OTP', 'Đang gửi…');
        if (outcome.kind === 'ok') {
          env.flows.start('reset-otp', { phone: phone.input.value.trim() });
          guard.release();
          env.go('reset-otp');
          return;
        }
        feedback.replaceChildren(failureBanner(outcome.code, { retryAfterSeconds: outcome.retryAfterSeconds }));
      };
      const form = h('form', { class: 'c-stack', novalidate: true }, phone.root, feedback, submit.node);
      const guard = guardForm(env, form);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void run();
      });
      phone.input.addEventListener('blur', () => phone.setError(phone.input.value === '' ? undefined : phoneError(phone.input.value)));
      const root = appPage({
        onBack: () => env.go('login'),
        bodyClass: 'c-stack c-stack--loose',
        body: [
          h('div', { class: 'c-stack c-stack--tight c-center' }, h('span', { class: 'c-empty__icon c-self-center' }, icon('key', 32)), h('h1', { class: 'c-title' }, 'Quên mật khẩu?'), h('p', { class: 'c-lead' }, 'Nhập số điện thoại tài khoản của bạn để nhận mã OTP đặt lại mật khẩu.')),
          form,
          h('div', { class: 'c-center' }, textLink('Quay lại đăng nhập', () => env.go('login'), '/login')),
        ],
      });
      if (variant === 'invalid-phone') {
        phone.input.value = '09123456';
        phone.setError(STATE_COPY.invalidPhone);
      } else if (variant === 'rate-limited') {
        phone.input.value = '0981234123';
        const note = h('p', { class: 'c-banner__text' });
        feedback.replaceChildren(banner({ kind: 'warn', title: 'Thử quá nhiều lần', text: note }));
        submit.button.setAttribute('aria-disabled', 'true');
        countdown(300, (remaining) => (note.textContent = STATE_COPY.rateLimited(formatCountdown(remaining))), () => submit.button.removeAttribute('aria-disabled'));
      } else if (variant === 'provider-down') {
        phone.input.value = '0981234123';
        feedback.replaceChildren(failureBanner('PROVIDER_UNAVAILABLE'));
      }
      return root;
    },
  };
}

// ---- New password -------------------------------------------------------------------------------------------------

function resetPasswordScreen(brand: AppBrand): ScreenDef {
  return {
    id: 'reset-password',
    code: codes(brand).resetPassword,
    title: 'Đặt lại mật khẩu',
    group: 'Tài khoản',
    path: '/reset/password',
    access: 'flow',
    flow: 'reset-password',
    variants: [v('default', 'Mặc định'), v('mismatch', 'Mật khẩu không khớp'), v('rule', 'Mật khẩu quá ngắn'), v('outcome-unknown', 'Chưa xác định kết quả'), v('done', 'Hoàn tất (minh họa)')],
    render(env, variant) {
      const next = passwordField({ id: 'new-password', label: 'Mật khẩu mới', autocomplete: 'new-password', placeholder: 'Nhập mật khẩu mới', hint: '8 đến 128 ký tự.' });
      const confirm = passwordField({ id: 'new-password-confirm', label: 'Nhập lại mật khẩu mới', autocomplete: 'new-password', placeholder: 'Nhập lại mật khẩu mới' });
      const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
      const check = (): boolean => {
        const ruleOk = isValidPassword(next.input.value);
        const matches = confirm.input.value === next.input.value && confirm.input.value !== '';
        next.setError(ruleOk ? undefined : STATE_COPY.passwordRule);
        confirm.setError(matches ? undefined : STATE_COPY.passwordMismatch);
        if (!ruleOk) {
          next.input.focus();
        } else if (!matches) {
          confirm.input.focus();
        }
        return ruleOk && matches;
      };
      const submit = actionButton(env, 'auth.resetComplete', {
        label: 'Đặt lại mật khẩu',
        type: 'submit',
        id: 'reset-password-submit',
        onBlocked: () => {
          check();
        },
      });
      next.input.addEventListener('blur', () => next.setError(next.input.value === '' || isValidPassword(next.input.value) ? undefined : STATE_COPY.passwordRule));
      confirm.input.addEventListener('blur', () => confirm.setError(confirm.input.value === '' || confirm.input.value === next.input.value ? undefined : STATE_COPY.passwordMismatch));
      const run = async (): Promise<void> => {
        if (!check()) {
          return;
        }
        if (env.mode === 'design') {
          designOnly(env, STATE_COPY.designNoSend);
          guard.release();
          env.go('reset-password', 'done');
          return;
        }
        setBusy(submit.button, true, 'Đặt lại mật khẩu', 'Đang xử lý…');
        const outcome = await env.ports.auth.completeReset({ newPassword: next.input.value });
        next.input.value = '';
        confirm.input.value = '';
        setBusy(submit.button, false, 'Đặt lại mật khẩu', 'Đang xử lý…');
        if (outcome.kind === 'ok') {
          guard.release();
          env.go('login');
          return;
        }
        feedback.replaceChildren(failureBanner(outcome.code, { retryAfterSeconds: outcome.retryAfterSeconds }));
      };
      const form = h(
        'form',
        { class: 'c-stack', novalidate: true },
        next.root,
        confirm.root,
        banner({ kind: 'warn', text: 'Sau khi đặt lại mật khẩu, tất cả các phiên đăng nhập trên thiết bị khác sẽ bị đăng xuất.' }),
        feedback,
        submit.node,
      );
      // C08: the new password and the reset proof (this flow) are wiped when the person leaves.
      const guard = guardForm(env, form, { flows: ['reset-password'] });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void run();
      });
      const root = appPage({
        onBack: () => env.go('login'),
        bodyClass: 'c-stack c-stack--loose',
        body: [h('div', { class: 'c-stack c-stack--tight' }, h('h1', { class: 'c-title' }, 'Đặt lại mật khẩu'), h('p', { class: 'c-lead' }, 'Nhập mật khẩu mới cho tài khoản để tiếp tục sử dụng.')), form],
      });
      if (variant === 'mismatch') {
        next.input.value = 'matkhau-moi-1';
        confirm.input.value = 'matkhau-moi-2';
        confirm.setError(STATE_COPY.passwordMismatch);
      } else if (variant === 'rule') {
        next.input.value = 'abc';
        confirm.input.value = 'abc';
        next.setError(STATE_COPY.passwordRule);
      } else if (variant === 'outcome-unknown') {
        next.input.value = 'matkhau-moi-1';
        confirm.input.value = 'matkhau-moi-1';
        feedback.replaceChildren(failureBanner('OUTCOME_UNKNOWN', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }));
      } else if (variant === 'done') {
        return appPage({
          bodyClass: 'c-stack c-stack--loose',
          body: [
            h(
              'div',
              { class: 'c-empty' },
              h('span', { class: 'c-empty__icon c-empty__icon--success' }, icon('checkCircle', 36)),
              h('h1', { class: 'c-title' }, 'Hoàn tất!'),
              h('p', { class: 'c-lead' }, 'Bạn có thể đăng nhập bằng mật khẩu mới. Hệ thống không tự đăng nhập giúp bạn.'),
            ),
            button({ label: 'Đăng nhập', kind: 'primary', onClick: () => env.go('login') }),
          ],
        });
      }
      return root;
    },
  };
}

export function authScreens(brand: AppBrand, routes: AuthRoutes): readonly ScreenDef[] {
  const c = codes(brand);
  return [
    welcomeScreen(brand, routes),
    loginScreen(brand, routes),
    registerScreen(brand, routes),
    otpScreen({
      id: 'register-otp',
      code: c.registerOtp,
      title: 'Xác minh OTP đăng ký',
      path: '/register/otp',
      flow: 'register-otp',
      feature: 'auth.registerOtp',
      back: 'register',
      onVerified: (env) => {
        env.flows.end('register-otp');
        go(env, routes.afterRegister);
      },
    }),
    resetScreen(brand),
    otpScreen({
      id: 'reset-otp',
      code: c.resetOtp,
      title: 'Xác minh OTP đặt lại mật khẩu',
      path: '/reset/otp',
      flow: 'reset-otp',
      feature: 'auth.resetOtp',
      back: 'reset',
      onVerified: (env) => {
        env.flows.end('reset-otp');
        env.flows.start('reset-password');
        env.go('reset-password');
      },
    }),
    resetPasswordScreen(brand),
  ];
}
