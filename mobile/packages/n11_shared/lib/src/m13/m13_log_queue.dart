import 'dart:convert';
import 'dart:io';

// M13: errors the app could not send at once wait here. The queue is small on purpose: it never grows without bound, it never holds a secret
// (everything is redacted BEFORE it is stored), the same error is kept once, and every entry has a limited number of delivery attempts.

const List<String> clientLogKinds = <String>['CRASH', 'ACTION_ERROR', 'PUSH_ERROR', 'MAP_ERROR', 'ROUTE_ERROR', 'GPS_STALE'];

/// The limits of the queue and of one delivery batch (the server accepts at most 50 entries per batch and 300 per account per hour).
class LogQueueLimits {
  const LogQueueLimits({
    this.maxEntries = 100,
    this.maxBatch = 50,
    this.maxAttempts = 5,
    this.maxAge = const Duration(days: 6),
    this.recentWindow = const Duration(minutes: 10),
    this.maxRecent = 50,
    this.baseBackoff = const Duration(minutes: 1),
    this.maxBackoff = const Duration(minutes: 30),
  });

  final int maxEntries;
  final int maxBatch;
  final int maxAttempts;

  /// Older than this the server would refuse the entry anyway (it accepts at most a week).
  final Duration maxAge;

  /// The same error is not queued again within this window after it was queued or delivered.
  final Duration recentWindow;
  final int maxRecent;
  final Duration baseBackoff;
  final Duration maxBackoff;
}

final RegExp _bearer = RegExp(r'Bearer\s+[A-Za-z0-9._~+/=-]+', caseSensitive: false);
final RegExp _authHeader = RegExp(r'(authorization|cookie|set-cookie|x-csrf-token|idempotency-key)\s*[:=]\s*[^\s,;]+', caseSensitive: false);
final RegExp _secretPair = RegExp(r'(password|passwd|pwd|otp|code|token|secret|api[_-]?key|credential|pin)\s*[:=]\s*[^\s,;&]+', caseSensitive: false);
final RegExp _email = RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
final RegExp _phone = RegExp(r'(?:\+?84|0)[\s.-]?(?:[0-9][\s.-]?){8,10}');
final RegExp _otpLike = RegExp(r'\b[0-9]{4,8}\b');
final RegExp _longToken = RegExp(r'[A-Za-z0-9_+=-]{24,}');
final RegExp _url = RegExp(r'(https?://[^\s?#]+)[^\s]*');
final RegExp _control = RegExp(r'[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]');

/// Removes what must never leave the phone from a free text: tokens and headers, secret-looking pairs, e-mails, phone numbers, code-like digit runs,
/// long opaque strings and the query part of a link. The result is cut to [maxLength]. The server redacts again; this is the first line.
String redactLogText(String input, {int maxLength = 300}) {
  String text = input.replaceAll(_control, ' ');
  text = text.replaceAll(_bearer, '[redacted]');
  text = text.replaceAllMapped(_authHeader, (Match m) => '${m[1]}=[redacted]');
  text = text.replaceAllMapped(_secretPair, (Match m) => '${m[1]}=[redacted]');
  text = text.replaceAll(_email, '[email]');
  text = text.replaceAllMapped(_url, (Match m) => m[1]!);
  text = text.replaceAll(_phone, '[phone]');
  text = text.replaceAll(_otpLike, '[num]');
  text = text.replaceAll(_longToken, '[redacted]');
  text = text.trim();
  return text.length > maxLength ? text.substring(0, maxLength) : text;
}

/// A code in the server's vocabulary ([A-Z0-9_.:-], 1..48); anything else becomes UNKNOWN.
String normalizeLogCode(String code) {
  final String upper = code.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9_.:-]'), '_');
  if (upper.isEmpty) {
    return 'UNKNOWN';
  }
  return upper.length > 48 ? upper.substring(0, 48) : upper;
}

class ClientLogEntry {
  ClientLogEntry({
    required this.at,
    required this.kind,
    required this.code,
    required this.appVersion,
    this.message = '',
    this.deliveryCode,
    this.attempts = 0,
    this.nextTry,
  });

  final DateTime at;
  final String kind;
  final String code;
  final String appVersion;
  final String message;
  final String? deliveryCode;
  int attempts;
  DateTime? nextTry;

  /// What makes two entries "the same error".
  String get key => '$kind|$code|$appVersion|${message.length > 120 ? message.substring(0, 120) : message}';

  Map<String, Object?> toWire() => <String, Object?>{
        'at': at.toUtc().toIso8601String(),
        'kind': kind,
        'code': code,
        'app_version': appVersion,
        if (message.isNotEmpty) 'message': message,
        if (deliveryCode != null) 'delivery_code': deliveryCode,
      };

  Map<String, Object?> toJson() => <String, Object?>{
        ...toWire(),
        'attempts': attempts,
        if (nextTry != null) 'next_try': nextTry!.toUtc().toIso8601String(),
      };

  static ClientLogEntry? tryParse(Object? raw) {
    if (raw is! Map<String, Object?>) {
      return null;
    }
    final Object? at = raw['at'];
    final Object? kind = raw['kind'];
    final Object? code = raw['code'];
    final Object? version = raw['app_version'];
    if (at is! String || kind is! String || code is! String || version is! String || !clientLogKinds.contains(kind)) {
      return null;
    }
    final DateTime? when = DateTime.tryParse(at);
    if (when == null) {
      return null;
    }
    final Object? message = raw['message'];
    final Object? delivery = raw['delivery_code'];
    final Object? attempts = raw['attempts'];
    final Object? next = raw['next_try'];
    return ClientLogEntry(
      at: when,
      kind: kind,
      code: normalizeLogCode(code),
      appVersion: version,
      message: message is String ? redactLogText(message) : '',
      deliveryCode: delivery is String && delivery.isNotEmpty ? (delivery.length > 32 ? delivery.substring(0, 32) : delivery) : null,
      attempts: attempts is int && attempts >= 0 ? attempts : 0,
      nextTry: next is String ? DateTime.tryParse(next) : null,
    );
  }
}

/// Where the queue is kept between runs. A store that cannot read or write only means the queue lives in memory for this run.
abstract class LogQueueStore {
  Future<String?> read();
  Future<void> write(String content);
}

class FileLogQueueStore implements LogQueueStore {
  /// [resolve] gives the file path (the app's private folder is only known to the native side, so it is asked lazily).
  FileLogQueueStore(this.resolve);

  final Future<String> Function() resolve;

  @override
  Future<String?> read() async {
    try {
      final File file = File(await resolve());
      return await file.exists() ? await file.readAsString() : null;
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(String content) async {
    try {
      final String path = await resolve();
      final File temp = File('$path.tmp');
      await temp.writeAsString(content, flush: true);
      await temp.rename(path);
    } on Object {
      // Memory only for this run.
    }
  }
}

class MemoryLogQueueStore implements LogQueueStore {
  String? content;

  @override
  Future<String?> read() async => content;

  @override
  Future<void> write(String content) async {
    this.content = content;
  }
}

enum DeliveryOutcome {
  /// The server accepted the batch.
  accepted,

  /// Network problem, throttling or a server error: try again later.
  retry,

  /// The session is gone or refused: keep the entries without counting an attempt, deliver after the next sign-in.
  signedOut,

  /// The server refused the batch as malformed: those entries will never be accepted.
  rejected,
}

class ClientLogQueue {
  ClientLogQueue({required this.store, this.limits = const LogQueueLimits(), DateTime Function()? now}) : _now = now ?? DateTime.now;

  final LogQueueStore store;
  final LogQueueLimits limits;
  final DateTime Function() _now;
  final List<ClientLogEntry> _entries = <ClientLogEntry>[];
  final Map<String, DateTime> _recent = <String, DateTime>{};
  bool _loaded = false;
  int dropped = 0;

  int get length => _entries.length;
  List<ClientLogEntry> get entries => List<ClientLogEntry>.unmodifiable(_entries);

  Future<void> load() async {
    if (_loaded) {
      return;
    }
    _loaded = true;
    final String? raw = await store.read();
    if (raw == null) {
      return;
    }
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is List<Object?>) {
        for (final Object? item in decoded) {
          final ClientLogEntry? entry = ClientLogEntry.tryParse(item);
          if (entry != null && !_expired(entry)) {
            _entries.add(entry);
          }
        }
      }
    } on FormatException {
      // A damaged file is dropped, not repaired.
    }
    _trim();
  }

  bool _expired(ClientLogEntry entry) => _now().difference(entry.at) > limits.maxAge || entry.attempts >= limits.maxAttempts;

  /// Queues one error. Returns false when it was dropped as a duplicate or because the kind is not one the server knows.
  Future<bool> add({required String kind, required String code, required String appVersion, String? message, String? deliveryCode}) async {
    await load();
    if (!clientLogKinds.contains(kind)) {
      return false;
    }
    final ClientLogEntry entry = ClientLogEntry(
      at: _now(),
      kind: kind,
      code: normalizeLogCode(code),
      appVersion: appVersion,
      message: message == null ? '' : redactLogText(message),
      deliveryCode: deliveryCode == null || deliveryCode.isEmpty ? null : (deliveryCode.length > 32 ? deliveryCode.substring(0, 32) : deliveryCode),
    );
    _forgetOldRecent();
    if (_recent.containsKey(entry.key) || _entries.any((ClientLogEntry e) => e.key == entry.key)) {
      return false;
    }
    _recent[entry.key] = entry.at;
    if (_recent.length > limits.maxRecent) {
      _recent.remove(_recent.keys.first);
    }
    _entries.add(entry);
    _trim();
    await _save();
    return true;
  }

  void _forgetOldRecent() {
    final DateTime now = _now();
    _recent.removeWhere((String _, DateTime at) => now.difference(at) > limits.recentWindow);
  }

  void _trim() {
    while (_entries.length > limits.maxEntries) {
      _entries.removeAt(0);
      dropped += 1;
    }
  }

  Future<void> _save() => store.write(jsonEncode(_entries.map((ClientLogEntry e) => e.toJson()).toList()));

  /// The entries that may be sent now (not waiting for a back-off), oldest first, at most one batch.
  List<ClientLogEntry> due() {
    final DateTime now = _now();
    return _entries.where((ClientLogEntry e) => e.nextTry == null || !e.nextTry!.isAfter(now)).take(limits.maxBatch).toList();
  }

  /// Delivers one batch through [send] and applies the outcome. Returns true when the queue has nothing due left.
  Future<bool> flush(Future<DeliveryOutcome> Function(List<Map<String, Object?>> batch) send) async {
    await load();
    final List<ClientLogEntry> batch = due();
    if (batch.isEmpty) {
      return true;
    }
    DeliveryOutcome outcome;
    try {
      outcome = await send(batch.map((ClientLogEntry e) => e.toWire()).toList());
    } on Object {
      outcome = DeliveryOutcome.retry;
    }
    switch (outcome) {
      case DeliveryOutcome.accepted:
      case DeliveryOutcome.rejected:
        _entries.removeWhere(batch.contains);
        break;
      case DeliveryOutcome.signedOut:
        break;
      case DeliveryOutcome.retry:
        final DateTime now = _now();
        for (final ClientLogEntry entry in batch) {
          entry.attempts += 1;
          final int factor = 1 << (entry.attempts - 1).clamp(0, 10);
          Duration wait = limits.baseBackoff * factor;
          if (wait > limits.maxBackoff) {
            wait = limits.maxBackoff;
          }
          entry.nextTry = now.add(wait);
        }
        final int before = _entries.length;
        _entries.removeWhere((ClientLogEntry e) => e.attempts >= limits.maxAttempts);
        dropped += before - _entries.length;
        break;
    }
    await _save();
    return due().isEmpty;
  }
}
