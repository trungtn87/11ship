package vn.eleven.m14.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** #294 item 6: the ring on the Shipper's home map against the backend rule `haversineMeters(shop, shipper) > SHIPPER_SEARCH_RADIUS_M`. */
class RadiusGeometryTest {
    private val cLat = 22.665
    private val cLon = 106.257

    private class Row(val dir: String, val asked: Double, val lat: Double, val lon: Double, val backendM: Double, val backendInside: Boolean)

    /**
     * Points 2999 / 3000 / 3001 m from (22.665, 106.257) in the four directions, with the distance and verdict produced by the REAL backend function
     * (apps/backend shipping-eligibility haversineMeters + SHIPPER_SEARCH_RADIUS_M, run on exactly these coordinates).
     * Verdict true = inside (distance <= 3000).
     */
    private val backend = listOf(
        Row("N", 2999.0, 22.691970617708, 106.257000000000, 2999.000000, true),
        Row("N", 3000.0, 22.691979610912, 106.257000000000, 3000.000000, false),
        Row("N", 3001.0, 22.691988604115, 106.257000000000, 3001.000000, false),
        Row("E", 2999.0, 22.664997349177, 106.286227771346, 2999.000000, true),
        Row("E", 3000.0, 22.664997347409, 106.286237517185, 3000.000000, true),
        Row("E", 3001.0, 22.664997345640, 106.286247263024, 3001.000000, false),
        Row("S", 2999.0, 22.638029382292, 106.257000000000, 2999.000000, true),
        Row("S", 3000.0, 22.638020389088, 106.257000000000, 3000.000000, false),
        Row("S", 3001.0, 22.638011395885, 106.257000000000, 3001.000000, false),
        Row("W", 2999.0, 22.664997349177, 106.227772228654, 2999.000000, true),
        Row("W", 3000.0, 22.664997347409, 106.227762482815, 3000.000000, false),
        Row("W", 3001.0, 22.664997345640, 106.227752736976, 3001.000000, false),
    )

    @Test fun distanceMatchesBackendHaversineInAllFourDirections() {
        for (r in backend) {
            val ours = RadiusGeometry.haversineMeters(cLat, cLon, r.lat, r.lon)
            assertEquals("${r.dir} ${r.asked}", r.backendM, ours, 1e-5)
        }
    }

    @Test fun insideRuleMatchesBackendAt2999And3001() {
        for (r in backend.filter { it.asked != 3000.0 }) {
            assertEquals("${r.dir} ${r.asked}", r.backendInside, RadiusGeometry.isInside(cLat, cLon, r.lat, r.lon, 3000.0))
        }
    }

    /** At exactly 3000.000 m the verdict is decided by the last bit of a double on both sides, so only the distance is asserted; the server decides. */
    @Test fun atExactlyThreeThousandBothSidesMeasureTheSameDistance() {
        for (r in backend.filter { it.asked == 3000.0 }) {
            assertEquals(3000.0, RadiusGeometry.haversineMeters(cLat, cLon, r.lat, r.lon), 1e-5)
        }
    }

    @Test fun ringVerticesLieOnTheBackendCircleInAllFourDirections() {
        val ring = RadiusGeometry.ring(cLat, cLon, 3000.0)
        assertEquals(RadiusGeometry.RING_STEPS + 1, ring.size)
        // North, east, south, west are every quarter of the ring.
        for ((name, index) in listOf("N" to 0, "E" to 90, "S" to 180, "W" to 270)) {
            val p = ring[index]
            assertEquals(name, 3000.0, RadiusGeometry.haversineMeters(cLat, cLon, p[0], p[1]), 1e-6)
        }
        // North/south keep the longitude. A great circle leaving due east/west bends toward the equator (~0.3 m at 3 km, 2.65e-6 deg, as in the backend rows above).
        assertEquals(cLon, ring[0][1], 1e-9)
        assertEquals(cLon, ring[180][1], 1e-9)
        assertEquals(22.664997347409, ring[90][0], 2e-9)
        assertEquals(22.664997347409, ring[270][0], 2e-9)
        assertTrue(ring[0][0] > cLat && ring[180][0] < cLat && ring[90][1] > cLon && ring[270][1] < cLon)
    }

    @Test fun everyRingVertexIsThreeKilometresAndTheRingIsClosed() {
        val ring = RadiusGeometry.ring(cLat, cLon, 3000.0)
        for (p in ring) assertEquals(3000.0, RadiusGeometry.haversineMeters(cLat, cLon, p[0], p[1]), 1e-6)
        assertEquals(ring.first()[0], ring.last()[0], 0.0)
        assertEquals(ring.first()[1], ring.last()[1], 0.0)
    }

    /** A chord between two vertices lies inside the true circle; the gap must stay far below GPS precision so a point at 2999 m never looks outside. */
    @Test fun chordSagittaStaysBelowTwentyCentimetres() {
        val ring = RadiusGeometry.ring(cLat, cLon, 3000.0)
        var worst = 0.0
        for (i in 0 until ring.size - 1) {
            val midLat = (ring[i][0] + ring[i + 1][0]) / 2
            val midLon = (ring[i][1] + ring[i + 1][1]) / 2
            worst = maxOf(worst, 3000.0 - RadiusGeometry.haversineMeters(cLat, cLon, midLat, midLon))
        }
        assertTrue("sagitta $worst", worst in 0.0..0.2)
    }

    @Test fun boundsHoldTheWholeRingWithItsExactExtremes() {
        val b = RadiusGeometry.bounds(cLat, cLon, 3000.0)
        val ring = RadiusGeometry.ring(cLat, cLon, 3000.0)
        for (p in ring) {
            assertTrue(p[0] >= b[0] - 1e-9 && p[0] <= b[2] + 1e-9)
            assertTrue(p[1] >= b[1] - 1e-9 && p[1] <= b[3] + 1e-9)
        }
        assertEquals("south is 3 km from the centre", 3000.0, RadiusGeometry.haversineMeters(cLat, cLon, b[0], cLon), 1e-6)
        assertEquals("north is 3 km from the centre", 3000.0, RadiusGeometry.haversineMeters(cLat, cLon, b[2], cLon), 1e-6)
        // The east/west extreme of a circle lies off the centre latitude; the box is still the tightest one.
        assertEquals(ring.maxOf { it[1] }, b[3], 2e-5)
        assertEquals(ring.minOf { it[1] }, b[1], 2e-5)
    }

    @Test fun fitBoxIsTheThreeKilometreCircleNotTheOldFiveKilometreBox() {
        val three = RadiusGeometry.bounds(cLat, cLon, 3000.0)
        val five = RadiusGeometry.bounds(cLat, cLon, 5000.0)
        assertTrue(abs(three[2] - three[0]) < abs(five[2] - five[0]) * 0.61)
        assertEquals(3.0 / 111.32, (three[2] - three[0]) / 2, 3.0 / 111.32 * 0.01)
    }

    @Test fun usableCentreRejectsNullIslandNanAndOutOfRange() {
        assertTrue(RadiusGeometry.isUsableCentre(22.665, 106.257))
        assertFalse(RadiusGeometry.isUsableCentre(0.0, 0.0))
        assertFalse(RadiusGeometry.isUsableCentre(null, 106.0))
        assertFalse(RadiusGeometry.isUsableCentre(22.0, null))
        assertFalse(RadiusGeometry.isUsableCentre(Double.NaN, 106.0))
        assertFalse(RadiusGeometry.isUsableCentre(22.0, Double.POSITIVE_INFINITY))
        assertFalse(RadiusGeometry.isUsableCentre(90.1, 0.0))
        assertFalse(RadiusGeometry.isUsableCentre(0.0, -180.1))
        assertTrue("only the exact (0,0) pair is the placeholder", RadiusGeometry.isUsableCentre(0.0, 106.0))
    }

    @Test fun worldRingIsAClosedFrameThatEnclosesTheRing() {
        val w = RadiusGeometry.worldRing
        assertEquals(w.first()[0], w.last()[0], 0.0)
        assertEquals(w.first()[1], w.last()[1], 0.0)
        for (p in RadiusGeometry.ring(cLat, cLon, 3000.0)) assertTrue(p[0] in -85.0..85.0 && p[1] in -180.0..180.0)
    }
}
