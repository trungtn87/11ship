package @APP_PACKAGE@

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import android.content.Intent
import vn.eleven.n11.N11DeviceChannel
import vn.eleven.n11.N11PushChannel
import vn.eleven.n11.N11LocationChannel

// 11Food only: the device bridge plus the one-shot foreground location channel for the shop position.
class MainActivity : FlutterActivity() {
    private var location: N11LocationChannel? = null
    private var push: N11PushChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        N11DeviceChannel(applicationContext).register(flutterEngine.dartExecutor.binaryMessenger)
        location = N11LocationChannel(this).also { it.register(flutterEngine.dartExecutor.binaryMessenger) }
        push = N11PushChannel(this).also { it.register(flutterEngine.dartExecutor.binaryMessenger) }
        N11PushChannel.handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        N11PushChannel.handleIntent(intent)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        location?.onPermissionResult(requestCode, grantResults)
        push?.onPermissionResult(requestCode, grantResults)
    }

    override fun onDestroy() {
        location?.dispose()
        push?.dispose()
        super.onDestroy()
    }
}
