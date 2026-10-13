import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// The Kotlin side of the device binding (mobile/tool/android-templates/kotlin/…). The Android Keystore key is generated, kept and
// used for signing THERE: this app code only ever receives public metadata (the public key, the attestation chain) and signatures.
// There is no method that returns a private key, and none that signs arbitrary bytes for another app: the join endorsement is
// built and signed natively from the fields below.

/// The reasons the native side refuses, as a closed list (never platform text).
enum DeviceBridgeFailure { unsupported, noKey, peerUnavailable, failed }

class DeviceBridgeException implements Exception {
  const DeviceBridgeException(this.failure);

  final DeviceBridgeFailure failure;

  @override
  String toString() => 'DeviceBridgeException($failure)';
}

@immutable
class DeviceKeyState {
  const DeviceKeyState({required this.keyId, required this.publicKeySpki, required this.chain, required this.bindingId, required this.generation});

  /// The id the SERVER gave this key at registration; null while it was generated but never accepted.
  final String? keyId;

  /// Base64 DER SubjectPublicKeyInfo.
  final String publicKeySpki;

  /// Base64 DER certificates, leaf first (Android Key Attestation).
  final List<String> chain;

  /// The binding this app last saw in a server answer, with its generation.
  final String? bindingId;
  final int? generation;
}

@immutable
class PeerState {
  const PeerState({required this.bindingId, required this.keyId});

  final String? bindingId;
  final String? keyId;
}

@immutable
class Endorsement {
  const Endorsement({required this.bindingId, required this.authorizerKeyId, required this.signature});

  final String bindingId;
  final String authorizerKeyId;

  /// base64url DER, over the JOIN message the peer built itself.
  final String signature;
}

abstract class DeviceBridge {
  /// A random identifier kept on the phone, sent as the legacy `device_id` metadata only (it grants nothing).
  Future<String> deviceId();

  Future<DeviceKeyState?> currentKey();

  /// Generates a NEW non-exportable P-256 key whose attestation challenge is the server nonce (base64url). Throws
  /// [DeviceBridgeFailure.unsupported] when the phone cannot attest in TEE / StrongBox.
  Future<DeviceKeyState> generateKey(String challengeBase64Url);

  Future<void> saveKeyId(String keyId);

  Future<void> deleteKey();

  /// Signs with the app's key; the result is base64url DER.
  Future<String> sign(Uint8List message);

  Future<void> rememberBinding(String bindingId, int generation);

  Future<void> forgetBinding();

  Future<String?> readToken();

  Future<void> storeToken(String token);

  Future<void> clearToken();

  /// The other 11Ship app on this phone, if it is installed, signed by the same key and has a binding. Null otherwise.
  Future<PeerState?> peer();

  /// Asks the other app (a signature-protected Binder service, caller checked by UID, package and signer) to endorse joining.
  Future<Endorsement> requestEndorsement({
    required String challengeId,
    required String nonce,
    required String targetApp,
    required String spkiSha256Hex,
  });
}

class MethodChannelDeviceBridge implements DeviceBridge {
  MethodChannelDeviceBridge({required this.environment, MethodChannel? channel}) : _channel = channel ?? const MethodChannel('vn.eleven.n11/device');

  /// The non-secret build environment identifier (the same value the server pins).
  final String environment;
  final MethodChannel _channel;

  Future<T?> _call<T>(String method, [Map<String, Object?>? arguments]) async {
    try {
      return await _channel.invokeMethod<T>(method, <String, Object?>{'environment': environment, ...?arguments});
    } on PlatformException catch (error) {
      switch (error.code) {
        case 'UNSUPPORTED':
          throw const DeviceBridgeException(DeviceBridgeFailure.unsupported);
        case 'NO_KEY':
          throw const DeviceBridgeException(DeviceBridgeFailure.noKey);
        case 'PEER_UNAVAILABLE':
          throw const DeviceBridgeException(DeviceBridgeFailure.peerUnavailable);
        default:
          throw const DeviceBridgeException(DeviceBridgeFailure.failed);
      }
    } on MissingPluginException {
      throw const DeviceBridgeException(DeviceBridgeFailure.unsupported);
    }
  }

  DeviceKeyState? _key(Map<Object?, Object?>? raw) {
    if (raw == null) {
      return null;
    }
    final Object? spki = raw['publicKeySpki'];
    final Object? chain = raw['chain'];
    if (spki is! String || chain is! List<Object?>) {
      throw const DeviceBridgeException(DeviceBridgeFailure.failed);
    }
    final Object? generation = raw['generation'];
    return DeviceKeyState(
      keyId: raw['keyId'] as String?,
      publicKeySpki: spki,
      chain: <String>[for (final Object? c in chain) c! as String],
      bindingId: raw['bindingId'] as String?,
      generation: generation is int ? generation : null,
    );
  }

  @override
  Future<String> deviceId() async => (await _call<String>('deviceId')) ?? (throw const DeviceBridgeException(DeviceBridgeFailure.failed));

  @override
  Future<DeviceKeyState?> currentKey() async => _key(await _call<Map<Object?, Object?>>('currentKey'));

  @override
  Future<DeviceKeyState> generateKey(String challengeBase64Url) async {
    final DeviceKeyState? key = _key(await _call<Map<Object?, Object?>>('generateKey', <String, Object?>{'challenge': challengeBase64Url}));
    return key ?? (throw const DeviceBridgeException(DeviceBridgeFailure.failed));
  }

  @override
  Future<void> saveKeyId(String keyId) => _call<void>('saveKeyId', <String, Object?>{'keyId': keyId});

  @override
  Future<void> deleteKey() => _call<void>('deleteKey');

  @override
  Future<String> sign(Uint8List message) async {
    final String? signature = await _call<String>('sign', <String, Object?>{'message': base64.encode(message)});
    return signature ?? (throw const DeviceBridgeException(DeviceBridgeFailure.failed));
  }

  @override
  Future<void> rememberBinding(String bindingId, int generation) => _call<void>('rememberBinding', <String, Object?>{'bindingId': bindingId, 'generation': generation});

  @override
  Future<void> forgetBinding() => _call<void>('forgetBinding');

  @override
  Future<String?> readToken() => _call<String>('readToken');

  @override
  Future<void> storeToken(String token) => _call<void>('storeToken', <String, Object?>{'token': token});

  @override
  Future<void> clearToken() => _call<void>('clearToken');

  @override
  Future<PeerState?> peer() async {
    final Map<Object?, Object?>? raw = await _call<Map<Object?, Object?>>('peer');
    if (raw == null) {
      return null;
    }
    return PeerState(bindingId: raw['bindingId'] as String?, keyId: raw['keyId'] as String?);
  }

  @override
  Future<Endorsement> requestEndorsement({required String challengeId, required String nonce, required String targetApp, required String spkiSha256Hex}) async {
    final Map<Object?, Object?>? raw = await _call<Map<Object?, Object?>>('requestEndorsement', <String, Object?>{
      'challengeId': challengeId,
      'nonce': nonce,
      'targetApp': targetApp,
      'spkiSha256Hex': spkiSha256Hex,
    });
    final Object? bindingId = raw?['bindingId'];
    final Object? keyId = raw?['authorizerKeyId'];
    final Object? signature = raw?['signature'];
    if (bindingId is! String || keyId is! String || signature is! String) {
      throw const DeviceBridgeException(DeviceBridgeFailure.failed);
    }
    return Endorsement(bindingId: bindingId, authorizerKeyId: keyId, signature: signature);
  }
}
