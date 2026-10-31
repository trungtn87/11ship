package vn.eleven.n11

import android.app.Activity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * M13 (issue #280): the native half of the app's version check (lib/src/m13/m13_update.dart). The app only compares versions and tells the person
 * that a newer build exists, so this class has one job left: the folder where the offline error queue lives. Nothing is downloaded, no installer
 * is opened and no install permission is requested.
 */
class N11UpdateChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "dataDirectory" -> result.success(File(activity.filesDir, "n11-ops").also { it.mkdirs() }.absolutePath)
            else -> result.notImplemented()
        }
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/update"
    }
}
