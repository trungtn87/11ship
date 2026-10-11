import { appBar, button, ButtonOptions, gate } from '../components.js';
import { Child, h } from '../dom.js';
import type { FeatureId } from '../features.js';
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
