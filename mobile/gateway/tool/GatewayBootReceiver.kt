package vn.eleven.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the gateway after a reboot or an in-place update of the app, but only if it was paired AND switched on. */
class GatewayBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!GatewayStore.isPaired(context) || !GatewayStore.isEnabled(context)) return
        try {
            GatewayService.start(context)
        } catch (e: Exception) {
            // The OS may refuse a background start; the user sees "stopped" in the app and starts it again.
            GatewayStore.recordConnection(context, false, "START_BLOCKED", null)
        }
    }
}
