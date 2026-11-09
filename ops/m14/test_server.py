import math
import unittest
import os
from unittest import mock
from server import env_flag, env_int, route_version, shortest_enabled, validated_request

TWO_POINTS = {'locations': [{'lat': 22.665, 'lon': 106.257}, {'lat': 22.67, 'lon': 106.26}]}


class ShortestProfileFlagTest(unittest.TestCase):
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

    def test_route_version_comes_from_configuration_and_names_the_profile(self):
        with mock.patch.dict(os.environ, {'M14_DATA_VERSION': 'abc123'}, clear=True):
            self.assertEqual(route_version(), 'valhalla-3.9.1/motorcycle-shortest/abc123')
        with mock.patch.dict(os.environ, {'M14_DATA_VERSION': 'abc123', 'M14_SHORTEST': '0'}, clear=True):
            self.assertEqual(route_version(), 'valhalla-3.9.1/motorcycle-default/abc123')

    def test_unknown_data_version_gives_no_route_version(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch('server.DATA_VERSION_FILE', os.path.join(os.devnull, 'none')):
            self.assertIsNone(route_version())


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
