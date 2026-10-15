package vn.eleven.m14.map

import android.content.Context
import org.json.JSONObject
import org.maplibre.android.maps.Style
import java.security.MessageDigest

/** GeoJSON is a native MapLibre source: no tile server, localhost server or cache warming. */
class OfflineMap(private val context: Context) {
    val metadata: JSONObject by lazy { JSONObject(context.assets.open("caobang/manifest.json").bufferedReader().use { it.readText() }) }
    fun contains(lat: Double, lon: Double): Boolean {
        val b=metadata.getJSONArray("bounds")
        return lon>=b.getDouble(0) && lat>=b.getDouble(1) && lon<=b.getDouble(2) && lat<=b.getDouble(3)
    }
    fun verify() {
        val files=metadata.getJSONObject("sha256")
        for(name in files.keys()) {
            val digest=MessageDigest.getInstance("SHA-256")
            context.assets.open("caobang/$name").use { s -> val b=ByteArray(65536); var n=s.read(b); while(n>=0) { if(n>0)digest.update(b,0,n); n=s.read(b) } }
            val actual=digest.digest().joinToString("") { "%02x".format(it) }
            require(actual==files.getString(name)) { "Gói bản đồ lỗi: $name" }
        }
    }
    fun style(): Style.Builder {
        val style=JSONObject(context.assets.open("caobang/style.json").bufferedReader().use { it.readText() })
        // Asset URLs remain local in airplane mode. Fonts and all named source data are bundled.
        return Style.Builder().fromJson(style.toString())
    }
    fun labels(): List<MapLabel> {
        val data=JSONObject(context.assets.open("caobang/map.geojson").bufferedReader().use { it.readText() }).getJSONArray("features")
        return buildList {
            for(i in 0 until data.length()) {
                val f=data.getJSONObject(i); val p=f.getJSONObject("properties"); val g=f.getJSONObject("geometry")
                val name=p.optString("name:vi").ifBlank { p.optString("name") }; if(name.isBlank()) continue
                val kind=p.optString("kind"); val type=g.getString("type"); val c=g.getJSONArray("coordinates")
                if(kind=="place" && type=="Point") {
                    val place=p.optString("place"); val priority=if(place in listOf("city","town")) 0 else 1
                    val zoom=if(priority==0 || place=="state") 0.0 else if(place=="village") 12.0 else 14.0
                    add(MapLabel(c.getDouble(1),c.getDouble(0),name,zoom,priority))
                } else if(kind=="road" && type=="LineString" && c.length()>0) {
                    val point=c.getJSONArray(c.length()/2); add(MapLabel(point.getDouble(1),point.getDouble(0),name,14.0,3))
                } else if(kind=="poi" && type=="Point") add(MapLabel(c.getDouble(1),c.getDouble(0),name,15.0,2))
            }
        }.sortedBy { it.priority }
    }
}
