package vn.eleven.n11

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Food only (lib/src/flows/location.dart): ONE foreground position fix when the person presses the button at the shop.
 * - Foreground location permission only (FINE + COARSE so the system dialog offers precise/approximate); never background.
 * - One shot: nothing keeps listening after the answer, the timeout or the cancel.
 * - A position from a mock provider is refused (UNAVAILABLE). No default, cached or typed position is ever returned.
 * Errors: DENIED, DISABLED, TIMEOUT, UNAVAILABLE. Results carry latitude, longitude, accuracyMeters, takenAtMillis only.
 */
class N11LocationChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    private val main = Handler(Looper.getMainLooper())
    private var pending: MethodChannel.Result? = null
    private var cancel: CancellationSignal? = null
    private var legacyListener: LocationListener? = null
    private var timeout: Runnable? = null

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method != "currentFix") {
            result.notImplemented()
            return
        }
        if (pending != null) {
            result.error("UNAVAILABLE", null, null)
            return
        }
        pending = result
        if (hasPermission()) {
            takeFix()
        } else {
            activity.requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQUEST_CODE)
        }
    }

    /** Forwarded by MainActivity.onRequestPermissionsResult. */
    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != REQUEST_CODE || pending == null) {
            return
        }
        if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
            takeFix()
        } else {
            fail("DENIED")
        }
    }

    fun dispose() {
        stopListening()
        pending = null
    }

    private fun hasPermission(): Boolean =
        activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasFine(): Boolean = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @Suppress("DEPRECATION")
    private fun takeFix() {
        val manager = activity.getSystemService(Activity.LOCATION_SERVICE) as? LocationManager
        if (manager == null) {
            fail("UNAVAILABLE")
            return
        }
        val provider = when {
            hasFine() && manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> {
                fail("DISABLED")
                return
            }
        }
        val deadline = Runnable { fail("TIMEOUT") }
        timeout = deadline
        main.postDelayed(deadline, TIMEOUT_MILLIS)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val signal = CancellationSignal()
                cancel = signal
                manager.getCurrentLocation(provider, signal, activity.mainExecutor) { location ->
                    if (location == null) fail("UNAVAILABLE") else deliver(location)
                }
            } else {
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) = deliver(location)
                    override fun onProviderEnabled(provider: String) = Unit
                    override fun onProviderDisabled(provider: String) = fail("DISABLED")
                    @Deprecated("Deprecated in Java")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
                }
                legacyListener = listener
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }
        } catch (e: SecurityException) {
            fail("DENIED")
        } catch (e: Exception) {
            fail("UNAVAILABLE")
        }
    }

    @Suppress("DEPRECATION")
    private fun isMock(location: Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock else location.isFromMockProvider

    private fun deliver(location: Location) {
        val result = pending ?: return
        if (isMock(location)) {
            fail("UNAVAILABLE")
            return
        }
        stopListening()
        pending = null
        result.success(
            mapOf(
                "latitude" to location.latitude,
                "longitude" to location.longitude,
                "accuracyMeters" to if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                "takenAtMillis" to System.currentTimeMillis(),
            ),
        )
    }

    private fun fail(code: String) {
        val result = pending
        stopListening()
        pending = null
        result?.error(code, null, null)
    }

    private fun stopListening() {
        timeout?.let { main.removeCallbacks(it) }
        timeout = null
        cancel?.cancel()
        cancel = null
        legacyListener?.let {
            (activity.getSystemService(Activity.LOCATION_SERVICE) as? LocationManager)?.removeUpdates(it)
        }
        legacyListener = null
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/location"
        private const val REQUEST_CODE = 4711
        private const val TIMEOUT_MILLIS = 25_000L
    }
}
