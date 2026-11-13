import http.client
import json
import math
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

import server
from server import ROUTE_VERSION_RE, data_version, env_flag, env_int, route_version, shortest_enabled, validated_request

TWO_POINTS = {'locations': [{'lat': 22.665, 'lon': 106.257}, {'lat': 22.67, 'lon': 106.26}]}
DATA = {'M14_DATA_VERSION': 'abc123def456'}
TRIP = {'trip': {'summary': {'length': 0.9, 'time': 89}, 'legs': [{'shape': 'oqjfj@_dntiEoe`@nkX'}]}}
NO_DATA = dict(DATA_VERSION_FILE=os.path.join(tempfile.gettempdir(), 'm14-no-such-data-version-file'))


class FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self._body = json.dumps(payload).encode() if payload is not None else b''

    def read(self, size=-1):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeEngine:
    """Stands in for the Valhalla engine behind server.urllib.request.urlopen. Records every call; never reaches a network."""

    def __init__(self, status=200, answer=TRIP, error=None):
        self.status, self.answer, self.error = status, answer, error
        self.calls = []

    def __call__(self, request, timeout=None):
        url = request if isinstance(request, str) else request.full_url
        data = None if isinstance(request, str) else request.data
        self.calls.append((url, data))
        if self.error is not None:
            raise self.error
        return FakeResponse(self.status, self.answer)


class ProfileVersionTest(unittest.TestCase):
    def motorcycle(self, env):
        with mock.patch.dict(os.environ, env, clear=True):
            return validated_request(dict(TWO_POINTS))['costing_options']['motorcycle']

    def test_shortest_is_on_by_default_and_sent_to_the_engine(self):
        self.assertTrue(self.motorcycle({})['shortest'])
        self.assertTrue(self.motorcycle({'M14_SHORTEST': '1'})['shortest'])

    def test_flag_off_restores_the_previous_profile(self):
        for off in ('0', 'false', 'OFF'):
            with self.subTest(off=off):
                self.assertEqual(self.motorcycle({'M14_SHORTEST': off}), {'use_highways': 0.3, 'use_tolls': 0.0, 'use_ferry': 0.0})

    def test_nonsense_flag_keeps_the_default_on(self):
        with mock.patch.dict(os.environ, {'M14_SHORTEST': 'maybe'}, clear=True):
            self.assertTrue(shortest_enabled())
        self.assertFalse(env_flag('X', False))

    def test_request_sent_to_the_engine_has_only_the_routing_fields(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            request = validated_request(dict(TWO_POINTS))
        self.assertEqual(set(request), {'locations', 'costing', 'costing_options', 'directions_options'})
        self.assertEqual(request['locations'][0], {'lat': 22.665, 'lon': 106.257, 'radius': 100, 'search_cutoff': 500})

    def test_route_version_names_engine_profile_and_data(self):
        with mock.patch.dict(os.environ, DATA, clear=True):
            version = route_version()
        self.assertRegex(version, r'^valhalla-3\.9\.1/motorcycle-shortest-[0-9a-f]{8}/abc123def456$')
        self.assertIsNotNone(ROUTE_VERSION_RE.fullmatch(version))

    def test_each_profile_component_changes_the_route_version(self):
        with mock.patch.dict(os.environ, DATA, clear=True):
            base = route_version()
            self.assertEqual(route_version(), base, 'the version is deterministic')
        with mock.patch.dict(os.environ, dict(DATA, M14_SHORTEST='0'), clear=True):
            self.assertNotEqual(route_version(), base, 'shortest flag')
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.USE_HIGHWAYS', 0.5):
            self.assertNotEqual(route_version(), base, 'profile parameter: use_highways')
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.SNAP_RADIUS', 150):
            self.assertNotEqual(route_version(), base, 'snapping parameter: radius')
        with mock.patch.dict(os.environ, {'M14_DATA_VERSION': 'other999'}, clear=True):
            self.assertNotEqual(route_version(), base, 'data version')

    def test_malformed_data_version_gives_no_route_version(self):
        for bad in ('x' * 65, 'has space', '-leading', 'tab\tinside', 'é'):
            with self.subTest(bad=bad), mock.patch.dict(os.environ, {'M14_DATA_VERSION': bad}, clear=True):
                self.assertIsNone(data_version())
                self.assertIsNone(route_version())

    def test_unknown_data_version_gives_no_route_version(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch('server.DATA_VERSION_FILE', NO_DATA['DATA_VERSION_FILE']):
            self.assertIsNone(route_version())

    def test_data_version_file_written_by_the_image_build_is_read(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'data.version')
            with open(path, 'w', encoding='ascii') as f:
                f.write('0123abcd\n')
            with mock.patch.dict(os.environ, {}, clear=True), mock.patch('server.DATA_VERSION_FILE', path):
                self.assertEqual(data_version(), '0123abcd')


class RoutingBoundsTest(unittest.TestCase):
    def test_motorcycle_policy_cannot_be_overridden(self):
        result = validated_request({'locations': [{'lat': 22.665, 'lon': 106.257}, {'lat': 22.67, 'lon': 106.26}], 'costing': 'auto', 'directions_options': {'units': 'miles'}})
        self.assertEqual(result['costing'], 'motorcycle')
        self.assertEqual(result['directions_options']['units'], 'kilometers')

    def test_bad_or_outside_points_fail_without_fallback(self):
        for point in ({'lat': math.nan, 'lon': 106.2}, {'lat': 21.0, 'lon': 106.2}, {'lat': True, 'lon': 106.2}, {'lat': '22.6', 'lon': 106.2}):
            with self.subTest(point=point), self.assertRaises(ValueError):
                validated_request({'locations': [point, {'lat': 22.665, 'lon': 106.257}]})

    def test_two_points_required(self):
        for points in (None, [], [{}], [{}, {}, {}]):
            with self.assertRaises(ValueError):
                validated_request({'locations': points})


class LimitsFromEnvironmentTest(unittest.TestCase):
    def test_valid_value_is_used_and_nonsense_keeps_the_default(self):
        with mock.patch.dict(os.environ, {"X": "600"}):
            self.assertEqual(env_int("X", 20, 1, 6000), 600)
        for bad in ("0", "-1", "abc", "", "9999999", "1.5"):
            with self.subTest(bad=bad), mock.patch.dict(os.environ, {"X": bad}):
                self.assertEqual(env_int("X", 20, 1, 6000), 20)
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(env_int("X", 2, 1, 8), 2)


class LiveHandlerTest(unittest.TestCase):
    """Runs the real Handler over HTTP. The engine is faked, so the tests show exactly when the engine is (not) asked."""

    def setUp(self):
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def call(self, method, path, body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            payload = None if body is None else json.dumps(body).encode()
            conn.request(method, path, body=payload, headers={'Content-Type': 'application/json'})
            response = conn.getresponse()
            return response.status, json.loads(response.read() or b'null')
        finally:
            conn.close()

    def test_health_is_ready_with_a_valid_version(self):
        engine = FakeEngine(status=200)
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.urllib.request.urlopen', engine):
            status, body = self.call('GET', '/health')
            expected = route_version()
        self.assertEqual(status, 200)
        self.assertEqual(body['ready'], True)
        self.assertEqual(body['routeVersion'], expected)

    def test_health_is_503_not_ready_when_the_version_is_missing(self):
        engine = FakeEngine(status=200)
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch('server.DATA_VERSION_FILE', NO_DATA['DATA_VERSION_FILE']), mock.patch('server.urllib.request.urlopen', engine):
            status, body = self.call('GET', '/health')
        self.assertEqual((status, body['ready']), (503, False))
        self.assertEqual(engine.calls, [], 'readiness does not depend on a version the gateway cannot give')

    def test_health_is_503_not_ready_when_the_version_is_malformed(self):
        with mock.patch.dict(os.environ, {'M14_DATA_VERSION': 'bad value'}, clear=True), mock.patch('server.urllib.request.urlopen', FakeEngine(status=200)):
            status, body = self.call('GET', '/health')
        self.assertEqual((status, body['ready']), (503, False))

    def test_health_is_503_when_the_engine_is_down_or_not_ready(self):
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.urllib.request.urlopen', FakeEngine(status=200, error=OSError('down'))):
            status, body = self.call('GET', '/health')
        self.assertEqual((status, body['ready']), (503, False))
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.urllib.request.urlopen', FakeEngine(status=503)):
            status, body = self.call('GET', '/health')
        self.assertEqual((status, body['ready']), (503, False))

    def test_route_is_refused_before_the_engine_when_the_version_is_missing(self):
        engine = FakeEngine()
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch('server.DATA_VERSION_FILE', NO_DATA['DATA_VERSION_FILE']), mock.patch('server.urllib.request.urlopen', engine):
            status, _ = self.call('POST', '/route', TWO_POINTS)
        self.assertEqual(status, 503)
        self.assertEqual(engine.calls, [], 'no route is computed when the answer could not carry a valid version')

    def test_route_adds_the_version_and_asks_the_engine_for_shortest(self):
        engine = FakeEngine()
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.urllib.request.urlopen', engine):
            status, body = self.call('POST', '/route', TWO_POINTS)
            expected = route_version()
        self.assertEqual(status, 200)
        self.assertEqual(body['route_version'], expected)
        self.assertEqual(body['trip'], TRIP['trip'], 'the shape comes through unchanged')
        self.assertEqual(len(engine.calls), 1)
        self.assertIn(b'"shortest": true', engine.calls[0][1])

    def test_route_with_the_flag_off_asks_for_the_previous_profile(self):
        engine = FakeEngine()
        with mock.patch.dict(os.environ, dict(DATA, M14_SHORTEST='0'), clear=True), mock.patch('server.urllib.request.urlopen', engine):
            status, body = self.call('POST', '/route', TWO_POINTS)
        self.assertEqual(status, 200)
        self.assertNotIn(b'shortest', engine.calls[0][1])
        self.assertIn('-default-', body['route_version'])

    def test_route_rejects_bad_points_without_asking_the_engine(self):
        engine = FakeEngine()
        with mock.patch.dict(os.environ, DATA, clear=True), mock.patch('server.urllib.request.urlopen', engine):
            status, _ = self.call('POST', '/route', {'locations': [{'lat': 21.0, 'lon': 106.2}, {'lat': 22.67, 'lon': 106.26}]})
        self.assertEqual(status, 400)
        self.assertEqual(engine.calls, [])


if __name__ == '__main__':
    unittest.main()
