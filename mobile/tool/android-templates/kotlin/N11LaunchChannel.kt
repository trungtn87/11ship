package vn.eleven.n11

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * 11Food only (issue #190): the shop page's quick contact. `dial` opens the PHONE APP with the number filled in (ACTION_DIAL needs no permission and
 * never places the call); `open` opens one https link in the app that owns it (Zalo, Messenger) or the browser. Both answer `false`, never throw, when
 * nothing can handle the intent, so Dart falls back to copying. The values are checked here again: a number must be +84 and nine digits, a link must be
 * https on a fixed host list without credentials or a port; anything else is refused before an intent is built.
 */
class N11LaunchChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "dial" -> {
                val phone = call.argument<String>("phone") ?: ""
                result.success(isPhone(phone) && start(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone, null))))
            }
            "open" -> {
                val url = call.argument<String>("url") ?: ""
                result.success(isSafeLink(url) && start(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)))
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
        const val CHANNEL = "vn.eleven.n11/launch"
        private val PHONE = Regex("^\\+84[0-9]{9}$")
        private val HOSTS = setOf("zalo.me", "m.me", "www.facebook.com")

        fun isPhone(value: String): Boolean = PHONE.matches(value)

        fun isSafeLink(value: String): Boolean {
            if (value.isEmpty() || value.length > 200) return false
            val uri = try { Uri.parse(value) } catch (e: Exception) { return false }
            return uri.scheme == "https" && uri.userInfo == null && uri.port == -1 && uri.host in HOSTS && uri.fragment == null
        }
    }
}
