import { h } from '../dom.js';
import { STATE_COPY } from '../states.js';
import { DEFAULT_VARIANT, ScreenDef, ScreenEnv, VariantDef } from '../screen.js';
import { closeAllDialogs, toast } from '../components.js';

// The design preview: lets the Owner open every designed screen and its states without a backend, a session or an
// error being caused for real. It is a SEPARATE page (design.html), only built for preview builds (see the build script),
// and it can do nothing the real app cannot protect: it creates no session, grants no right, calls no endpoint and stores
// nothing (no localStorage, no cookie, no URL secret). Every screen it shows is labelled "Dữ liệu minh họa".

export interface PreviewContext {
  readonly host: HTMLElement;
  go(id: string, variant?: string): void;
  back(): void;
  toast(text: string): void;
  readonly screen: ScreenDef;
  readonly variant: string;
}

export interface DesignConfig {
  readonly title: string;
  readonly subtitle: string;
  readonly frame: 'phone' | 'desktop';
  readonly screens: readonly ScreenDef[];
  readonly defaultScreen: string;
  /** Builds the environment a screen runs in for this preview render. */
  readonly makeEnv: (context: PreviewContext) => ScreenEnv;
  /** Optional extra controls (for example the role switch of the admin preview). Returned node is placed in the toolbar. */
  readonly toolbar?: (rerender: () => void) => HTMLElement;
}

export function parseHash(hash: string): { readonly id: string | undefined; readonly variant: string | undefined } {
  const match = /^#\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(hash);
  return match === null ? { id: undefined, variant: undefined } : { id: match[1], variant: match[2] };
}

export function groupScreens(screens: readonly ScreenDef[]): readonly { readonly group: string; readonly screens: readonly ScreenDef[] }[] {
  const groups = new Map<string, ScreenDef[]>();
  for (const screen of screens) {
    const list = groups.get(screen.group);
    if (list === undefined) {
      groups.set(screen.group, [screen]);
    } else {
      list.push(screen);
    }
  }
  return Array.from(groups, ([group, list]) => ({ group, screens: list }));
}

export class DesignViewer {
  #screen: ScreenDef | undefined;
  #variant = DEFAULT_VARIANT.id;
  #stage: HTMLElement | undefined;
  #head: HTMLElement | undefined;
  #nav: HTMLElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly config: DesignConfig,
  ) {}

  mount(): void {
    const banner = h(
      'div',
      { class: 'dv-banner', role: 'note' },
      h('strong', {}, STATE_COPY.designBanner),
      h('span', {}, ' · Chế độ xem thiết kế. Không đăng nhập, không gọi máy chủ, không lưu dữ liệu. Nội dung hiển thị chỉ để duyệt hình thức.'),
    );
    this.#nav = h('nav', { class: 'dv-nav', 'aria-label': 'Danh sách màn hình' });
    const details = h('details', { class: 'dv-nav-details' }, h('summary', {}, 'Danh sách màn hình'), this.#nav);
    if (window.matchMedia('(min-width: 900px)').matches) {
      details.setAttribute('open', '');
    }
    this.#head = h('div', { class: 'dv-head' });
    this.#stage = h('div', { class: 'dv-stage' });
    const toolbar = this.config.toolbar?.(() => this.#renderScreen());
    const main = h('main', { class: 'dv-main', id: 'dv-main', tabindex: '-1' }, this.#head, toolbar === undefined ? undefined : h('div', { class: 'dv-toolbar' }, toolbar), this.#stage);
    this.root.replaceChildren(h('div', { class: 'dv' }, banner, h('div', { class: 'dv-layout' }, details, main)));
    window.addEventListener('hashchange', () => this.#fromHash());
    this.#fromHash();
  }

  #fromHash(): void {
    const { id, variant } = parseHash(window.location.hash);
    const screen = this.config.screens.find((candidate) => candidate.id === id) ?? this.config.screens.find((candidate) => candidate.id === this.config.defaultScreen);
    if (screen === undefined) {
      return;
    }
    const known = screen.variants.some((candidate) => candidate.id === variant);
    this.#screen = screen;
    this.#variant = known && variant !== undefined ? variant : (screen.variants[0] ?? DEFAULT_VARIANT).id;
    this.#renderNav();
    this.#renderScreen();
  }

  #select(id: string, variant?: string): void {
    window.location.hash = variant === undefined ? `#/${id}` : `#/${id}/${variant}`;
  }

  #renderNav(): void {
    const nav = this.#nav;
    if (nav === undefined) {
      return;
    }
    nav.replaceChildren(
      ...groupScreens(this.config.screens).map((group) =>
        h(
          'section',
          { class: 'dv-group' },
          h('h2', { class: 'dv-group__title' }, group.group),
          h(
            'ul',
            { class: 'dv-group__list' },
            ...group.screens.map((screen) =>
              h(
                'li',
                {},
                h(
                  'a',
                  { class: 'dv-link', href: `#/${screen.id}`, 'aria-current': screen.id === this.#screen?.id ? 'page' : undefined },
                  h('span', { class: 'dv-code' }, screen.code),
                  h('span', {}, screen.title),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  #renderScreen(): void {
    const screen = this.#screen;
    const stage = this.#stage;
    const head = this.#head;
    if (screen === undefined || stage === undefined || head === undefined) {
      return;
    }
    closeAllDialogs();
    const variants: readonly VariantDef[] = screen.variants;
    const heading: Node[] = [h('p', { class: 'dv-eyebrow' }, this.config.title), h('h1', { class: 'dv-title' }, h('span', { class: 'dv-code' }, screen.code), ` ${screen.title}`)];
    if (variants.length > 1) {
      heading.push(
        h(
          'div',
          { class: 'dv-variants', role: 'group', 'aria-label': 'Trạng thái của màn hình' },
          ...variants.map((variant) => {
            const element = h('button', { type: 'button', class: 'dv-variant', 'aria-pressed': String(variant.id === this.#variant), 'data-variant': variant.id }, variant.label);
            element.addEventListener('click', () => this.#select(screen.id, variant.id));
            return element;
          }),
        ),
      );
    }
    head.replaceChildren(...heading);
    const surface = h('div', { class: 'dv-surface', 'data-screen': screen.id, 'data-variant': this.#variant });
    const frame = h('div', { class: this.config.frame === 'phone' ? 'dv-frame dv-frame--phone' : 'dv-frame dv-frame--desktop' }, surface);
    stage.replaceChildren(frame);
    const context: PreviewContext = {
      host: frame,
      go: (id, variant) => this.#select(id, variant),
      back: () => window.history.back(),
      toast: (text) => toast(text, 4000, frame),
      screen,
      variant: this.#variant,
    };
    surface.append(screen.render(this.config.makeEnv(context), this.#variant));
    document.title = `${screen.code} ${screen.title} · ${this.config.title}`;
  }
}
