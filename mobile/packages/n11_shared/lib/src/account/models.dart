import 'package:flutter/foundation.dart';

// What the server says about the signed-in person (contract11 section 2). Everything shown comes from here: the app stores no
// role, no capability and no profile of its own, and grants nothing from a label. Unknown extra fields are ignored; a missing or
// mistyped required field makes the whole object invalid (null), never a half-filled identity.

@immutable
class Profile {
  const Profile({required this.fullName, required this.version});

  final String? fullName;
  final int? version;
}

@immutable
class Identity {
  const Identity({
    required this.userId,
    required this.phoneNormalized,
    required this.availableRoles,
    required this.activeRole,
    required this.profile,
    required this.customerAccess,
    required this.onboardingRequired,
    required this.roleSelectionRequired,
    required this.sessionExpiresAt,
    this.shopOnboarding = 'NOT_STARTED',
    this.driverOnboarding = 'NOT_STARTED',
  });

  final String userId;
  final String phoneNormalized;
  final List<String> availableRoles;
  final String? activeRole;
  final Profile profile;
  final bool customerAccess;
  final bool onboardingRequired;
  final bool roleSelectionRequired;
  final DateTime? sessionExpiresAt;

  /// How far the person got, as the server reports it: NOT_STARTED / INCOMPLETE / COMPLETED for the shop; NOT_STARTED /
  /// PENDING_APPROVAL / ACTIVE / SUSPENDED / CLOSING / CLOSED for the driver. Display only; it grants nothing.
  final String shopOnboarding;
  final String driverOnboarding;

  static Identity? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? userId = data['user_id'];
    final Object? phone = data['phone_normalized'];
    final Object? roles = data['available_roles'];
    final Object? active = data['active_role'];
    final Object? profile = data['profile'];
    final Object? capabilities = data['capabilities'];
    if (userId is! String || phone is! String || roles is! List<Object?> || profile is! Map<String, Object?> || capabilities is! Map<String, Object?>) {
      return null;
    }
    final Object? fullName = profile['full_name'];
    final Object? version = profile['version'];
    final Object? customerAccess = capabilities['customer_access'];
    final Object? onboardingRequired = data['onboarding_required'];
    final Object? roleSelection = data['role_selection_required'];
    if ((fullName != null && fullName is! String) || (version != null && version is! int) || customerAccess is! bool) {
      return null;
    }
    final Object? session = data['session'];
    DateTime? expires;
    if (session is Map<String, Object?> && session['expires_at'] is String) {
      expires = DateTime.tryParse(session['expires_at']! as String);
    }
    final Object? onboarding = data['onboarding'];
    return Identity(
      shopOnboarding: onboarding is Map<String, Object?> && onboarding['shop'] is String ? onboarding['shop']! as String : 'NOT_STARTED',
      driverOnboarding: onboarding is Map<String, Object?> && onboarding['driver'] is String ? onboarding['driver']! as String : 'NOT_STARTED',
      userId: userId,
      phoneNormalized: phone,
      availableRoles: <String>[for (final Object? r in roles) if (r is String) r],
      activeRole: active is String ? active : null,
      profile: Profile(fullName: fullName as String?, version: version as int?),
      customerAccess: customerAccess,
      onboardingRequired: onboardingRequired is bool && onboardingRequired,
      roleSelectionRequired: roleSelection is bool && roleSelection,
      sessionExpiresAt: expires,
    );
  }

  /// "+84 90•• ••• 12": the person recognises their number, the screen never shows it whole.
  String get maskedPhone {
    final String p = phoneNormalized;
    if (p.length < 6) {
      return '••••';
    }
    return '${p.substring(0, p.length - 8)}••• •••${p.substring(p.length - 2)}';
  }
}

/// A refusal by the server or the device, as a closed code (no server text is ever shown).
@immutable
class AuthFailure implements Exception {
  const AuthFailure(this.kind, {this.code, this.status});

  final AuthFailureKind kind;
  final String? code;
  final int? status;

  @override
  String toString() => 'AuthFailure($kind, $code, $status)';
}

enum AuthFailureKind {
  /// No complete answer (offline, timeout): the outcome of a write is UNKNOWN.
  unknownOutcome,

  /// The TLS handshake was refused. Verification is never switched off.
  tls,

  /// 401 INVALID_CREDENTIALS (wrong phone or password): not a session expiry.
  invalidCredentials,

  /// 401 on a session: the token is dead (expired, revoked, replaced).
  sessionEnded,

  /// 403 DEVICE_PROOF_UNSUPPORTED or the device cannot create an attested key.
  deviceUnsupported,

  /// 403 DEVICE_PROOF_*: the server did not accept the proof. Grants nothing.
  deviceProofRefused,

  /// 503 / TRANSACTION_OUTCOME_UNKNOWN: the server cannot answer now. Never downgraded to another platform.
  serverUnavailable,

  /// 409 VERSION_CONFLICT on the profile.
  versionConflict,

  /// 409 PHONE_ALREADY_REGISTERED.
  phoneRegistered,

  /// 409 AUTH_RESULT_NOT_REPLAYABLE / IDEMPOTENCY_REPLAY_EXPIRED: a previous attempt cannot be replayed.
  notReplayable,

  /// 403 ACCOUNT_DISABLED.
  accountDisabled,

  /// 400 and everything else: the request was refused as malformed.
  badRequest,

  /// 429.
  rateLimited,

  /// The server does not support this registration mode on Android (REQUIRED needs an OTP step that is not wired).
  verificationUnsupported,

  /// The server answer could not be understood.
  badResponse,

  /// 409 DRIVER_PROFILE_EXISTS / SHOP_* state conflicts that the server reports for a profile that already moved on.
  stateConflict,

  /// 400 INVALID_SERVICE_AREA: the chosen area is not an ACTIVE one any more.
  invalidServiceArea,

  /// 403 ROLE_NOT_AVAILABLE (a context the account can not wear now).
  roleNotAvailable,
}
