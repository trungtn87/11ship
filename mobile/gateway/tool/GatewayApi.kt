package vn.eleven.gateway

import org.json.JSONObject
import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * HTTPS client of the 11Ship backend (/v1/sms-gateway/*). The phone always connects OUT; nothing listens on the LAN. TLS is the
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

    class ClaimResult(val sendingEnabled: Boolean, val job: Job?)
    class HeartbeatResult(val sendingEnabled: Boolean, val pollSeconds: Int)

    private val root = baseUrl.trimEnd('/') + "/v1/sms-gateway"

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

    fun heartbeat(appVersion: String, smsPermission: Boolean, paused: Boolean): HeartbeatResult {
        val data = post(
            "/heartbeat",
            JSONObject().put("app_version", appVersion).put("sms_permission", smsPermission).put("paused", paused)
        )
        return HeartbeatResult(data.optBoolean("sending_enabled", false), data.optInt("poll_seconds", 5))
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
