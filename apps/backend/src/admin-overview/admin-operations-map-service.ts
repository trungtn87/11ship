import { Injectable } from '@nestjs/common';
import { AdminRightsReader } from '../admin-m12/admin-rights';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AdminServiceAreaRepository } from '../admin-service-areas/admin-service-area-repository';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { LOCATION_LIVE_SECONDS, LOCATION_STALE_SECONDS } from '../delivery/delivery-constants';
import { locationValid } from '../delivery/delivery-rules';
import { ShipperLocationRepository } from '../delivery/shipper-location';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { Inject } from '@nestjs/common';

/** Points drawn per kind. One more is read to learn whether more exist; the answer then says `truncated`, it never silently cuts. */
const MAP_LIMIT = 300;

/**
 * Issue #262 (IV): the operations map of the Administration. It hands the web the real coordinates the system holds (the service-area circles, the pins of the active
 * shops, the latest position of the Shipper who switched Online) and nothing else; the web draws them as an internal sketch on the WGS84 plane (no tiles, no third-party
 * map, no route, no directions). A position is `LIVE` up to 120 s, `STALE` up to 600 s and is not given after that; an Online Shipper without a usable position is only
 * counted, never drawn at an invented place. Scope: shops need the SHOP app VIEW, Shippers the DRIVER app VIEW (a Shipper's name additionally needs the review right of
 * DRIVER); the zones need either. SYSTEM sees all.
 */
@Injectable()
export class AdminOperationsMapService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly rightsReader: AdminRightsReader,
    private readonly zones: AdminServiceAreaRepository,
    private readonly drivers: DriverAdminQueryRepository,
    private readonly locations: ShipperLocationRepository,
    private readonly shopRepository: ShopRepository,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async map(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rightsReader.read(context, known);
      const seeShops = rights.canViewApp('SHOP');
      const seeShippers = rights.canViewApp('DRIVER');
      if (!seeShops && !seeShippers) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const zones = (await this.zones.list(context)).map(({ area }) => ({
        service_area_id: area.serviceAreaId,
        name: area.name,
        status: area.status,
        coverage: area.coverage === null ? null : { lat: area.coverage.latitude, lng: area.coverage.longitude, radius_m: area.coverage.radiusMeters },
      }));
      let truncated = false;
      let shops: JsonObject[] | null = null;
      let shopsWithoutPin: number | null = null;
      if (seeShops) {
        const read = await this.#shops(context);
        shops = read.pins;
        shopsWithoutPin = read.withoutPin;
        truncated = truncated || read.truncated;
      }
      let shippers: JsonObject[] | null = null;
      let online: number | null = null;
      let withoutPosition: number | null = null;
      if (seeShippers) {
        const online$ = await this.drivers.onlineForMap(context, MAP_LIMIT + 1);
        const slice = online$.slice(0, MAP_LIMIT);
        truncated = truncated || online$.length > MAP_LIMIT;
        const positions = await this.locations.findMany(context, slice.map((d) => d.driverId));
        shippers = [];
        withoutPosition = 0;
        for (const d of slice) {
          const p = positions.get(d.driverId);
          const valid = p !== undefined && locationValid(p.lat, p.lng, p.accuracyM) && !(p.lat === 0 && p.lng === 0);
          if (p === undefined || !valid || p.ageSeconds < 0 || p.ageSeconds > LOCATION_STALE_SECONDS) {
            withoutPosition += 1;
            continue;
          }
          shippers.push({
            driver_id: d.driverId,
            code: d.shipperCode,
            name: rights.canReviewShippers ? d.fullName : null,
            lat: p.lat,
            lng: p.lng,
            age_seconds: p.ageSeconds,
            freshness: p.ageSeconds <= LOCATION_LIVE_SECONDS ? 'LIVE' : 'STALE',
          });
        }
        online = slice.length;
      }
      return {
        generated_at: new Date(rights.nowMs).toISOString(),
        zones,
        shops,
        shops_without_pin: shopsWithoutPin,
        shippers,
        shippers_online: online,
        shippers_without_position: withoutPosition,
        truncated,
      };
    });
  }

  async #shops(context: TransactionContext): Promise<{ pins: JsonObject[]; withoutPin: number; truncated: boolean }> {
    const read = await this.shopRepository.mapPins(context, MAP_LIMIT + 1);
    return {
      pins: read.pins.slice(0, MAP_LIMIT).map((p) => ({ shop_id: p.shopId, name: p.name, lat: p.lat, lng: p.lng, service_area_id: p.serviceAreaId })),
      withoutPin: read.withoutPin,
      truncated: read.pins.length > MAP_LIMIT,
    };
  }
}
