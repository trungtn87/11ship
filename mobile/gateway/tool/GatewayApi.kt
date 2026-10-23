package vn.eleven.gateway

import org.json.JSONObject
import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * HTTPS client of the 11Ship backend (/v1/sms-gateway routes). The phone always connects OUT; nothing listens on the LAN. TLS is the
 * platform default: the certificate chain and the host name are verified against the system trust store, there is no custom
 * TrustManager or HostnameVerifier, and redirects are not followed.
 */
class GatewayApi(baseUrl: String, private val credential: String) {
    class Unauthorized : IOException("unauthorized")
    class Rejected(val status: Int) : IOException("rejected $status")
    class ServerError(val status: Int) : IOException("server $status")

    class Job(
        val jobId: String,
        val attemptId: String,
        val to: String,
        val text: String,
    )

    private companion object {
        val ERROR_CODE = Regex("^[A-Z0-9_]{1,24}$")
    }

    class ClaimResult(val sendingEnabled: Boolean, val job: Job?)
    class HeartbeatResult(val sendingEnabled: Boolean, val pollSeconds: Int, val update: UpdateOffer?)

    private val origin = baseUrl.trimEnd('/')
    private val root = origin + "/v1/sms-gateway"

    init {
        require(baseUrl.startsWith("https://")) { "HTTPS is required" }
    }

    private fun post(path: String, body: JSONObject): JSONObject {
        val connection = URL(root + path).openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $credential")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return when {
                status in 200..299 -> JSONObject(text).getJSONObject("data")
                status == 401 -> throw Unauthorized()
                status in 400..499 -> throw Rejected(status)
                else -> throw ServerError(status)
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * The heartbeat carries what the phone can really tell (battery, charging, SIM state, version, results waiting, current task). A value the
     * phone does not give is left out; the SIM balance is never part of it.
     */
    fun heartbeat(
        appVersion: String,
        smsPermission: Boolean,
        paused: Boolean,
        versionCode: Int? = null,
        telemetry: Telemetry? = null,
    ): HeartbeatResult {
        val body = JSONObject().put("app_version", appVersion).put("sms_permission", smsPermission).put("paused", paused)
        if (versionCode != null && versionCode > 0) body.put("app_version_code", versionCode)
        if (telemetry != null) {
            telemetry.batteryPercent?.let { body.put("battery_percent", it) }
            telemetry.charging?.let { body.put("charging", it) }
            body.put("sim_state", telemetry.simState)
            body.put("pending_reports", telemetry.unreportedResults.coerceIn(0, 100))
            body.put("current_task", telemetry.currentTask)
            telemetry.lastErrorCode?.takeIf { ERROR_CODE.matches(it) }?.let { body.put("last_error_code", it) }
        }
        val data = post("/heartbeat", body)
        val update = data.optJSONObject("update")?.let {
            try {
                UpdateOffer(
                    it.getString("release_id"), it.getString("version_name"), it.getInt("version_code"),
                    it.optString("priority", "RECOMMENDED"), it.getLong("size_bytes"), it.getString("sha256"),
                    it.optBoolean("ready", false), it.getString("download_path"),
                )
            } catch (e: Exception) {
                null
            }
        }
        return HeartbeatResult(data.optBoolean("sending_enabled", false), data.optInt("poll_seconds", 5), update)
    }

    /**
     * Downloads the announced file into [target]. The device credential opens it only while the phone reports itself stopped (paused=true). The file is
     * kept only when its size and SHA-256 equal what the heartbeat announced; otherwise it is deleted and [UpdateVerificationFailed] is thrown.
     */
    fun downloadUpdate(offer: UpdateOffer, target: java.io.File) {
        val connection = URL(origin + offer.downloadPath + "?paused=true").openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $credential")
            val status = connection.responseCode
            when {
                status in 200..299 -> Unit
                status == 401 -> throw Unauthorized()
                status in 400..499 -> throw Rejected(status)
                else -> throw ServerError(status)
            }
            connection.inputStream.use { UpdateRules.saveVerified(it, target, offer.sizeBytes, offer.sha256) }
        } finally {
            connection.disconnect()
        }
    }

    fun claim(smsPermission: Boolean, paused: Boolean): ClaimResult {
        val data = post("/jobs/claim", JSONObject().put("sms_permission", smsPermission).put("paused", paused))
        val job = data.optJSONObject("job")?.let {
            Job(it.getString("job_id"), it.getString("attempt_id"), it.getString("to"), it.getString("text"))
        }
        return ClaimResult(data.optBoolean("sending_enabled", false), job)
    }

    fun ack(jobId: String, attemptId: String, result: String, errorCode: String?) {
        val body = JSONObject().put("attempt_id", attemptId).put("result", result)
        if (errorCode != null) body.put("error_code", errorCode)
        post("/jobs/$jobId/ack", body)
    }
}
