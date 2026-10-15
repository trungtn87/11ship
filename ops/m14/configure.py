import json
import subprocess
from pathlib import Path

c = json.loads(subprocess.check_output(['valhalla_build_config'], text=True))
c['mjolnir'].update(tile_dir='/opt/m14/tiles', tile_extract='', traffic_extract='', concurrency=1, id_table_size=10_000_000, max_cache_size=32_000_000)
c['httpd']['service']['listen'] = 'tcp://127.0.0.1:8002'
c['httpd']['service']['interrupt'] = 'ipc:///tmp/m14-interrupt'
c['httpd']['service']['loopback'] = 'ipc:///tmp/m14-loopback'
c['loki']['service']['proxy'] = 'ipc:///tmp/m14-loki'
c['thor']['service']['proxy'] = 'ipc:///tmp/m14-thor'
c['odin']['service']['proxy'] = 'ipc:///tmp/m14-odin'
c['loki']['actions'] = ['route', 'status']
c['service_limits']['motorcycle'].update(max_distance=150000, max_locations=2)
c['logging'] = {'type': 'std_out', 'color': False}
Path('/opt/m14/valhalla.json').write_text(json.dumps(c))
