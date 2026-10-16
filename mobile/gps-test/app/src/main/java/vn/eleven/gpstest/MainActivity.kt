package vn.eleven.gpstest

import android.Manifest
import androidx.core.content.ContextCompat
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.graphics.*
import android.net.*
import android.location.LocationManager
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*
import org.maplibre.android.MapLibre
import org.maplibre.android.annotations.*
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.*
import vn.eleven.m14.gps.*
import vn.eleven.m14.history.*
import vn.eleven.m14.map.OfflineMap
import vn.eleven.m14.map.MapPin
import vn.eleven.m14.map.MapPinsView
import vn.eleven.m14.routing.*
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

class MainActivity: Activity() {
    private lateinit var mapView: MapView
    private var map: MapLibreMap?=null
    private lateinit var offline: OfflineMap
    private lateinit var history: HistoryStore
    private lateinit var client: RouteClient
    private lateinit var gpsText: TextView
    private lateinit var networkText: TextView
    private lateinit var result: TextView
    private lateinit var startButton: Button
    private lateinit var endButton: Button
    private lateinit var recording: Button
    private lateinit var calculate: Button
    private val ui=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor()
    private var start: Endpoint?=null
    private var end: Endpoint?=null
    private var route: Route?=null
    private var moving: Boolean?=null
    private lateinit var pinsView: MapPinsView
    private var renderedTime=-1L
    private var renderedFresh=false
    private var lastTrackRedraw=0L
    private var ready=false
    private var busy=false
    private var pendingStart=false
    private val date=SimpleDateFormat("dd/MM HH:mm:ss",Locale("vi","VN"))
    private val receiver=object: BroadcastReceiver() { override fun onReceive(c: Context?, i: Intent?) { refresh() } }
    private val tick=object: Runnable { override fun run() { refresh(); ui.postDelayed(this,5000) } }
    private fun dp(v: Int)=(resources.displayMetrics.density*v).toInt()
    private fun message(v: String) { Toast.makeText(this,v,Toast.LENGTH_LONG).show() }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text=label; textSize=12f; isAllCaps=false; minHeight=dp(38); minimumHeight=dp(38); setPadding(dp(6),0,dp(6),0); setOnClickListener { action() } }
    private fun text(size: Float=13f) = TextView(this).apply { textSize=size; setPadding(dp(8),dp(3),dp(8),dp(3)); setTextColor(Color.rgb(30,40,45)) }
    private fun LinearLayout.row(vararg views: View) { addView(LinearLayout(this@MainActivity).apply { orientation=LinearLayout.HORIZONTAL; views.forEach { addView(it,LinearLayout.LayoutParams(0,dp(44),1f)) } }) }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        MapLibre.getInstance(this)
        offline=OfflineMap(this); history=HistoryStore(this); client=RouteClient(this,BuildConfig.ROUTING_URL)
        CleanupJob.schedule(this)
        route=client.saved(); start=route?.start; end=route?.end
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
        root.fitsSystemWindows=true
        root.addView(text(18f).apply { text="11Ship GPS Test"; setBackgroundColor(Color.rgb(226,184,31)) })
        gpsText=text(); root.addView(gpsText)
        mapView=MapView(this); mapView.onCreate(state)
        val mapFrame=FrameLayout(this)
        mapFrame.addView(mapView,FrameLayout.LayoutParams(-1,-1))
        pinsView=MapPinsView(this) { map }
        mapFrame.addView(pinsView,FrameLayout.LayoutParams(-1,-1))
        root.addView(mapFrame,LinearLayout.LayoutParams(-1,0,1f))
        val controls=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(4),0,dp(4),0) }
        val scroll=ScrollView(this).apply { addView(controls) }
        root.addView(scroll,LinearLayout.LayoutParams(-1,dp(240)))
        startButton=button("") { editEndpoint(true) }; endButton=button("") { editEndpoint(false) }
        controls.row(startButton,endButton)
        controls.row(button("Đổi chiều") { val old=start; start=end; end=old; changed() }, button("Xóa điểm") { start=null; end=null; changed() },button("Về vị trí của tôi") { center() })
        calculate=button("Tính tuyến") { calculateRoute() }
        recording=button("Bắt đầu ghi") { if(RecorderService.active(this)) stopRecording() else explainStart() }
        controls.row(calculate,recording)
        result=text(); controls.addView(result)
        networkText=text(12f); controls.addView(networkText)
        controls.row(button("Lịch sử") { showHistory() },button("Gói bản đồ") { showPackage() })
        controls.addView(text(11f).apply { text="© OpenStreetMap contributors · ODbL 1.0"; setOnClickListener { showPackage() } })
        setContentView(root)
        result.text=route?.let { "Tuyến dự tính đã lưu: %.2f km · %s".format(it.km,date.format(Date(it.calculatedAt))) } ?: "Chọn hai điểm trên bản đồ để tính tuyến dự tính."
        updateEndpoints()
        mapView.getMapAsync { m ->
            map=m; m.uiSettings.isAttributionEnabled=false
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(22.665,106.257),12.0))
            worker.execute {
                try { offline.verify(); val labels=offline.labels(); runOnUiThread { if(!isDestroyed) { pinsView.labels=labels; m.setStyle(offline.style()) { ready=true; redraw() } } } }
                catch(e: Exception) { runOnUiThread { AlertDialog.Builder(this).setTitle("Gói bản đồ chưa sử dụng được").setMessage(e.message).setPositiveButton("Đóng",null).show() } }
            }
            m.addOnMapClickListener { p -> choosePoint(p); true }
            m.addOnMapLongClickListener { p -> choosePoint(p); true }
            m.addOnCameraMoveListener { pinsView.invalidate() }
            m.addOnCameraIdleListener { pinsView.invalidate(); refresh() }

        }
    }
    private fun choosePoint(p: LatLng) {
        if(!ready) return
        if(!offline.contains(p.latitude,p.longitude)) { message("Ngoài vùng bản đồ Cao Bằng đã đóng gói"); return }
        moving?.let { first ->
            val previous=if(first) start else end
            val next=Endpoint(p.latitude,p.longitude,previous?.name.orEmpty())
            if(first) start=next else end=next
            moving=null; changed(); return
        }
        AlertDialog.Builder(this).setTitle("Đặt ghim tại %.5f, %.5f".format(p.latitude,p.longitude)).setItems(arrayOf("Điểm đầu (A)","Điểm cuối (B)")) { _, i ->
            val e=Endpoint(p.latitude,p.longitude); if(i==0) start=e else end=e; changed()
        }.show()
    }
    private fun editEndpoint(first: Boolean) {
        val p=if(first) start else end
        AlertDialog.Builder(this).setTitle(if(first) "Điểm đầu (A)" else "Điểm cuối (B)").setItems(arrayOf("Dùng vị trí GPS hiện tại","Tên / ghi chú thủ công","Xóa điểm","Di chuyển ghim đến chỗ chạm tiếp theo")) { _,i ->
            when(i) {
                0 -> currentFresh()?.let { if(!offline.contains(it.lat,it.lon)) message("Vị trí nằm ngoài vùng bản đồ") else { if(first) start=it else end=it; changed() } }
                1 -> { if(p==null) message("Chọn điểm trên bản đồ trước") else {
                    val input=EditText(this).apply { setText(p.name); hint="Tên hoặc ghi chú" }
                    AlertDialog.Builder(this).setTitle("Ghi chú điểm").setView(input).setPositiveButton("Lưu") { _,_ -> if(first) start=p.copy(name=input.text.toString().take(160)) else end=p.copy(name=input.text.toString().take(160)); changed() }.setNegativeButton("Hủy",null).show()
                } }
                2 -> { if(first) start=null else end=null; changed() }
                3 -> { moving=first; message("Chạm bản đồ để di chuyển ghim ${if(first) "A" else "B"}") }
            }
        }.show()
    }
    private fun changed() { route=null; result.text="Điểm đã đổi — bấm Tính tuyến. Có thể mở tuyến cũ trong Lịch sử."; updateEndpoints(); redraw() }
    private fun updateEndpoints() {
        fun label(p: Endpoint?, name: String)=if(p==null) "$name: chạm bản đồ" else "$name: ${p.name.ifBlank { "%.5f, %.5f".format(p.lat,p.lon) }}"
        startButton.text=label(start,"A · Điểm đầu"); endButton.text=label(end,"B · Điểm cuối")
        calculate.isEnabled=!busy && start!=null && end!=null
    }
    private fun online(): Boolean { val n=getSystemService(ConnectivityManager::class.java); return n.getNetworkCapabilities(n.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)==true }
    private fun calculateRoute() {
        val a=start?:return; val b=end?:return
        if(!online()) { result.text="Cần mạng để tính tuyến mới"; return }
        busy=true; updateEndpoints(); result.text="Đang tính tuyến xe máy… Dịch vụ test có thể cần thời gian khởi động."
        worker.execute {
            try { val r=client.calculate(a,b); runOnUiThread { if(!isDestroyed) { if(start==a && end==b) { route=r; result.text="Tuyến dự tính: %.2f km".format(r.km); redraw() } else result.text="Đã lưu tuyến cho hai điểm cũ. Bấm Tính tuyến cho điểm mới." } } }
            catch(e: Exception) { runOnUiThread { if(!isDestroyed) result.text=if(!online()) "Cần mạng để tính tuyến mới" else (if(e is IllegalStateException || e is IllegalArgumentException) e.message?:"Không tính được tuyến" else "Không kết nối được dịch vụ tính tuyến. Hãy kiểm tra mạng hoặc thử lại.")+if(route!=null) " · Vẫn đang xem tuyến đã lưu" else "" } }
            finally { runOnUiThread { if(!isDestroyed) { busy=false; updateEndpoints() } } }
        }
    }
    private fun currentFresh(): Endpoint? {
        val p=RecorderService.preferences(this); val elapsed=p.getLong("elapsed",0); val age=SystemClock.elapsedRealtime()-elapsed
        if(!p.contains("lat") || elapsed==0L || age !in 0..120_000 || System.currentTimeMillis()-p.getLong("time",0) !in 0..120_000) { message("Chưa có vị trí GPS mới. Bấm Bắt đầu ghi và chờ tín hiệu."); return null }
        return Endpoint(p.getString("lat","0")!!.toDouble(),p.getString("lon","0")!!.toDouble(),"Vị trí của tôi")
    }
    private fun center() { currentFresh()?.let { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.lat,it.lon),15.0)) } }
    private fun explainStart() {
        AlertDialog.Builder(this).setTitle("Ghi GPS trên điện thoại").setMessage("Chỉ bắt đầu lấy vị trí khi bạn bấm Bắt đầu. App thử lấy GPS mỗi 60 giây, tiếp tục khi khóa màn hình và có thông báo Dừng. Lịch sử chỉ lưu tại máy, giữ 24 giờ. Cần quyền vị trí chính xác để lấy GPS khi không có mạng.")
            .setPositiveButton("Bắt đầu") { _,_ -> pendingStart=true; requestStart() }.setNegativeButton("Hủy",null).show()
    }
    private fun requestStart() {
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) { requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION),14); return }
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),15); return }
        beginRecording()
    }
    private fun beginRecording() {
        if(!pendingStart) return
        pendingStart=false
        try { startForegroundService(Intent(this,TestRecorderService::class.java)); ui.postDelayed({ refresh() },500) }
        catch(_: Exception) { message("Chưa thể bắt đầu ghi. Hãy mở app và thử lại.") }
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, grants: IntArray) {
        super.onRequestPermissionsResult(code,permissions,grants)
        if(code==14) {
            if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) requestStart()
            else { pendingStart=false; gpsText.text="Quyền vị trí chính xác bị từ chối — chưa thu thập GPS"; AlertDialog.Builder(this).setMessage("Để test GPS offline, hãy cho phép vị trí chính xác trong Cài đặt. Bản đồ và lịch sử đã lưu vẫn dùng được.").setPositiveButton("Cài đặt") { _,_ -> startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName"))) }.setNegativeButton("Đóng",null).show() }
        } else if(code==15) {
            if(Build.VERSION.SDK_INT<33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED) beginRecording()
            else { pendingStart=false; message("Chưa bắt đầu ghi: cần cho phép thông báo để có nút Dừng khi khóa màn hình.") }
        }
    }
    private fun stopRecording() { startService(Intent(this,TestRecorderService::class.java).setAction(RecorderService.STOP)); ui.postDelayed({ refresh() },300) }
    private fun refresh() {
        if(!::gpsText.isInitialized) return
        val p=RecorderService.preferences(this); val active=RecorderService.active(this)
        val age=SystemClock.elapsedRealtime()-p.getLong("elapsed",0)
        val fresh=age in 0..120_000 && System.currentTimeMillis()-p.getLong("time",0) in 0..120_000
        val details=if(p.contains("lat")) "\nVĩ độ ${p.getString("lat","")} · Kinh độ ${p.getString("lon","")} · ±${p.getFloat("accuracy",0f).toInt()} m · ${date.format(Date(p.getLong("time",0)))} · ${if(fresh) "vị trí mới" else "vị trí cũ"}" else "\nChưa lấy được vị trí"
        val denied=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED
        gpsText.text=(if(denied) "Chưa cấp quyền GPS chính xác" else if(!getSystemService(LocationManager::class.java).isProviderEnabled(LocationManager.GPS_PROVIDER)) "GPS đang tắt" else p.getString("status","Chưa bắt đầu ghi GPS"))+details
        recording.text=if(active) "Dừng ghi" else "Bắt đầu ghi"
        val center=map?.cameraPosition?.target
        val outside=try { (center!=null && !offline.contains(center.latitude,center.longitude)) || (p.contains("lat") && !offline.contains(p.getString("lat","0")!!.toDouble(),p.getString("lon","0")!!.toDouble())) } catch(_:Exception) { false }
        networkText.text=(if(online()) "Có mạng · Bản đồ và GPS dùng dữ liệu cục bộ" else "Cần mạng để tính tuyến mới")+(if(outside) "\nNgoài vùng bản đồ đã đóng gói" else "")
        val time=p.getLong("time",0)
        if(time!=renderedTime || fresh!=renderedFresh || SystemClock.elapsedRealtime()-lastTrackRedraw>=60_000) { renderedTime=time; renderedFresh=fresh; redraw() }
    }
    private fun redraw() {
        val m=map?:return; if(!ready) return
        lastTrackRedraw=SystemClock.elapsedRealtime()
        m.clear()
        val points=history.points()
        points.groupBy { it.segment }.values.forEach { group -> if(group.size>1) m.addPolyline(PolylineOptions().addAll(group.map { LatLng(it.lat,it.lon) }).color(Color.rgb(20,150,85)).width(4f)) }
        route?.let { r -> m.addPolyline(PolylineOptions().addAll(r.coordinates.map { LatLng(it.first,it.second) }).color(Color.rgb(40,95,225)).width(5f)) }
        val pins=mutableListOf<MapPin>()
        start?.let { pins.add(MapPin(it.lat,it.lon,"A",Color.rgb(20,140,70))) }
        end?.let { pins.add(MapPin(it.lat,it.lon,"B",Color.rgb(220,70,35))) }
        val p=RecorderService.preferences(this)
        if(p.contains("lat")) {
            val age=SystemClock.elapsedRealtime()-p.getLong("elapsed",0)
            pins.add(MapPin(p.getString("lat","0")!!.toDouble(),p.getString("lon","0")!!.toDouble(),"GPS",if(age in 0..120_000 && System.currentTimeMillis()-p.getLong("time",0) in 0..120_000) Color.BLUE else Color.GRAY))
        }
        pinsView.pins=pins

    }
    private fun showHistory() {
        val points=history.points(); var meters=0.0
        points.zipWithNext().forEach { (a,b) -> if(a.segment==b.segment) meters+=TrackRules.distance(a,b) }
        val enabled=RecorderService.preferences(this).getBoolean("historyEnabled",true)
        AlertDialog.Builder(this).setTitle("Lịch sử 24 giờ · ${points.size} điểm").setMessage("Đã di chuyển theo các điểm GPS hợp lệ: %.2f km\nĐường xanh lá: lịch sử. Đường xanh dương: tuyến dự tính.\nKhông upload lịch sử. Sai số GPS có thể ảnh hưởng quãng đường.".format(meters/1000))
            .setPositiveButton("Tùy chọn") { _,_ -> AlertDialog.Builder(this).setItems(arrayOf("Xem thời điểm các điểm ghi","Xuất GPX","Xóa toàn bộ lịch sử",if(enabled) "Tắt hoàn toàn lưu lịch sử" else "Bật lưu lịch sử","Xem tuyến đã lưu")) { _,i -> when(i) {
                0 -> AlertDialog.Builder(this).setTitle("Điểm ghi mới nhất").setItems(points.asReversed().map { "${date.format(Date(it.time))} · %.5f, %.5f · ±%.0f m".format(it.lat,it.lon,it.accuracy) }.toTypedArray()) { _,n -> points.asReversed()[n].let { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.lat,it.lon),16.0)) } }.setNegativeButton("Đóng",null).show()
                1 -> startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/gpx+xml").putExtra(Intent.EXTRA_TITLE,"11Ship-GPS-${System.currentTimeMillis()}.gpx").addCategory(Intent.CATEGORY_OPENABLE),16)
                2 -> AlertDialog.Builder(this).setMessage("Xóa toàn bộ lịch sử trên máy?").setPositiveButton("Xóa") { _,_ -> history.clear(); redraw() }.setNegativeButton("Hủy",null).show()
                3 -> { RecorderService.preferences(this).edit().putBoolean("historyEnabled",!enabled).apply(); if(enabled) { history.clear(); redraw() }; message(if(enabled) "Đã tắt và xóa lịch sử; chỉ giữ vị trí mới nhất" else "Đã bật lưu lịch sử") }
                4 -> { route=client.saved(); route?.let { start=it.start; end=it.end; result.text="Tuyến dự tính đã lưu: %.2f km · %s".format(it.km,date.format(Date(it.calculatedAt))); updateEndpoints(); redraw() } ?: message("Chưa có tuyến đã lưu") }
            } }.show() }.setNegativeButton("Đóng",null).show()
    }
    private fun showPackage() {
        try {
            val m=offline.metadata
            AlertDialog.Builder(this).setTitle("Bản đồ offline Cao Bằng").setMessage("Phiên bản: ${m.getString("version")}\nDữ liệu: ${m.getString("source_date")}\nVùng phủ [tây, nam, đông, bắc]: ${m.getJSONArray("bounds")}\nTP Cao Bằng và vùng lân cận, đệm ít nhất 10 km quanh bán kính phục vụ test 10 km.\nGói đi kèm APK, không cần tải thêm. Cập nhật bằng APK mới.\n\n© OpenStreetMap contributors\nNguồn: Geofabrik Vietnam, ODbL 1.0\nhttps://www.openstreetmap.org/copyright\nDữ liệu dẫn xuất và giấy phép có trong gói bàn giao. Font Noto Sans: SIL OFL 1.1.")
                .setPositiveButton("Về vùng phủ") { _,_ -> map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(22.665,106.257),12.0)) }.setNegativeButton("Đóng",null).show()
        } catch(_: Exception) { message("Chưa có gói bản đồ hợp lệ") }
    }
    @Deprecated("Android callback") override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode==16 && resultCode==RESULT_OK) data?.data?.let { uri -> try { contentResolver.openOutputStream(uri)?.let { history.export(it) }; message("Đã xuất GPX") } catch(_:Exception) { message("Không thể xuất GPX") } }
    }
    override fun onStart() { super.onStart(); mapView.onStart(); ContextCompat.registerReceiver(this,receiver,IntentFilter(RecorderService.ACTION),ContextCompat.RECEIVER_NOT_EXPORTED); tick.run() }
    override fun onResume() { super.onResume(); mapView.onResume(); if(::history.isInitialized) history.prune() }
    override fun onPause() { mapView.onPause(); super.onPause() }
    override fun onStop() { ui.removeCallbacks(tick); unregisterReceiver(receiver); mapView.onStop(); super.onStop() }
    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); mapView.onSaveInstanceState(out) }
    override fun onLowMemory() { super.onLowMemory(); mapView.onLowMemory() }
    override fun onDestroy() { mapView.onDestroy(); worker.shutdown(); history.close(); super.onDestroy() }
}
