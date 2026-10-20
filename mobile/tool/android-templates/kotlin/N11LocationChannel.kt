package vn.eleven.n11

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Handler
import vn.eleven.m14.gps.FreshLocationRequest
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * ONE foreground fix for a user-requested address/shop location (lib/src/flows/location.dart).
 * - Foreground location permission only (FINE + COARSE so the system dialog offers precise/approximate); never background.
 * - One shot: nothing keeps listening after the answer, the timeout or the cancel.
 * - A position from a mock provider is refused (UNAVAILABLE). GPS and network are requested together; old/mock positions are never returned.
 * Errors: DENIED, DISABLED, TIMEOUT, UNAVAILABLE. Results carry latitude, longitude, accuracyMeters, takenAtMillis only.
 */
class N11LocationChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    private val main = Handler(Looper.getMainLooper())
    private var pending: MethodChannel.Result? = null
    private var request: FreshLocationRequest? = null

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
        fail("UNAVAILABLE")
    }

    private fun hasPermission(): Boolean =
        activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasFine(): Boolean = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun takeFix() {
        val manager = activity.getSystemService(Activity.LOCATION_SERVICE) as? LocationManager
        if (manager == null) { fail("UNAVAILABLE"); return }
        val current = FreshLocationRequest(manager, main, hasFine())
        request = current
        current.start(onFix = { location ->
                if (request === current) {
                    val result = pending
                    pending = null
                    request = null
                    result?.success(mapOf(
                        "latitude" to location.latitude,
                        "longitude" to location.longitude,
                        "accuracyMeters" to location.accuracy.toDouble(),
                        "takenAtMillis" to location.time,
                    ))
                }
            }, onFailure = { code -> if (request === current) fail(code) })
    }

    private fun fail(code: String) {
        val result = pending
        pending = null
        request?.cancel()
        request = null
        result?.error(code, null, null)
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/location"
        private const val REQUEST_CODE = 4711
    }
}
