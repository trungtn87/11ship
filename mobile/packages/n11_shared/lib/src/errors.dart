// Why a health check failed, in words the person can read, and the last line of defence against a secret reaching the
// screen. Port of apps/client-shared/src/errors.ts. The wording is FIXED here, keyed by closed lists: nothing a server or an
// exception said is ever copied into it. `sanitizeDiagnosticText` exists for the few free-text fragments that are still shown or
// copied (the server address): it removes what looks like a credential.

/// The only reasons a health probe can fail. A closed list on purpose: no free-form error text travels with a result.
enum HealthFailureReason {
  /// The request never reached a server (no network, refused, DNS).
  offline,

  /// No complete answer within the time limit.
  timeout,

  /// The TLS handshake failed (the server certificate is not trusted). Verification is never switched off.
  tls,

  /// The server answered 200 but the body is not the agreed health body.
  badResponse,

  /// /ready answered 503: the process is alive but not ready to serve.
  notReady,

  /// Any other HTTP status.
  unexpectedStatus,
}

/// What the person is told about the connection.
enum HealthPhase { checking, ready, backendNotReady, offline, timeout, badResponse, tlsFailed, notConfigured }

class HealthCopy {
  const HealthCopy(this.title, this.text);

  final String title;
  final String text;
}

/// Vietnamese copy per phase (03-ui-catalog C01-C03, F05/S06).
HealthCopy healthCopy(HealthPhase phase) {
  switch (phase) {
    case HealthPhase.checking:
      return const HealthCopy('Đang kiểm tra kết nối…', 'Vui lòng chờ trong giây lát.');
    case HealthPhase.ready:
      return const HealthCopy('Máy chủ sẵn sàng', 'Ứng dụng đã kết nối được với máy chủ.');
    case HealthPhase.backendNotReady:
      return const HealthCopy('Máy chủ chưa sẵn sàng', 'Máy chủ đã phản hồi nhưng chưa sẵn sàng phục vụ. Vui lòng thử lại sau ít phút.');
    case HealthPhase.offline:
      return const HealthCopy('Không có kết nối mạng', 'Vui lòng kiểm tra kết nối internet và thử lại.');
    case HealthPhase.timeout:
      return const HealthCopy('Máy chủ phản hồi quá lâu', 'Chưa nhận được phản hồi. Vui lòng thử lại.');
    case HealthPhase.badResponse:
      return const HealthCopy(
        'Máy chủ phản hồi chưa đúng',
        'Phản hồi từ máy chủ không như mong đợi. Vui lòng thử lại; nếu vẫn lỗi, hãy gửi thông tin chẩn đoán cho người hỗ trợ.',
      );
    case HealthPhase.tlsFailed:
      return const HealthCopy(
        'Chứng chỉ bảo mật không hợp lệ',
        'Kết nối HTTPS bị từ chối vì chứng chỉ của máy chủ không được tin cậy. Ứng dụng không bỏ qua bước kiểm tra này. Hãy gửi thông tin chẩn đoán cho người hỗ trợ.',
      );
    case HealthPhase.notConfigured:
      return const HealthCopy(
        'Chưa cấu hình địa chỉ máy chủ',
        'Bản dựng này thiếu địa chỉ máy chủ HTTPS (API_BASE_URL). Hãy dựng lại ứng dụng với địa chỉ máy chủ.',
      );
  }
}

/// Short Vietnamese label of a failure reason, for the rows of the diagnostics screen. Never a raw message.
String healthReasonLabel(HealthFailureReason reason) {
  switch (reason) {
    case HealthFailureReason.offline:
      return 'Không kết nối được';
    case HealthFailureReason.timeout:
      return 'Quá thời gian chờ';
    case HealthFailureReason.tls:
      return 'Chứng chỉ không hợp lệ';
    case HealthFailureReason.badResponse:
      return 'Nội dung phản hồi không đúng';
    case HealthFailureReason.notReady:
      return 'Chưa sẵn sàng (503)';
    case HealthFailureReason.unexpectedStatus:
      return 'Mã phản hồi không đúng';
  }
}

const String _redacted = '[đã ẩn]';

// Keys whose value must never be shown. Matched case-insensitively as whole words before ":" or "=".
const String _sensitiveKey =
    r'pass(?:word|wd)?|secret|token|api[_-]?key|authorization|cookie|set-cookie|session(?:[_-]?id)?|otp|dsn|database[_-]?url|credential|private[_-]?key|csrf';

final RegExp _stackLine = RegExp(r'^\s*at\s+\S');
final RegExp _controlChars = RegExp(r'[\u0000-\u001f\u007f-\u009f  ]');
// user:password@host inside any URL / connection string
final RegExp _urlUserInfo = RegExp(r'\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@', caseSensitive: false);
final RegExp _authHeader = RegExp(r'\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}', caseSensitive: false);
final RegExp _keyValue = RegExp(
  r'''(["']?\b(?:''' + _sensitiveKey + r''')s?\b["']?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}]+)''',
  caseSensitive: false,
);
final RegExp _jwt = RegExp(r'\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b');
// any long opaque run (hex, base64, base64url): looks like a key, a hash of a secret or a token
final RegExp _opaque = RegExp(r'[A-Za-z0-9_+/=-]{32,}');
final RegExp _spaces = RegExp(r'\s+');

/// Cleans one free-text fragment before it is shown or copied: drops stack-trace lines, removes control characters, redacts
/// credentials (URL user-info, Bearer/Basic values, password/token/cookie/... pairs, JWTs, long opaque strings) and cuts the
/// result to [maxLength]. It never throws and never returns more than [maxLength] characters.
///
/// Do NOT pass the public source SHA (40 hex characters look like a key and would be hidden) through this.
String sanitizeDiagnosticText(Object? input, {int maxLength = 200}) {
  if (input is! String) {
    return '';
  }
  final String withoutStack = input.split(RegExp(r'\r?\n')).where((String line) => !_stackLine.hasMatch(line)).join(' ');
  String text = withoutStack.replaceAll(_controlChars, ' ');
  text = text.replaceAllMapped(_urlUserInfo, (Match m) => '${m.group(1)}$_redacted@');
  text = text.replaceAllMapped(_authHeader, (Match m) => '${m.group(1)} $_redacted');
  text = text.replaceAllMapped(_keyValue, (Match m) => '${m.group(1)}=$_redacted');
  text = text.replaceAll(_jwt, _redacted);
  text = text.replaceAll(_opaque, _redacted);
  text = text.replaceAll(_spaces, ' ').trim();
  final int limit = maxLength < 1 ? 1 : maxLength;
  return text.length > limit ? '${text.substring(0, limit - 1)}…' : text;
}
