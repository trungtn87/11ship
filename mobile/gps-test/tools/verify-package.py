#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'app/src/main/assets/caobang'
m = json.loads((root / 'manifest.json').read_text())
assert m['feature_count'] > 100
assert m['bounds'] == [106.0, 22.43, 106.52, 22.91]
for name, expected in m['sha256'].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
assert all((root / 'fonts/NotoSansRegular' / f'{i}-{i+255}.pbf').exists() for i in range(0,65536,256))
style = json.loads((root / 'style.json').read_text())
assert style['glyphs'].startswith('asset://')
assert all(s['data'].startswith('asset://') for s in style['sources'].values())
assert 'sprite' not in style  # Pins are generated locally with Android Canvas; no sprite endpoint.
data = json.loads((root / 'map.geojson').read_text())
assert any(f['properties'].get('name') == 'Cao Bằng' for f in data['features']), 'Cao Bang place missing'
print('Offline package verified:', m['version'], m['feature_count'], 'features')
