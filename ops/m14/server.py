"""Small bounded gateway. No history endpoint, user database, request-body logging or paid provider."""
import hashlib
import json
import math
import os
import re
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BOUNDS = (106.0, 22.43, 106.52, 22.91)
ENGINE = 'http://127.0.0.1:8002'
ENGINE_NAME = 'valhalla-3.9.1'  # the image is pinned by digest in the Dockerfile
DATA_VERSION_FILE = '/opt/m14/data.version'  # written by the Dockerfile from the PBF the graph was built from
# Same rule as the backend (apps/backend/src/delivery/m14-route-client.ts ROUTE_VERSION_PATTERN): a version that does not match is never served.
ROUTE_VERSION_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/+:-]{0,127}')
DATA_VERSION_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/+:-]{0,63}')
# The motorcycle profile actually sent to the engine. Every value here is part of the profile digest in route_version().
USE_HIGHWAYS = 0.3
USE_TOLLS = 0.0
USE_FERRY = 0.0
SNAP_RADIUS = 100
SEARCH_CUTOFF = 500
def env_int(name, default, low, high):
    """A bounded integer limit from the environment; anything else keeps the default (the gateway never starts on a nonsense limit)."""
    raw = os.environ.get(name)
    if raw is None or not raw.isdigit() or not low <= int(raw) <= high:
        return default
    return int(raw)


# Defaults suit the public test service. On the VPS the backend is ONE client address (the container gateway), so its per-address ceiling and the
# parallel routes it may run are raised through the environment (ops/m14/vps.sh); the routing port is never published beyond 127.0.0.1.
RATE_PER_MINUTE = env_int('M14_RATE_PER_MIN', 20, 1, 6000)
MAX_CONCURRENT = env_int('M14_MAX_CONCURRENT', 2, 1, 8)
CAPACITY = threading.BoundedSemaphore(MAX_CONCURRENT)
LOCK = threading.Lock()
REQUESTS = {}


def env_flag(name, default):
    """A boolean from the environment: 1/true/on or 0/false/off; anything else keeps the default."""
    raw = (os.environ.get(name) or '').strip().lower()
    if raw in ('1', 'true', 'on'):
        return True
    if raw in ('0', 'false', 'off'):
        return False
    return default


def shortest_enabled():
    """Owner 2026-11-09: the shortest motorcycle route is the DEFAULT. M14_SHORTEST=0/false/off exists only to roll back to the previous profile."""
    return env_flag('M14_SHORTEST', True)


def data_version():
    """Identifies the map data the graph was built from: M14_DATA_VERSION, else the file the image build wrote. None when unknown or malformed (nothing invented)."""
    explicit = (os.environ.get('M14_DATA_VERSION') or '').strip()
    if explicit:
        value = explicit
    else:
        try:
            with open(DATA_VERSION_FILE, encoding='ascii') as f:
                value = f.read().strip()
        except (OSError, UnicodeDecodeError):
            return None
    return value if DATA_VERSION_RE.fullmatch(value) else None


def motorcycle_costing():
    costing = {'use_highways': USE_HIGHWAYS, 'use_tolls': USE_TOLLS, 'use_ferry': USE_FERRY}
    if shortest_enabled():
        costing['shortest'] = True
    return costing


def routing_profile():
    """Everything in a request that shapes the route, except the two coordinates."""
    return {
        'costing': 'motorcycle',
        'costing_options': {'motorcycle': motorcycle_costing()},
        'directions_options': {'units': 'kilometers', 'directions_type': 'none'},
        'snap': {'radius': SNAP_RADIUS, 'search_cutoff': SEARCH_CUTOFF},
    }


def profile_digest():
    """8 hex characters of the profile above: changing any profile value (shortest, highways, snapping...) changes the route version."""
    return hashlib.sha256(json.dumps(routing_profile(), sort_keys=True).encode()).hexdigest()[:8]


def route_version():
    """engine + profile digest + data version from this service's own configuration. None when the data version is unknown or the result is malformed:
    /health is then not ready and /route refuses before asking the engine."""
    data = data_version()
    if data is None:
        return None
    value = '%s/motorcycle-%s-%s/%s' % (ENGINE_NAME, 'shortest' if shortest_enabled() else 'default', profile_digest(), data)
    return value if ROUTE_VERSION_RE.fullmatch(value) else None


def validated_request(data):
    locations = data.get('locations')
    if not isinstance(locations, list) or len(locations) != 2:
        raise ValueError('Cần đúng hai điểm đầu và cuối')
    clean = []
    for p in locations:
        if not isinstance(p, dict):
            raise ValueError('Điểm không hợp lệ')
        lat, lon = p.get('lat'), p.get('lon')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lon)):
            raise ValueError('Tọa độ không hợp lệ')
        if not (BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]):
            raise ValueError('Điểm nằm ngoài vùng dữ liệu Cao Bằng phục vụ test')
        clean.append(dict(lat=lat, lon=lon, radius=SNAP_RADIUS, search_cutoff=SEARCH_CUTOFF))
    profile = routing_profile()
    return dict(locations=clean, costing=profile['costing'], costing_options=profile['costing_options'], directions_options=profile['directions_options'])


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Coordinates must not be retained in logs.

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def reply(self, code, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'message': 'Không có chức năng này'})
        version = route_version()
        if version is None:
            # Not ready: the backend preflight (ops/m14/vps.sh) and any load balancer must not send traffic here.
            return self.reply(503, {'ready': False, 'message': 'Cấu hình phiên bản tuyến không hợp lệ'})
        try:
            with urllib.request.urlopen(ENGINE+'/status', timeout=3) as r:
                status = r.status
            ready = status == 200
            self.reply(200 if ready else 503, {'ready': ready, 'engine': 'Valhalla 3.9.1', 'costing': 'motorcycle', 'bounds': BOUNDS, 'shortest': shortest_enabled(), 'routeVersion': version})
        except Exception:
            self.reply(503, {'ready': False, 'message': 'Dịch vụ đang khởi động'})

    def do_POST(self):
        if self.path != '/route':
            return self.reply(404, {'message': 'Không có chức năng này'})
        version = route_version()
        if version is None:
            # Refused BEFORE the engine is asked: an answer without a valid version would be unusable to the backend.
            return self.reply(503, {'message': 'Chưa xác định được phiên bản dữ liệu tuyến'})
        now = time.monotonic()
        with LOCK:
            # Fixed ceiling on in-memory rate-limit bookkeeping; no persistent IP logs.
            for k in list(REQUESTS):
                if REQUESTS[k][0] < now-60:
                    del REQUESTS[k]
            key = self.client_address[0]
            since, count = REQUESTS.get(key, (now, 0))
            if count >= RATE_PER_MINUTE or len(REQUESTS) >= 256:
                return self.reply(429, {'message': 'Dịch vụ đang bận, thử lại sau một phút'})
            REQUESTS[key] = (since, count+1)
        if not CAPACITY.acquire(blocking=False):
            return self.reply(429, {'message': 'Dịch vụ đang tính tuyến khác, vui lòng thử lại'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                return self.reply(400, {'message': 'Yêu cầu quá lớn hoặc thiếu dữ liệu'})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Yêu cầu không hợp lệ')
            data = validated_request(data)
            request = urllib.request.Request(ENGINE+'/route', json.dumps(data).encode(), {'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=40) as r:
                    body = json.load(r)
                if 'trip' not in body:
                    raise ValueError('Không tìm được tuyến')
                body['route_version'] = version  # the shape (trip.legs[0].shape, polyline6) is already part of the engine answer
                return self.reply(200, body)
            except urllib.error.HTTPError as error:
                if error.code < 500:
                    return self.reply(422, {'message': 'Không tìm thấy tuyến xe máy trên dữ liệu hiện có. Thử chọn điểm gần đường hơn.'})
                return self.reply(503, {'message': 'Bộ máy tính tuyến tạm thời chưa sẵn sàng'})
        except (ValueError, TypeError) as error:
            self.reply(400, {'message': str(error)})
        except Exception:
            self.reply(503, {'message': 'Không kết nối được bộ máy tính tuyến, vui lòng thử lại'})
        finally:
            CAPACITY.release()


def main():
    engine = subprocess.Popen(['valhalla_service', '/opt/m14/valhalla.json', '1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    server = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '10000'))), Handler)
    server.daemon_threads = True
    def stop(*args):
        engine.terminate()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def watch():
        engine.wait()
        os._exit(1)  # Let Render restart a failed engine instead of serving a false healthy state.
    threading.Thread(target=watch, daemon=True).start()
    print('M14 routing gateway listening; request-body logging disabled', flush=True)
    try:
        server.serve_forever()
    finally:
        engine.terminate()
        server.server_close()


if __name__ == '__main__':
    main()
