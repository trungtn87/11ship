package vn.eleven.n11

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * M13: the native half of the app update (lib/src/m13/m13_update.dart). Dart downloads the file and checks its size and SHA-256; this class only
 * tells Dart where the update folder is and, for a file inside that folder, opens the Android installer (the person confirms there). Nothing is
 * installed silently, and no path outside the update folder is ever opened. The application id and the signing key are unchanged.
 */
class N11UpdateChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    private fun updateDir(): File = File(activity.cacheDir, "updates").also { it.mkdirs() }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "updateDirectory" -> result.success(updateDir().absolutePath)
            "dataDirectory" -> result.success(File(activity.filesDir, "n11-ops").also { it.mkdirs() }.absolutePath)
            "openStore" -> openStore(result)
            "install" -> install(call.argument<String>("path") ?: "", result)
            else -> result.notImplemented()
        }
    }

    /** M13 (#280): opens the Google Play page of THIS application id only (no address comes from Dart). false = no Play app/browser could open it. */
    private fun openStore(result: MethodChannel.Result) {
        val id = activity.packageName
        for (uri in listOf("market://details?id=$id", "https://play.google.com/store/apps/details?id=$id")) {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                result.success(true)
                return
            } catch (e: Exception) {
                // try the next address
            }
        }
        result.success(false)
    }

    private fun install(path: String, result: MethodChannel.Result) {
        val file = File(path)
        if (!N11UpdatePaths.isUpdateFile(updateDir(), file) || !file.isFile) {
            result.error("INSTALLER", null, null)
            return
        }
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            } catch (e: Exception) {
                // The settings screen is not available; Dart tells the person what is missing.
            }
            result.error("INSTALL_PERMISSION", null, null)
            return
        }
        try {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
            activity.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
            result.success("OPENED")
        } catch (e: Exception) {
            result.error("INSTALLER", null, null)
        }
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/update"
    }
}

/** Android-free path rule, unit tested: only a plain file named update-<digits>.apk directly inside the update folder may be opened. */
object N11UpdatePaths {
    private val NAME = Regex("^update-[0-9]{1,10}\\.apk$")

    fun isUpdateFile(dir: File, file: File): Boolean {
        val parent = file.absoluteFile.parentFile?.canonicalFile ?: return false
        return parent == dir.canonicalFile && NAME.matches(file.name) && file.canonicalFile.parentFile == dir.canonicalFile
    }
}
