#!/usr/bin/env python3
"""Build native local GeoJSON/style, with no public tile downloads. Input: osmium export GeoJSON sequence."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

BOUNDS = [106.0, 22.43, 106.52, 22.91]


def build(source, destination, source_date):
    destination.mkdir(parents=True, exist_ok=True)
    features = []
    for line in source.open():
        if not line.strip():
            continue
        item = json.loads(line.lstrip('\x1e'))
        p = item.get('properties', {})
        kind = None
        if p.get('highway'):
            kind = 'road'
        elif p.get('waterway') or p.get('natural') == 'water' or p.get('water'):
            kind = 'water'
        elif p.get('building'):
            kind = 'building'
        elif p.get('landuse') or p.get('natural') in ('wood', 'scrub', 'grassland') or p.get('leisure') == 'park':
            kind = 'land'
        elif p.get('place'):
            kind = 'place'
        elif p.get('amenity') in ('hospital', 'school', 'bus_station', 'marketplace'):
            kind = 'poi'
        if not kind:
            continue
        # Keep only relevant tags; geometries remain from real OSM data, never synthetic roads.
        item['properties'] = {k: p[k] for k in ('name', 'name:vi', 'highway', 'place', 'landuse', 'natural', 'amenity') if k in p}
        item['properties']['kind'] = kind
        features.append(item)
    if sum(f['properties']['kind'] == 'road' for f in features) < 100:
        raise ValueError('Missing/insufficient Cao Bang road data; refusing a placeholder package')
    (destination / 'map.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')))
    def layer(id, type, kind, paint, geometry=None, layout=None, minzoom=0):
        filt = ['==', ['get', 'kind'], kind]
        if geometry:
            filt = ['all', filt, ['==', ['geometry-type'], geometry]]
        return dict(id=id, type=type, source='caobang', filter=filt, paint=paint, layout=layout or {}, minzoom=minzoom)
    style = {
        'version': 8, 'name': 'Cao Bằng offline',
        'glyphs': 'asset://caobang/fonts/{fontstack}/{range}.pbf',
        'sources': {'caobang': {'type': 'geojson', 'data': 'asset://caobang/map.geojson', 'attribution': '© OpenStreetMap contributors', 'maxzoom': 18}},
        'layers': [
            {'id': 'background', 'type': 'background', 'paint': {'background-color': '#f5f3e9'}},
            layer('land', 'fill', 'land', {'fill-color': '#d9e5cf', 'fill-opacity': 0.75}, 'Polygon'),
            layer('water-area', 'fill', 'water', {'fill-color': '#9dcfe2'}, 'Polygon'),
            layer('water-line', 'line', 'water', {'line-color': '#9dcfe2', 'line-width': 3}, 'LineString'),
            layer('building', 'fill', 'building', {'fill-color': '#d7c9b9', 'fill-outline-color': '#c0b29f'}, 'Polygon', minzoom=14),
            layer('road-casing', 'line', 'road', {'line-color': '#c7bbaa', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 5, 18, 13]}, 'LineString'),
            layer('road', 'line', 'road', {'line-color': ['match', ['get', 'highway'], ['primary', 'secondary', 'trunk', 'motorway'], '#f0cb7a', '#ffffff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 3, 18, 10]}, 'LineString', {'line-cap': 'round', 'line-join': 'round'}),
            layer('road-label', 'symbol', 'road', {'text-color': '#5a5045', 'text-halo-color': '#ffffff', 'text-halo-width': 1}, 'LineString', {'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 11}, 14),
            layer('place-label', 'symbol', 'place', {'text-color': '#263c46', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5}, 'Point', {'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 14}),
            layer('poi-label', 'symbol', 'poi', {'text-color': '#66507b', 'text-halo-color': '#ffffff', 'text-halo-width': 1}, 'Point', {'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 11}, 15),
        ]
    }
    (destination / 'style.json').write_text(json.dumps(style, ensure_ascii=False, indent=2))
    (destination / 'NOTICE.txt').write_text('© OpenStreetMap contributors. Source: Geofabrik Vietnam extract, '+source_date+'.\nMap database (map.geojson) is provided under Open Database License 1.0 (ODbL).\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/\nThe full derived database is included as map.geojson; no tile server was scraped.\nFonts: Noto Sans, SIL Open Font License; see fonts/OFL.txt.\nMap style: 11Ship GPS Test project.\n')
    checksums = {str(f.relative_to(destination)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(destination.rglob('*')) if f.is_file() and f.name != 'manifest.json'}
    manifest = dict(version='caobang-v1.1-'+source_date, source_date=source_date, bounds=BOUNDS, center=[106.257,22.665], service_radius_km=10, minimum_buffer_km=10, feature_count=len(features), license='ODbL-1.0', source='https://download.geofabrik.de/asia/vietnam.html', sha256=checksums)
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f'Built {len(features)} OSM features; {len(checksums)} local files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--source-date', required=True)
    args = parser.parse_args()
    build(args.source, args.destination, args.source_date)
