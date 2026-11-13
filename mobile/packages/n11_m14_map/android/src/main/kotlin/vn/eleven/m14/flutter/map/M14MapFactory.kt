package vn.eleven.m14.flutter.map

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Color
import android.os.*
import android.view.Gravity
import android.view.View
import android.widget.*
import io.flutter.plugin.common.*
import io.flutter.plugin.platform.*
import org.maplibre.android.MapLibre
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.annotations.PolygonOptions
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.*
import vn.eleven.m14.map.*
import java.util.concurrent.Executors

/** One loader thread for every map view: a view created again must not start another 8 MB parse beside the running one (#299). */
private val mapLoader=Executors.newSingleThreadExecutor { r -> Thread(r,"m14-map-load").apply { isDaemon=true } }

class M14MapFactory(private val messenger: BinaryMessenger): PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView = M14MapView(context,viewId,messenger,args as? Map<*,*>)
}
private class M14MapView(context: Context, id: Int, messenger: BinaryMessenger, initial: Map<*,*>?): PlatformView, Application.ActivityLifecycleCallbacks {
    private val frame=FrameLayout(context).apply {
        importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription="Đang mở bản đồ offline Cao Bằng"
    }
    private val channel=MethodChannel(messenger,"vn.eleven/m14/map/$id")
    private val offline=OfflineMap(context)
    private val coverage=TextView(context).apply { text="Ngoài vùng bản đồ Cao Bằng"; setTextColor(Color.BLACK); setBackgroundColor(0xFFFFE0B2.toInt()); setPadding(12,8,12,8); visibility=View.GONE }
    private val view: MapView
    private val pins: MapPinsView
    private var map: MapLibreMap?=null
    private var data=initial
    private var focusedPoint: Pair<Double, Double>?=null
    private var ready=false
    private var loadError: String?=null
    private var centerRequest=0
    private var initialCameraApplied=false
    /** True once the person panned/pinched; a GPS update then redraws the area but never moves the camera under their fingers. */
    private var userMoved=false
    private var disposed=false
    private var resumed=false
    private var started=false
    private val main=Handler(Looper.getMainLooper())
    private val host: Activity? = generateSequence(context) { (it as? ContextWrapper)?.baseContext?.takeIf { b -> b!==it } }.filterIsInstance<Activity>().firstOrNull()
    init {
        MapLibre.getInstance(context)
        view=MapView(context,MapLibreMapOptions.createFromAttributes(context).textureMode(true)); view.onCreate(null)
        pins=MapPinsView(context) { map }
        frame.addView(view,FrameLayout.LayoutParams(-1,-1)); frame.addView(pins,FrameLayout.LayoutParams(-1,-1))
        val attribution=TextView(context).apply { text="© OpenStreetMap contributors · ODbL 1.0"; textSize=10f; setTextColor(Color.DKGRAY); setBackgroundColor(0xDDFFFFFF.toInt()); setPadding(8,3,8,3) }
        frame.addView(attribution,FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM or Gravity.END))
        frame.addView(coverage,FrameLayout.LayoutParams(-2,-2,Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        channel.setMethodCallHandler { call,result ->
            when(call.method) {
                "update" -> { data=call.arguments as? Map<*,*>; draw(); result.success(null) }
                "state" -> result.success(mapOf("ready" to ready, "error" to loadError))
                else -> result.notImplemented()
            }
        }
        view.addOnDidFinishRenderingMapListener { fully ->
            if(fully && ready && !disposed) frame.contentDescription="Bản đồ offline Cao Bằng đã hiển thị"
        }
        view.addOnDidFailLoadingMapListener { fail("Không tải được bản đồ Cao Bằng. Thử lại hoặc cập nhật ứng dụng.") }
        host?.application?.registerActivityLifecycleCallbacks(this)
        start(); resume()
        mapLoader.execute {
            if(disposed) return@execute
            try {
                offline.verify(); val labels=offline.labels(); val style=offline.style()
                main.post {
                    if(!disposed) view.getMapAsync { current ->
                        if(!disposed) {
                            map=current; pins.labels=labels
                            current.uiSettings.isAttributionEnabled=false
                            current.uiSettings.isLogoEnabled=false
                            current.setStyle(style) { if(!disposed) {
                                ready=true
                                // Style readiness is the product's real ready signal (the same
                                // event sent to Flutter). A headless emulator may never emit a
                                // separate fully-rendered frame callback, so accessibility must
                                // not stay stuck at "Đang mở" after a usable offline map exists.
                                frame.contentDescription="Bản đồ offline Cao Bằng đã hiển thị"
                                draw()
                                channel.invokeMethod("ready",null)
                            } }
                            // Regional fallback only. The first valid point/route later replaces it with a viewport-based fit.
                            current.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(22.665,106.257),12.0))
                            current.addOnCameraMoveListener { pins.invalidate() }
                            current.addOnCameraMoveStartedListener { reason -> if(reason==MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) userMoved=true }
                            current.addOnCameraIdleListener {
                                val center=current.cameraPosition.target
                                coverage.visibility=if(center!=null && !offline.contains(center.latitude,center.longitude)) View.VISIBLE else View.GONE
                            }
                            fun selected(point: LatLng): Boolean {
                                if(data?.get("select_points")!=true) return false
                                channel.invokeMethod("point",mapOf("lat" to point.latitude,"lon" to point.longitude,"inside" to offline.contains(point.latitude,point.longitude))); return true
                            }
                            current.addOnMapClickListener { selected(it) }
                            current.addOnMapLongClickListener { selected(it) }
                        }
                    }
                }
            } catch(e: Exception) { main.post { fail("Không mở được gói bản đồ Cao Bằng. Thử lại hoặc cập nhật ứng dụng có bản đồ offline.") } }
        }
    }
    private fun fail(message: String) {
        if(disposed) return
        ready=false; loadError=message
        frame.contentDescription=message
        channel.invokeMethod("error", message)
    }
    private fun draw() {
        val current=map?:return
        pins.pins=(data?.get("pins") as? List<*>)?.mapNotNull { item ->
            val p=item as? Map<*,*> ?: return@mapNotNull null
            val lat=(p["lat"] as? Number)?.toDouble()?:return@mapNotNull null
            val lon=(p["lon"] as? Number)?.toDouble()?:return@mapNotNull null
            if(!lat.isFinite() || !lon.isFinite()) return@mapNotNull null
            MapPin(lat,lon,p["label"] as? String?:"",(p["color"] as? Number)?.toInt()?:Color.BLUE)
        }?:emptyList()
        val coords=(data?.get("route") as? List<*>)?.mapNotNull { item ->
            val p=item as? List<*>?:return@mapNotNull null
            val lat=(p.getOrNull(0) as? Number)?.toDouble()?:return@mapNotNull null
            val lon=(p.getOrNull(1) as? Number)?.toDouble()?:return@mapNotNull null
            if(lat.isFinite() && lon.isFinite()) LatLng(lat,lon) else null
        }?:emptyList()
        val circle=radiusCircle()
        if(!initialCameraApplied) {
            val important=pins.pins.map { LatLng(it.latitude,it.longitude) } + coords
            if(important.isNotEmpty()) {
                // A person who already panned/pinched before the first fix keeps their view; the fit is only for a map nobody has touched.
                if(!userMoved) fitImportant(current, important, circle?.radiusM ?: DEFAULT_FIT_RADIUS_M)
                initialCameraApplied=true
            }
        }
        if(data?.get("focus_pin")==true) pins.pins.firstOrNull()?.let { pin ->
            val point=Pair(pin.latitude,pin.longitude)
            if(focusedPoint!=point) {
                val first=focusedPoint==null
                focusedPoint=point
                if(first && !initialCameraApplied) fitRadius(current, LatLng(pin.latitude,pin.longitude), circle?.radiusM ?: DEFAULT_FIT_RADIUS_M)
                else current.moveCamera(CameraUpdateFactory.newLatLng(LatLng(pin.latitude,pin.longitude)))
            }
        }
        val requested=(data?.get("center_request") as? Number)?.toInt()?:0
        if(requested!=centerRequest) {
            centerRequest=requested
            // The explicit "back to my position" button: fit the whole area again, wherever the person had panned to.
            val centre=circle?.let { LatLng(it.lat,it.lon) } ?: pins.pins.firstOrNull()?.let { LatLng(it.latitude,it.longitude) }
            if(centre!=null) { fitRadius(current, centre, circle?.radiusM ?: DEFAULT_FIT_RADIUS_M); userMoved=false }
        }
        current.clear()
        if(coords.size>1) current.addPolyline(PolylineOptions().addAll(coords).color(Color.rgb(25,110,230)).width(5f))
        if(circle!=null) drawRadius(current, circle)
    }
    /** The receiving area, only when its centre is a usable position (never (0,0), NaN or out of range) and the radius is positive. */
    private fun radiusCircle(): RadiusCircle? {
        val c=data?.get("radius_circle") as? Map<*,*> ?: return null
        val lat=(c["lat"] as? Number)?.toDouble(); val lon=(c["lon"] as? Number)?.toDouble(); val radius=(c["radius_m"] as? Number)?.toDouble()
        if(!RadiusGeometry.isUsableCentre(lat,lon) || radius==null || !radius.isFinite() || radius<=0.0) return null
        return RadiusCircle(lat!!,lon!!,radius,
            (c["color"] as? Number)?.toInt()?:Color.BLUE,
            (c["fill_color"] as? Number)?.toInt(),
            (c["outside_color"] as? Number)?.toInt())
    }
    /**
     * Inside: the original map colours (no tint unless a fill is asked for). Outside: a neutral translucent grey, drawn as a polygon with a hole so the
     * map stays fully pannable and its names/roads stay readable. The boundary is its own polyline so it can be thick and clear.
     */
    private fun drawRadius(current: MapLibreMap, c: RadiusCircle) {
        val ring=RadiusGeometry.ring(c.lat,c.lon,c.radiusM).map { LatLng(it[0],it[1]) }
        if(c.outsideColor!=null) current.addPolygon(PolygonOptions()
            .addAll(RadiusGeometry.worldRing.map { LatLng(it[0],it[1]) })
            .addHole(ring)
            .fillColor(c.outsideColor).strokeColor(Color.TRANSPARENT))
        if(c.fillColor!=null) current.addPolygon(PolygonOptions().addAll(ring).fillColor(c.fillColor).strokeColor(Color.TRANSPARENT))
        current.addPolyline(PolylineOptions().addAll(ring).color(c.color).width(3.5f))
    }
    private class RadiusCircle(val lat: Double, val lon: Double, val radiusM: Double, val color: Int, val fillColor: Int?, val outsideColor: Int?)
    private fun fitImportant(current: MapLibreMap, points: List<LatLng>, radiusM: Double) {
        val first=points.first()
        if(points.size==1 || points.all { it.latitude==first.latitude && it.longitude==first.longitude }) {
            fitRadius(current,first,radiusM); return
        }
        val bounds=LatLngBounds.Builder().includes(points).build()
        current.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds,64))
    }
    /** Fit the whole circle of [radiusM] (default 5 km for the address picker) plus [FIT_PADDING_DP] on every side, independent of screen density/aspect ratio. */
    private fun fitRadius(current: MapLibreMap, center: LatLng, radiusM: Double) {
        val b=RadiusGeometry.bounds(center.latitude,center.longitude,radiusM)
        val bounds=LatLngBounds.Builder().include(LatLng(b[0],b[1])).include(LatLng(b[2],b[3])).build()
        val pad=(FIT_PADDING_DP*frame.resources.displayMetrics.density).toInt()
        current.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds,pad,pad,pad,pad))
    }
    private companion object {
        const val DEFAULT_FIT_RADIUS_M=5000.0
        const val FIT_PADDING_DP=24f
    }
    override fun getView(): View=frame
    private fun start() { if(!started && !disposed) { view.onStart(); started=true } }
    private fun resume() { if(!resumed && !disposed) { view.onResume(); resumed=true } }
    private fun pause() { if(resumed) { view.onPause(); resumed=false } }
    private fun stop() { pause(); if(started) { view.onStop(); started=false } }
    override fun dispose() { if(disposed)return; stop(); disposed=true; channel.setMethodCallHandler(null); host?.application?.unregisterActivityLifecycleCallbacks(this); view.onDestroy() }
    override fun onActivityStarted(a: Activity) { if(a===host) start() }
    override fun onActivityResumed(a: Activity) { if(a===host) resume() }
    override fun onActivityPaused(a: Activity) { if(a===host) pause() }
    override fun onActivityStopped(a: Activity) { if(a===host) stop() }
    override fun onActivityDestroyed(a: Activity) { if(a===host) dispose() }
    override fun onActivityCreated(a: Activity,b: Bundle?) {}
    override fun onActivitySaveInstanceState(a: Activity,b: Bundle) { if(a===host) view.onSaveInstanceState(b) }
}
