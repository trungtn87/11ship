import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'device_bridge.dart';
import 'models.dart';
import 'native_auth.dart';

// The one place that holds "who is signed in" for an app (docs/tasks/M01-android-account-session-handoff-20261013.md section 5).
//  - The token lives only in the Keystore-encrypted store of this app (never preferences, logs or Binder) and is read back only to
//    ask the server `me` first: nothing sensitive is shown before the server confirmed the session on a cold start.
//  - Identity, roles and capabilities come from the server answer; nothing is granted or remembered locally.
//  - A lost answer to a write keeps the SAME Idempotency-Key and body; only the person pressing "Thử lại" sends it again, with a
//    fresh nonce and signature.
//  - 401 clears the token and every personal value but keeps the device key, so the person can sign in again on this phone.
//  - Late answers (after logout, or from before a newer action) are dropped by an epoch counter: a stale response never
//    reinstalls a session that was logged out.

enum SessionStatus {
  /// Reading the stored token / asking the server (nothing sensitive is shown).
  starting,
  guest,
  signedIn,

  /// A token exists but the server could not be asked (offline / 503): nothing sensitive is shown, the person can retry.
  unverified,
}

/// How the server verifies a phone at registration (GET /v1/client-auth/config).
/// How the server registers a new account right now (GET /v1/client-auth/config): [required] = with the SMS proof, [notRequired] = SYSTEM turned
/// the registration OTP off (the account is created with an unverified phone), [unknown] = unreadable or a mode this build does not know.
enum RegistrationMode { unknown, required, notRequired }

/// The consent the register screen shows and sends. The pair identifies the texts in account_views.dart (and docs/current/
/// M01-terms-privacy-20261014.md); the server must be configured with the SAME pair (CLIENT_AUTH_TERMS_VERSION /
/// CLIENT_AUTH_PRIVACY_VERSION) and refuses any other. Changing a text means a new version here AND on the server.
const String kConsentTermsVersion = 'terms-20261014-v1';
const String kConsentPrivacyVersion = 'privacy-20261017-v1';

enum PendingKind { register, login }

/// A write whose outcome the app does not know: kept as it was sent so that the person can send it again unchanged.
class PendingAuth {
  PendingAuth({required this.kind, required this.path, required this.body, required this.idempotencyKey});

  final PendingKind kind;
  final String path;
  final String body;
  final String idempotencyKey;
}

class SessionController extends ChangeNotifier {
  SessionController({required this.api, required this.bridge, required this.ready});

  final NativeAuthApi api;
  final DeviceBridge bridge;

  /// False when the build has no valid HTTPS server address: every action is unavailable and says so.
  final bool ready;

  /// The server origin of this build (for the native location service, which sends the position itself); null when unknown.
  String? get apiBaseUrl {
    final ApiTransport transport = api.transport;
    return transport is HttpApiTransport ? transport.base.toString() : null;
  }

  SessionStatus _status = SessionStatus.starting;
  Identity? _identity;
  Profile? _profile;
  PendingAuth? _pending;
  AuthFailure? _lastFailure;
  bool _busy = false;
  bool _loggedOutNotice = false;
  bool _sessionEndedNotice = false;
  bool _logoutUnconfirmed = false;
  RegistrationMode _registrationMode = RegistrationMode.unknown;
  int _epoch = 0;
  bool _disposed = false;

  SessionStatus get status => _status;
  Identity? get identity => _identity;
  Profile? get profile => _profile;
  PendingAuth? get pending => _pending;
  AuthFailure? get lastFailure => _lastFailure;
  bool get busy => _busy;
  RegistrationMode get registrationMode => _registrationMode;

  /// The session ended on the server (expired, revoked, replaced): shown once on the login screen.
  bool get sessionEndedNotice => _sessionEndedNotice;

  /// The person logged out on the phone but the server's confirmation (204) did not arrive.
  bool get logoutUnconfirmed => _logoutUnconfirmed;
  bool get loggedOutNotice => _loggedOutNotice;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  void _setBusy(bool value) {
    _busy = value;
    _notify();
  }

  // ---- cold start ------------------------------------------------------------------------------------------------

  /// Reads the stored token and asks the server who it is before showing anything personal.
  Future<void> start() async {
    final int epoch = ++_epoch;
    if (!ready) {
      _status = SessionStatus.guest;
      _notify();
      return;
    }
    String? token;
    try {
      token = await bridge.readToken();
    } on DeviceBridgeException {
      token = null;
    }
    if (epoch != _epoch) {
      return;
    }
    if (token == null) {
      _status = SessionStatus.guest;
      _notify();
      return;
    }
    _status = SessionStatus.starting;
    _notify();
    await _validate(token, epoch);
  }

  /// Asks `me` again (also the "Thử lại" of an unverified start).
  Future<void> revalidate() async {
    final int epoch = ++_epoch;
    String? token;
    try {
      token = await bridge.readToken();
    } on DeviceBridgeException {
      token = null;
    }
    if (epoch != _epoch) {
      return;
    }
    if (token == null) {
      _toGuest();
      return;
    }
    _status = SessionStatus.starting;
    _notify();
    await _validate(token, epoch);
  }

  Future<void> _validate(String token, int epoch) async {
    try {
      final ApiResponse response = await api.signedCall('GET', '/v1/client-auth/me', token: token);
      if (epoch != _epoch) {
        return;
      }
      if (response.status == 200) {
        final Identity? identity = Identity.tryParse(response.data);
        if (identity == null) {
          _status = SessionStatus.unverified;
          _lastFailure = const AuthFailure(AuthFailureKind.badResponse);
          _notify();
          return;
        }
        _identity = identity;
        _profile = identity.profile;
        _status = SessionStatus.signedIn;
        _lastFailure = null;
        _notify();
        return;
      }
      final AuthFailure failure = failureOf(response);
      if (failure.kind == AuthFailureKind.sessionEnded || failure.kind == AuthFailureKind.deviceProofRefused) {
        // A legacy token is never upgraded locally: ask for the password again.
        await _endSession(epoch, notice: true);
        return;
      }
      // A refused device proof (for example a phone clock more than a minute off) grants nothing and ends nothing: the person
      // can retry; only a 401 clears the session.
      _status = SessionStatus.unverified;
      _lastFailure = failure;
      _notify();
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      _status = SessionStatus.unverified;
      _lastFailure = failure;
      _notify();
    } on DeviceBridgeException {
      if (epoch != _epoch) {
        return;
      }
      _status = SessionStatus.unverified;
      _lastFailure = const AuthFailure(AuthFailureKind.deviceUnsupported);
      _notify();
    }
  }

  /// 401: the token and every personal value go, the device key stays so the person can sign in again.
  Future<void> _endSession(int epoch, {required bool notice}) async {
    try {
      await bridge.clearToken();
    } on DeviceBridgeException {
      // The in-memory state is cleared below regardless.
    }
    if (epoch != _epoch) {
      return;
    }
    _toGuest();
    _sessionEndedNotice = notice;
    _notify();
  }

  void _toGuest() {
    _identity = null;
    _profile = null;
    _pending = null;
    _status = SessionStatus.guest;
    _notify();
  }

  /// The person left the form while a request was in flight: its late answer is dropped, not installed.
  void abandon() {
    if (_status == SessionStatus.signedIn) {
      return;
    }
    _epoch++;
    _busy = false;
    _pending = null;
    _lastFailure = null;
  }

  void dismissNotices() {
    _sessionEndedNotice = false;
    _loggedOutNotice = false;
    _logoutUnconfirmed = false;
    _lastFailure = null;
    _notify();
  }

  // ---- registration mode -----------------------------------------------------------------------------------------

  /// GET /v1/client-auth/config. An unreadable answer leaves the mode unknown and the submit disabled (the app never guesses).
  Future<void> loadRegistrationMode() async {
    if (!ready) {
      return;
    }
    try {
      final ApiResponse response = await api.transport.send('GET', '/v1/client-auth/config');
      final Object? data = response.status == 200 ? response.data : null;
      final Object? mode = data is Map<String, Object?> ? data['registration_verification'] : null;
      // Two modes exist in the app: the SMS-verified registration and the one SYSTEM opens by turning the registration OTP off. Any other
      // answer (including a server mode this build does not know, the development-only DISABLED_TEST included) leaves the mode unknown:
      // the app never guesses and never offers a registration the server did not announce.
      _registrationMode = mode == 'REQUIRED'
          ? RegistrationMode.required
          : mode == 'NOT_REQUIRED'
              ? RegistrationMode.notRequired
              : RegistrationMode.unknown;
    } on AuthFailure {
      _registrationMode = RegistrationMode.unknown;
    }
    _notify();
  }

  // ---- register / login ------------------------------------------------------------------------------------------

  /// [verificationToken] is the one-use proof of the OTP step. It rides in the same signed body as everything else, so a retry after
  /// a lost answer replays the identical request.
  /// With the SMS proof ([RegistrationMode.required]) the one-use [verificationToken] is part of the body; when SYSTEM turned the registration
  /// OTP off ([RegistrationMode.notRequired]) there is no token and the body has none (the server refuses a token it did not ask for).
  Future<bool> register({required String phone, required String password, required String fullName, String? verificationToken}) async {
    final bool withProof = _registrationMode == RegistrationMode.required && verificationToken != null;
    final bool withoutProof = _registrationMode == RegistrationMode.notRequired;
    if (!withProof && !withoutProof) {
      return false;
    }
    return _begin(
      PendingKind.register,
      '/v1/client-auth/register',
      (Map<String, Object?> device) => jsonEncode(<String, Object?>{
        'phone': phone.trim(),
        'password': password,
        if (withProof) 'verification_token': verificationToken,
        'device': device,
        'full_name': fullName,
        'consent': <String, Object?>{'terms_version': kConsentTermsVersion, 'privacy_version': kConsentPrivacyVersion},
      }),
    );
  }

  Future<bool> login({required String phone, required String password}) async {
    return _begin(
      PendingKind.login,
      '/v1/client-auth/login',
      (Map<String, Object?> device) => jsonEncode(<String, Object?>{'phone': phone.trim(), 'password': password, 'device': device}),
    );
  }

  Future<bool> _begin(PendingKind kind, String path, String Function(Map<String, Object?> device) build) async {
    if (!ready || _busy) {
      return false;
    }
    final int epoch = ++_epoch;
    _lastFailure = null;
    _sessionEndedNotice = false;
    _loggedOutNotice = false;
    _setBusy(true);
    try {
      final String deviceBody = build(await api.deviceBlock());
      return await _send(PendingAuth(
        kind: kind, path: path, body: deviceBody, idempotencyKey: newIdempotencyKey(),
      ), epoch);
    } on AuthFailure catch (failure) {
      return _fail(failure, epoch);
    } on DeviceBridgeException catch (failure) {
      return _fail(AuthFailure(failure.failure == DeviceBridgeFailure.unsupported ? AuthFailureKind.deviceUnsupported : AuthFailureKind.deviceProofRefused), epoch);
    } finally {
      if (epoch == _epoch) {
        _setBusy(false);
      }
    }
  }

  /// The person pressed "Thử lại" after an unknown outcome: the SAME key and body, a fresh nonce and signature.
  Future<bool> retryPending() async {
    final PendingAuth? pending = _pending;
    if (pending == null || _busy) {
      return false;
    }
    final int epoch = ++_epoch;
    _lastFailure = null;
    _setBusy(true);
    try {
      return await _send(pending, epoch);
    } on AuthFailure catch (failure) {
      return _fail(failure, epoch);
    } on DeviceBridgeException {
      return _fail(const AuthFailure(AuthFailureKind.deviceProofRefused), epoch);
    } finally {
      if (epoch == _epoch) {
        _setBusy(false);
      }
    }
  }

  void cancelPending() {
    _pending = null;
    _lastFailure = null;
    _notify();
  }

  Future<bool> _send(PendingAuth pending, int epoch) async {
    _pending = pending;
    final ApiResponse response = await api.authCall(pending.path, pending.body, pending.idempotencyKey);
    if (epoch != _epoch) {
      return false;
    }
    final bool created = response.status == 201 && pending.kind == PendingKind.register;
    final bool ok = response.status == 200 && pending.kind == PendingKind.login;
    if (!created && !ok) {
      throw failureOf(response, endpoint: pending.path);
    }
    final Object? data = response.data;
    final Identity? identity = Identity.tryParse(data);
    final Object? token = data is Map<String, Object?> ? data['access_token'] : null;
    if (identity == null || token is! String) {
      throw const AuthFailure(AuthFailureKind.badResponse);
    }
    await bridge.storeToken(token);
    if (epoch != _epoch) {
      return false;
    }
    _sessionEndedNotice = false;
    _loggedOutNotice = false;
    _identity = identity;
    _profile = identity.profile;
    _pending = null;
    _status = SessionStatus.signedIn;
    _notify();
    return true;
  }

  bool _fail(AuthFailure failure, int epoch) {
    if (epoch != _epoch) {
      return false;
    }
    final bool unknown = failure.outcomeUnknown;
    if (!unknown) {
      _pending = null;
    }
    _lastFailure = failure;
    _notify();
    return false;
  }

  // ---- protected calls for the other flows (shop, driver, context) ---------------------------------------------------

  /// Bumps with every login / logout / session end. A flow that started under one value drops its answer when it changed, so a
  /// late response never builds a profile for another session.
  int get sessionEpoch => _epoch;

  /// A signed request of the current session (Bearer + device proof, raw bytes). A 401 ends the session exactly like everywhere
  /// else and surfaces as [AuthFailureKind.sessionEnded]; any other refusal is thrown as the closed [AuthFailure].
  Future<ApiResponse> protectedCall(String method, String path, {String? body, String? idempotencyKey}) async {
    if (_status != SessionStatus.signedIn) {
      throw const AuthFailure(AuthFailureKind.sessionEnded);
    }
    final int epoch = _epoch;
    final String? token = await bridge.readToken();
    if (token == null) {
      throw const AuthFailure(AuthFailureKind.sessionEnded);
    }
    try {
      final ApiResponse response = await api.signedCall(method, path, token: token, body: body, idempotencyKey: idempotencyKey);
      if (epoch != _epoch) {
        throw const AuthFailure(AuthFailureKind.sessionEnded);
      }
      if (response.status == 401) {
        await _endSession(epoch, notice: true);
        throw const AuthFailure(AuthFailureKind.sessionEnded);
      }
      return response;
    } on DeviceBridgeException {
      throw const AuthFailure(AuthFailureKind.deviceProofRefused);
    }
  }

  /// Reads `me` again and replaces the identity (after an onboarding step changed what the server says about the person).
  Future<void> refreshIdentity() async {
    final int epoch = _epoch;
    final ApiResponse response = await protectedCall('GET', '/v1/client-auth/me');
    if (epoch != _epoch) {
      return;
    }
    final Identity? identity = response.status == 200 ? Identity.tryParse(response.data) : null;
    if (identity == null) {
      throw response.status == 200 ? const AuthFailure(AuthFailureKind.badResponse) : failureOf(response);
    }
    _identity = identity;
    _profile = identity.profile;
    _notify();
  }

  /// POST /v1/client-auth/context: only on the person's own action; the server decides (ROLE_NOT_AVAILABLE) and answers the CURRENT
  /// identity. Never a grant.
  String? _contextKey;
  String? _contextBody;

  Future<void> selectContext(String context) async {
    final int epoch = _epoch;
    final String body = jsonEncode(<String, Object?>{'context': context});
    // A lost answer is retried with the same key and body (the person taps again); any other outcome starts a new intent.
    final String key = _contextBody == body && _contextKey != null ? _contextKey! : newIdempotencyKey();
    _contextBody = body;
    _contextKey = key;
    final ApiResponse response;
    try {
      response = await protectedCall('POST', '/v1/client-auth/context', body: body, idempotencyKey: key);
    } on AuthFailure catch (failure) {
      if (!failure.outcomeUnknown) {
        _contextBody = null;
        _contextKey = null;
      }
      rethrow;
    }
    final AuthFailure? refusal = response.status == 200 ? null : failureOf(response);
    // A gateway answer that only says the upstream did not answer (502/504) leaves the outcome unknown: keep the intent.
    if (refusal == null || !refusal.outcomeUnknown) {
      _contextBody = null;
      _contextKey = null;
    }
    if (epoch != _epoch) {
      return;
    }
    final Identity? identity = refusal == null ? Identity.tryParse(response.data) : null;
    if (identity == null) {
      throw refusal ?? const AuthFailure(AuthFailureKind.badResponse);
    }
    _identity = identity;
    _profile = identity.profile;
    _notify();
  }

  // ---- logout ----------------------------------------------------------------------------------------------------

  /// Clears the local session at once; 204 confirms the revoke, anything else says it is NOT confirmed. A late answer to an earlier
  /// request cannot bring the session back because the epoch moves first.
  Future<void> logout() async {
    final int epoch = ++_epoch;
    String? token;
    try {
      token = await bridge.readToken();
    } on DeviceBridgeException {
      token = null;
    }
    _busy = false;
    _toGuest();
    _loggedOutNotice = true;
    _logoutUnconfirmed = false;
    try {
      await bridge.clearToken();
    } on DeviceBridgeException {
      // Cleared in memory; the next start asks the server anyway.
    }
    _notify();
    if (token == null || !ready) {
      return;
    }
    try {
      final ApiResponse response = await api.signedCall('POST', '/v1/client-auth/logout', token: token, body: '{}');
      if (response.status != 204 && failureOf(response).kind != AuthFailureKind.sessionEnded) {
        _logoutUnconfirmed = true;
      }
    } on AuthFailure {
      _logoutUnconfirmed = true;
    } on DeviceBridgeException {
      _logoutUnconfirmed = true;
    }
    if (epoch == _epoch || _status == SessionStatus.guest) {
      _notify();
    }
  }

  // ---- profile ---------------------------------------------------------------------------------------------------

  /// GET /v1/customer/me/profile. A 401 ends the session (token and personal values cleared).
  Future<bool> loadProfile() async {
    final int epoch = _epoch;
    final String? token = await bridge.readToken();
    if (token == null) {
      return false;
    }
    try {
      final ApiResponse response = await api.signedCall('GET', '/v1/customer/me/profile', token: token);
      if (epoch != _epoch) {
        return false;
      }
      if (response.status != 200) {
        throw failureOf(response);
      }
      final Object? data = response.data;
      if (data is Map<String, Object?> && data['version'] is int) {
        _profile = Profile(fullName: data['full_name'] as String?, version: data['version']! as int);
        _lastFailure = null;
        _notify();
        return true;
      }
      throw const AuthFailure(AuthFailureKind.badResponse);
    } on AuthFailure catch (failure) {
      await _handleSessionFailure(failure, epoch);
      return false;
    } on DeviceBridgeException {
      await _handleSessionFailure(const AuthFailure(AuthFailureKind.deviceProofRefused), epoch);
      return false;
    }
  }

  /// PUT with expected_version. VERSION_CONFLICT reloads the current profile and does NOT overwrite it. A lost answer keeps the
  /// same key and body for the person's own retry.
  Future<ProfileSave> saveProfile(String fullName) async {
    final Profile? current = _profile;
    final int? version = current?.version;
    if (version == null || _busy) {
      return ProfileSave.failed;
    }
    final int epoch = _epoch;
    final String? token = await bridge.readToken();
    if (token == null) {
      return ProfileSave.failed;
    }
    final String body = jsonEncode(<String, Object?>{'full_name': fullName, 'expected_version': version});
    final String key = _profileKey != null && _profileBody == body ? _profileKey! : newIdempotencyKey();
    _profileKey = key;
    _profileBody = body;
    _setBusy(true);
    try {
      final ApiResponse response = await api.signedCall('PUT', '/v1/customer/me/profile', token: token, body: body, idempotencyKey: key);
      if (epoch != _epoch) {
        return ProfileSave.failed;
      }
      if (response.status == 200) {
        final Object? data = response.data;
        if (data is Map<String, Object?> && data['version'] is int) {
          _profile = Profile(fullName: data['full_name'] as String?, version: data['version']! as int);
          _profileKey = null;
          _profileBody = null;
          _lastFailure = null;
          _notify();
          return ProfileSave.saved;
        }
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      final AuthFailure failure = failureOf(response);
      if (failure.kind == AuthFailureKind.versionConflict) {
        _profileKey = null;
        _profileBody = null;
        await loadProfile();
        return ProfileSave.conflict;
      }
      throw failure;
    } on AuthFailure catch (failure) {
      await _handleSessionFailure(failure, epoch);
      return failure.outcomeUnknown ? ProfileSave.unknown : ProfileSave.failed;
    } on DeviceBridgeException {
      await _handleSessionFailure(const AuthFailure(AuthFailureKind.deviceProofRefused), epoch);
      return ProfileSave.failed;
    } finally {
      if (epoch == _epoch) {
        _setBusy(false);
      }
    }
  }

  String? _profileKey;
  String? _profileBody;

  Future<void> _handleSessionFailure(AuthFailure failure, int epoch) async {
    if (epoch != _epoch) {
      return;
    }
    if (failure.kind == AuthFailureKind.sessionEnded) {
      await _endSession(epoch, notice: true);
      return;
    }
    _lastFailure = failure;
    _notify();
  }
}

enum ProfileSave { saved, conflict, unknown, failed }
