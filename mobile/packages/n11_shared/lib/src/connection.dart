import 'brand.dart';
import 'config.dart';
import 'errors.dart';
import 'health.dart';

// The text behind "Sao chép thông tin lỗi": what a support person needs, and nothing that could be a secret. Every line is built
// from the closed vocabulary of errors.dart or from public build facts; the only free-text value (the server address) goes
// through sanitizeDiagnosticText. The source commit is public and is added after sanitizing.

String formatStamp(DateTime moment) {
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(moment.day)}/${two(moment.month)}/${moment.year} ${two(moment.hour)}:${two(moment.minute)}:${two(moment.second)}';
}

String probeLine(String label, ProbeResult result) {
  switch (result.state) {
    case ProbeState.pending:
      return '$label: đang kiểm tra';
    case ProbeState.skipped:
      return '$label: chưa kiểm tra';
    case ProbeState.ok:
      return '$label: đạt (HTTP ${result.httpStatus}, ${result.elapsedMs} ms)';
    case ProbeState.failed:
      final String status = result.httpStatus == null ? '' : ' (HTTP ${result.httpStatus})';
      return '$label: không đạt — ${healthReasonLabel(result.reason!)}$status, ${result.elapsedMs} ms';
  }
}

String diagnosticsReport(AppBrand brand, AppConfig config, HealthSnapshot health) {
  final List<String> lines = <String>[
    'Chẩn đoán ${brand.name}',
    'Mã ứng dụng: ${config.appId.isEmpty ? 'chưa rõ' : sanitizeDiagnosticText(config.appId, maxLength: 80)}',
    'Phiên bản: ${config.versionLabel}',
    if (config.ciRun.isNotEmpty) 'Lượt CI: ${sanitizeDiagnosticText(config.ciRun, maxLength: 20)}',
    'Mã nguồn: ${config.hasKnownSource ? config.sourceSha : 'không rõ'}',
    'Khóa ký: ${config.signing.name}',
    if (config.builtAt.isNotEmpty) 'Dựng lúc: ${sanitizeDiagnosticText(config.builtAt, maxLength: 40)}',
    if (config.flutterVersion.isNotEmpty) 'Flutter: ${sanitizeDiagnosticText(config.flutterVersion, maxLength: 20)}',
    'Địa chỉ máy chủ: ${config.apiUri == null ? 'chưa cấu hình' : sanitizeDiagnosticText(config.apiUri.toString(), maxLength: 120)}',
    'Trạng thái: ${healthCopy(health.phase).title}',
    probeLine('Còn sống (live)', health.live),
    probeLine('Sẵn sàng (ready)', health.ready),
    health.lastCheckedAt == null ? 'Lần kiểm tra gần nhất: chưa có' : 'Lần kiểm tra gần nhất: ${formatStamp(health.lastCheckedAt!)}',
  ];
  return lines.join('\n');
}
