package vn.eleven.m14.map

import android.content.Context
import android.graphics.*
import android.view.View
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap

data class MapPin(val latitude: Double, val longitude: Double, val label: String, val color: Int)
data class MapLabel(val latitude: Double, val longitude: Double, val text: String, val minZoom: Double, val priority: Int)

/** Native Canvas overlay: pins remain visible independently of style sprite/glyph loading. */
class MapPinsView(context: Context, private val map: () -> MapLibreMap?): View(context) {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private val font by lazy { Typeface.createFromAsset(context.assets,"caobang/fonts/NotoSans-Regular.ttf") }
    var labels: List<MapLabel> = emptyList()
        set(value) { field=value; invalidate() }
    var pins: List<MapPin> = emptyList()
        set(value) { field=value; invalidate() }
    init { isClickable=false; importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val current=map()?:return
        val projection=current.projection
        val scale=resources.displayMetrics.density
        val visible=projection.visibleRegion.latLngBounds
        val occupied=mutableListOf<RectF>()
        val zoom=current.cameraPosition.zoom
        // Text uses the bundled font directly, independent of network-gated native glyph requests.
        for(label in labels) {
            if(zoom<label.minZoom || !visible.contains(LatLng(label.latitude,label.longitude))) continue
            val p=projection.toScreenLocation(LatLng(label.latitude,label.longitude))
            paint.typeface=font; paint.textSize=(if(label.priority==0) 15 else 11)*scale; paint.textAlign=Paint.Align.CENTER
            val half=paint.measureText(label.text)/2
            val box=RectF(p.x-half-4*scale,p.y+paint.ascent()-4*scale,p.x+half+4*scale,p.y+paint.descent()+4*scale)
            if(box.left<0 || box.right>width || box.top<0 || box.bottom>height || occupied.any { RectF.intersects(it,box) }) continue
            occupied.add(box)
            paint.style=Paint.Style.STROKE; paint.strokeWidth=3*scale; paint.color=Color.WHITE
            canvas.drawText(label.text,p.x,p.y,paint)
            paint.style=Paint.Style.FILL; paint.color=Color.rgb(38,60,70)
            canvas.drawText(label.text,p.x,p.y,paint)
        }
        for(pin in pins) {
            val p=projection.toScreenLocation(LatLng(pin.latitude,pin.longitude))
            if(p.x < -50*scale || p.x>width+50*scale || p.y < -50*scale || p.y>height+50*scale) continue
            val r=17*scale; val cy=p.y-22*scale
            paint.color=pin.color; paint.style=Paint.Style.FILL
            canvas.drawPath(Path().apply { moveTo(p.x,p.y); lineTo(p.x-9*scale,cy+8*scale); lineTo(p.x+9*scale,cy+8*scale); close() },paint)
            canvas.drawCircle(p.x,cy,r,paint)
            paint.style=Paint.Style.STROKE; paint.strokeWidth=2*scale; paint.color=Color.WHITE
            canvas.drawCircle(p.x,cy,r,paint)
            paint.style=Paint.Style.FILL; paint.typeface=Typeface.DEFAULT_BOLD; paint.textSize=(if(pin.label=="GPS") 10 else 15)*scale; paint.textAlign=Paint.Align.CENTER
            canvas.drawText(pin.label,p.x,cy-(paint.ascent()+paint.descent())/2,paint)
        }
    }
}
