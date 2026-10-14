/// State of the native gateway service, as reported by MainActivity over the method channel.
/// Nothing here can hold an OTP or a message text: the native side never exposes them.
class GatewayState {
  const GatewayState({
    this.paired = false,
    this.baseUrl,
    this.enabled = false,
    this.authFailed = false,
    this.serviceRunning = false,
    this.smsGranted = false,
    this.notificationsGranted = true,
    this.batteryUnrestricted = false,
    this.lastOkMs,
    this.lastError,
    this.serverSendingEnabled,
    this.sentToday = 0,
    this.failedToday = 0,
    this.pendingReport = false,
    this.appVersion = '',
  });

  final bool paired;
  final String? baseUrl;
  final bool enabled;
  final bool authFailed;
  final bool serviceRunning;
  final bool smsGranted;
  final bool notificationsGranted;
  final bool batteryUnrestricted;
  final int? lastOkMs;
  final String? lastError;
  final bool? serverSendingEnabled;
  final int sentToday;
  final int failedToday;
  final bool pendingReport;
  final String appVersion;

  factory GatewayState.fromMap(Map<dynamic, dynamic>? map) {
    if (map == null) return const GatewayState();
    bool flag(String key, [bool fallback = false]) => map[key] is bool ? map[key] as bool : fallback;
    int count(String key) => map[key] is int ? map[key] as int : 0;
    String? text(String key) => map[key] is String ? map[key] as String : null;
    return GatewayState(
      paired: flag('paired'),
      baseUrl: text('baseUrl'),
      enabled: flag('enabled'),
      authFailed: flag('authFailed'),
      serviceRunning: flag('serviceRunning'),
      smsGranted: flag('smsGranted'),
      notificationsGranted: flag('notificationsGranted', true),
      batteryUnrestricted: flag('batteryUnrestricted'),
      lastOkMs: map['lastOkMs'] is int ? map['lastOkMs'] as int : null,
      lastError: text('lastError'),
      serverSendingEnabled: map['serverSendingEnabled'] is bool ? map['serverSendingEnabled'] as bool : null,
      sentToday: count('sentToday'),
      failedToday: count('failedToday'),
      pendingReport: flag('pendingReport'),
      appVersion: text('appVersion') ?? '',
    );
  }

  /// The VPS line of the status card.
  String vpsStatus() {
    if (!paired) return 'Chưa ghép cặp với VPS.';
    if (authFailed) return 'VPS từ chối mã ghép cặp. Ghép cặp lại bằng mã mới.';
    if (!enabled) return 'Gateway đang tạm dừng.';
    if (!serviceRunning) return 'Dịch vụ nền chưa chạy. Bấm "Bật gateway".';
    final String? error = lastError;
    if (error != null && error.startsWith('ACK_')) {
      return 'Đang chờ báo kết quả gửi SMS trước đó về VPS (${describeError(error)}). Chưa nhận việc mới.';
    }
    if (error != null) return 'Mất kết nối VPS: ${describeError(error)}';
    if (lastOkMs == null) return 'Đang kết nối VPS...';
    if (serverSendingEnabled == false) return 'Đã kết nối VPS, nhưng VPS đang tắt gửi SMS.';
    return 'Đã kết nối VPS.';
  }

  String pairingStatus() {
    if (!paired) return 'Chưa ghép cặp';
    if (authFailed) return 'Bị từ chối';
    return 'Đã ghép cặp${baseUrl == null ? '' : ' (${hostOf(baseUrl!)})'}';
  }

  String lastConnection(DateTime now) {
    final ms = lastOkMs;
    if (ms == null) return 'Chưa có';
    final seconds = now.difference(DateTime.fromMillisecondsSinceEpoch(ms)).inSeconds;
    if (seconds < 5) return 'Vừa xong';
    if (seconds < 60) return '$seconds giây trước';
    if (seconds < 3600) return '${seconds ~/ 60} phút trước';
    return '${seconds ~/ 3600} giờ trước';
  }

  String simStatus() {
    if (!smsGranted) return 'Chưa cấp quyền gửi SMS';
    return 'Đã cấp quyền gửi SMS (SIM mặc định gửi SMS của máy)';
  }
}

String hostOf(String url) {
  final uri = Uri.tryParse(url);
  return uri == null || uri.host.isEmpty ? '?' : uri.host;
}

String describeError(String? code) {
  switch (code) {
    case 'DNS':
      return 'không tìm thấy máy chủ';
    case 'TLS':
      return 'lỗi chứng chỉ HTTPS';
    case 'TIMEOUT':
      return 'quá thời gian chờ';
    case 'NETWORK':
      return 'lỗi mạng';
    case 'UNAUTHORIZED':
      return 'mã ghép cặp bị từ chối';
    case 'NOT_PAIRED':
      return 'chưa ghép cặp';
    case 'START_BLOCKED':
      return 'Android không cho tự khởi động';
    case 'ACK_PENDING':
      return 'chưa báo được';
    case null:
      return '';
    default:
      if (code.startsWith('ACK_HTTP_')) {
        return 'VPS trả mã ${code.substring(9)}';
      }
      return code.startsWith('SERVER_') ? 'VPS lỗi (${code.substring(7)})' : 'lỗi ($code)';
  }
}
