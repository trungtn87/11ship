import { appBar, button, ButtonOptions, gate } from '../components.js';
import { Child, h } from '../dom.js';
import type { FeatureId } from '../features.js';
import type { GuardHandle } from '../leave.js';
import type { ScreenEnv } from '../screen.js';

// Page scaffolding shared by the screens of both apps.

export interface PageOptions {
  readonly title?: string;
  readonly onBack?: () => void;
  readonly variant?: 'plain' | 'yellow';
  readonly right?: HTMLElement;
  readonly logo?: HTMLElement;
  readonly body: readonly Child[];
  readonly nav?: HTMLElement;
  /** Stretch the body so its last child sits at the bottom (a CTA under a short form). */
  readonly bodyClass?: string;
}

export function appPage(options: PageOptions): HTMLElement {
  const bar = appBar({ title: options.title, onBack: options.onBack, variant: options.variant, right: options.right, logo: options.logo });
  const classes = ['c-body', options.nav === undefined ? undefined : 'c-body--with-nav', options.bodyClass].filter((name): name is string => name !== undefined);
  const main = h('main', { class: classes.join(' ') }, ...options.body);
  return h('div', { class: 'c-app' }, bar, main, options.nav);
}

/** True when the action must not run yet: real app + no backend for it. In the preview the action runs as a harmless demo. */
export function isGated(env: ScreenEnv, feature: FeatureId): boolean {
  return env.mode === 'live' && !env.isWired(feature);
}

/**
 * The call-to-action of a business action. In the real app, while the backend is missing, it is shown unavailable WITH its
 * visible reason; otherwise it is a normal button. Returns the node to place in the form.
 */
export function actionButton(
  env: ScreenEnv,
  feature: FeatureId,
  options: ButtonOptions & { readonly onBlocked?: () => void },
): { readonly node: HTMLElement; readonly button: HTMLButtonElement } {
  const element = button(options);
  if (isGated(env, feature)) {
    return { node: gate(element, env.featureReason(feature), options.onBlocked), button: element };
  }
  return { node: element, button: element };
}

/** The harmless "demo" result of an action in the design preview. Never worded as a real result. */
export function designOnly(env: ScreenEnv, text: string): void {
  env.toast(text);
}

/**
 * C08 for a form: registers the form's editable fields with the environment. "Dirty" = a field differs from what it held
 * when this was called (so call it right after the fields are built, before any sample/variant content is put in).
 * Wiping (on a real exit, or `release()` after success) empties password/OTP/text fields and ends the named in-memory flows.
 */
export function guardForm(
  env: ScreenEnv,
  form: HTMLElement,
  options: {
    readonly flows?: readonly string[];
    /** The screen holds more than its fields (a phone proof, a password kept in memory): leaving must ask even when no field changed. */
    readonly extraDirty?: () => boolean;
    /** Runs on every real exit (and on `release`), after the fields are wiped: drops what the screen kept in memory. */
    readonly onWipe?: () => void;
  } = {},
): GuardHandle {
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input')).filter((input) => !input.readOnly && !input.disabled && input.type !== 'hidden' && input.type !== 'submit' && input.type !== 'button');
  const baseline = fields.map((input) => (input.type === 'checkbox' || input.type === 'radio' ? String(input.checked) : input.value));
  const current = (input: HTMLInputElement): string => (input.type === 'checkbox' || input.type === 'radio' ? String(input.checked) : input.value);
  return env.guard({
    dirty: () => fields.some((input, index) => current(input) !== baseline[index]) || options.extraDirty?.() === true,
    wipe: () => {
      fields.forEach((input, index) => {
        if (current(input) === baseline[index]) {
          return;
        }
        if (input.type === 'checkbox' || input.type === 'radio') {
          input.checked = baseline[index] === 'true';
        } else {
          input.value = baseline[index];
        }
        input.dispatchEvent(new Event('input'));
      });
      for (const flow of options.flows ?? []) {
        env.flows.end(flow);
      }
      options.onWipe?.();
    },
  });
}
