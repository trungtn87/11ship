import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { isWellFormed } from '../auth/auth-validation';

export const PLACE_SEARCH_FETCH = Symbol('PLACE_SEARCH_FETCH');
export const PLACE_SEARCH_ORIGIN = Symbol('PLACE_SEARCH_ORIGIN');
export type PlaceFetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface PlaceResult {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly in_cao_bang: boolean;
}

const DEFAULT_ORIGIN = 'https://photon.komoot.io';
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 128;
const MIN_UPSTREAM_GAP_MS = 1100;
const CAO_BANG = { lat: 22.6666, lon: 106.2639 };

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export function parsePlaceQuery(value: unknown): string {
  if (typeof value !== 'string' || !isWellFormed(value) || value.includes('\0')) throw new BadRequestException();
  const query = value.trim();
  if ([...query].length < 2 || [...query].length > 120) throw new BadRequestException();
  return query;
}

export function parsePhoton(body: unknown): PlaceResult[] {
  const features = object(body)?.features;
  if (!Array.isArray(features)) throw new TechnicalError('unavailable', 'Place search returned an invalid response');
  const results: PlaceResult[] = [];
  for (const raw of features) {
    const feature = object(raw); const geometry = object(feature?.geometry); const properties = object(feature?.properties);
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || properties === undefined) continue;
    const longitude = coordinates[0]; const latitude = coordinates[1];
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) continue;
    if (String(properties.countrycode ?? '').toUpperCase() !== 'VN') continue;
    const name = text(properties.name) ?? text(properties.street) ?? text(properties.city) ?? text(properties.state);
    if (name === undefined) continue;
    const addressParts = [properties.housenumber, properties.street, properties.district, properties.city, properties.state, properties.country]
      .map(text).filter((part): part is string => part !== undefined);
    const address = [...new Set(addressParts)].join(', ') || name;
    const state = `${text(properties.state) ?? ''} ${text(properties.city) ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const inCaoBang = state.includes('cao bang');
    results.push({
      id: `${String(properties.osm_type ?? 'osm')}:${String(properties.osm_id ?? `${latitude},${longitude}`)}`,
      name, address, latitude, longitude, in_cao_bang: inCaoBang,
    });
  }
  return results.sort((a, b) => Number(b.in_cao_bang) - Number(a.in_cao_bang)).slice(0, 8);
}

@Injectable()
export class PlaceSearchService {
  readonly #cache = new Map<string, { at: number; results: PlaceResult[] }>();
  readonly #inflight = new Map<string, Promise<PlaceResult[]>>();
  #upstreamGate: Promise<void> = Promise.resolve();
  #nextRequestAt = 0;

  constructor(
    @Optional() @Inject(PLACE_SEARCH_FETCH) private readonly injectedFetch?: PlaceFetcher,
    @Optional() @Inject(PLACE_SEARCH_ORIGIN) private readonly injectedOrigin?: string,
  ) {}

  async search(query: string, now = Date.now()): Promise<PlaceResult[]> {
    const key = createHash('sha256').update(query.toLocaleLowerCase('vi')).digest('hex');
    const cached = this.#cache.get(key);
    if (cached !== undefined && now - cached.at < CACHE_TTL_MS) return cached.results;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const request = this.#searchUpstream(query, key);
    this.#inflight.set(key, request);
    try { return await request; } finally { this.#inflight.delete(key); }
  }

  async #searchUpstream(query: string, key: string): Promise<PlaceResult[]> {
    const previous = this.#upstreamGate;
    let release!: () => void;
    this.#upstreamGate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, this.#nextRequestAt - Date.now());
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      this.#nextRequestAt = Date.now() + MIN_UPSTREAM_GAP_MS;
      const origin = (this.injectedOrigin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
      const url = new URL(`${origin}/api/`);
      url.searchParams.set('q', query);
      url.searchParams.set('lat', String(CAO_BANG.lat));
      url.searchParams.set('lon', String(CAO_BANG.lon));
      url.searchParams.set('limit', '12');
      const fetcher = this.injectedFetch ?? ((target, init) => fetch(target, init));
      const response = await fetcher(url.toString(), {
        headers: { accept: 'application/json', 'user-agent': '11Ship/1.0 (+https://github.com/trungtn87/11ship)' },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new TechnicalError('unavailable', 'Place search upstream refused the request');
      const results = parsePhoton(await response.json());
      if (this.#cache.size >= CACHE_MAX) {
        const oldest = this.#cache.keys().next(); if (!oldest.done) this.#cache.delete(oldest.value);
      }
      this.#cache.set(key, { at: Date.now(), results });
      return results;
    } catch (error) {
      if (error instanceof TechnicalError) throw error;
      throw new TechnicalError('unavailable', 'Place search is unavailable');
    } finally {
      release();
    }
  }
}
