package vn.eleven.gpstest

import android.app.Application
import vn.eleven.m14.gps.RecorderService

class GpsApplication: Application() {
    override fun onCreate() {
        super.onCreate()
        // Service is deliberately not resurrected after process death/reboot.
        RecorderService.preferences(this).edit().putBoolean("recording",false).putString("status","Chưa bắt đầu ghi GPS").apply()
    }
}
