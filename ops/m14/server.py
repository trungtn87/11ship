"""Small bounded gateway. No history endpoint, user database, request-body logging or paid provider."""
import json
import math
import os
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BOUNDS = (106.0, 22.43, 106.52, 22.91)
ENGINE = 'http://127.0.0.1:8002'
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
        clean.append(dict(lat=lat, lon=lon, radius=100, search_cutoff=500))
    return dict(locations=clean, costing='motorcycle', costing_options={'motorcycle': {'use_highways': 0.3, 'use_tolls': 0.0, 'use_ferry': 0.0}}, directions_options={'units': 'kilometers', 'directions_type': 'none'})


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
        try:
            with urllib.request.urlopen(ENGINE+'/status', timeout=3) as r:
                status = r.status
            self.reply(200 if status == 200 else 503, {'ready': status == 200, 'engine': 'Valhalla 3.9.1', 'costing': 'motorcycle', 'bounds': BOUNDS})
        except Exception:
            self.reply(503, {'ready': False, 'message': 'Dịch vụ đang khởi động'})

    def do_POST(self):
        if self.path != '/route':
            return self.reply(404, {'message': 'Không có chức năng này'})
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
