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
}
