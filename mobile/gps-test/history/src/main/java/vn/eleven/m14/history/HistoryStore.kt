package vn.eleven.m14.history

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.location.Location
import java.io.OutputStream
import java.time.Instant
import kotlin.math.*

data class TrackPoint(val lat: Double, val lon: Double, val accuracy: Float, val time: Long, val segment: Long)

object TrackRules {
    const val RETENTION = 86_400_000L
    fun distance(a: TrackPoint, b: TrackPoint): Double {
        val p = Math.toRadians(b.lat - a.lat); val q = Math.toRadians(b.lon - a.lon)
        val h = sin(p/2).pow(2) + cos(Math.toRadians(a.lat))*cos(Math.toRadians(b.lat))*sin(q/2).pow(2)
        return 12_742_000 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
    fun split(a: TrackPoint, b: TrackPoint): Boolean {
        val dt = b.time-a.time
        return dt <= 0 || dt > 180_000 || a.accuracy > 100 || b.accuracy > 100 || distance(a,b) > 55 * dt/1000.0 + a.accuracy + b.accuracy
    }
}

/** Local only. Production must disable historyEnabled before recording. */
class HistoryStore(context: Context): SQLiteOpenHelper(context, "m14-history.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE points(id INTEGER PRIMARY KEY,lat REAL NOT NULL,lon REAL NOT NULL,accuracy REAL NOT NULL,time INTEGER NOT NULL,segment INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX points_time ON points(time)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Migration required") }
    fun prune(now: Long = System.currentTimeMillis()) = writableDatabase.delete("points", "time < ?", arrayOf((now-TrackRules.RETENTION).toString()))
    fun clear() { writableDatabase.delete("points", null, null) }
    fun points(): List<TrackPoint> {
        prune()
        return readableDatabase.rawQuery("SELECT lat,lon,accuracy,time,segment FROM points ORDER BY time,id", null).use { c ->
            buildList { while(c.moveToNext()) add(TrackPoint(c.getDouble(0),c.getDouble(1),c.getFloat(2),c.getLong(3),c.getLong(4))) }
        }
    }
    @Synchronized fun append(location: Location, forceSegment: Boolean) {
        val previous = points().lastOrNull()
        val point = TrackPoint(location.latitude,location.longitude,location.accuracy,location.time,0)
        if (previous != null && point.time <= previous.time) return
        val segment = if (previous == null || forceSegment || TrackRules.split(previous,point)) point.time else previous.segment
        writableDatabase.execSQL("INSERT INTO points(lat,lon,accuracy,time,segment) VALUES(?,?,?,?,?)", arrayOf(point.lat,point.lon,point.accuracy,point.time,segment))
    }
    fun export(out: OutputStream) {
        val points = points()
        out.bufferedWriter().use { w ->
            w.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?><gpx version=\"1.1\" creator=\"11Ship GPS Test\" xmlns=\"http://www.topografix.com/GPX/1/1\"><trk><name>Lịch sử GPS 24 giờ</name>")
            var segment: Long? = null
            for (p in points) {
                if(segment != p.segment) { if(segment != null) w.write("</trkseg>"); w.write("<trkseg>"); segment=p.segment }
                w.write("<trkpt lat=\"${p.lat}\" lon=\"${p.lon}\"><time>${Instant.ofEpochMilli(p.time)}</time><extensions><accuracy xmlns=\"https://11ship.vn/m14\">${p.accuracy}</accuracy></extensions></trkpt>")
            }
            if(segment != null) w.write("</trkseg>")
            w.write("</trk></gpx>")
        }
    }
}
