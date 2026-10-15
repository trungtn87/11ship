package vn.eleven.m14.map

import android.content.Context
import android.graphics.*
import android.view.View
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap

data class MapPin(val latitude: Double, val longitude: Double, val label: String, val color: Int)

/** Native Canvas overlay: pins remain visible independently of style sprite/glyph loading. */
class MapPinsView(context: Context, private val map: () -> MapLibreMap?): View(context) {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    var pins: List<MapPin> = emptyList()
        set(value) { field=value; invalidate() }
    init { isClickable=false; importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val projection=map()?.projection?:return
        val scale=resources.displayMetrics.density
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
