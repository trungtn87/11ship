package vn.eleven.n11

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * M08 push for Android (lib/src/m08/m08_push.dart), the build that carries the push provider (FCM). Chosen by tool/prepare-android.sh only when the build was
 * given the Firebase client identifiers (N11PushConfig); otherwise N11PushChannelStub replaces this file and the app says "not supported".
 *
 * - The registration token goes to Dart, which binds it to the SIGNED-IN session on the server. This class never talks to the server.
 * - deleteToken() is called by Dart on sign-out, so the next account on this phone gets a new token.
 * - A push that arrives while the app is in the background is shown by the system from the message's notification part, on the channel the server chose
 *   (sound / vibration are the account's setting); its content is generic by contract (no OTP, phone, address or bank data). Tapping it starts the app with
 *   the notification id, which Dart opens from the SERVER (right and state are re-checked there).
 * - Nothing is claimed about delivery: a displayed push is not "read" and "sent" is not "shown".
 */
class N11PushChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    private val main = Handler(Looper.getMainLooper())
    private var channel: MethodChannel? = null
    private var pendingPermission: MethodChannel.Result? = null

    fun register(messenger: BinaryMessenger) {
        ensureFirebase(activity.applicationContext)
        createChannels(activity.applicationContext)
        channel = MethodChannel(messenger, CHANNEL).also { it.setMethodCallHandler(this) }
        sink = { name, argument -> main.post { channel?.invokeMethod(name, argument) } }
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "state" -> state(result)
            "requestPermission" -> requestPermission(result)
            "openSettings" -> {
                openSettings()
                result.success(null)
            }
            "deleteToken" -> deleteToken(result)
            else -> result.notImplemented()
        }
    }

    private fun state(result: MethodChannel.Result) {
        if (!ensureFirebase(activity.applicationContext)) {
            result.success(mapOf("supported" to false, "permission" to "unknown"))
            return
        }
        val launch = takeLaunchId()
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            val token = if (task.isSuccessful) task.result else null
            result.success(mapOf("supported" to true, "permission" to permission(), "token" to token, "launch_notification_id" to launch))
        }
    }

    /** granted: the system lets this app show notifications; denied: it asked before and they are off; unknown: never asked. */
    private fun permission(): String {
        val ctx = activity.applicationContext
        if (NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return "granted"
        return if (ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ASKED, false)) "denied" else "unknown"
    }

    private fun requestPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            result.success(permission())
            return
        }
        if (pendingPermission != null) {
            result.success(permission())
            return
        }
        pendingPermission = result
        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE)
    }

    /** Forwarded by MainActivity.onRequestPermissionsResult. */
    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != REQUEST_CODE) return
        activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ASKED, true).apply()
        pendingPermission?.success(permission())
        pendingPermission = null
    }

    private fun openSettings() {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
        } catch (_: Exception) {
            activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun deleteToken(result: MethodChannel.Result) {
        if (!ensureFirebase(activity.applicationContext)) {
            result.success(null)
            return
        }
        FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { result.success(null) }
    }

    fun dispose() {
        sink = null
        channel?.setMethodCallHandler(null)
        channel = null
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/push"
        private const val PREFS = "n11_push"
        private const val ASKED = "permission_asked"
        private const val REQUEST_CODE = 4712

        /** Set while the Flutter engine is alive; null otherwise (a token or tap then waits for the next `state` call). */
        @Volatile
        var sink: ((String, Any?) -> Unit)? = null

        @Volatile
        private var launchId: String? = null

        /** The notification id carried by the intent that started or resumed the activity (a tap on a system notification). */
        fun handleIntent(intent: Intent?) {
            val id = intent?.getStringExtra("notification_id") ?: return
            if (!id.matches(Regex("^[0-9a-fA-F-]{36}$"))) return
            intent.removeExtra("notification_id")
            val deliver = sink
            if (deliver != null) deliver("tap", id) else launchId = id
        }

        private fun takeLaunchId(): String? = launchId.also { launchId = null }

        /** The provider is initialised from the build's client identifiers (not a secret: they ship in every APK of the app, as Firebase documents). */
        @Synchronized
        fun ensureFirebase(context: Context): Boolean {
            if (FirebaseApp.getApps(context).isNotEmpty()) return true
            return try {
                val options = FirebaseOptions.Builder()
                    .setApplicationId(N11PushConfig.APP_ID)
                    .setApiKey(N11PushConfig.API_KEY)
                    .setProjectId(N11PushConfig.PROJECT_ID)
                    .setGcmSenderId(N11PushConfig.SENDER_ID)
                    .build()
                FirebaseApp.initializeApp(context, options)
                true
            } catch (_: Exception) {
                false
            }
        }

        /** One channel per sound / vibration choice of the account (the server names the channel in the message). Silent still shows the notification. */
        fun createChannels(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            fun make(id: String, name: String, sound: Boolean, vibrate: Boolean) {
                val importance = if (sound) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_LOW
                val channel = NotificationChannel(id, name, importance)
                channel.enableVibration(vibrate)
                if (!sound) channel.setSound(null, null)
                manager.createNotificationChannel(channel)
            }
            make("n11_sv", "Thông báo (âm thanh và rung)", sound = true, vibrate = true)
            make("n11_sn", "Thông báo (chỉ âm thanh)", sound = true, vibrate = false)
            make("n11_qv", "Thông báo (chỉ rung)", sound = false, vibrate = true)
            make("n11_qn", "Thông báo (im lặng)", sound = false, vibrate = false)
        }
    }
}
