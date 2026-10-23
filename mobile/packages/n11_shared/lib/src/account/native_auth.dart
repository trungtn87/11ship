import 'dart:convert';

import 'api_client.dart';
import 'device_bridge.dart';

/// App labels narrow server routing; neither this label nor device_id grants access.
enum ClientApp {
  food('FOOD', 'SHIP'),
  ship('SHIP', 'FOOD');
  const ClientApp(this.label, this.peerLabel);
  final String label;
  final String peerLabel;
}

/// HTTPS account authentication and opaque Bearer sessions, shared by both APKs.
/// Keystore is used only for local encrypted token storage; no enrollment or attestation.
class NativeAuthApi {
  NativeAuthApi({required this.app, required this.transport, required this.bridge, required this.environment});
  final ClientApp app;
  final ApiTransport transport;
  final DeviceBridge bridge;
  final String environment;

  Future<Map<String, Object?>> deviceBlock() async => <String, Object?>{
    'device_id': await bridge.deviceId(), 'platform': 'ANDROID', 'app': app.label,
  };

  Future<ApiResponse> authCall(String path, String body, String idempotencyKey) =>
      transport.send('POST', path, body: utf8.encode(body), headers: <String, String>{'idempotency-key': idempotencyKey});

  // Keep the name for existing module callers; requests carry only the session token.
  Future<ApiResponse> signedCall(String method, String path, {required String token, String? body, String? idempotencyKey}) =>
      transport.send(method, path, body: body == null ? null : utf8.encode(body), headers: <String, String>{
        'authorization': 'Bearer $token',
        if (idempotencyKey != null) 'idempotency-key': idempotencyKey,
      });
}
