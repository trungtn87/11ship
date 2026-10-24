package vn.eleven.m14.flutter

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import vn.eleven.m14.gps.RecorderService

/**
 * The 11Ship location service: the recorder with the Shipper's own wording and no stop button (sharing ends with the online button, so the app and the
 * server cannot disagree about it).
 *
 * The position is uploaded by the Flutter app. When the Shipper swipes the app away the Flutter engine is gone, so nothing could upload any more: this
 * service then stops collecting (no battery spent for nothing) and leaves one ordinary notification that reopens the app, which restores the sharing by
 * itself. The server stops handing out orders on its own once the last position is two minutes old. What the phone's maker does to a service beyond this
 * (force-stop, battery restrictions) is outside what an app can promise.
 */
class ShipLocationService: RecorderService() {
    override val notificationTitle = "11Ship đang chia sẻ vị trí"
    override val notificationText = "Để nhận đơn gần bạn và cho quán biết bạn đang tới · cập nhật khoảng 1 phút"
    override val stopActionLabel: String? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        getSystemService(NotificationManager::class.java).cancel(PAUSED_NOTIFICATION)
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        shutdown("Đã dừng chia sẻ vị trí vì ứng dụng bị đóng")
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 3, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val notification = android.app.Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("11Ship tạm dừng chia sẻ vị trí")
            .setContentText("Mở lại 11Ship để tiếp tục nhận đơn.")
            .setAutoCancel(true).setContentIntent(open).build()
        getSystemService(NotificationManager::class.java).notify(PAUSED_NOTIFICATION, notification)
        super.onTaskRemoved(rootIntent)
    }

    private companion object {
        const val PAUSED_NOTIFICATION = 15
    }
}
