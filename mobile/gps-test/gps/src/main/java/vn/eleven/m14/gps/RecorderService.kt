package vn.eleven.m14.gps

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.*
import android.os.*

/** No boot receiver, uploads, or location access until an explicit foreground start. */
open class RecorderService: Service() {
    companion object {
        @Volatile var runningInProcess = false
            private set
        const val ACTION = "vn.eleven.m14.GPS_STATE"
        const val STOP = "vn.eleven.m14.STOP"
        const val CHANNEL = "m14-recording"
        fun preferences(c: Context) = c.getSharedPreferences("m14-gps", Context.MODE_PRIVATE)
        fun active(c: Context): Boolean = preferences(c).getBoolean("recording", false)
    }
    protected open val notificationTitle = "11Ship đang cập nhật vị trí"
    protected open val notificationText = "Chu kỳ mục tiêu 60 giây · chỉ giữ vị trí mới nhất"
    /** Optional test-only sink; production core has no database or history dependency. */
    protected open fun onAcceptedLocation(location: Location) {}
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var manager: LocationManager
    private var request: FreshLocationRequest? = null
    private var wake: PowerManager.WakeLock? = null
    private var coldAttempt = true
    private var running = false
    private var lastAcceptedElapsed = 0L
    private val cycle = object: Runnable {
        override fun run() { if(running) { acquire(); handler.postDelayed(this, 60_000) } }
    }
    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(LocationManager::class.java)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"Đang ghi GPS",NotificationManager.IMPORTANCE_LOW))
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if(intent?.action == STOP) { shutdown(); return START_NOT_STICKY }
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { state("Chưa được cấp quyền vị trí chính xác"); stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this,1,Intent(this,javaClass).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this,2,it,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val notification = Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(notificationTitle).setContentText(notificationText)
            .setOngoing(true).setContentIntent(open).addAction(Notification.Action.Builder(null,"Dừng ghi",stop).build()).build()
        if(Build.VERSION.SDK_INT >= 29) startForeground(14,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(14,notification)
        if(!running) {
            running=true; runningInProcess=true
            preferences(this).edit().putBoolean("recording",true).apply()
            // Keeps the target timer running with the screen locked; GPS uses a bounded initial cold-fix window, then at most 25s/min. GPS and network are both requested.
            wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"11Ship:GPSRecording").also { it.acquire() }
            cycle.run()
        }
        return START_NOT_STICKY
    }
    private fun acquire() {
        if(request != null) return
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) { state("Quyền vị trí đã bị thu hồi"); shutdown(); return }
        state("Đang lấy vị trí qua GPS và mạng…")
        val fixTimeout=if(coldAttempt) 120_000L else 25_000L
        coldAttempt=false
        val current = FreshLocationRequest(manager, handler, true)
        request = current
        current.start(timeoutMillis = fixTimeout, onFix = { location ->
            if(running && request === current) {
                request = null
                if(location.elapsedRealtimeNanos > lastAcceptedElapsed) {
                    lastAcceptedElapsed=location.elapsedRealtimeNanos
                    onAcceptedLocation(location)
                    preferences(this).edit().putString("lat",location.latitude.toString()).putString("lon",location.longitude.toString())
                        .putFloat("accuracy",location.accuracy).putLong("time",location.time).putLong("elapsed",location.elapsedRealtimeNanos/1_000_000).apply()
                    state("Đã lấy vị trí mới · sai số khoảng ${location.accuracy.toInt()} m")
                }
            }
        }, onFailure = { code ->
            if(running && request === current) {
                request = null
                when(code) {
                    "DENIED" -> shutdown("Quyền vị trí đã bị thu hồi — hãy cấp lại quyền để tiếp tục")
                    "DISABLED" -> state("Định vị đang tắt — bật Vị trí trên điện thoại")
                    "TIMEOUT" -> state("Hết thời gian chờ vị trí mới — sẽ thử lại ở chu kỳ tiếp theo")
                    else -> state("Chưa lấy được vị trí từ GPS và mạng — sẽ thử lại")
                }
            }
        })
    }
    private fun cancelFix() { request?.cancel(); request=null }
    private fun state(message: String) {
        preferences(this).edit().putString("status",message).apply()
        sendBroadcast(Intent(ACTION).setPackage(packageName))
    }
    private fun shutdown(reason: String = "Đã dừng ghi — không tiếp tục thu thập vị trí") {
        running=false; runningInProcess=false; handler.removeCallbacksAndMessages(null); cancelFix()
        preferences(this).edit().putBoolean("recording",false).apply()
        wake?.let { if(it.isHeld) it.release() }; wake=null
        state(reason)
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() { if(running) shutdown(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
