package vn.eleven.m14.gps

import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.SystemClock

/** One bounded foreground fix. GPS and network race; a coarse fix gets a short chance to improve.
 * No last-known/default position, background start, or Google Play Services dependency.
 * Each request owns its listener/timers: late callbacks cannot complete a subsequent request.
 */
class FreshLocationRequest(
    private val manager: LocationManager,
    private val handler: Handler,
    private val finePermission: Boolean,
    private val nowNanos: () -> Long = { SystemClock.elapsedRealtimeNanos() },
) {
    private var active = false
    private var best: Location? = null
    private val providers = mutableSetOf<String>()
    private var listener: LocationListener? = null
    private var deadline: Runnable? = null
    private var settle: Runnable? = null
    private var success: ((Location) -> Unit)? = null
    private var failure: ((String) -> Unit)? = null

    @Suppress("DEPRECATION")
    private fun usable(location: Location): Boolean {
        val age = nowNanos() - location.elapsedRealtimeNanos
        return !location.isFromMockProvider && age in 0..25_000_000_000L &&
            location.latitude.isFinite() && location.latitude in -90.0..90.0 &&
            location.longitude.isFinite() && location.longitude in -180.0..180.0 &&
            location.hasAccuracy() && location.accuracy.isFinite() && location.accuracy > 0
    }

    fun start(timeoutMillis: Long = 45_000L, onFix: (Location) -> Unit, onFailure: (String) -> Unit) {
        check(!active) { "Location request is already running" }
        active = true
        success = onFix
        failure = onFailure
        val current = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (!active || listener !== this || !usable(location)) return
                if (best == null || location.accuracy < best!!.accuracy) best = location
                if (location.accuracy <= 100f) {
                    complete()
                } else if (settle == null) {
                    // Do not leave someone indoors waiting for a satellite fix after the network answered.
                    settle = Runnable { if (active) complete() }.also { handler.postDelayed(it, 5_000L) }
                }
            }
            override fun onProviderDisabled(provider: String) {
                if (!active || listener !== this) return
                providers.remove(provider)
                if (providers.isEmpty()) complete("DISABLED")
            }
            override fun onProviderEnabled(provider: String) = Unit
            @Deprecated("Android callback")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        listener = current
        try {
            if (finePermission && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) providers.add(LocationManager.GPS_PROVIDER)
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) providers.add(LocationManager.NETWORK_PROVIDER)
            if (providers.isEmpty()) { complete("DISABLED"); return }
            for (provider in providers.toList()) {
                try {
                    manager.requestLocationUpdates(provider, 0L, 0f, current, handler.looper)
                } catch (error: IllegalArgumentException) {
                    providers.remove(provider)
                }
            }
            if (providers.isEmpty()) { complete("UNAVAILABLE"); return }
            deadline = Runnable { if (active) complete("TIMEOUT") }.also { handler.postDelayed(it, timeoutMillis) }
        } catch (error: SecurityException) {
            complete("DENIED")
        } catch (error: Exception) {
            complete("UNAVAILABLE")
        }
    }

    private fun complete(error: String = "TIMEOUT") {
        if (!active) return
        val fix = if(error == "DENIED" || error == "UNAVAILABLE") null else best?.takeIf { usable(it) }
        val onFix = success
        val onFailure = failure
        cancel()
        if (fix != null) onFix?.invoke(fix) else onFailure?.invoke(error)
    }

    fun cancel() {
        active = false // Clear before removing updates, even if a callback is already queued.
        deadline?.let { handler.removeCallbacks(it) }; deadline = null
        settle?.let { handler.removeCallbacks(it) }; settle = null
        listener?.let { try { manager.removeUpdates(it) } catch (_: SecurityException) {} }
        listener = null
        providers.clear()
        best = null
        success = null
        failure = null
    }
}
