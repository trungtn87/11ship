package vn.eleven.m14.map

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Pure geometry for the Shipper's 3 km receiving area (#294 item 6). No Android types, so a JVM test can compare it to the backend rule.
 *
 * The backend decides eligibility with `haversineMeters(shop, shipper) > SHIPPER_SEARCH_RADIUS_M` (apps/backend/src/shipping-policy/shipping-eligibility.ts):
 * a straight line on a sphere of 6 371 008.8 m, and a point at exactly the radius is still INSIDE. The ring drawn here uses the same sphere.
 */
object RadiusGeometry {
    const val EARTH_RADIUS_M = 6_371_008.8

    /** 1 degree of bearing per vertex: a chord lies at most ~0.11 m inside a 3 km circle, far below GPS precision. */
    const val RING_STEPS = 360

    fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val rad = PI / 180.0
        val dLat = (lat2 - lat1) * rad
        val dLon = (lon2 - lon1) * rad
        val h = sin(dLat / 2).let { it * it } + cos(lat1 * rad) * cos(lat2 * rad) * sin(dLon / 2).let { it * it }
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
    }

    /** The backend rule: inside while the distance is not greater than the radius. */
    fun isInside(centerLat: Double, centerLon: Double, lat: Double, lon: Double, radiusM: Double): Boolean =
        haversineMeters(centerLat, centerLon, lat, lon) <= radiusM

    /** The point [distanceM] away from the centre along [bearingRad] (0 = north, clockwise). Returns [lat, lon] in degrees. */
    fun destination(lat: Double, lon: Double, distanceM: Double, bearingRad: Double): DoubleArray {
        val angular = distanceM / EARTH_RADIUS_M
        val lat1 = Math.toRadians(lat)
        val lon1 = Math.toRadians(lon)
        val lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearingRad))
        val lon2 = lon1 + atan2(sin(bearingRad) * sin(angular) * cos(lat1), cos(angular) - sin(lat1) * sin(lat2))
        return doubleArrayOf(Math.toDegrees(lat2), Math.toDegrees(lon2))
    }

    /** A closed ring (first point repeated last) of [lat, lon] pairs, starting north and going clockwise. */
    fun ring(lat: Double, lon: Double, radiusM: Double, steps: Int = RING_STEPS): List<DoubleArray> =
        (0..steps).map { destination(lat, lon, radiusM, 2.0 * PI * (it % steps) / steps) }

    /** The area that must stay greyed: the whole map frame. The circle is cut out of it as a hole. Returned as [lat, lon] pairs. */
    val worldRing: List<DoubleArray> = listOf(
        doubleArrayOf(-85.0, -180.0), doubleArrayOf(85.0, -180.0), doubleArrayOf(85.0, 180.0), doubleArrayOf(-85.0, 180.0), doubleArrayOf(-85.0, -180.0),
    )

    /** The smallest lat/lon box that holds the whole circle: [south, west, north, east] (exact extremes of a spherical circle). */
    fun bounds(lat: Double, lon: Double, radiusM: Double): DoubleArray {
        val angular = radiusM / EARTH_RADIUS_M
        val latDelta = Math.toDegrees(angular)
        val c = cos(Math.toRadians(lat)).coerceAtLeast(1e-6)
        val lonDelta = Math.toDegrees(asin(min(1.0, sin(angular) / c)))
        return doubleArrayOf(lat - latDelta, lon - lonDelta, lat + latDelta, lon + lonDelta)
    }

    /** A centre the area can honestly be drawn around: finite, in range and not the (0, 0) "no fix" placeholder. */
    fun isUsableCentre(lat: Double?, lon: Double?): Boolean =
        lat != null && lon != null && lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0 && !(lat == 0.0 && lon == 0.0)
}
