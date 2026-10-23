package vn.eleven.gateway

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.telephony.TelephonyManager

/** What the phone itself can tell without any extra permission. A value the device does not give is null / UNKNOWN: it is never guessed. The SIM balance is never read or reported. */
class Telemetry(
    val batteryPercent: Int?,
    val charging: Boolean?,
    val simState: String,
    val unreportedResults: Int,
    val currentTask: String,
    val lastErrorCode: String?,
)

object DeviceTelemetry {
    fun read(ctx: Context, unreportedResults: Int, currentTask: String, lastErrorCode: String?): Telemetry {
        var percent: Int? = null
        var charging: Boolean? = null
        try {
            val intent: Intent? = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (intent != null) {
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                if (level >= 0 && scale > 0) percent = (level * 100 / scale).coerceIn(0, 100)
                val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                if (status != -1) {
                    charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
                }
            }
        } catch (e: Exception) {
            // Stays unknown.
        }
        return Telemetry(percent, charging, simState(ctx), unreportedResults, currentTask, lastErrorCode)
    }

    private fun simState(ctx: Context): String = try {
        val manager = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        when (manager.simState) {
            TelephonyManager.SIM_STATE_READY -> "READY"
            TelephonyManager.SIM_STATE_ABSENT -> "ABSENT"
            TelephonyManager.SIM_STATE_PIN_REQUIRED, TelephonyManager.SIM_STATE_PUK_REQUIRED, TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "LOCKED"
            else -> "UNKNOWN"
        }
    } catch (e: Exception) {
        "UNKNOWN"
    }
}
