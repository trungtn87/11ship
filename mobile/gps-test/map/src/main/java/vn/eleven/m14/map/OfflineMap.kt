package vn.eleven.m14.map

import android.content.Context
import android.util.JsonReader
import android.util.JsonToken
import android.util.Log
import org.json.JSONObject
import org.maplibre.android.maps.Style
import java.io.InputStream
import java.io.InputStreamReader
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

/** GeoJSON is a native MapLibre source: no tile server, localhost server or cache warming. */
class OfflineMap(private val context: Context) {
    val metadata: JSONObject by lazy { JSONObject(context.assets.open("caobang/manifest.json").bufferedReader().use { it.readText() }) } // ~30 KB
    fun contains(lat: Double, lon: Double): Boolean {
        val b=metadata.getJSONArray("bounds")
        return lon>=b.getDouble(0) && lat>=b.getDouble(1) && lon<=b.getDouble(2) && lat<=b.getDouble(3)
    }
    /** The package is immutable per install: hash it once per process, not for every map view. */
    fun verify() {
        synchronized(lock) {
            if(verified) return
            val files=metadata.getJSONObject("sha256")
            for(name in files.keys()) {
                val digest=MessageDigest.getInstance("SHA-256")
                context.assets.open("caobang/$name").use { s -> val b=ByteArray(65536); var n=s.read(b); while(n>=0) { if(n>0)digest.update(b,0,n); n=s.read(b) } }
                val actual=digest.digest().joinToString("") { "%02x".format(it) }
                require(actual==files.getString(name)) { "Gói bản đồ lỗi: $name" }
            }
            verified=true
        }
    }
    fun style(): Style.Builder {
        val style=JSONObject(context.assets.open("caobang/style.json").bufferedReader().use { it.readText() })
        // Asset URLs remain local in airplane mode. Fonts and all named source data are bundled.
        return Style.Builder().fromJson(style.toString())
    }
    /**
     * Parsed from the ~8 MB map.geojson ONCE per process (#299): never a whole-file String/JSONObject
     * (~16 MB UTF-16 plus the tree, per map view, which caused OOM when views were recreated).
     */
    fun labels(): List<MapLabel> {
        synchronized(lock) {
            labelCache?.let { return it }
            val n=geojsonLoads.incrementAndGet()
            Log.i("M14OfflineMap","map.geojson load #$n")
            val parsed=context.assets.open("caobang/map.geojson").use { readLabels(it) }
            labelCache=parsed
            return parsed
        }
    }
    companion object {
        private val lock=Any()
        private var verified=false
        private var labelCache: List<MapLabel>?=null
        /** Times map.geojson was parsed in this process; must stay at most 1. */
        val geojsonLoads=AtomicInteger(0)

        internal fun readLabels(input: InputStream): List<MapLabel> {
            val out=ArrayList<MapLabel>()
            JsonReader(InputStreamReader(input,Charsets.UTF_8).buffered(65536)).use { r ->
                r.beginObject()
                while(r.hasNext()) {
                    if(r.nextName()!="features") { r.skipValue(); continue }
                    r.beginArray()
                    while(r.hasNext()) readFeature(r)?.let { out.add(it) }
                    r.endArray()
                }
                r.endObject()
            }
            return out.sortedBy { it.priority }
        }

        private fun readFeature(r: JsonReader): MapLabel? {
            val props=HashMap<String,String>(); var type=""; var coords: DoubleArray?=null; var count=0
            r.beginObject()
            while(r.hasNext()) when(r.nextName()) {
                "properties" -> if(r.peek()==JsonToken.BEGIN_OBJECT) {
                    r.beginObject()
                    while(r.hasNext()) {
                        val k=r.nextName()
                        if((k=="name:vi" || k=="name" || k=="kind" || k=="place") && r.peek()==JsonToken.STRING) props[k]=r.nextString() else r.skipValue()
                    }
                    r.endObject()
                } else r.skipValue()
                "geometry" -> if(r.peek()==JsonToken.BEGIN_OBJECT) {
                    r.beginObject()
                    while(r.hasNext()) when(r.nextName()) {
                        "type" -> type=r.nextString()
                        "coordinates" -> when(type) {
                            // Only Point and LineString are labelled; polygons and the rest are skipped unread.
                            "Point" -> {
                                val a=DoubleArray(2); r.beginArray(); var i=0
                                while(r.hasNext()) { val v=r.nextDouble(); if(i<2) a[i]=v; i++ }
                                r.endArray(); coords=a; count=1
                            }
                            "LineString" -> {
                                val list=ArrayList<Double>(); r.beginArray()
                                while(r.hasNext()) { r.beginArray(); var i=0; while(r.hasNext()) { val v=r.nextDouble(); if(i<2) list.add(v); i++ }; r.endArray() }
                                r.endArray(); coords=list.toDoubleArray(); count=list.size/2
                            }
                            else -> r.skipValue()
                        }
                        else -> r.skipValue()
                    }
                    r.endObject()
                } else r.skipValue()
                else -> r.skipValue()
            }
            r.endObject()
            val name=(props["name:vi"]?:"").ifBlank { props["name"]?:"" }; if(name.isBlank()) return null
            val c=coords?:return null
            val kind=props["kind"]
            if(kind=="place" && type=="Point" && count==1) {
                val place=props["place"]?:""; val priority=if(place=="city" || place=="town") 0 else 1
                val zoom=if(priority==0 || place=="state") 0.0 else if(place=="village") 12.0 else 14.0
                return MapLabel(c[1],c[0],name,zoom,priority)
            }
            if(kind=="road" && type=="LineString" && count>0) { val m=count/2; return MapLabel(c[2*m+1],c[2*m],name,14.0,3) }
            if(kind=="poi" && type=="Point" && count==1) return MapLabel(c[1],c[0],name,15.0,2)
            return null
        }
    }
}
