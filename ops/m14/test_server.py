import math
import unittest
from server import validated_request


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
