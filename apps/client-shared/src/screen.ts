import type { AppBrand } from './brand.js';
import type { ConnectionView } from './connection.js';
import type { FeatureId } from './features.js';
import type { ClientPorts } from './ports.js';
import type { GuardHandle, LeaveGuard } from './leave.js';
import type { Access } from './router.js';

// What a screen is, and what it may use. The SAME screen code runs in two places: the real app (mode `live`) and the
// design preview (mode `design`, sample data labelled "Dữ liệu minh họa"). A screen never checks the mode to invent data;
// it only asks the environment, so a preview can never leak into the real app.

/** In-memory state of a multi-step flow (register -> code -> done). Never persisted: no localStorage, no URL. */
export class FlowStore {
  readonly #flows = new Map<string, unknown>();

  start(name: string, data?: unknown): void {
    this.#flows.set(name, data);
  }

  end(name: string): void {
    this.#flows.delete(name);
  }

  has(name: string): boolean {
    return this.#flows.has(name);
  }

  data<T>(name: string): T | undefined {
    return this.#flows.get(name) as T | undefined;
  }

  names(): ReadonlySet<string> {
    return new Set(this.#flows.keys());
  }

  clear(): void {
    this.#flows.clear();
  }
}

/** The account a screen shows. In live mode this is always undefined until a real login exists. */
export interface AccountView {
  readonly fullName: string | null;
  readonly phoneMasked: string;
  readonly roles: readonly string[];
  /** Shop owner only. */
  readonly shop?: { readonly state: 'NONE' | 'DRAFT' | 'COMPLETE'; readonly name?: string };
  /** Driver only. */
  readonly driver?: { readonly status: 'NONE' | 'PENDING' | 'ACTIVE'; readonly kind?: 'EXTERNAL' | 'PLATFORM'; readonly legalName?: string; readonly plate?: string | null };
}

export interface ScreenEnv {
  readonly mode: 'live' | 'design';
  readonly brand: AppBrand;
  readonly ports: ClientPorts;
  readonly flows: FlowStore;
  /** undefined = nobody is signed in. */
  readonly account: AccountView | undefined;
  /** Go to a screen by its id. Live: pushes the real path. Design: switches the previewed screen. */
  go(id: string, variant?: string): void;
  back(): void;
  /**
   * C08: a screen with a form registers how to tell it is dirty and how to wipe it. Every in-app navigation (go, back), the
   * browser Back button and closing the page then ask "Bỏ thay đổi?" first; leaving for real wipes the form.
   */
  guard(guard: LeaveGuard): GuardHandle;
  toast(text: string): void;
  /** Where dialogs are mounted: the phone frame in the preview, the page body (undefined) in the app. */
  readonly dialogHost: HTMLElement | undefined;
  isWired(feature: FeatureId): boolean;
  featureReason(feature: FeatureId): string;
  /** Whether the server is reachable (health), as the connection banner and the diagnostics screen show it. Live: real checks. Design: a fixed example. */
  readonly connection: ConnectionView;
  /** Test build: OTP screens tell the person the SMS is simulated and where the code is read (PC tool), never show the code. */
  readonly testSmsNotice: boolean;
  /** Preview only. */
  readonly sample?: SampleData;
}

export interface VariantDef {
  readonly id: string;
  readonly label: string;
}

export interface ScreenDef {
  /** Stable id used in routes, the preview URL and tests (e.g. `login`). */
  readonly id: string;
  /** Screen code of the design catalog (F10, S12, D81...), for the PR evidence and Owner findings. */
  readonly code: string;
  readonly title: string;
  readonly group: string;
  /** Real path, if the screen is a real route. Screens that exist only as previews of a state have none. */
  readonly path?: string;
  readonly access: Access;
  readonly flow?: string;
  /** The screen shows the connection state itself (diagnostics), so the shared banner is not added above it. */
  readonly hideConnectionBanner?: boolean;
  readonly variants: readonly VariantDef[];
  render(env: ScreenEnv, variant: string): HTMLElement;
}

export const DEFAULT_VARIANT: VariantDef = { id: 'default', label: 'Mặc định' };

/**
 * Sample data of the design preview (client-shared/src/design/samples.ts). `ScreenEnv.sample` is undefined in the real app, so
 * no sample person, shop or address can ever be shown (or even be present in the real build's code) outside the preview.
 */
export interface SampleData {
  readonly person: { readonly fullName: string; readonly phoneMasked: string };
  readonly shop: { readonly name: string; readonly phone: string; readonly address: string };
  readonly location: { readonly accuracy: string; readonly measured: string };
}
