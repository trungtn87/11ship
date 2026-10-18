import 'm08_models.dart';

// The data seam of the M08 screens. A screen or controller asks a source and draws whatever comes back; it never invents a value. Real builds use the HTTP
// source over the signed session (m08_http.dart); tests pass their own. A source throws [NotificationFailure] on a refusal or a lost answer.

enum NotificationFailureKind {
  /// No complete answer (offline, timeout): nothing is known about a write until the person tries again.
  offline,

  /// The session ended or lost its role.
  sessionEnded,

  /// The notification is not the account's (or no longer exists).
  notFound,

  /// The server could not answer now, or its answer was not what the contract says.
  server,
}

class NotificationFailure implements Exception {
  const NotificationFailure(this.kind, {this.code});

  final NotificationFailureKind kind;
  final String? code;

  @override
  String toString() => 'NotificationFailure($kind, $code)';
}

abstract class NotificationSource {
  const NotificationSource();

  Future<NotificationPage> list({required bool unreadOnly, int? before, int limit = 30});

  /// Long poll: everything newer than [after]; waits up to [wait] for the first one. The session is re-checked by the server on every round.
  Future<NotificationPage> changes({required int after, Duration wait = Duration.zero});

  Future<int> unreadCount();
  Future<int> markRead(List<String> ids);
  Future<int> markAllRead();

  /// Opens one notification: marks it read and answers what the CURRENT right and state allow.
  Future<OpenOutcome> open(String id);

  Future<NotificationSettings> settings();
  Future<NotificationSettings> updateSettings(NotificationSettings next);

  /// Binds the phone's push token to THIS session, or ends the binding.
  Future<void> registerPushToken(String token);
  Future<void> unregisterPushToken();
  Future<void> reportPushPermissionDenied();
}
