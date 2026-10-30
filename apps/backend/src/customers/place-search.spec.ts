import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { TechnicalError } from '../common/app-errors';
import { parsePhoton, parsePlaceQuery, PlaceFetcher, PlaceSearchService } from './place-search';

const photon = (features: unknown[]) => ({ features });
const feature = (name: string, coordinates: [number, number], state = 'Cao Bằng') => ({
  geometry: { coordinates },
  properties: { osm_type: 'N', osm_id: name, name, city: state, state, country: 'Việt Nam', countrycode: 'VN' },
});

describe('Cao Bang place search', () => {
  it('validates a bounded search query', () => {
    expect(parsePlaceQuery('  Bệnh viện  ')).toBe('Bệnh viện');
    for (const value of ['', 'a', 'a'.repeat(121), null, 1, 'a\0b']) {
      expect(() => parsePlaceQuery(value)).toThrow(BadRequestException);
    }
  });

  it('keeps valid Vietnam coordinates and ranks Cao Bang first', () => {
    expect(parsePhoton(photon([
      feature('Hà Nội', [105.84, 21.03], 'Hà Nội'),
      feature('Bệnh viện Đa khoa Cao Bằng', [106.2522, 22.6657]),
      feature('Zero', [0, 0]),
      { geometry: { coordinates: [106, 22] }, properties: { name: 'China', countrycode: 'CN' } },
    ]))).toMatchObject([
      { name: 'Bệnh viện Đa khoa Cao Bằng', latitude: 22.6657, longitude: 106.2522, in_cao_bang: true },
      { name: 'Hà Nội', in_cao_bang: false },
    ]);
  });

  it('biases the upstream request to Cao Bang and caches an identical query', async () => {
    const fetcher = jest.fn<PlaceFetcher>(async () => ({ ok: true, json: async () => photon([feature('Bến xe Cao Bằng', [106.25, 22.67])]) }));
    const service = new PlaceSearchService(fetcher, 'https://places.example.test/');
    const first = await service.search('Bến xe');
    const second = await service.search('Bến xe');
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0]![0]);
    expect(url.searchParams.get('q')).toBe('Bến xe');
    expect(url.searchParams.get('lat')).toBe('22.6666');
    expect(url.searchParams.get('lon')).toBe('106.2639');
  });

  it('fails closed when the provider refuses or returns an invalid document', async () => {
    const refused: PlaceFetcher = async () => ({ ok: false, json: async () => ({}) });
    await expect(new PlaceSearchService(refused).search('Bệnh viện')).rejects.toBeInstanceOf(TechnicalError);
    expect(() => parsePhoton({})).toThrow(TechnicalError);
  });
});
