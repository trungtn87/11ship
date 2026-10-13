package @APP_PACKAGE@

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import vn.eleven.n11.N11DeviceChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        N11DeviceChannel(applicationContext).register(flutterEngine.dartExecutor.binaryMessenger)
    }
}
