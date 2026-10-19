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
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.*
import vn.eleven.m14.map.*
import java.util.concurrent.Executors

class M14MapFactory(private val messenger: BinaryMessenger): PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView = M14MapView(context,viewId,messenger,args as? Map<*,*>)
}
private class M14MapView(context: Context, id: Int, messenger: BinaryMessenger, initial: Map<*,*>?): PlatformView, Application.ActivityLifecycleCallbacks {
    private val frame=FrameLayout(context)
    private val channel=MethodChannel(messenger,"vn.eleven/m14/map/$id")
    private val offline=OfflineMap(context)
    private val coverage=TextView(context).apply { text="Ngoài vùng bản đồ Cao Bằng"; setTextColor(Color.BLACK); setBackgroundColor(0xFFFFE0B2.toInt()); setPadding(12,8,12,8); visibility=View.GONE }
    private val view: MapView
    private val pins: MapPinsView
    private var map: MapLibreMap?=null
    private var data=initial
    private var disposed=false
    private var resumed=false
    private var started=false
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor()
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
            if(call.method=="update") { data=call.arguments as? Map<*,*>; draw(); result.success(null) } else result.notImplemented()
        }
        host?.application?.registerActivityLifecycleCallbacks(this)
        start(); resume()
        worker.execute {
            try {
                offline.verify(); val labels=offline.labels()
                main.post {
                    if(!disposed) view.getMapAsync { current ->
                        if(!disposed) {
                            map=current; pins.labels=labels
                            current.uiSettings.isAttributionEnabled=false
                            current.uiSettings.isLogoEnabled=false
                            current.setStyle(offline.style()) { if(!disposed) { draw(); channel.invokeMethod("ready",null) } }
                            current.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(22.665,106.257),12.0))
                            current.addOnCameraMoveListener { pins.invalidate() }
                            current.addOnCameraIdleListener {
                                val center=current.cameraPosition.target
                                coverage.visibility=if(center!=null && !offline.contains(center.latitude,center.longitude)) View.VISIBLE else View.GONE
                            }
                            fun selected(point: LatLng): Boolean {
                                channel.invokeMethod("point",mapOf("lat" to point.latitude,"lon" to point.longitude,"inside" to offline.contains(point.latitude,point.longitude))); return true
                            }
                            current.addOnMapClickListener { selected(it) }
                            current.addOnMapLongClickListener { selected(it) }
                        }
                    }
                }
            } catch(e: Exception) { main.post { if(!disposed) { channel.invokeMethod("error","Không mở được gói bản đồ Cao Bằng"); frame.addView(TextView(context).apply { text="Không mở được gói bản đồ Cao Bằng"; setBackgroundColor(Color.WHITE) }) } } }
        }
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
        current.clear()
        val coords=(data?.get("route") as? List<*>)?.mapNotNull { item ->
            val p=item as? List<*>?:return@mapNotNull null
            val lat=(p.getOrNull(0) as? Number)?.toDouble()?:return@mapNotNull null
            val lon=(p.getOrNull(1) as? Number)?.toDouble()?:return@mapNotNull null
            if(lat.isFinite() && lon.isFinite()) LatLng(lat,lon) else null
        }?:emptyList()
        if(coords.size>1) current.addPolyline(PolylineOptions().addAll(coords).color(Color.rgb(25,110,230)).width(5f))
    }
    override fun getView(): View=frame
    private fun start() { if(!started && !disposed) { view.onStart(); started=true } }
    private fun resume() { if(!resumed && !disposed) { view.onResume(); resumed=true } }
    private fun pause() { if(resumed) { view.onPause(); resumed=false } }
    private fun stop() { pause(); if(started) { view.onStop(); started=false } }
    override fun dispose() { if(disposed)return; stop(); disposed=true; channel.setMethodCallHandler(null); worker.shutdownNow(); host?.application?.unregisterActivityLifecycleCallbacks(this); view.onDestroy() }
    override fun onActivityStarted(a: Activity) { if(a===host) start() }
    override fun onActivityResumed(a: Activity) { if(a===host) resume() }
    override fun onActivityPaused(a: Activity) { if(a===host) pause() }
    override fun onActivityStopped(a: Activity) { if(a===host) stop() }
    override fun onActivityDestroyed(a: Activity) { if(a===host) dispose() }
    override fun onActivityCreated(a: Activity,b: Bundle?) {}
    override fun onActivitySaveInstanceState(a: Activity,b: Bundle) { if(a===host) view.onSaveInstanceState(b) }
}
