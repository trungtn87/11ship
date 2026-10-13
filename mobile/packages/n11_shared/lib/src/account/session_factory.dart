import '../config.dart';
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
