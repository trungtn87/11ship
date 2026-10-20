package vn.eleven.n11

import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import org.junit.Assert.*
import org.junit.Test
import org.mockito.Mockito.*
import vn.eleven.m14.gps.FreshLocationRequest

/** Regression: the phone's GPS is silent while network positioning is available. */
class FreshLocationRequestTest {
    private val manager = mock(LocationManager::class.java)
    private val handler = mock(Handler::class.java)
    private val looper = mock(Looper::class.java)
    private var now = 100_000_000_000L
    private val listeners = mutableMapOf<String, LocationListener>()
    private val timers = mutableListOf<Pair<Runnable, Long>>()
    private var fix: Location? = null
    private var error: String? = null
    private var answers = 0

    init {
        `when`(handler.looper).thenReturn(looper)
        `when`(manager.isProviderEnabled(anyString())).thenReturn(true)
        doAnswer { call ->
            listeners[call.getArgument(0)] = call.getArgument(3)
            null
        }.`when`(manager).requestLocationUpdates(anyString(), anyLong(), anyFloat(), any(LocationListener::class.java), any(Looper::class.java))
        doAnswer { call -> timers.add(call.getArgument<Runnable>(0) to call.getArgument<Long>(1)); true }
            .`when`(handler).postDelayed(any(Runnable::class.java), anyLong())
    }

    private fun start(fine: Boolean = true): FreshLocationRequest {
        val request = FreshLocationRequest(manager, handler, fine) { now }
        request.start(onFix = { fix = it; answers++ }, onFailure = { error = it; answers++ })
        now += 1_000_000_000L
        return request
    }

    @Suppress("DEPRECATION")
    private fun point(accuracy: Float = 20f, ageSeconds: Long = 0, mockFix: Boolean = false): Location {
        val location = mock(Location::class.java)
        `when`(location.latitude).thenReturn(22.67)
        `when`(location.longitude).thenReturn(106.26)
        `when`(location.hasAccuracy()).thenReturn(true)
        `when`(location.accuracy).thenReturn(accuracy)
        `when`(location.elapsedRealtimeNanos).thenReturn(now - ageSeconds * 1_000_000_000L)
        `when`(location.isFromMockProvider).thenReturn(mockFix)
        return location
    }

    @Test fun networkAnswersEvenWhenGpsNeverDoes() {
        start()
        assertEquals(setOf("gps", "network"), listeners.keys)
        val network = point()
        listeners.getValue("network").onLocationChanged(network)
        assertSame(network, fix)
        assertNull(error)
        verify(manager).removeUpdates(any(LocationListener::class.java))
        verify(handler, atLeastOnce()).removeCallbacks(any(Runnable::class.java))
        timers.forEach { it.first.run() }
        assertEquals(1, answers)
    }

    @Test fun approximatePermissionUsesNetworkAndNeverRequestsGps() {
        start(fine = false)
        assertEquals(setOf("network"), listeners.keys)
        val network = point(500f)
        listeners.getValue("network").onLocationChanged(network)
        assertNull(fix)
        timers.single { it.second == 5_000L }.first.run()
        assertSame(network, fix)
    }

    @Test fun gpsCanImproveTheNetworkFixBeforeTheGracePeriodEnds() {
        start()
        listeners.getValue("network").onLocationChanged(point(800f))
        val gps = point(15f)
        listeners.getValue("gps").onLocationChanged(gps)
        timers.forEach { it.first.run() }
        assertSame(gps, fix)
        assertEquals(1, answers)
    }

    @Test fun rejectsOldMockInvalidAndFuturePositionsThenTimesOut() {
        start()
        val gps = listeners.getValue("gps")
        gps.onLocationChanged(point(ageSeconds = 26))
        gps.onLocationChanged(point(ageSeconds = 1)) // exactly at request start
        gps.onLocationChanged(point(2000f)) // unusable accuracy
        gps.onLocationChanged(point(mockFix = true))
        gps.onLocationChanged(point(ageSeconds = -1))
        gps.onLocationChanged(point(Float.NaN))
        gps.onLocationChanged(point().also { `when`(it.latitude).thenReturn(91.0) })
        timers.single { it.second == 45_000L }.first.run()
        assertNull(fix)
        assertEquals("TIMEOUT", error)
    }

    @Test fun disabledAndRevokedAreReportedWithoutHanging() {
        `when`(manager.isProviderEnabled(anyString())).thenReturn(false)
        start()
        assertEquals("DISABLED", error)
        reset(manager)
        `when`(manager.isProviderEnabled(anyString())).thenThrow(SecurityException())
        error = null
        start()
        assertEquals("DENIED", error)
    }

    @Test fun disablingGpsDoesNotDiscardAWorkingNetworkProvider() {
        start()
        listeners.getValue("gps").onProviderDisabled("gps")
        assertNull(error)
        val network = point()
        listeners.getValue("network").onLocationChanged(network)
        assertSame(network, fix)
    }

    @Test fun cancelAndLateCallbacksCannotCompleteTheNextRequest() {
        val first = start()
        val oldListener = listeners.getValue("gps")
        val oldDeadline = timers.first().first
        first.cancel()
        start()
        oldListener.onLocationChanged(point())
        oldDeadline.run()
        assertEquals(0, answers)
        listeners.getValue("network").onLocationChanged(point())
        assertEquals(1, answers)
    }
}
