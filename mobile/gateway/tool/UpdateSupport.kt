package vn.eleven.gateway

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/** What the server offers in the heartbeat answer (M13). Everything here comes from the server; nothing is trusted until the file is verified. */
class UpdateOffer(
    val releaseId: String,
    val versionName: String,
    val versionCode: Int,
    val priority: String,
    val sizeBytes: Long,
    val sha256: String,
    val ready: Boolean,
    val downloadPath: String,
)

/** Thrown when a downloaded file is not what the server announced. The file is deleted before this is thrown. */
class UpdateVerificationFailed(val code: String) : IOException(code)

/** Android-free rules of the gateway self-update, so they are unit tested. */
object UpdateRules {
    /** Upper bound for an APK we are willing to store (the real one is far smaller). */
    const val MAX_APK_BYTES = 150L * 1024 * 1024
    private val HEX64 = Regex("^[0-9a-f]{64}$")
    private val PATH = Regex("^/v1/sms-gateway/update/[0-9a-fA-F-]{36}$")

    /**
     * Why an update must NOT be started now, or null when it may. The gateway updates only when it is stopped (so no task is running) and no result is
     * waiting for the server: the same conditions the server checks before it marks the offer ready and before it serves the file.
     */
    fun blocker(offer: UpdateOffer?, installedVersionCode: Int, serviceRunning: Boolean, unreportedResults: Int, currentTask: String): String? {
        if (offer == null || offer.versionCode <= installedVersionCode) return "NO_UPDATE"
        if (serviceRunning) return "STOP_FIRST"
        if (unreportedResults > 0) return "REPORT_PENDING"
        if (currentTask != "IDLE") return "TASK_RUNNING"
        if (!offer.ready) return "SERVER_NOT_READY"
        if (offer.sizeBytes <= 0 || offer.sizeBytes > MAX_APK_BYTES) return "BAD_SIZE"
        if (!HEX64.matches(offer.sha256)) return "BAD_HASH"
        if (!PATH.matches(offer.downloadPath)) return "BAD_PATH"
        return null
    }

    fun sha256Hex(stream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Copies [source] into [target] (at most [expectedSize] bytes) and accepts it only when size and SHA-256 equal what the server announced. */
    fun saveVerified(source: InputStream, target: File, expectedSize: Long, expectedSha256: String) {
        val part = File(target.path + ".part")
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        try {
            part.outputStream().use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = source.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > expectedSize) throw UpdateVerificationFailed("SIZE_MISMATCH")
                    digest.update(buffer, 0, read)
                    out.write(buffer, 0, read)
                }
            }
            if (total != expectedSize) throw UpdateVerificationFailed("SIZE_MISMATCH")
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (!actual.equals(expectedSha256, ignoreCase = true)) throw UpdateVerificationFailed("SHA256_MISMATCH")
            if (target.exists() && !target.delete()) throw UpdateVerificationFailed("REPLACE_FAILED")
            if (!part.renameTo(target)) throw UpdateVerificationFailed("REPLACE_FAILED")
        } catch (e: Exception) {
            part.delete()
            target.delete()
            throw e
        }
    }
}
