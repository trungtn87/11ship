import { AuthClient, AuthResult, ServiceAreaChoice, ShopView, SignedIn } from './auth/client.js';
import { PublicContext } from './auth/contract.js';
import { FailureCode } from './states.js';
import { isValidCoordinatePair } from './validation.js';

// The 11Food shop onboarding (F20 -> F21 -> F22 -> F21 -> F23) as ONE in-memory object.
//
// What it holds, in memory only (never the URL, history, any storage or a log): the form as typed, the service area chosen, the
// pickup point the person confirmed, a measured point not yet confirmed, and what the server last said (the shop with its version,
// the ACTIVE areas). Because it lives here and not in the DOM, F21 -> F22 -> F21 keeps what was typed even though every screen is
// redrawn from scratch.
//
// Rules this object enforces (the screens only display its state and send intents):
// * The server decides. A shop is created/updated/completed only through the three onboarding calls; this object grants nothing
//   and never invents a shop, a role, an area or a position. The client never infers an area from a position.
// * One call at a time per kind (the adapter shares a running call and answers IN_PROGRESS for a different input).
// * Save and complete are ONE intent each: an unknown outcome keeps the key and the exact body in the adapter, and the person's
//   next press with the SAME input re-sends them. VERSION_CONFLICT overwrites nothing: `load({force:true})` shows what the server has.
// * A position comes only from the browser's geolocation after the person pressed the button, is shown with its accuracy and time,
//   and is used only after "Dùng vị trí này". A refusal/timeout/unavailable answer produces NO position.
// * Completing is offered only for a SAVED draft (nothing unsaved) that has a pickup point and an area that is still in the server's
//   list. Completion mints no token and selects no context: the identity is refreshed (`me`) and the person then enters the shop
//   context with `selectContext('SHOP_OWNER')`.

export interface ShopForm {
  readonly name: string;
  readonly phone: string;
  readonly address: string;
  readonly zalo: string;
  readonly facebook: string;
}

export type ShopFormField = keyof ShopForm;
export const EMPTY_SHOP_FORM: ShopForm = { name: '', phone: '', address: '', zalo: '', facebook: '' };

/** A point of the pickup location. `accuracyMeters`/`measuredAtMs` are null for a point that was loaded from the server (it keeps neither). */
export interface PickupPoint {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters: number | null;
  readonly measuredAtMs: number | null;
}

// ---- geolocation ---------------------------------------------------------------------------------------------------

export interface GeoFix {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters: number | null;
  readonly measuredAtMs: number;
}

export type GeoFailure = 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED';
export type GeoResult = { readonly kind: 'ok'; readonly fix: GeoFix } | { readonly kind: 'failure'; readonly reason: GeoFailure };

export interface GeolocationPort {
  /** Asks the device for ONE position now. It is only called from a press of the button, never on its own. */
  locate(): Promise<GeoResult>;
}

/** Longest wait for a position (the browser's own timeout). */
export const GEO_TIMEOUT_MS = 20_000;

/** The real device position through the browser. Nothing is stored: the answer is handed to the controller and nowhere else. */
export function browserGeolocation(nav: { readonly geolocation?: Geolocation }): GeolocationPort {
  return {
    locate: () =>
      new Promise<GeoResult>((resolve) => {
        const geolocation = nav.geolocation;
        if (geolocation === undefined || geolocation === null) {
          resolve({ kind: 'failure', reason: 'UNSUPPORTED' });
          return;
        }
        try {
          geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude, accuracy } = position.coords;
              if (!isValidCoordinatePair(latitude, longitude) || !Number.isFinite(position.timestamp)) {
                resolve({ kind: 'failure', reason: 'UNAVAILABLE' });
                return;
              }
              resolve({ kind: 'ok', fix: { lat: latitude, lng: longitude, accuracyMeters: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null, measuredAtMs: position.timestamp } });
            },
            (error) => resolve({ kind: 'failure', reason: error.code === 1 ? 'DENIED' : error.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE' }),
            { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
          );
        } catch {
          resolve({ kind: 'failure', reason: 'UNAVAILABLE' });
        }
      }),
  };
}

// ---- controller ------------------------------------------------------------------------------------------------------

export interface ShopState {
  /** The server's shop and areas were read for this visit. */
  readonly loaded: boolean;
  /** The shop as the server holds it, or null (none yet). */
  readonly shop: ShopView | null;
  /** The ACTIVE areas, in the server's order. Empty = none (a valid answer). */
  readonly areas: readonly ServiceAreaChoice[];
  readonly form: ShopForm;
  readonly serviceAreaId: string | null;
  /** The confirmed pickup point (typed into the next save). */
  readonly pickup: PickupPoint | undefined;
  /** A measured point waiting for "Dùng vị trí này". */
  readonly candidate: GeoFix | undefined;
}

export type FailedStep = { readonly kind: 'failure'; readonly code: FailureCode; readonly retryAfterSeconds?: number; readonly unresolved: boolean };
export type ShopStep = { readonly kind: 'ok' } | FailedStep | { readonly kind: 'stale' };
export type LocateStep = { readonly kind: 'ok'; readonly fix: GeoFix } | { readonly kind: 'failure'; readonly reason: GeoFailure } | { readonly kind: 'busy' } | { readonly kind: 'stale' };
export type CompleteStep = { readonly kind: 'ok'; readonly identityRefreshed: boolean } | FailedStep | { readonly kind: 'stale' };

export interface ShopController {
  state(): ShopState;
  /** True when the shop can still be edited through onboarding (none yet, or an INCOMPLETE draft). ACTIVE/DISABLED shops are read-only here. */
  editable(): boolean;
  /**
   * Reads the shop and the ACTIVE areas. Without `force`, a visit that is already loaded keeps what the person typed (F21 after
   * F22). With `force`, the server's data replaces the form (entering from F20/F23, or after a VERSION_CONFLICT).
   */
  load(options?: { readonly force?: boolean }): Promise<ShopStep>;
  setField(field: ShopFormField, value: string): void;
  chooseArea(serviceAreaId: string | null): void;
  /** True when the form, the area or the pickup differ from what the server last said (or from the empty form when there is no shop). */
  dirty(): boolean;
  /** Why completion is not offered yet (Vietnamese), or undefined when it is. */
  completeBlocker(): string | undefined;
  save(): Promise<ShopStep>;
  complete(): Promise<CompleteStep>;
  /** Asks the device for a position (the person pressed the button). A success is a candidate, not yet the pickup point. */
  locate(): Promise<LocateStep>;
  /** "Dùng vị trí này": the candidate becomes the pickup point of the form (still to be saved). */
  confirmCandidate(): boolean;
  discardCandidate(): void;
  /** F21 -> F22 -> F21: the next screen change is part of the flow, so typed data is kept and no question is asked. Cleared by `arrive()`. */
  keepForFlow(): void;
  /** A screen of the flow was drawn. */
  arrive(): void;
  /** True between `keepForFlow()` and the next `arrive()`: the person is moving inside the flow, so the leave question is not asked. */
  flowing(): boolean;
  /** Reads the ACTIVE areas again WITHOUT touching what was typed (an area that stopped being active). */
  refreshAreas(): Promise<ShopStep>;
  /** The person really left the flow: unsaved edits and the candidate are dropped, and the next visit reads the server again. */
  discardEdits(): void;
  /** Refreshes the identity (me): the roles/onboarding the server reports after completion. */
  refreshIdentity(): Promise<AuthResult<SignedIn>>;
  /** Enter the SHOP_OWNER or CUSTOMER context. The server decides whether the person may. */
  selectContext(context: PublicContext): Promise<AuthResult<SignedIn>>;
  /** Everything goes (sign-out, another person). Answers still on their way become stale. */
  reset(): void;
}

export interface ShopControllerOptions {
  readonly auth: AuthClient;
  readonly geo: GeolocationPort;
}

const failed = (answer: Extract<AuthResult<unknown>, { kind: 'failure' }>): FailedStep =>
  answer.retryAfterSeconds === undefined ? { kind: 'failure', code: answer.code, unresolved: answer.unresolved } : { kind: 'failure', code: answer.code, unresolved: answer.unresolved, retryAfterSeconds: answer.retryAfterSeconds };

const toE164 = (phone: string): string => {
  const trimmed = phone.trim();
  return trimmed.startsWith('+84') ? trimmed : trimmed.startsWith('84') ? `+${trimmed}` : `+84${trimmed.slice(1)}`;
};

interface Baseline {
  readonly form: ShopForm;
  readonly serviceAreaId: string | null;
  readonly pickup: { readonly lat: number; readonly lng: number } | undefined;
}

const EMPTY_BASELINE: Baseline = { form: EMPTY_SHOP_FORM, serviceAreaId: null, pickup: undefined };

function baselineOf(shop: ShopView): Baseline {
  return {
    form: { name: shop.name, phone: shop.contactPhone, address: shop.addressText, zalo: shop.zalo ?? '', facebook: shop.facebook ?? '' },
    serviceAreaId: shop.serviceAreaId,
    pickup: shop.pickupLat === null || shop.pickupLng === null ? undefined : { lat: shop.pickupLat, lng: shop.pickupLng },
  };
}

export function createShopController(options: ShopControllerOptions): ShopController {
  const { auth, geo } = options;
  let epoch = 0;
  let loaded = false;
  let shop: ShopView | null = null;
  let areas: readonly ServiceAreaChoice[] = [];
  let form: ShopForm = EMPTY_SHOP_FORM;
  let serviceAreaId: string | null = null;
  let pickup: PickupPoint | undefined;
  let candidate: GeoFix | undefined;
  let baseline: Baseline = EMPTY_BASELINE;
  let inFlow = false;
  let loadRun: Promise<ShopStep> | undefined;
  let locateRun: Promise<LocateStep> | undefined;

  const adopt = (next: ShopView | null): void => {
    shop = next;
    baseline = next === null ? EMPTY_BASELINE : baselineOf(next);
    form = baseline.form;
    serviceAreaId = baseline.serviceAreaId;
    pickup = baseline.pickup === undefined ? undefined : { ...baseline.pickup, accuracyMeters: null, measuredAtMs: null };
    candidate = undefined;
  };

  const editable = (): boolean => shop === null || shop.status === 'INCOMPLETE';

  const dirty = (): boolean =>
    form.name !== baseline.form.name ||
    form.phone !== baseline.form.phone ||
    form.address !== baseline.form.address ||
    form.zalo !== baseline.form.zalo ||
    form.facebook !== baseline.form.facebook ||
    serviceAreaId !== baseline.serviceAreaId ||
    (pickup?.lat ?? null) !== (baseline.pickup?.lat ?? null) ||
    (pickup?.lng ?? null) !== (baseline.pickup?.lng ?? null);

  const reset = (): void => {
    epoch += 1;
    loaded = false;
    shop = null;
    areas = [];
    form = EMPTY_SHOP_FORM;
    serviceAreaId = null;
    pickup = undefined;
    candidate = undefined;
    baseline = EMPTY_BASELINE;
    inFlow = false;
    loadRun = undefined;
    locateRun = undefined;
  };

  // The data belongs to the person signed in: sign-out, expiry or another person's sign-in drops it all.
  let owner = auth.session.identity()?.userId;
  auth.session.subscribe(() => {
    const now = auth.session.identity()?.userId;
    if (now !== owner) {
      owner = now;
      reset();
    }
  });

  function load(loadOptions: { readonly force?: boolean } = {}): Promise<ShopStep> {
    if (loaded && loadOptions.force !== true) {
      return Promise.resolve({ kind: 'ok' });
    }
    if (loadRun !== undefined) {
      return loadRun;
    }
    const mine = epoch;
    const run: Promise<ShopStep> = (async (): Promise<ShopStep> => {
      const [shopAnswer, areaAnswer] = await Promise.all([auth.readShop(), auth.readServiceAreas()]);
      if (mine !== epoch || shopAnswer.kind === 'stale' || areaAnswer.kind === 'stale') {
        return { kind: 'stale' };
      }
      if (shopAnswer.kind === 'failure') {
        return failed(shopAnswer);
      }
      if (areaAnswer.kind === 'failure') {
        return failed(areaAnswer);
      }
      areas = areaAnswer.value;
      adopt(shopAnswer.value);
      loaded = true;
      return { kind: 'ok' };
    })().finally(() => {
      if (loadRun === run) {
        loadRun = undefined;
      }
    });
    loadRun = run;
    return run;
  }

  function areaInList(): boolean {
    return serviceAreaId !== null && areas.some((area) => area.serviceAreaId === serviceAreaId);
  }

  function completeBlocker(): string | undefined {
    if (shop === null) {
      return 'Lưu hồ sơ trước, rồi mới hoàn tất được.';
    }
    if (shop.status !== 'INCOMPLETE') {
      return 'Hồ sơ này đã hoàn tất.';
    }
    if (dirty()) {
      return 'Có thay đổi chưa lưu. Hãy lưu hồ sơ trước khi hoàn tất.';
    }
    if (shop.pickupLat === null || shop.pickupLng === null) {
      return 'Cần lấy và xác nhận vị trí thật tại quán, rồi lưu hồ sơ.';
    }
    if (shop.serviceAreaId === null) {
      return areas.length === 0 ? 'Chưa có khu vực hoạt động để chọn, nên chưa hoàn tất được.' : 'Cần chọn khu vực phục vụ rồi lưu hồ sơ.';
    }
    if (!areaInList()) {
      return 'Khu vực đã lưu không còn hoạt động. Hãy chọn lại khu vực rồi lưu hồ sơ.';
    }
    return undefined;
  }

  async function save(): Promise<ShopStep> {
    if (!editable()) {
      return { kind: 'failure', code: 'SHOP_EXISTS', unresolved: false };
    }
    const mine = epoch;
    const sent = { form, serviceAreaId, pickup };
    const answer = await auth.saveShop({
      name: sent.form.name,
      contactPhone: sent.form.phone,
      addressText: sent.form.address,
      zalo: sent.form.zalo.trim() === '' ? null : sent.form.zalo,
      facebook: sent.form.facebook.trim() === '' ? null : sent.form.facebook,
      pickup: sent.pickup === undefined ? null : { lat: sent.pickup.lat, lng: sent.pickup.lng },
      serviceAreaId: sent.serviceAreaId,
      expectedVersion: shop === null ? null : shop.version,
    });
    if (mine !== epoch || answer.kind === 'stale') {
      return { kind: 'stale' };
    }
    if (answer.kind === 'failure') {
      return failed(answer);
    }
    // What the server now holds is what was sent, with the version it gave. The next save names this version.
    shop = {
      shopId: answer.value.shopId,
      name: sent.form.name.trim(),
      contactPhone: toE164(sent.form.phone),
      zalo: sent.form.zalo.trim() === '' ? null : sent.form.zalo.trim(),
      facebook: sent.form.facebook.trim() === '' ? null : sent.form.facebook.trim(),
      addressText: sent.form.address.trim(),
      pickupLat: sent.pickup?.lat ?? null,
      pickupLng: sent.pickup?.lng ?? null,
      serviceAreaId: sent.serviceAreaId,
      status: 'INCOMPLETE',
      acceptingOrders: false,
      version: answer.value.version,
    };
    baseline = { form: sent.form, serviceAreaId: sent.serviceAreaId, pickup: sent.pickup === undefined ? undefined : { lat: sent.pickup.lat, lng: sent.pickup.lng } };
    return { kind: 'ok' };
  }

  async function complete(): Promise<CompleteStep> {
    if (completeBlocker() !== undefined || shop === null) {
      return { kind: 'failure', code: 'SHOP_INCOMPLETE', unresolved: false };
    }
    const mine = epoch;
    const answer = await auth.completeShop({ expectedVersion: shop.version });
    if (mine !== epoch || answer.kind === 'stale') {
      return { kind: 'stale' };
    }
    if (answer.kind === 'failure') {
      return failed(answer);
    }
    shop = { ...shop, status: 'ACTIVE', acceptingOrders: false, version: answer.value.version };
    baseline = baselineOf(shop);
    // Completion grants the role on the server but changes nothing in the session: ask the server who this person is now.
    const refreshed = await auth.me();
    return { kind: 'ok', identityRefreshed: refreshed.kind === 'ok' };
  }

  function locate(): Promise<LocateStep> {
    if (locateRun !== undefined) {
      return Promise.resolve({ kind: 'busy' });
    }
    const mine = epoch;
    const run: Promise<LocateStep> = (async (): Promise<LocateStep> => {
      const result = await geo.locate();
      if (mine !== epoch) {
        return { kind: 'stale' };
      }
      if (result.kind === 'failure') {
        candidate = undefined;
        return result;
      }
      candidate = result.fix;
      return { kind: 'ok', fix: result.fix };
    })().finally(() => {
      if (locateRun === run) {
        locateRun = undefined;
      }
    });
    locateRun = run;
    return run;
  }

  return {
    state: () => ({ loaded, shop, areas, form, serviceAreaId, pickup, candidate }),
    editable,
    load,
    setField(field, value) {
      if (editable()) {
        form = { ...form, [field]: value };
      }
    },
    chooseArea(next) {
      if (editable()) {
        serviceAreaId = next;
      }
    },
    dirty,
    completeBlocker,
    save,
    complete,
    locate,
    confirmCandidate() {
      if (candidate === undefined || !editable()) {
        return false;
      }
      pickup = { lat: candidate.lat, lng: candidate.lng, accuracyMeters: candidate.accuracyMeters, measuredAtMs: candidate.measuredAtMs };
      candidate = undefined;
      return true;
    },
    discardCandidate() {
      candidate = undefined;
    },
    keepForFlow() {
      inFlow = true;
    },
    arrive() {
      inFlow = false;
    },
    flowing: () => inFlow,
    async refreshAreas() {
      const mine = epoch;
      const answer = await auth.readServiceAreas();
      if (mine !== epoch || answer.kind === 'stale') {
        return { kind: 'stale' };
      }
      if (answer.kind === 'failure') {
        return failed(answer);
      }
      areas = answer.value;
      return { kind: 'ok' };
    },
    discardEdits() {
      if (inFlow) {
        return;
      }
      candidate = undefined;
      if (loaded) {
        form = baseline.form;
        serviceAreaId = baseline.serviceAreaId;
        pickup = baseline.pickup === undefined ? undefined : { ...baseline.pickup, accuracyMeters: null, measuredAtMs: null };
        // The next visit reads the server again (it may have changed on another device).
        loaded = false;
      }
    },
    refreshIdentity: () => auth.me(),
    selectContext: (context) => auth.selectContext(context),
    reset,
  };
}
