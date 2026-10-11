import { AdminRole } from '../core/api.js';
import { Grants, GrantId } from '../core/menu.js';
import { h } from '../dom/dom.js';

// The design preview of the administration web: lets the Owner open every designed screen and its states without a
// backend, a session or an error being caused for real. It is a SEPARATE page (design.html), only built for preview builds
// (scripts/admin-web-build.mjs removes this whole folder from the real build), and it can do nothing the real app has to
// protect: it creates no session, grants no right, calls no endpoint and stores nothing (no localStorage, no cookie, no
// secret in the URL). Every screen it shows is labelled "Dữ liệu minh họa".

export type Persona = 'system' | 'admin-granted' | 'admin-empty';

export const PERSONAS: readonly { readonly id: Persona; readonly label: string }[] = [
  { id: 'system', label: 'SYSTEM' },
  { id: 'admin-granted', label: 'ADMIN có quyền mẫu' },
  { id: 'admin-empty', label: 'ADMIN chưa cấp quyền' },
];

/** Sample grants of the preview persona "ADMIN (có quyền mẫu)". Not what the real backend sends (it sends none yet). */
const SAMPLE_GRANTS: readonly GrantId[] = ['users', 'shops', 'drivers', 'orders'];

export function roleOf(persona: Persona): AdminRole {
  return persona === 'system' ? 'SYSTEM' : 'ADMIN';
}

export function grantsOf(persona: Persona): Grants {
  return persona === 'admin-granted' ? new Set<GrantId>(SAMPLE_GRANTS) : new Set<GrantId>();
}

export interface Variant {
  readonly id: string;
  readonly label: string;
}

export interface DesignContext {
  readonly persona: Persona;
  readonly role: AdminRole;
  readonly grants: Grants;
  /** The element the screen is mounted in; dialogs of the preview are mounted inside it. */
  readonly frame: HTMLElement;
  toast(text: string): void;
  go(id: string, variant?: string): void;
  /** Runs after the screen is in the page (to open a dialog, move focus...). */
  onMounted(callback: () => void): void;
}

export interface DesignScreen {
  readonly id: string;
  /** Code of the design catalog (D81, C03...), for the PR evidence and Owner findings. "—" = none assigned yet. */
  readonly code: string;
  readonly title: string;
  readonly group: string;
  /** What the Owner should know about this screen (what is real, what waits for the backend). */
  readonly note?: string;
  readonly variants: readonly Variant[];
  render(context: DesignContext, variant: string): HTMLElement;
}

export const DEMO_NOTICE = 'Chế độ xem thiết kế: thao tác này chỉ minh họa, không gửi gì tới máy chủ.';

export interface ParsedHash {
  readonly id: string | undefined;
  readonly variant: string | undefined;
  readonly persona: Persona;
}

export function parseHash(hash: string): ParsedHash {
  const match = /^#\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?(?:\?persona=(system|admin-granted|admin-empty))?$/.exec(hash);
  return match === null ? { id: undefined, variant: undefined, persona: 'system' } : { id: match[1], variant: match[2], persona: (match[3] as Persona | undefined) ?? 'system' };
}

export function formatHash(id: string, variant: string | undefined, persona: Persona): string {
  return `#/${id}${variant === undefined ? '' : `/${variant}`}${persona === 'system' ? '' : `?persona=${persona}`}`;
}

export function groupScreens(screens: readonly DesignScreen[]): readonly { readonly group: string; readonly screens: readonly DesignScreen[] }[] {
  const groups = new Map<string, DesignScreen[]>();
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
  #screen: DesignScreen | undefined;
  #variant = 'default';
  #persona: Persona = 'system';
  #head: HTMLElement | undefined;
  #stage: HTMLElement | undefined;
  #list: HTMLElement | undefined;
  #select: HTMLSelectElement | undefined;
  #toastTimer: number | undefined;
  #toastBox: HTMLElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly title: string,
    private readonly screens: readonly DesignScreen[],
    private readonly defaultScreen: string,
  ) {}

  mount(): void {
    const banner = h(
      'div',
      { class: 'dv-banner', role: 'note' },
      h('strong', {}, 'Dữ liệu minh họa'),
      h('span', {}, ' · Chế độ xem thiết kế. Không đăng nhập, không gọi máy chủ, không lưu dữ liệu. Nội dung chỉ để duyệt hình thức. Thu hẹp cửa sổ dưới 900 px để xem dạng điện thoại/máy tính bảng.'),
    );
    this.#select = h('select', { class: 'dv-select', 'aria-label': 'Chọn màn hình' });
    for (const group of groupScreens(this.screens)) {
      const optgroup = h('optgroup', { label: group.group });
      for (const screen of group.screens) {
        optgroup.append(h('option', { value: screen.id }, `${screen.code} · ${screen.title}`));
      }
      this.#select.append(optgroup);
    }
    const select = this.#select;
    select.addEventListener('change', () => this.#navigate(select.value));
    const prev = h('button', { type: 'button', class: 'dv-btn', 'aria-label': 'Màn trước' }, '‹');
    const next = h('button', { type: 'button', class: 'dv-btn', 'aria-label': 'Màn sau' }, '›');
    prev.addEventListener('click', () => this.#step(-1));
    next.addEventListener('click', () => this.#step(1));
    const personas = h(
      'div',
      { class: 'dv-segment', role: 'group', 'aria-label': 'Vai trò xem thử' },
      ...PERSONAS.map((persona) => {
        const button = h('button', { type: 'button', class: 'dv-seg', 'data-persona': persona.id }, persona.label);
        button.addEventListener('click', () => this.#setPersona(persona.id));
        return button;
      }),
    );
    this.#list = h('nav', { class: 'dv-list', 'aria-label': 'Danh sách màn hình' });
    const details = h('details', { class: 'dv-details' }, h('summary', {}, 'Danh sách màn hình'), this.#list);
    this.#head = h('div', { class: 'dv-head' });
    this.#stage = h('div', { class: 'dv-stage' });
    this.#toastBox = h('div', { class: 'dv-toast', role: 'status', hidden: true });
    this.root.replaceChildren(
      h(
        'div',
        { class: 'dv' },
        banner,
        h('div', { class: 'dv-bar' }, h('p', { class: 'dv-eyebrow' }, this.title), h('div', { class: 'dv-controls' }, prev, this.#select, next, personas)),
        details,
        this.#head,
        this.#stage,
        this.#toastBox,
      ),
    );
    window.addEventListener('hashchange', () => this.#fromHash());
    this.#fromHash();
  }

  #fromHash(): void {
    const parsed = parseHash(window.location.hash);
    const screen = this.screens.find((candidate) => candidate.id === parsed.id) ?? this.screens.find((candidate) => candidate.id === this.defaultScreen);
    if (screen === undefined) {
      return;
    }
    this.#screen = screen;
    this.#persona = parsed.persona;
    this.#variant = screen.variants.some((variant) => variant.id === parsed.variant) && parsed.variant !== undefined ? parsed.variant : (screen.variants[0]?.id ?? 'default');
    this.#renderAll();
  }

  #navigate(id: string, variant?: string): void {
    window.location.hash = formatHash(id, variant, this.#persona);
  }

  #step(delta: number): void {
    const index = this.screens.findIndex((screen) => screen.id === this.#screen?.id);
    const target = this.screens[(index + delta + this.screens.length) % this.screens.length];
    if (target !== undefined) {
      this.#navigate(target.id);
    }
  }

  #setPersona(persona: Persona): void {
    this.#persona = persona;
    if (this.#screen !== undefined) {
      window.location.hash = formatHash(this.#screen.id, this.#variant, persona);
    }
  }

  #toast(text: string): void {
    const box = this.#toastBox;
    if (box === undefined) {
      return;
    }
    box.textContent = text;
    box.hidden = false;
    if (this.#toastTimer !== undefined) {
      window.clearTimeout(this.#toastTimer);
    }
    this.#toastTimer = window.setTimeout(() => {
      box.hidden = true;
    }, 4000);
  }

  #renderAll(): void {
    const screen = this.#screen;
    const head = this.#head;
    const stage = this.#stage;
    const list = this.#list;
    if (screen === undefined || head === undefined || stage === undefined || list === undefined) {
      return;
    }
    if (this.#select !== undefined) {
      this.#select.value = screen.id;
    }
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-persona]')) {
      button.setAttribute('aria-pressed', String(button.dataset.persona === this.#persona));
    }
    list.replaceChildren(
      ...groupScreens(this.screens).map((group) =>
        h(
          'section',
          { class: 'dv-group' },
          h('h2', { class: 'dv-group-title' }, group.group),
          h(
            'ul',
            { class: 'dv-group-list' },
            ...group.screens.map((item) =>
              h('li', {}, h('a', { class: 'dv-link', href: formatHash(item.id, undefined, this.#persona), ...(item.id === screen.id ? { 'aria-current': 'page' } : {}) }, h('span', { class: 'dv-code' }, item.code), h('span', {}, item.title))),
            ),
          ),
        ),
      ),
    );
    const heading: (Node | undefined)[] = [
      h('h1', { class: 'dv-title' }, h('span', { class: 'dv-code' }, screen.code), ` ${screen.title}`),
      screen.note === undefined ? undefined : h('p', { class: 'dv-note' }, screen.note),
    ];
    if (screen.variants.length > 1) {
      heading.push(
        h(
          'div',
          { class: 'dv-variants', role: 'group', 'aria-label': 'Trạng thái của màn hình' },
          ...screen.variants.map((variant) => {
            const button = h('button', { type: 'button', class: 'dv-variant', 'aria-pressed': String(variant.id === this.#variant), 'data-variant': variant.id }, variant.label);
            button.addEventListener('click', () => this.#navigate(screen.id, variant.id));
            return button;
          }),
        ),
      );
    }
    head.replaceChildren(...heading.filter((node): node is Node => node !== undefined));
    const frame = h('div', { class: 'dv-frame', 'data-screen': screen.id, 'data-variant': this.#variant });
    const mounted: (() => void)[] = [];
    const context: DesignContext = {
      persona: this.#persona,
      role: roleOf(this.#persona),
      grants: grantsOf(this.#persona),
      frame,
      toast: (text) => this.#toast(text),
      go: (id, variant) => this.#navigate(id, variant),
      onMounted: (callback) => {
        mounted.push(callback);
      },
    };
    stage.replaceChildren(frame);
    frame.append(screen.render(context, this.#variant));
    for (const callback of mounted) {
      callback();
    }
    document.title = `${screen.code} ${screen.title} · ${this.title}`;
  }
}
