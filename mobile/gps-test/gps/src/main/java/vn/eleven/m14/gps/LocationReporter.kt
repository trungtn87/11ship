package vn.eleven.m14.gps

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Sends the Shipper's LATEST position to the server from the foreground service, so it goes on when the screen is locked, the app is in the
// background or the Flutter engine is gone. Pure Kotlin on purpose (no Android classes): the rules are unit-tested on the JVM.
//
// One uploader only: while this service runs the Flutter app never sends a position itself, so nothing is sent twice. Only the latest fix is
// kept (no queue, no trail). The session is the app's own opaque Bearer token, read from the app's encrypted store for each request and never
// copied, logged or put in a notification; there is no refresh, so a 401 means the session is over.

/** One accepted fix, as the recorder hands it over. [elapsedMs] is the monotonic measurement time, [measuredAtMs] the wall clock of the fix. */
data class Fix(val lat: Double, val lon: Double, val accuracyM: Float, val measuredAtMs: Long, val elapsedMs: Long, val mock: Boolean = false)

object ReportRules {
    const val MAX_ACCURACY_M = 1000f
    const val MAX_AGE_MS = 120_000L

    /** The same checks as the app's own display rules; an invalid fix is never sent. */
    fun valid(fix: Fix, nowMs: Long): Boolean {
        val age = nowMs - fix.measuredAtMs
        return !fix.mock && fix.lat.isFinite() && fix.lat in -90.0..90.0 && fix.lon.isFinite() && fix.lon in -180.0..180.0 &&
            fix.accuracyM.isFinite() && fix.accuracyM > 0f && fix.accuracyM <= MAX_ACCURACY_M && age in 0 until MAX_AGE_MS
    }

    fun body(fix: Fix): String = "{\"lat\":${fix.lat},\"lng\":${fix.lon},\"accuracy_m\":${fix.accuracyM.toDouble()}}"

    /** A one-way digest that tells "the same session" from another without keeping the token. */
    fun fingerprint(token: String): String =
        MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).take(8).joinToString("") { "%02x".format(it) }

    fun flag(body: String, name: String): Boolean? = Regex("\"$name\"\\s*:\\s*(true|false)").find(body)?.groupValues?.get(1)?.toBooleanStrictOrNull()

    /** Only an https address of the app's own server is accepted. */
    fun validBase(base: String): Boolean = Regex("https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/?").matches(base)
}

data class ReportResponse(val status: Int, val body: String)

interface ReportTransport {
    @Throws(IOException::class)
    fun put(url: String, token: String, body: String): ReportResponse

    /** Abandons the request in flight (logout, stop). */
    fun cancel()
}

/** Where the session token comes from: the app's encrypted store. Null = no session. */
interface SessionLink {
    fun token(): String?
}

interface ReportListener {
    /** The server holds this position now. [shouldShare]/[intentOnline] are the server's words, null when it did not say. */
    fun uploaded(atWallMs: Long, shouldShare: Boolean?, intentOnline: Boolean?)
    /** No answer or a server error: the next fix (or one quick retry) tries again. */
    fun failed()
    /** The server refused this account (suspended, no Shipper role…). Sending goes on at the next fix; the app decides what to do. */
    fun refused()
    /** The session is over (401, token gone, another account): the service must stop and forget the link. */
    fun sessionEnded()
    /** The server says nothing needs the position any more (offline and no work left): the service stops. */
    fun notNeeded()
}

class LocationReporter(
    private val transport: ReportTransport,
    private val link: SessionLink,
    private val listener: ReportListener,
    private val clock: () -> Long,
    private val executor: (Runnable) -> Unit,
    private val stopGraceMs: Long = 90_000L,
) {
    private val lock = Any()
    private var base: String? = null
    private var fingerprint: String? = null
    private var startedAtMs = 0L
    private var generation = 0
    private var inFlight = false
    private var pending: Fix? = null
    private var latest: Fix? = null
    private var lastSentElapsed = Long.MIN_VALUE
    private var retried = false

    /** [fingerprint] is the digest of the token the Shipper's app held when it started sharing. */
    fun start(base: String, fingerprint: String) {
        synchronized(lock) {
            require(ReportRules.validBase(base)) { "address" }
            generation++
            this.base = base.trimEnd('/')
            this.fingerprint = fingerprint
            startedAtMs = clock()
            inFlight = false
            pending = null
            latest = null
            lastSentElapsed = Long.MIN_VALUE
            retried = false
        }
    }

    /** Cancels what is waiting and what is in flight; whatever answers later is ignored. */
    fun stop() {
        synchronized(lock) {
            generation++
            base = null
            fingerprint = null
            pending = null
            latest = null
            inFlight = false
        }
        transport.cancel()
    }

    val running: Boolean get() = synchronized(lock) { base != null }

    fun submit(fix: Fix) {
        val go = synchronized(lock) {
            if (base == null || !ReportRules.valid(fix, clock()) || fix.elapsedMs <= lastSentElapsed) return
            latest = fix
            retried = false
            pending = fix
            if (inFlight) false else { inFlight = true; true }
        }
        if (go) executor(Runnable { drain() })
    }

    /** One quick retry of the latest fix after a failure, only while it is still recent. */
    fun retryLatest() {
        val go = synchronized(lock) {
            val fix = latest
            if (base == null || fix == null || retried || fix.elapsedMs <= lastSentElapsed || !ReportRules.valid(fix, clock())) return
            retried = true
            pending = fix
            if (inFlight) false else { inFlight = true; true }
        }
        if (go) executor(Runnable { drain() })
    }

    private class Job(val fix: Fix, val gen: Int, val url: String, val expected: String)

    private fun drain() {
        while (true) {
            val job = synchronized(lock) {
                val fix = pending
                val target = base
                if (fix == null || target == null) {
                    inFlight = false
                    null
                } else {
                    pending = null
                    Job(fix, generation, "$target/v1/driver/location", fingerprint ?: "")
                }
            } ?: return
            send(job.fix, job.gen, job.url, job.expected)
            // A stop (or a restart) while sending ends this loop: the new run has its own.
            if (!current(job.gen)) return
        }
    }

    private fun send(fix: Fix, gen: Int, url: String, expected: String) {
        val token = link.token()
        if (token == null || ReportRules.fingerprint(token) != expected) {
            if (current(gen)) { stopped(gen); listener.sessionEnded() }
            return
        }
        val response = try {
            transport.put(url, token, ReportRules.body(fix))
        } catch (e: IOException) {
            if (current(gen)) listener.failed()
            return
        }
        if (!current(gen)) return
        when {
            response.status == 200 -> {
                val shouldShare = ReportRules.flag(response.body, "should_share_location")
                synchronized(lock) { lastSentElapsed = maxOf(lastSentElapsed, fix.elapsedMs) }
                listener.uploaded(clock(), shouldShare, ReportRules.flag(response.body, "intent_online"))
                val grace = synchronized(lock) { clock() - startedAtMs < stopGraceMs }
                if (shouldShare == false && !grace) { stopped(gen); listener.notNeeded() }
            }
            response.status == 401 -> { stopped(gen); listener.sessionEnded() }
            response.status in 400..499 -> listener.refused()
            else -> listener.failed()
        }
    }

    private fun current(gen: Int): Boolean = synchronized(lock) { generation == gen && base != null }

    private fun stopped(gen: Int) {
        synchronized(lock) {
            if (generation == gen) { generation++; base = null; fingerprint = null; pending = null; latest = null }
        }
    }
}

/** The real transport: HTTPS only, short timeouts, the token only in the Authorization header, nothing logged. */
class HttpsReportTransport : ReportTransport {
    @Volatile private var connection: HttpURLConnection? = null

    override fun put(url: String, token: String, body: String): ReportResponse {
        val target = URL(url)
        if (target.protocol != "https") throw IOException("https only")
        val c = target.openConnection() as HttpURLConnection
        connection = c
        try {
            c.requestMethod = "PUT"
            c.connectTimeout = 15_000
            c.readTimeout = 15_000
            c.doOutput = true
            c.instanceFollowRedirects = false
            c.setRequestProperty("authorization", "Bearer $token")
            c.setRequestProperty("content-type", "application/json; charset=utf-8")
            c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = c.responseCode
            val stream = if (status >= 400) c.errorStream else c.inputStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            return ReportResponse(status, text)
        } finally {
            connection = null
            c.disconnect()
        }
    }

    override fun cancel() { connection?.disconnect() }
}
