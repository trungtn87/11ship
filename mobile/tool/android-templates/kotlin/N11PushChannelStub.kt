package vn.eleven.n11

import android.app.Activity
import android.content.Context
import android.content.Intent
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * The build WITHOUT a push provider (no Firebase client identifiers were given to tool/prepare-android.sh). It answers `supported: false`, so the app says
 * honestly that push is not available on this build; the inbox and the live sync work. Nothing is faked.
 */
class N11PushChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "state" -> result.success(mapOf("supported" to false, "permission" to "unknown"))
            "requestPermission", "openSettings", "deleteToken" -> result.success(null)
            else -> result.notImplemented()
        }
    }

    @Suppress("UNUSED_PARAMETER")
    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
    }

    fun dispose() {
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/push"

        @Suppress("UNUSED_PARAMETER")
        fun handleIntent(intent: Intent?) {
        }

        @Suppress("UNUSED_PARAMETER")
        fun ensureFirebase(context: Context): Boolean = false

        @Suppress("UNUSED_PARAMETER")
        fun createChannels(context: Context) {
        }
    }
}
