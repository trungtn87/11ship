package vn.eleven.m14.routing

import org.junit.Assert.*
import org.junit.Test

class PolylineTest {
    @Test fun decodesPolylineUsingValhallaSixDecimalScale() {
        val result=decodePolyline6("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        assertEquals(3,result.size)
        assertEquals(3.85,result[0].first,1e-8)
        assertEquals(-12.02,result[0].second,1e-8)
        assertEquals(4.3252,result[2].first,1e-8)
        assertEquals(-12.6453,result[2].second,1e-8)
    }
    @Test(expected=IllegalArgumentException::class) fun truncatedRouteIsRejected() { decodePolyline6("_") }
}
