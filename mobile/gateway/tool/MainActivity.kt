package vn.eleven.gateway

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
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
                        if (hasSmsPermission()) response.success(true)
                        else if (pendingPermission != null) {
                            response.error("BUSY", "Đang xin quyền SMS.", null)
                        } else {
                            pendingPermission = response
                            ActivityCompat.requestPermissions(
                                this, arrayOf(Manifest.permission.SEND_SMS), requestCode
                            )
                        }
                    }
                    "sendTestSms" -> {
                        val phone = call.argument<String>("phone") ?: ""
                        when {
                            !Regex("^\\+84[0-9]{9}$").matches(phone) ->
                                response.error("PHONE", "Số nhận không hợp lệ.", null)
                            !hasSmsPermission() ->
                                response.error("PERMISSION", "Chưa được cấp SEND_SMS.", null)
                            !packageManager.hasSystemFeature(
                                PackageManager.FEATURE_TELEPHONY_MESSAGING
                            ) ->
                                response.error("NO_SIM", "Thiết bị không hỗ trợ SMS.", null)
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
                    else -> response.notImplemented()
                }
            }
    }

    private fun hasSmsPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) ==
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
