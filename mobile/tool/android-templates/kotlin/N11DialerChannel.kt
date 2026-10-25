package vn.eleven.n11

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Issue #191, both apps: "Gọi" on an order opens the PHONE APP with the number filled in. ACTION_DIAL needs no permission (no CALL_PHONE) and never places the
 * call. The number is checked here again (+84 and nine digits); anything else is refused before an intent is built. Answers `false`, never throws, when nothing
 * can handle the intent, so Dart falls back to copying the number.
 */
class N11DialerChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "dial" -> {
                val phone = call.argument<String>("phone") ?: ""
                result.success(isPhone(phone) && start(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone, null))))
            }
            else -> result.notImplemented()
        }
    }

    private fun start(intent: Intent): Boolean =
        try {
            activity.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        } catch (e: SecurityException) {
            false
        }

    companion object {
        const val CHANNEL = "vn.eleven.n11/dialer"
        private val PHONE = Regex("^\\+84[0-9]{9}$")

        fun isPhone(value: String): Boolean = PHONE.matches(value)
    }
}
