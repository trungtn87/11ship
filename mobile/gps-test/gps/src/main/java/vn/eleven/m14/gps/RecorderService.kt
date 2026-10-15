package vn.eleven.m14.gps

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.*
import android.os.*
import vn.eleven.m14.history.HistoryStore

/** No boot receiver, uploads, or location access until an explicit foreground start. */
class RecorderService: Service() {
    companion object {
        const val ACTION = "vn.eleven.m14.GPS_STATE"
        const val STOP = "vn.eleven.m14.STOP"
        const val CHANNEL = "m14-recording"
        fun preferences(c: Context) = c.getSharedPreferences("m14-gps", Context.MODE_PRIVATE)
        fun active(c: Context): Boolean = preferences(c).getBoolean("recording", false)
    }
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var manager: LocationManager
    private lateinit var history: HistoryStore
    private var listener: LocationListener? = null
    private var wake: PowerManager.WakeLock? = null
    private var first = true
    private var running = false
    private var lastAcceptedElapsed = 0L
    private val cycle = object: Runnable {
        override fun run() { if(running) { acquire(); handler.postDelayed(this, 60_000) } }
    }
    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(LocationManager::class.java)
        history = HistoryStore(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"Đang ghi GPS",NotificationManager.IMPORTANCE_LOW))
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if(intent?.action == STOP) { shutdown(); return START_NOT_STICKY }
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { state("Chưa được cấp quyền vị trí chính xác"); stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this,1,Intent(this,RecorderService::class.java).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this,2,it,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val notification = Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("11Ship GPS Test đang ghi vị trí").setContentText("Chu kỳ mục tiêu 60 giây · chỉ lưu trên điện thoại")
            .setOngoing(true).setContentIntent(open).addAction(Notification.Action.Builder(null,"Dừng ghi",stop).build()).build()
        if(Build.VERSION.SDK_INT >= 29) startForeground(14,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(14,notification)
        if(!running) {
            running=true
            preferences(this).edit().putBoolean("recording",true).apply()
            // Keeps the target timer running with the screen locked; GPS uses a bounded initial cold-fix window, then at most 25s/min.
            wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"11Ship:GPSRecording").also { it.acquire() }
            cycle.run()
        }
        return START_NOT_STICKY
    }
    private fun acquire() {
        if(listener != null) return // Let the first offline cold fix acquire satellite ephemeris.
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) { state("Quyền vị trí đã bị thu hồi"); shutdown(); return }
        if(!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) { state("GPS đang tắt — bật Vị trí trên điện thoại"); return }
        state("Đang chờ vị trí GPS mới…")
        val requestedAt=SystemClock.elapsedRealtimeNanos()
        val current = object: LocationListener {
            override fun onLocationChanged(location: Location) {
                if(!running || listener !== this) return
                val age = (SystemClock.elapsedRealtimeNanos()-location.elapsedRealtimeNanos)/1_000_000
                if(location.isFromMockProvider) { state("Vị trí giả bị từ chối"); return }
                if(location.elapsedRealtimeNanos < requestedAt || age !in 0..25_000 || !location.hasAccuracy() || location.elapsedRealtimeNanos<=lastAcceptedElapsed) return
                if(!location.latitude.isFinite() || !location.longitude.isFinite()) return
                lastAcceptedElapsed=location.elapsedRealtimeNanos
                if(preferences(this@RecorderService).getBoolean("historyEnabled",true)) { history.append(location,first); first=false }
                preferences(this@RecorderService).edit().putString("lat",location.latitude.toString()).putString("lon",location.longitude.toString())
                    .putFloat("accuracy",location.accuracy).putLong("time",location.time).putLong("elapsed",location.elapsedRealtimeNanos/1_000_000).apply()
                state("Đã lấy vị trí mới")
                cancelFix()
            }
            override fun onProviderDisabled(provider: String) { state("GPS đang tắt") }
            override fun onProviderEnabled(provider: String) {}
            @Deprecated("Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        listener=current
        try { manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,0L,0f,current,Looper.getMainLooper()) }
        catch(_: SecurityException) { state("Quyền vị trí đã bị từ chối"); shutdown(); return }
        handler.postDelayed({ if(listener === current) { cancelFix(); state("Chưa lấy được GPS mới — đang giữ vị trí cũ nếu có") } },if(lastAcceptedElapsed==0L) 120_000 else 25_000)
    }
    private fun cancelFix() { listener?.let { manager.removeUpdates(it) }; listener=null }
    private fun state(message: String) {
        preferences(this).edit().putString("status",message).apply()
        sendBroadcast(Intent(ACTION).setPackage(packageName))
    }
    private fun shutdown() {
        running=false; handler.removeCallbacksAndMessages(null); cancelFix()
        preferences(this).edit().putBoolean("recording",false).apply()
        wake?.let { if(it.isHeld) it.release() }; wake=null
        state("Đã dừng ghi — không tiếp tục thu thập vị trí")
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() { shutdown(); history.close(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
