package vn.eleven.gpstest

import android.location.Location
import vn.eleven.m14.gps.RecorderService
import vn.eleven.m14.history.HistoryStore

/** History is compiled into the isolated test app only. */
class TestRecorderService: RecorderService() {
    private val history by lazy { HistoryStore(this) }
    private var first = true
    override val notificationTitle = "11Ship GPS Test đang ghi vị trí"
    override val notificationText = "Chu kỳ mục tiêu 60 giây · chỉ lưu trên điện thoại"
    override fun onAcceptedLocation(location: Location) {
        if(preferences(this).getBoolean("historyEnabled", true)) {
            history.append(location, first)
            first = false
        }
    }
    override fun onDestroy() { super.onDestroy(); history.close() }
}
