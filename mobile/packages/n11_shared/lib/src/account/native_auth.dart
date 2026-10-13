import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'api_client.dart';
import 'device_bridge.dart';
import 'device_proof.dart';
import 'models.dart';

// The app side of the device protocol (contract11 sections 7 and 8): turning "this phone" into a one-use registration token, and
// signing every request with the key the session was issued to. It owns no UI and no state beyond the bridge and the transport.

enum ClientApp {
  food('FOOD', 'SHIP'),
  ship('SHIP', 'FOOD');

  const ClientApp(this.label, this.peerLabel);

  /// The wire name of the app (`device.app`, `purpose` challenges).
  final String label;
  final String peerLabel;
}

/// A one-use registration token with the key behind it. Consumed by the first login / register that carries it; a replay of that
/// same request presents it again with a fresh signature.
class RegistrationGrant {
  const RegistrationGrant({required this.token, required this.keyId, this.joined = false});

  final String token;
  final String keyId;

  /// True when this grant was endorsed by the other app's binding (JOIN). The server accepts it only for the SAME user as that
  /// binding, which the app cannot know before the login answers, so a login that is refused for the device after a JOIN may
  /// be redone once on the app's own binding (see SessionController).
  final bool joined;
}

class NativeAuthApi {
  NativeAuthApi({required this.app, required this.transport, required this.bridge, required this.environment, Random? random, int Function()? nowSeconds})
      : _random = random ?? Random.secure(),
        _nowSeconds = nowSeconds ?? (() => DateTime.now().millisecondsSinceEpoch ~/ 1000);

  final ClientApp app;
  final ApiTransport transport;
  final DeviceBridge bridge;
  final String environment;
  final Random _random;
  final int Function() _nowSeconds;

  String _nonce() => base64UrlNoPad(Uint8List.fromList(List<int>.generate(32, (int _) => _random.nextInt(256))));

  Map<String, Object?> _device(String deviceId) => <String, Object?>{'device_id': deviceId, 'platform': 'ANDROID', 'app': app.label};

  Future<Map<String, Object?>> deviceBlock() async => _device(await bridge.deviceId());

  // ---- the registration token -------------------------------------------------------------------------------------

  /// What this phone has to do to get a token (contract11 section 7):
  ///  - the other app is installed, signed by the same key and holds a current binding that is not ours: JOIN it (it endorses a
  ///    NEW attested key of this app); if it cannot, this app starts its own binding;
  ///  - this app already has a key the server knows: prove it again (AUTH) with the stored chain and a fresh signature;
  ///  - otherwise generate an attested key for the server nonce (ENROLL).
  ///
  /// [allowJoin] is false when the account is not known to be the peer's: a REGISTER creates a new account, which can never own the
  /// peer's binding, so it goes straight to this app's own binding (ENROLL / AUTH) and never joins.
  Future<RegistrationGrant> obtainGrant({bool allowJoin = true}) async {
    final DeviceKeyState? key = await bridge.currentKey();
    PeerState? peer;
    try {
      peer = await bridge.peer();
    } on DeviceBridgeException {
      peer = null;
    }
    final bool peerHasBinding = allowJoin && peer != null && peer.bindingId != null && peer.keyId != null;
    final bool inPeerBinding = key != null && key.keyId != null && peerHasBinding && key.bindingId == peer.bindingId;

    if (peerHasBinding && !inPeerBinding) {
      try {
        return await _join(peer);
      } on AuthFailure catch (failure) {
        if (failure.kind != AuthFailureKind.deviceProofRefused) {
          rethrow;
        }
      } on DeviceBridgeException catch (failure) {
        if (failure.failure == DeviceBridgeFailure.unsupported) {
          rethrow;
        }
      }
      // The other app could not (or would not) endorse: this app logs in on its own binding, like a phone with no peer.
      return _enrollOrAuth(await bridge.currentKey());
    }
    return _enrollOrAuth(key);
  }

  /// A login was refused for the device after a JOIN (the account is not the peer's): drop the key that was minted for the join and
  /// the binding memory that came with it, so the next grant is a fresh ENROLL on this app's own binding.
  Future<void> discardJoinedKey() async {
    await bridge.deleteKey();
    await bridge.forgetBinding();
  }

  Future<RegistrationGrant> _enrollOrAuth(DeviceKeyState? key) async {
    if (key != null && key.keyId != null) {
      try {
        return await _auth(key);
      } on AuthFailure catch (failure) {
        if (failure.kind != AuthFailureKind.deviceProofRefused) {
          rethrow;
        }
        // The server does not know (or no longer accepts) this key: it is replaced by a fresh attested one.
        await bridge.deleteKey();
        await bridge.forgetBinding();
      }
    }
    return _enroll();
  }

  Future<({String challengeId, String nonce})> _challenge(String purpose, String? keyId) async {
    final ApiResponse response = await _post(
      '/v1/client-auth/device/challenges',
      jsonEncode(<String, Object?>{'app': app.label, 'purpose': purpose, 'key_id': keyId}),
    );
    final Object? data = response.status == 201 ? response.data : null;
    if (data is! Map<String, Object?> || data['challenge_id'] is! String || data['nonce'] is! String) {
      throw response.status == 201 ? const AuthFailure(AuthFailureKind.badResponse) : failureOf(response);
    }
    return (challengeId: data['challenge_id']! as String, nonce: data['nonce']! as String);
  }

  Future<RegistrationGrant> _enroll() async {
    final ({String challengeId, String nonce}) challenge = await _challenge('ENROLL', null);
    final DeviceKeyState key = await bridge.generateKey(challenge.nonce);
    final RegistrationGrant grant = await _register(key, challenge, null);
    await bridge.saveKeyId(grant.keyId);
    return grant;
  }

  Future<RegistrationGrant> _auth(DeviceKeyState key) async {
    final ({String challengeId, String nonce}) challenge = await _challenge('AUTH', key.keyId);
    return _register(key, challenge, null);
  }

  Future<RegistrationGrant> _join(PeerState peer) async {
    final ({String challengeId, String nonce}) challenge = await _challenge('JOIN', null);
    final DeviceKeyState key = await bridge.generateKey(challenge.nonce);
    final Endorsement endorsement = await bridge.requestEndorsement(
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      targetApp: app.label,
      spkiSha256Hex: sha256Hex(base64.decode(key.publicKeySpki)),
    );
    final RegistrationGrant grant = await _register(key, challenge, endorsement);
    await bridge.saveKeyId(grant.keyId);
    return RegistrationGrant(token: grant.token, keyId: grant.keyId, joined: true);
  }

  Future<RegistrationGrant> _register(DeviceKeyState key, ({String challengeId, String nonce}) challenge, Endorsement? join) async {
    final Uint8List message = registerKeyMessage(
      environment: environment,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      app: app.label,
      spkiSha256Hex: sha256Hex(base64.decode(key.publicKeySpki)),
      bindingId: join?.bindingId,
      authorizerKeyId: join?.authorizerKeyId,
    );
    final String signature = await bridge.sign(message);
    final ApiResponse response = await _post(
      '/v1/client-auth/device/registrations',
      jsonEncode(<String, Object?>{
        'challenge_id': challenge.challengeId,
        'app': app.label,
        'certificate_chain': key.chain,
        'public_key_spki': key.publicKeySpki,
        'signature': signature,
        'join': join == null ? null : <String, Object?>{'binding_id': join.bindingId, 'authorizer_key_id': join.authorizerKeyId, 'signature': join.signature},
      }),
      headers: <String, String>{'idempotency-key': newIdempotencyKey(_random)},
    );
    final Object? data = response.status == 201 ? response.data : null;
    if (data is! Map<String, Object?> || data['device_registration_token'] is! String || data['key_id'] is! String) {
      throw response.status == 201 ? const AuthFailure(AuthFailureKind.badResponse) : failureOf(response);
    }
    return RegistrationGrant(token: data['device_registration_token']! as String, keyId: data['key_id']! as String);
  }

  Future<ApiResponse> _post(String path, String body, {Map<String, String> headers = const <String, String>{}}) {
    return transport.send('POST', path, headers: headers, body: utf8.encode(body));
  }

  // ---- signed requests --------------------------------------------------------------------------------------------

  /// login / register: the exact JSON bytes, the Idempotency-Key and the registration token are signed together with a fresh
  /// time and nonce. [idempotencyKey] and [body] are the SAME on a user-initiated retry; time, nonce and signature are new.
  Future<ApiResponse> authCall(String path, String body, RegistrationGrant grant, String idempotencyKey) async {
    final List<int> bytes = utf8.encode(body);
    final String time = _nowSeconds().toString();
    final String nonce = _nonce();
    final String signature = await bridge.sign(authMessage(
      environment: environment,
      method: 'POST',
      path: path,
      body: bytes,
      idempotencyKey: idempotencyKey,
      registrationToken: grant.token,
      time: time,
      nonce: nonce,
    ));
    return transport.send('POST', path, body: bytes, headers: <String, String>{
      'idempotency-key': idempotencyKey,
      'x-device-registration': grant.token,
      'x-device-time': time,
      'x-device-nonce': nonce,
      'x-device-signature': signature,
    });
  }

  /// Any authenticated request: Bearer token plus the proof of the key the session was issued to.
  Future<ApiResponse> signedCall(String method, String path, {required String token, String? body, String? idempotencyKey}) async {
    final DeviceKeyState? key = await bridge.currentKey();
    final String? keyId = key?.keyId;
    if (keyId == null) {
      throw const DeviceBridgeException(DeviceBridgeFailure.noKey);
    }
    final List<int> bytes = body == null ? const <int>[] : utf8.encode(body);
    final String time = _nowSeconds().toString();
    final String nonce = _nonce();
    final String signature = await bridge.sign(requestMessage(
      environment: environment,
      keyId: keyId,
      time: time,
      nonce: nonce,
      method: method,
      url: path,
      body: bytes,
      bearerToken: token,
      idempotencyKey: idempotencyKey ?? '',
    ));
    return transport.send(method, path, body: body == null ? null : bytes, headers: <String, String>{
      'authorization': 'Bearer $token',
      'x-device-key-id': keyId,
      'x-device-time': time,
      'x-device-nonce': nonce,
      'x-device-signature': signature,
      if (idempotencyKey != null) 'idempotency-key': idempotencyKey,
    });
  }
}
