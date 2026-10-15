"""Run on CI against Render, or against an isolated local Docker deployment."""
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

origin = sys.argv[1].rstrip('/')
for attempt in range(12):
    try:
        with urllib.request.urlopen(origin+'/health', timeout=40) as response:
            health = json.load(response)
        assert health['ready']
        break
    except Exception:
        if attempt == 11:
            raise
        time.sleep(10)

start = {'lat': 22.6672017, 'lon': 106.2638557}  # Real OSM road vertex, Đường Pác Bó.
end = {'lat': 22.6566272, 'lon': 106.2585301}  # Real OSM road vertex, Đường Tân An.
request = urllib.request.Request(origin+'/route', json.dumps({'locations': [start, end]}).encode(), {'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=60) as response:
    route = json.load(response)
trip = route['trip']
assert trip['summary']['length'] > 0
assert trip['legs'][0]['shape']
assert trip['units'] == 'kilometers'
# Outside coverage must fail. No straight-line fallback is accepted.
bad = urllib.request.Request(origin+'/route', json.dumps({'locations': [start, {'lat': 21.0, 'lon': 105.0}]}).encode(), {'Content-Type': 'application/json'})
try:
    urllib.request.urlopen(bad, timeout=30)
    raise AssertionError('Outside point unexpectedly routed')
except urllib.error.HTTPError as error:
    assert error.code == 400
    assert 'ngoài vùng' in json.load(error)['message']
report = dict(origin=origin, ready=True, motorcycle_route_km=trip['summary']['length'], shape_points_encoded=len(trip['legs'][0]['shape']), outside_rejected=True, start=start, end=end)
Path('routing-smoke.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, ensure_ascii=False))
