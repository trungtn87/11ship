package vn.eleven.m14.flutter

import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors
import vn.eleven.m14.gps.Fix
import vn.eleven.m14.gps.HttpsReportTransport
import vn.eleven.m14.gps.LocationReporter
import vn.eleven.m14.gps.RecorderService
import vn.eleven.m14.gps.ReportListener
import vn.eleven.m14.gps.ReportRules

/**
 * The 11Ship location service: collects the position AND sends it to the server, so sharing goes on with the screen locked, the app in the
 * background or swiped away (the process stays alive while this foreground service runs). The Flutter app only starts and stops it and shows its
 * state; it never sends a position itself while this service runs, so nothing is sent twice.
 *
 * - Wording of the notification is the Shipper's own; no stop button (sharing ends with the online button, so app and server cannot disagree).
 * - The session is the app's opaque token, read from its encrypted store for each request (ShipSessionLink); it is never copied, logged or shown.
 *   A 401, a missing token or another account's token ends the service and forgets the link.
 * - It stops when the app stops it (offline and no work, logout), when the server says nothing needs the position any more, or on a session end.
 * - If Android kills the process it may restart the service (START_STICKY) only while the link says the Shipper still wants it; every stop clears the link.
 * - Android can still end it (force-stop, battery restrictions of the phone's maker): nothing here promises otherwise.
 */
class ShipLocationService: RecorderService() {
    override val notificationTitle = "11Ship đang chia sẻ vị trí"
    override val notificationText = "Để nhận đơn gần bạn và cho quán biết bạn đang tới · cập nhật khoảng 1 phút"
    override val stopActionLabel: String? = null
    override val restartPolicy: Int get() = if (link(this).getBoolean(WANTED, false)) START_STICKY else START_NOT_STICKY

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val reporter by lazy {
        LocationReporter(HttpsReportTransport(), ShipSessionLink, listener, System::currentTimeMillis, { task -> worker.execute(task) })
    }

    private val listener = object: ReportListener {
        override fun uploaded(atWallMs: Long, shouldShare: Boolean?, intentOnline: Boolean?) {
            val edit = preferences(this@ShipLocationService).edit().putLong("uploadedAt", atWallMs).putString("uploadState", "OK")
            if (shouldShare == null) edit.remove("shouldShare") else edit.putBoolean("shouldShare", shouldShare)
            if (intentOnline == null) edit.remove("intentOnline") else edit.putBoolean("intentOnline", intentOnline)
            edit.apply()
            announce()
        }
        override fun failed() {
            preferences(this@ShipLocationService).edit().putString("uploadState", "FAILED").apply()
            announce()
            main.postDelayed({ reporter.retryLatest() }, RETRY_MS)
        }
        override fun refused() {
            preferences(this@ShipLocationService).edit().putString("uploadState", "REFUSED").apply()
            announce()
        }
        override fun sessionEnded() {
            preferences(this@ShipLocationService).edit().putString("uploadState", "SESSION_ENDED").apply()
            stopFor("Phiên đăng nhập đã kết thúc — dừng chia sẻ vị trí")
        }
        override fun notNeeded() {
            stopFor("Đã dừng chia sẻ vị trí — không còn đơn cần xử lý")
        }
    }

    private fun announce() = publish()

    private fun stopFor(reason: String) { main.post { shutdown(reason) } }

    override fun mayStart(intent: Intent?): Boolean {
        val store = link(this)
        val base = intent?.getStringExtra(EXTRA_BASE)
        val fingerprint = intent?.getStringExtra(EXTRA_FINGERPRINT)
        if (base != null || fingerprint != null) {
            // An explicit start from the app.
            if (base == null || fingerprint == null || !ReportRules.validBase(base)) return false
            store.edit().putString(BASE, base).putString(FINGERPRINT, fingerprint).putBoolean(WANTED, true).apply()
        } else if (!store.getBoolean(WANTED, false)) {
            // A restart nobody asked for (after offline and no work, or a logout): stop at once.
            return false
        }
        if (!reporter.running) {
            val savedBase = store.getString(BASE, null)
            val savedFingerprint = store.getString(FINGERPRINT, null)
            if (savedBase == null || savedFingerprint == null) return false
            reporter.start(savedBase, savedFingerprint)
            preferences(this).edit().remove("uploadedAt").remove("shouldShare").remove("intentOnline").remove("uploadState").apply()
        }
        return true
    }

    override fun onAcceptedLocation(location: Location) {
        reporter.submit(Fix(location.latitude, location.longitude, location.accuracy, location.time, location.elapsedRealtimeNanos / 1_000_000L))
    }

    override fun onShutdown() {
        // Cancels the request in flight and drops the waiting fix; whatever answers later is ignored. The link is forgotten.
        reporter.stop()
        main.removeCallbacksAndMessages(null)
        clearLink(this)
    }

    override fun onDestroy() {
        super.onDestroy()
        worker.shutdownNow()
    }

    companion object {
        const val EXTRA_BASE = "vn.eleven.m14.ship.BASE"
        const val EXTRA_FINGERPRINT = "vn.eleven.m14.ship.FINGERPRINT"
        private const val BASE = "base"
        private const val FINGERPRINT = "fingerprint"
        private const val WANTED = "wanted"
        private const val RETRY_MS = 10_000L

        private fun link(c: Context) = c.getSharedPreferences("m14-ship-link", Context.MODE_PRIVATE)

        /** Forgets the server address and the session fingerprint: nothing is left that could restart or authorise a send. */
        fun clearLink(c: Context) {
            link(c).edit().clear().apply()
        }

        fun startIntent(c: Context, base: String, token: String): Intent =
            Intent(c, ShipLocationService::class.java).putExtra(EXTRA_BASE, base).putExtra(EXTRA_FINGERPRINT, ReportRules.fingerprint(token))
    }
}
