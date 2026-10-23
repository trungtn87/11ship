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
import androidx.core.content.FileProvider
import java.io.File
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
                    "gatewayUpdateCheck" -> updateCheck(response)
                    "gatewayUpdateInstall" -> updateInstall(response)
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

    // --- self-update (M13) ----------------------------------------------------------------------------------------------

    /** The last offer the server made to this stopped phone. Only the stopped phone asks for one, and the file is never taken from anywhere else. */
    @Volatile
    private var offer: UpdateOffer? = null

    private fun updateTelemetry(): Telemetry =
        DeviceTelemetry.read(this, GatewayStore.unreportedCount(this), "IDLE", GatewayStore.lastError(this))

    /** Asks the server (as a stopped phone) whether a newer version is ready, and says why not when it is not. Nothing is downloaded here. */
    private fun updateCheck(response: MethodChannel.Result) {
        val base = GatewayStore.baseUrl(this)
        val credential = GatewayStore.loadCredential(this)
        if (base == null || credential == null) {
            response.error("NOT_PAIRED", "Chưa ghép cặp với VPS.", null)
            return
        }
        if (GatewayService.running) {
            response.success(mapOf("state" to "STOP_FIRST"))
            return
        }
        Thread {
            var result: Map<String, Any?>
            var failure: String? = null
            try {
                val beat = GatewayApi(base, credential).heartbeat(versionName(), hasSmsPermission(), true, versionCode(), updateTelemetry())
                offer = beat.update
                val blocker = UpdateRules.blocker(
                    beat.update, versionCode() ?: 0, GatewayService.running, GatewayStore.unreportedCount(this), "IDLE"
                )
                result = mapOf(
                    "state" to (blocker ?: "READY"),
                    "versionName" to beat.update?.versionName,
                    "versionCode" to beat.update?.versionCode,
                    "priority" to beat.update?.priority,
                    "sizeBytes" to beat.update?.sizeBytes,
                )
            } catch (e: GatewayApi.Unauthorized) {
                failure = "UNAUTHORIZED"
                result = emptyMap()
            } catch (e: Exception) {
                failure = "NETWORK"
                result = emptyMap()
            }
            runOnUiThread {
                if (failure == null) response.success(result) else response.error(failure, "Không hỏi được VPS về bản cập nhật.", null)
            }
        }.start()
    }

    /**
     * Downloads the offered file, verifies size and SHA-256 and only then hands it to the Android installer (the person confirms there). The
     * application id and the signing key are unchanged: Android refuses an update signed by another key.
     */
    private fun updateInstall(response: MethodChannel.Result) {
        val base = GatewayStore.baseUrl(this)
        val credential = GatewayStore.loadCredential(this)
        val current = offer
        val blocker = UpdateRules.blocker(current, versionCode() ?: 0, GatewayService.running, GatewayStore.unreportedCount(this), "IDLE")
        if (base == null || credential == null || current == null || blocker != null) {
            response.error(blocker ?: "NO_UPDATE", "Chưa thể cập nhật lúc này.", null)
            return
        }
        Thread {
            var failure: String? = null
            var file: File? = null
            try {
                val dir = File(cacheDir, "updates").also { it.mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                file = File(dir, "gateway-${current.versionCode}.apk")
                GatewayApi(base, credential).downloadUpdate(current, file)
                // Verified once while saving; verified again right before the installer opens it.
                val again = file.inputStream().use { UpdateRules.sha256Hex(it) }
                if (!again.equals(current.sha256, ignoreCase = true)) {
                    file.delete()
                    failure = "SHA256_MISMATCH"
                }
            } catch (e: UpdateVerificationFailed) {
                failure = e.code
            } catch (e: GatewayApi.Unauthorized) {
                failure = "UNAUTHORIZED"
            } catch (e: GatewayApi.Rejected) {
                failure = "REJECTED_${e.status}"
            } catch (e: Exception) {
                failure = "NETWORK"
            }
            runOnUiThread {
                if (failure != null || file == null) {
                    response.error(failure ?: "NETWORK", "Không tải hoặc không xác minh được bản cập nhật.", null)
                } else {
                    openInstaller(file, response)
                }
            }
        }.start()
    }

    private fun openInstaller(file: File, response: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            } catch (e: Exception) {
                // The settings screen is not available; the code below tells the person what is missing.
            }
            response.error("INSTALL_PERMISSION", "Hãy cho phép 11Ship SMS Gateway cài ứng dụng, rồi bấm cập nhật lại.", null)
            return
        }
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
            startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
            response.success(true)
        } catch (e: Exception) {
            response.error("INSTALLER", "Không mở được trình cài đặt Android.", null)
        }
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

    @Suppress("DEPRECATION")
    private fun versionCode(): Int? = try {
        val info = packageManager.getPackageInfo(packageName, 0)
        (if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()).toInt().takeIf { it > 0 }
    } catch (e: Exception) {
        null
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
