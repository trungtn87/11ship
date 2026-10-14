package vn.eleven.gateway

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Foreground service that polls the 11Ship backend over HTTPS and sends the OTP SMS it is handed.
 *
 * Safety rules (issue #102):
 *  - a job is claimed once; whatever happens, one result is reported: SENT (the radio accepted it), FAILED (it was not sent) or
 *    UNKNOWN (no usable report). An UNKNOWN or crashed attempt is NEVER sent again;
 *  - only recipients +84 + nine digits and the two fixed 11Ship OTP texts are accepted, whatever the server says;
 *  - the text (the OTP) lives in a local variable for the duration of the send: it is not logged, not stored, not shown in the
 *    notification or the UI;
 *  - SmsManager.sendTextMessage returning does NOT mean sent: the sent PendingIntent result decides.
 */
class GatewayService : Service() {
    companion object {
        @Volatile
        var running = false
            private set

        const val ACTION_STOP = "vn.eleven.gateway.STOP"
        private const val ACTION_SENT = "vn.eleven.gateway.SMS_SENT"
        private const val ACTION_DELIVERED = "vn.eleven.gateway.SMS_DELIVERED"
        private const val CHANNEL = "gateway"
        private const val NOTIFICATION_ID = 1811
        private val TEXT = Regex(
            "^11Ship: Ma (xac thuc dang ky|dat lai mat khau) cua ban la [0-9]{6}\\. " +
                "Hieu luc [0-9]{1,2} phut\\. Khong chia se ma nay\\.$"
        )
        private val PHONE = Regex("^\\+84[0-9]{9}$")

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, GatewayService::class.java))
        }

        fun stop(ctx: Context) {
            if (running) {
                ContextCompat.startForegroundService(
                    ctx, Intent(ctx, GatewayService::class.java).setAction(ACTION_STOP)
                )
            }
        }
    }

    @Volatile
    private var stopRequested = false
    private var worker: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val sentResults = ConcurrentHashMap<String, LinkedBlockingQueue<Int>>()

    private val resultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val job = intent.getStringExtra("job") ?: return
            when (intent.action) {
                ACTION_SENT -> sentResults[job]?.offer(resultCode)
                ACTION_DELIVERED -> {
                    if (resultCode != Activity.RESULT_OK) return
                    val attempt = intent.getStringExtra("attempt") ?: return
                    Thread {
                        try {
                            val base = GatewayStore.baseUrl(applicationContext)
                            val cred = GatewayStore.loadCredential(applicationContext)
                            if (base != null && cred != null) {
                                GatewayApi(base, cred).ack(job, attempt, "DELIVERED", null)
                            }
                        } catch (e: Exception) {
                            // The delivery receipt is optional; the SENT report already decided the outcome.
                        }
                    }.start()
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val filter = IntentFilter().apply {
            addAction(ACTION_SENT)
            addAction(ACTION_DELIVERED)
        }
        ContextCompat.registerReceiver(this, resultReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        enterForeground("Đang khởi động...")
        if (intent?.action == ACTION_STOP) {
            stopRequested = true
            worker?.interrupt()
            if (worker == null) stopSelf()
            return START_NOT_STICKY
        }
        if (!GatewayStore.isPaired(this) || !GatewayStore.isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (worker == null) {
            running = true
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "11ship:gateway").apply {
                setReferenceCounted(false)
                acquire()
            }
            worker = Thread({ loop() }, "gateway-loop").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopRequested = true
        running = false
        try {
            unregisterReceiver(resultReceiver)
        } catch (e: Exception) {
            // Already gone.
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    // --- loop -----------------------------------------------------------------------------------------------------------

    private fun loop() {
        var backoffSeconds = 0
        var pollSeconds = 5
        var lastBeat = 0L
        var api: GatewayApi? = null
        try {
            recoverCrashedAttempt()
            while (!stopRequested) {
                val base = GatewayStore.baseUrl(this)
                val credential = GatewayStore.loadCredential(this)
                if (base == null || credential == null) {
                    GatewayStore.recordConnection(this, false, "NOT_PAIRED", null)
                    GatewayStore.setEnabled(this, false)
                    break
                }
                val client = GatewayApi(base, credential)
                api = client
                try {
                    flushPending(client)
                    val permission = hasSmsPermission()
                    val now = System.currentTimeMillis()
                    if (now - lastBeat > 60_000) {
                        val beat = client.heartbeat(versionName(), permission, false)
                        pollSeconds = beat.pollSeconds.coerceIn(2, 60)
                        lastBeat = now
                    }
                    val claim = client.claim(permission, false)
                    GatewayStore.recordConnection(this, true, null, claim.sendingEnabled)
                    backoffSeconds = 0
                    setStatus(if (claim.sendingEnabled) "Đã kết nối VPS" else "Đã kết nối, VPS đang tắt gửi SMS")
                    val job = claim.job
                    if (job != null) {
                        process(client, job)
                        continue
                    }
                } catch (e: GatewayApi.Unauthorized) {
                    GatewayStore.setAuthFailed(this, true)
                    GatewayStore.setEnabled(this, false)
                    GatewayStore.recordConnection(this, false, "UNAUTHORIZED", null)
                    break
                } catch (e: Exception) {
                    backoffSeconds = if (backoffSeconds == 0) 5 else minOf(60, backoffSeconds * 2)
                    GatewayStore.recordConnection(this, false, errorCode(e), null)
                    setStatus("Mất kết nối VPS, thử lại sau ${backoffSeconds}s")
                    if (!sleepSeconds(backoffSeconds)) break
                    continue
                }
                if (!sleepSeconds(pollSeconds)) break
            }
        } finally {
            // Tell the server this phone no longer takes work, so that no OTP is queued for a phone that stopped.
            api?.let {
                try {
                    it.heartbeat(versionName(), hasSmsPermission(), true)
                } catch (e: Exception) {
                    // Best effort: the server also notices the missing heartbeats.
                }
            }
            running = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun sleepSeconds(seconds: Int): Boolean {
        return try {
            Thread.sleep(seconds * 1000L)
            !stopRequested
        } catch (e: InterruptedException) {
            false
        }
    }

    private fun errorCode(e: Exception): String = when (e) {
        is GatewayApi.ServerError -> "SERVER_${e.status}"
        is GatewayApi.Rejected -> "REJECTED_${e.status}"
        is javax.net.ssl.SSLException -> "TLS"
        is java.net.UnknownHostException -> "DNS"
        is java.net.SocketTimeoutException -> "TIMEOUT"
        is IOException -> "NETWORK"
        else -> "ERROR"
    }

    // --- one job --------------------------------------------------------------------------------------------------------

    private fun process(api: GatewayApi, job: GatewayApi.Job) {
        if (!PHONE.matches(job.to) || !TEXT.matches(job.text) || job.text.length > 160) {
            report(api, job.jobId, job.attemptId, "FAILED", "REJECTED_TEMPLATE")
            return
        }
        if (!hasSmsPermission()) {
            report(api, job.jobId, job.attemptId, "FAILED", "NO_PERMISSION")
            return
        }
        // Written BEFORE the radio is touched: if the process dies from here on, the next start reports UNKNOWN and never resends.
        GatewayStore.markAttempt(this, job.jobId, job.attemptId)
        val results = LinkedBlockingQueue<Int>()
        sentResults[job.jobId] = results
        try {
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val sentIntent = Intent(ACTION_SENT).setPackage(packageName)
                .putExtra("job", job.jobId).putExtra("attempt", job.attemptId)
            val deliveredIntent = Intent(ACTION_DELIVERED).setPackage(packageName)
                .putExtra("job", job.jobId).putExtra("attempt", job.attemptId)
            val code = job.jobId.hashCode()
            val sentPi = PendingIntent.getBroadcast(this, code, sentIntent, flags)
            val deliveredPi = PendingIntent.getBroadcast(this, code xor 0x5a5a5a5a, deliveredIntent, flags)
            try {
                smsManager().sendTextMessage(job.to, null, job.text, sentPi, deliveredPi)
            } catch (e: Exception) {
                // Refused before anything reached the radio.
                report(api, job.jobId, job.attemptId, "FAILED", "SEND_EXCEPTION")
                return
            }
            val sent = results.poll(45, TimeUnit.SECONDS)
            when {
                sent == null -> report(api, job.jobId, job.attemptId, "UNKNOWN", "NO_SENT_REPORT")
                sent == Activity.RESULT_OK -> report(api, job.jobId, job.attemptId, "SENT", null)
                else -> report(api, job.jobId, job.attemptId, "FAILED", sendErrorName(sent))
            }
        } catch (e: InterruptedException) {
            report(api, job.jobId, job.attemptId, "UNKNOWN", "INTERRUPTED")
        } finally {
            sentResults.remove(job.jobId)
        }
    }

    private fun sendErrorName(code: Int): String = when (code) {
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "GENERIC_FAILURE"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "RADIO_OFF"
        SmsManager.RESULT_ERROR_NULL_PDU -> "NULL_PDU"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "NO_SERVICE"
        SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "LIMIT_EXCEEDED"
        else -> "ERROR_$code"
    }

    /** Records the result durably first, then tells the server (idempotent on the server, retried until it answers). */
    private fun report(api: GatewayApi, jobId: String, attemptId: String, result: String, errorCode: String?) {
        GatewayStore.savePending(this, GatewayStore.PendingReport(jobId, attemptId, result, errorCode))
        GatewayStore.clearAttempt(this)
        GatewayStore.countResult(this, result == "SENT")
        flushPending(api)
    }

    /** Sends the stored report. If the server cannot be reached it stays stored and is retried on the next pass. */
    private fun flushPending(api: GatewayApi) {
        val pending = GatewayStore.pending(this) ?: return
        var wait = 2
        for (attempt in 1..4) {
            try {
                api.ack(pending.jobId, pending.attemptId, pending.result, pending.errorCode)
                GatewayStore.clearPending(this)
                return
            } catch (e: GatewayApi.Rejected) {
                // 404/409: the server already has a final answer for this attempt; nothing more can be done.
                GatewayStore.clearPending(this)
                return
            } catch (e: GatewayApi.Unauthorized) {
                throw e
            } catch (e: Exception) {
                if (attempt == 4 || !sleepSeconds(wait)) return
                wait *= 2
            }
        }
    }

    /** A previous run died between "about to send" and "reported": it may or may not have sent. Report UNKNOWN, never resend. */
    private fun recoverCrashedAttempt() {
        val crashed = GatewayStore.attempt(this) ?: return
        if (GatewayStore.pending(this) == null) {
            GatewayStore.savePending(
                this, GatewayStore.PendingReport(crashed.first, crashed.second, "UNKNOWN", "RESTARTED")
            )
            GatewayStore.countResult(this, false)
        }
        GatewayStore.clearAttempt(this)
    }

    // --- helpers --------------------------------------------------------------------------------------------------------

    private fun hasSmsPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

    @Suppress("DEPRECATION")
    private fun smsManager(): SmsManager =
        if (Build.VERSION.SDK_INT >= 31) getSystemService(SmsManager::class.java) else SmsManager.getDefault()

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
    } catch (e: Exception) {
        "0"
    }

    private fun notification(text: String): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "11Ship SMS Gateway", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Never contains a code, a number or any message text.
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("11Ship SMS Gateway")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun enterForeground(text: String) {
        val n = notification(text)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun setStatus(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, notification(text))
    }
}
