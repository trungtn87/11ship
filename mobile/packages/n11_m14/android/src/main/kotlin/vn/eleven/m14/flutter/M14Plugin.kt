package vn.eleven.m14.flutter

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.*
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.*
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.*
import vn.eleven.m14.gps.RecorderService
import vn.eleven.m14.map.OfflineMap
import vn.eleven.m14.routing.*
import java.io.IOException
import java.util.concurrent.Executors

/** No history classes or database: official M14 retains one latest fix only. */
class M14Plugin: FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler,
    EventChannel.StreamHandler, PluginRegistry.RequestPermissionsResultListener {
    private lateinit var context: Context
    private lateinit var channel: MethodChannel
    private lateinit var events: EventChannel
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var activityBinding: ActivityPluginBinding? = null
    private var pendingStart: MethodChannel.Result? = null
    private var sink: EventChannel.EventSink? = null
    private var listening = false
    private var attached = false
    private val receiver = object: BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) { sink?.success(snapshot()) }
    }
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        attached = true
        channel = MethodChannel(binding.binaryMessenger,"vn.eleven/m14").also { it.setMethodCallHandler(this) }
        events = EventChannel(binding.binaryMessenger,"vn.eleven/m14/gps").also { it.setStreamHandler(this) }
    }
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        attached = false
        onCancel(null)
        channel.setMethodCallHandler(null); events.setStreamHandler(null)
        worker.shutdownNow()
        // User-started foreground collection stops only by explicit stop, notification or process death.
    }
    private fun snapshot(): Map<String, Any?> {
        val p = RecorderService.preferences(context)
        val elapsed = p.getLong("elapsed",0)
        val age = SystemClock.elapsedRealtime()-elapsed
        val wallAge = System.currentTimeMillis()-p.getLong("time",0)
        return mapOf("recording" to RecorderService.runningInProcess,
            "gpsEnabled" to context.getSystemService(LocationManager::class.java).isProviderEnabled(LocationManager.GPS_PROVIDER),
            "permissionGranted" to (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED),
            "lat" to p.getString("lat",null)?.toDoubleOrNull(), "lon" to p.getString("lon",null)?.toDoubleOrNull(),
            "accuracy" to if(p.contains("accuracy")) p.getFloat("accuracy",0f).toDouble() else null,
            "time" to if(p.contains("time")) p.getLong("time",0) else null,
            "fresh" to (elapsed>0 && age in 0..120_000 && wallAge in 0..120_000),
            "status" to if(RecorderService.runningInProcess) p.getString("status","") else "Đã dừng — không thu thập vị trí")
    }
    private fun async(result: MethodChannel.Result, task: () -> Any?) {
        worker.execute {
            try { val value=task(); main.post { if(attached) result.success(value) } }
            catch(e: Exception) { main.post { if(attached) result.error("M14",if(e is IOException) "Cần mạng để tính tuyến mới" else e.message,null) } }
        }
    }
    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when(call.method) {
            "status" -> result.success(snapshot())
            "mapPackage" -> async(result) { val map=OfflineMap(context); map.verify(); jsonMap(map.metadata) }
            "savedRoute" -> async(result) { RouteClient(context,"").saved()?.let { jsonMap(it.json()) } }
            "calculate" -> async(result) {
                val a=call.arguments as? Map<*,*> ?: error("Chưa đủ hai điểm")
                val origin=a["origin"] as? String ?: ""
                require(Regex("https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/?").matches(origin)) { "Dịch vụ tính tuyến chưa được cấu hình HTTPS" }
                fun coordinate(key: String)=(a[key] as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: error("Điểm không hợp lệ")
                val start=Endpoint(coordinate("startLat"),coordinate("startLon"))
                val end=Endpoint(coordinate("endLat"),coordinate("endLon"))
                val map=OfflineMap(context)
                require(map.contains(start.lat,start.lon) && map.contains(end.lat,end.lon)) { "Điểm nằm ngoài vùng dữ liệu Cao Bằng" }
                val network=context.getSystemService(ConnectivityManager::class.java)
                check(network.getNetworkCapabilities(network.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)==true) { "Cần mạng để tính tuyến mới" }
                jsonMap(RouteClient(context,origin).calculate(start,end).json())
            }
            "start" -> {
                if(call.argument<Boolean>("consent")!=true) { result.error("CONSENT","Cần đồng ý cập nhật vị trí trước khi bắt đầu",null); return }
                if(pendingStart!=null) { result.error("BUSY","Đang chờ cấp quyền vị trí",null); return }
                val activity=activityBinding?.activity
                if(activity==null || activity.isFinishing) { result.error("FOREGROUND","Mở ứng dụng để bắt đầu cập nhật vị trí",null); return }
                pendingStart=result
                val permissions=mutableListOf<String>()
                if(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) {
                    permissions.add(Manifest.permission.ACCESS_FINE_LOCATION); permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
                }
                if(Build.VERSION.SDK_INT>=33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
                if(permissions.isEmpty()) finishStart() else activity.requestPermissions(permissions.toTypedArray(),1414)
            }
            "stop" -> { context.stopService(Intent(context,RecorderService::class.java)); result.success(null) }
            else -> result.notImplemented()
        }
    }
    private fun finishStart() {
        val result=pendingStart?:return; pendingStart=null
        if(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) { result.error("PERMISSION","Quyền vị trí chính xác bị từ chối",null); return }
        if(!context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { result.error("NOTIFICATION","Bật thông báo để hiển thị trạng thái và nút dừng GPS",null); return }
        try { context.startForegroundService(Intent(context,RecorderService::class.java)); result.success(null) }
        catch(e: Exception) { result.error("START","Không thể bắt đầu GPS: ${e.message}",null) }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray): Boolean {
        if(requestCode!=1414) return false
        finishStart(); return true
    }
    override fun onListen(arguments: Any?, eventSink: EventChannel.EventSink) {
        sink=eventSink
        if(!listening) {
            if(Build.VERSION.SDK_INT>=33) context.registerReceiver(receiver,IntentFilter(RecorderService.ACTION),Context.RECEIVER_NOT_EXPORTED)
            else context.registerReceiver(receiver,IntentFilter(RecorderService.ACTION))
            listening=true
        }
        sink?.success(snapshot())
    }
    override fun onCancel(arguments: Any?) { if(listening) context.unregisterReceiver(receiver); listening=false; sink=null }
    override fun onAttachedToActivity(binding: ActivityPluginBinding) { activityBinding=binding; binding.addRequestPermissionsResultListener(this) }
    override fun onDetachedFromActivityForConfigChanges() = detachActivity()
    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) = onAttachedToActivity(binding)
    override fun onDetachedFromActivity() = detachActivity()
    private fun detachActivity() {
        activityBinding?.removeRequestPermissionsResultListener(this); activityBinding=null
        pendingStart?.error("FOREGROUND","Mở lại ứng dụng để bắt đầu cập nhật vị trí",null); pendingStart=null
    }
}

internal fun jsonMap(o: org.json.JSONObject): Map<String, Any?> = o.keys().asSequence().associateWith { key -> jsonValue(o.get(key)) }
private fun jsonValue(v: Any?): Any? = when(v) {
    org.json.JSONObject.NULL -> null
    is org.json.JSONObject -> jsonMap(v)
    is org.json.JSONArray -> (0 until v.length()).map { jsonValue(v.get(it)) }
    else -> v
}
