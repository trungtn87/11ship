package vn.eleven.gateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.telephony.SmsManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingPermission: MethodChannel.Result? = null
    private val requestCode = 1811
    private val smsText = "11Ship SMS Gateway: Tin nhan thu nghiem. Khong phai ma OTP."
    private val baseUrlPattern = Regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$")
    private val credentialPattern = Regex("^[A-Za-z0-9_-]{43}$")

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "vn.eleven.gateway/sms")
            .setMethodCallHandler { call, response ->
                when (call.method) {
                    "deviceStatus" -> response.success(
                        mapOf(
                            "supported" to packageManager.hasSystemFeature(
                                PackageManager.FEATURE_TELEPHONY_MESSAGING
                            ),
                            "granted" to hasSmsPermission()
                        )
                    )
                    "requestPermission" -> {
                        if (hasSmsPermission() && notificationsGranted()) response.success(true)
                        else if (pendingPermission != null) {
                            response.error("BUSY", "Đang xin quyền.", null)
                        } else {
                            pendingPermission = response
                            val wanted = mutableListOf(Manifest.permission.SEND_SMS)
                            if (Build.VERSION.SDK_INT >= 33) wanted.add(Manifest.permission.POST_NOTIFICATIONS)
                            ActivityCompat.requestPermissions(this, wanted.toTypedArray(), requestCode)
                        }
                    }
                    "sendTestSms" -> {
                        val phone = call.argument<String>("phone") ?: ""
                        when {
                            !Regex("^\\+84[0-9]{9}$").matches(phone) ->
                                response.error("PHONE", "Số nhận không hợp lệ.", null)
                            !hasSmsPermission() ->
                                response.error("PERMISSION", "Chưa được cấp SEND_SMS.", null)
                            // FEATURE_TELEPHONY_MESSAGING is a diagnostic flag, not
                            // an authoritative capability test on every OEM ROM.
                            // Let SmsManager report a real send error instead.
                            else -> try {
                                @Suppress("DEPRECATION")
                                val manager = if (Build.VERSION.SDK_INT >= 31) {
                                    getSystemService(SmsManager::class.java)
                                } else {
                                    SmsManager.getDefault()
                                }
                                manager.sendTextMessage(phone, null, smsText, null, null)
                                response.success(
                                    "Đã chuyển yêu cầu gửi tới Android. " +
                                        "Đây chưa phải xác nhận giao SMS; hãy kiểm tra máy nhận."
                                )
                            } catch (e: Exception) {
                                response.error("SEND", "Android từ chối: ${e.message}", null)
                            }
                        }
                    }
                    "gatewayState" -> response.success(gatewayState())
                    "gatewayPair" -> pair(
                        call.argument<String>("baseUrl") ?: "",
                        call.argument<String>("credential") ?: "",
                        response
                    )
                    "gatewayUnpair" -> {
                        GatewayStore.setEnabled(this, false)
                        GatewayService.stop(this)
                        GatewayStore.unpair(this)
                        response.success(true)
                    }
                    "gatewaySetEnabled" -> {
                        val enabled = call.argument<Boolean>("enabled") == true
                        if (enabled && (!GatewayStore.isPaired(this))) {
                            response.error("NOT_PAIRED", "Chưa ghép cặp với VPS.", null)
                        } else {
                            GatewayStore.setEnabled(this, enabled)
                            if (enabled) {
                                GatewayStore.setAuthFailed(this, false)
                                GatewayService.start(this)
                            } else {
                                GatewayService.stop(this)
                            }
                            response.success(true)
                        }
                    }
                    "openBatterySettings" -> {
                        try {
                            startActivity(
                                Intent(
                                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                    Uri.parse("package:$packageName")
                                )
                            )
                        } catch (e: Exception) {
                            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                        }
                        response.success(true)
                    }
                    else -> response.notImplemented()
                }
            }
    }

    /** Verifies the credential against the VPS first; nothing is stored unless the server accepted it. */
    private fun pair(baseUrl: String, credential: String, response: MethodChannel.Result) {
        val url = baseUrl.trim().trimEnd('/')
        val secret = credential.trim()
        if (!baseUrlPattern.matches(url)) {
            response.error("URL", "Địa chỉ VPS phải bắt đầu bằng https://", null)
            return
        }
        if (!credentialPattern.matches(secret)) {
            response.error("CREDENTIAL", "Mã ghép cặp không đúng định dạng (43 ký tự).", null)
            return
        }
        Thread {
            var code: String? = null
            try {
                GatewayApi(url, secret).heartbeat(versionName(), hasSmsPermission(), true)
            } catch (e: GatewayApi.Unauthorized) {
                code = "UNAUTHORIZED"
            } catch (e: Exception) {
                code = "NETWORK"
            }
            runOnUiThread {
                if (code == null) {
                    GatewayStore.setBaseUrl(this, url)
                    GatewayStore.saveCredential(this, secret)
                    GatewayStore.setEnabled(this, false)
                    response.success(true)
                } else {
                    response.error(
                        code,
                        if (code == "UNAUTHORIZED") "VPS từ chối mã ghép cặp (sai hoặc đã thu hồi)."
                        else "Không kết nối được VPS qua HTTPS.",
                        null
                    )
                }
            }
        }.start()
    }

    private fun gatewayState(): Map<String, Any?> {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        return GatewayStore.snapshot(this) + mapOf(
            "serviceRunning" to GatewayService.running,
            "smsGranted" to hasSmsPermission(),
            "notificationsGranted" to notificationsGranted(),
            "batteryUnrestricted" to power.isIgnoringBatteryOptimizations(packageName),
            "appVersion" to versionName(),
        )
    }

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
    } catch (e: Exception) {
        "0"
    }

    private fun hasSmsPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    private fun notificationsGranted() =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == this.requestCode) {
            pendingPermission?.success(hasSmsPermission())
            pendingPermission = null
        }
    }
}
