package vn.eleven.m14.routing

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class Endpoint(val lat: Double, val lon: Double, val name: String = "")
data class Route(val start: Endpoint, val end: Endpoint, val km: Double, val coordinates: List<Pair<Double,Double>>, val calculatedAt: Long) {
    fun json(): JSONObject = JSONObject().put("start", start.json()).put("end",end.json()).put("km",km).put("time",calculatedAt)
        .put("coordinates",JSONArray(coordinates.map { listOf(it.first,it.second) }))
    companion object {
        fun fromJson(o: JSONObject) = Route(endpoint(o.getJSONObject("start")), endpoint(o.getJSONObject("end")),o.getDouble("km"),
            o.getJSONArray("coordinates").let { a -> (0 until a.length()).map { a.getJSONArray(it).let { v -> v.getDouble(0) to v.getDouble(1) } } },o.getLong("time"))
        private fun endpoint(o: JSONObject) = Endpoint(o.getDouble("lat"),o.getDouble("lon"),o.optString("name"))
    }
}
private fun Endpoint.json() = JSONObject().put("lat",lat).put("lon",lon).put("name",name)

class RouteClient(context: Context, private val origin: String) {
    private val cache = AtomicFile(File(context.filesDir,"m14-route-v1.json"))
    fun saved(): Route? = try { Route.fromJson(JSONObject(cache.openRead().bufferedReader().use { it.readText() })) } catch(_: Exception) { null }
    fun calculate(start: Endpoint, end: Endpoint): Route {
        check(origin.startsWith("https://")) { "Dịch vụ tính tuyến chưa được cấu hình" }
        val connection = URL(origin.trimEnd('/')+"/route").openConnection() as HttpsURLConnection
        try {
            connection.requestMethod="POST"; connection.connectTimeout=20_000; connection.readTimeout=60_000
            connection.doOutput=true; connection.setRequestProperty("Content-Type","application/json")
            val body = JSONObject().put("locations",JSONArray().put(start.json()).put(end.json())).put("costing","motorcycle")
                .put("costing_options",JSONObject().put("motorcycle",JSONObject().put("use_highways",0.3).put("use_tolls",0.0).put("use_ferry",0.0)))
                .put("directions_options",JSONObject().put("units","kilometers").put("directions_type","none"))
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            if(code != 200) {
                val error = connection.errorStream?.bufferedReader()?.use { it.readText().take(4096) }.orEmpty()
                val message = try { JSONObject(error).optString("message") } catch(_:Exception) { "" }
                throw IllegalStateException(message.ifBlank { when(code) { 400,404,422 -> "Không tìm được tuyến hoặc ngoài vùng dữ liệu"; 429 -> "Dịch vụ đang bận, vui lòng thử lại"; else -> "Dịch vụ tính tuyến chưa sẵn sàng ($code)" } })
            }
            val data = JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).getJSONObject("trip")
            val legs = data.getJSONArray("legs")
            val coords = buildList { for(i in 0 until legs.length()) addAll(decodePolyline6(legs.getJSONObject(i).getString("shape"))) }
            require(coords.size>=2) { "Dịch vụ không trả về tuyến hợp lệ" }
            val km = data.getJSONObject("summary").getDouble("length")
            require(km.isFinite() && km>=0) { "Quãng đường không hợp lệ" }
            val route = Route(start,end,km,coords,System.currentTimeMillis())
            val stream = cache.startWrite()
            try { stream.write(route.json().toString().toByteArray()); cache.finishWrite(stream) } catch(e: Exception) { cache.failWrite(stream); throw e }
            return route
        } finally { connection.disconnect() }
    }
}

fun decodePolyline6(encoded: String): List<Pair<Double, Double>> {
    var pos=0; var lat=0L; var lon=0L
    fun value(): Long {
        var shift=0; var result=0L; var b: Int
        do { require(pos<encoded.length && shift<=60) { "Tuyến không hợp lệ" }; b=encoded[pos++].code-63; require(b in 0..63); result=result or ((b and 31).toLong() shl shift); shift+=5 } while(b>=32)
        return if(result and 1L != 0L) (result shr 1).inv() else result shr 1
    }
    return buildList { while(pos<encoded.length) { lat+=value(); lon+=value(); add(lat/1e6 to lon/1e6) } }
}
