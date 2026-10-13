package @APP_PACKAGE@

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import vn.eleven.n11.N11DeviceChannel
import vn.eleven.n11.N11LocationChannel

// 11Food only: the device bridge plus the one-shot foreground location channel for the shop position.
class MainActivity : FlutterActivity() {
    private var location: N11LocationChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        N11DeviceChannel(applicationContext).register(flutterEngine.dartExecutor.binaryMessenger)
        location = N11LocationChannel(this).also { it.register(flutterEngine.dartExecutor.binaryMessenger) }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        location?.onPermissionResult(requestCode, grantResults)
    }

    override fun onDestroy() {
        location?.dispose()
        super.onDestroy()
    }
}
