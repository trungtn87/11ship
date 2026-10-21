import 'dart:convert';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'm08_models.dart';
import 'm08_source.dart';

// The HTTP side of the M08 source: signed requests of the session (Bearer + device proof). Every answer is parsed strictly. None of these writes is a
// business command (read marks, settings, the push link), so repeating one is harmless and none needs an Idempotency-Key.

NotificationFailure _failureOf(Object error) {
  if (error is NotificationFailure) {
    return error;
  }
  if (error is AuthFailure) {
    return switch (error.kind) {
      AuthFailureKind.unknownOutcome || AuthFailureKind.tls => const NotificationFailure(NotificationFailureKind.offline),
      AuthFailureKind.sessionEnded => NotificationFailure(NotificationFailureKind.sessionEnded, code: error.code),
      AuthFailureKind.deviceProofRefused || AuthFailureKind.deviceUnsupported => NotificationFailure(NotificationFailureKind.deviceProofRefused, code: error.code),
      _ => error.code == 'NOTIFICATION_NOT_FOUND' ? NotificationFailure(NotificationFailureKind.notFound, code: error.code) : NotificationFailure(NotificationFailureKind.server, code: error.code),
    };
  }
  if (error is FormatException) {
    return const NotificationFailure(NotificationFailureKind.server, code: 'BAD_RESPONSE');
  }
  return const NotificationFailure(NotificationFailureKind.server);
}

class HttpNotificationSource extends NotificationSource {
  const HttpNotificationSource({required this.session});

  final SessionController session;

  Future<Object?> _call(String method, String path, {Object? body}) async {
    try {
      final ApiResponse response = await session.protectedCall(method, path, body: body == null ? null : jsonEncode(body));
      if (response.status != 200) {
        throw failureOf(response);
      }
      return response.data;
    } on Object catch (error) {
      throw _failureOf(error);
    }
  }

  T _parse<T>(T Function() parse) {
    try {
      return parse();
    } on FormatException {
      throw const NotificationFailure(NotificationFailureKind.server, code: 'BAD_RESPONSE');
    }
  }

  @override
  Future<NotificationPage> list({required bool unreadOnly, int? before, int limit = 30}) async {
    final Object? data = await _call('GET', '/v1/notifications?filter=${unreadOnly ? 'unread' : 'all'}&limit=$limit${before == null ? '' : '&before=$before'}');
    return _parse(() => NotificationPage.fromJson(data));
  }

  @override
  Future<NotificationPage> changes({required int after, Duration wait = Duration.zero}) async {
    final Object? data = await _call('GET', '/v1/notifications/changes?after=$after&wait=${wait.inSeconds}');
    return _parse(() => NotificationPage.fromJson(data));
  }

  int _count(Object? data) => _parse(() {
        if (data is Map<String, Object?> && data['unread_count'] is int) {
          return data['unread_count']! as int;
        }
        throw const FormatException('count');
      });

  @override
  Future<int> unreadCount() async => _count(await _call('GET', '/v1/notifications/unread-count'));

  @override
  Future<int> markRead(List<String> ids) async => _count(await _call('POST', '/v1/notifications/read', body: <String, Object?>{'ids': ids}));

  @override
  Future<int> markAllRead() async => _count(await _call('POST', '/v1/notifications/read-all', body: <String, Object?>{}));

  @override
  Future<OpenOutcome> open(String id) async {
    final Object? data = await _call('POST', '/v1/notifications/$id/open', body: <String, Object?>{});
    return _parse(() => OpenOutcome.fromJson(data));
  }

  @override
  Future<NotificationSettings> settings() async {
    final Object? data = await _call('GET', '/v1/notifications/settings');
    return _parse(() => NotificationSettings.fromJson(data));
  }

  @override
  Future<NotificationSettings> updateSettings(NotificationSettings next) async {
    final Object? data = await _call('PUT', '/v1/notifications/settings', body: next.toJson());
    return _parse(() => NotificationSettings.fromJson(data));
  }

  @override
  Future<void> registerPushToken(String token) async {
    await _call('PUT', '/v1/notifications/push-token', body: <String, Object?>{'provider': 'FCM', 'token': token});
  }

  @override
  Future<void> unregisterPushToken() async {
    await _call('DELETE', '/v1/notifications/push-token');
  }

  @override
  Future<void> reportPushPermissionDenied() async {
    await _call('PUT', '/v1/notifications/push-token', body: <String, Object?>{'provider': 'FCM', 'permission': 'DENIED'});
  }
}
