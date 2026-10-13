import '../config.dart';
import '../flows/driver_controller.dart';
import '../flows/location.dart';
import '../flows/reset_controller.dart';
import '../flows/shop_controller.dart';
import 'api_client.dart';
import 'device_bridge.dart';
import 'native_auth.dart';
import 'session_controller.dart';

/// The real wiring of one app: HTTPS to the configured server (normal TLS verification only), the Keystore bridge, and the session.
/// A build without a valid HTTPS server address or without the device environment cannot sign in; its screens say so.
/// [transport] and [bridge] are replaced by tests only.
SessionController createSessionController(ClientApp app, AppConfig config, {ApiTransport? transport, DeviceBridge? bridge}) {
  final Uri? base = config.apiUri;
  final bool ready = base != null && config.deviceEnvironment.isNotEmpty;
  final DeviceBridge deviceBridge = bridge ?? MethodChannelDeviceBridge(environment: config.deviceEnvironment);
  final ApiTransport http = transport ?? HttpApiTransport(base: base ?? Uri.parse('https://invalid.invalid'));
  return SessionController(
    api: NativeAuthApi(app: app, transport: http, bridge: deviceBridge, environment: config.deviceEnvironment),
    bridge: deviceBridge,
    ready: ready,
  );
}

/// The three connected flows of an app, built on its session. [location] is for tests; the real one is the Kotlin channel.
class AppFlows {
  AppFlows({required this.session, required this.reset, this.shop, this.driver});

  final SessionController session;
  final ResetController reset;
  final ShopController? shop;
  final DriverController? driver;
}

AppFlows createFlows(ClientApp app, SessionController session, AppConfig config, {ApiTransport? transport, LocationProvider? location}) {
  final ApiTransport http = transport ?? HttpApiTransport(base: config.apiUri ?? Uri.parse('https://invalid.invalid'));
  return AppFlows(
    session: session,
    reset: ResetController(transport: http, session: session),
    shop: app == ClientApp.food ? ShopController(session: session, location: location ?? MethodChannelLocationProvider()) : null,
    driver: app == ClientApp.ship ? DriverController(session: session) : null,
  );
}
