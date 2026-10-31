"""Concurrency probe of the routing service: `load-test.py <origin> [routes=40] [parallel=4]`.

Sends real routes between real road points of the Cao Bang package (the two OSM vertices smoke.py uses plus pairs derived from them), `parallel` at a
time, and prints status counts, p50/p95/max latency and the container/host resources while it ran. It never retries a refused route: a 429 or a 5xx is
reported as it is, because the backend treats those as "route unavailable" (no straight line). Coordinates are not logged.
"""
import json
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

origin = sys.argv[1].rstrip('/')
total = int(sys.argv[2]) if len(sys.argv) > 2 else 40
parallel = int(sys.argv[3]) if len(sys.argv) > 3 else 4
A = {'lat': 22.6672017, 'lon': 106.2638557}  # Đường Pác Bó
B = {'lat': 22.6566272, 'lon': 106.2585301}  # Đường Tân An
pairs = [(A, B), (B, A)]
for i in range(1, 8):  # nudged variants so the backend-side cache would not hide the engine
    d = i * 0.0007
    pairs.append(({'lat': A['lat'] - d, 'lon': A['lon']}, {'lat': B['lat'], 'lon': B['lon'] + d}))

results = []
lock = threading.Lock()
counter = {'next': 0}


def one(index):
    start, end = pairs[index % len(pairs)]
    request = urllib.request.Request(origin + '/route', json.dumps({'locations': [start, end]}).encode(), {'Content-Type': 'application/json'})
    began = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.load(response)
            status = response.status
            km = body.get('trip', {}).get('summary', {}).get('length')
    except urllib.error.HTTPError as error:
        status, km = error.code, None
    except Exception:
        status, km = 0, None
    return status, time.monotonic() - began, km


def worker():
    while True:
        with lock:
            i = counter['next']
            if i >= total:
                return
            counter['next'] += 1
        outcome = one(i)
        with lock:
            results.append(outcome)


def sample(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=15).stdout.strip()
    except Exception:
        return '(unavailable)'


before = sample(['docker', 'stats', '--no-stream', '--format', 'cpu={{.CPUPerc}} mem={{.MemUsage}}'])
stats_during = []
stop = threading.Event()


def watch():
    while not stop.is_set():
        stats_during.append(sample(['docker', 'stats', '--no-stream', '--format', 'cpu={{.CPUPerc}} mem={{.MemUsage}}']))
        stop.wait(2)


watcher = threading.Thread(target=watch, daemon=True)
watcher.start()
began = time.monotonic()
threads = [threading.Thread(target=worker) for _ in range(parallel)]
for t in threads:
    t.start()
for t in threads:
    t.join()
elapsed = time.monotonic() - began
stop.set()
watcher.join(timeout=5)

codes = {}
for status, _, _ in results:
    codes[status] = codes.get(status, 0) + 1
ok = sorted(t for s, t, _ in results if s == 200)
report = {
    'routes': total, 'parallel': parallel, 'seconds': round(elapsed, 1), 'routes_per_minute': round(total / elapsed * 60, 1),
    'status_counts': codes,
    'latency_s': {'p50': round(statistics.median(ok), 2), 'p95': round(ok[int(len(ok) * 0.95) - 1], 2) if len(ok) >= 2 else None, 'max': round(max(ok), 2)} if ok else None,
    'container_before': before, 'container_during_last': stats_during[-1] if stats_during else None,
    'loadavg': sample(['cat', '/proc/loadavg']),
}
print(json.dumps(report, indent=2, ensure_ascii=False))
sys.exit(0 if codes.get(200, 0) == total else 1)
