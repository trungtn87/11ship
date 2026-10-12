import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../brand.dart';
import '../config.dart';
import '../connection.dart';
import '../errors.dart';
import '../health.dart';
import '../tokens.dart';
import 'components.dart';
import 'connection_banner.dart';

// Diagnostics (catalog F05 for 11Food, S06 for 11Ship): which app and build this is, and whether the server answers
// /v1/health/live and /v1/health/ready. A technical panel kept apart from the product screens; it shows no business data. Every
// value comes from the AppConfig (build facts passed by CI) or the HealthMonitor (real checks); the fixed wording of failures
// comes from errors.dart, so no raw exception, address of a database or token can appear here.

const String kRecheckLabel = 'Kiểm tra lại';
const String kCopyLabel = 'Sao chép thông tin lỗi';

class DiagnosticsView extends StatefulWidget {
  const DiagnosticsView({super.key, required this.monitor, required this.brand, required this.config});

  final HealthMonitor monitor;
  final AppBrand brand;
  final AppConfig config;

  @override
  State<DiagnosticsView> createState() => _DiagnosticsViewState();
}

class _DiagnosticsViewState extends State<DiagnosticsView> {
  /// Shown when the clipboard cannot be written, so the text can be selected by hand.
  String? _manualReport;

  Future<void> _copy(BuildContext context) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final String report = diagnosticsReport(widget.brand, widget.config, widget.monitor.snapshot);
    try {
      await Clipboard.setData(ClipboardData(text: report));
      if (!mounted) {
        return;
      }
      setState(() => _manualReport = null);
      messenger.showSnackBar(const SnackBar(content: Text('Đã sao chép thông tin chẩn đoán.')));
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _manualReport = report);
      messenger.showSnackBar(const SnackBar(content: Text('Chưa sao chép được. Hãy chọn và sao chép nội dung hiển thị bên dưới.')));
    }
  }

  Widget _row(String label, Widget value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: N11Text.caption),
          const SizedBox(height: 2),
          value,
        ],
      ),
    );
  }

  Widget _text(String value) => Text(value, style: N11Text.bodyStrong);

  Widget _section(String title, List<Widget> rows) {
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Semantics(header: true, child: Text(title, style: N11Text.h2.copyWith(fontSize: 16))),
          const SizedBox(height: N11Space.gap2),
          ...rows,
        ],
      ),
    );
  }

  Widget _probeChip(ProbeResult result) {
    switch (result.state) {
      case ProbeState.pending:
        return const Align(alignment: Alignment.centerLeft, child: N11Chip('Đang kiểm tra', kind: ChipKind.info));
      case ProbeState.skipped:
        return const Align(alignment: Alignment.centerLeft, child: N11Chip('Chưa kiểm tra', kind: ChipKind.soon));
      case ProbeState.ok:
        return Align(alignment: Alignment.centerLeft, child: N11Chip('Đạt · ${result.elapsedMs} ms', kind: ChipKind.ok));
      case ProbeState.failed:
        final HealthFailureReason reason = result.reason!;
        final String status = result.httpStatus == null || reason == HealthFailureReason.notReady ? '' : ' (${result.httpStatus})';
        return Align(
          alignment: Alignment.centerLeft,
          child: N11Chip('${healthReasonLabel(reason)}$status', kind: reason == HealthFailureReason.notReady ? ChipKind.warn : ChipKind.bad),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppConfig config = widget.config;
    return ListenableBuilder(
      listenable: widget.monitor,
      builder: (BuildContext context, Widget? child) {
        final HealthSnapshot health = widget.monitor.snapshot;
        final HealthCopy copy = healthCopy(health.phase);
        final bool checking = health.phase == HealthPhase.checking;
        final bool canRecheck = !checking && health.phase != HealthPhase.notConfigured;
        final DateTime? last = health.lastCheckedAt;
        final Uri? api = config.apiUri;
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap8),
          child: vstack(<Widget>[
            Semantics(
              liveRegion: true,
              container: true,
              child: N11Banner(kind: bannerKindOf(health.phase), icon: bannerIconOf(health.phase), title: copy.title, text: copy.text),
            ),
            _section('Ứng dụng', <Widget>[
              _row('Ứng dụng', _text(widget.brand.name)),
              _row('Mã ứng dụng', _text(config.appId.isEmpty ? 'Chưa rõ' : config.appId)),
              _row('Phiên bản', _text(config.versionLabel)),
              if (config.ciRun.isNotEmpty) _row('Lượt dựng trên CI', _text(config.ciRun)),
              _row('Mã nguồn', _text(config.sourceShaShort)),
              _row('Khóa ký', _text(config.signing.label)),
              if (config.builtAt.isNotEmpty) _row('Dựng lúc', _text(sanitizeDiagnosticText(config.builtAt, maxLength: 40))),
              if (config.flutterVersion.isNotEmpty) _row('Flutter', _text(sanitizeDiagnosticText(config.flutterVersion, maxLength: 20))),
            ]),
            _section('Máy chủ', <Widget>[
              _row('Địa chỉ máy chủ', _text(api == null ? 'Chưa cấu hình' : sanitizeDiagnosticText(api.toString(), maxLength: 120))),
              _row('Còn sống ($kLivePath)', _probeChip(health.live)),
              _row('Sẵn sàng ($kReadyPath)', _probeChip(health.ready)),
              _row('Lần kiểm tra gần nhất', _text(last == null ? 'Chưa có' : formatStamp(last))),
            ]),
            N11Button(
              key: const Key('diag-recheck'),
              label: checking ? kCheckingLabel : kRecheckLabel,
              icon: Icons.refresh,
              onPressed: canRecheck ? () => widget.monitor.check() : null,
            ),
            N11Button(
              key: const Key('diag-copy'),
              label: kCopyLabel,
              kind: ButtonKind.secondary,
              icon: Icons.copy,
              onPressed: () => _copy(context),
            ),
            if (_manualReport != null)
              Container(
                padding: const EdgeInsets.all(N11Space.gap3),
                decoration: BoxDecoration(color: N11Colors.field, borderRadius: BorderRadius.circular(kRadiusControl)),
                child: SelectableText(_manualReport!, key: const Key('diag-report'), style: N11Text.caption.copyWith(color: N11Colors.black)),
              ),
          ]),
        );
      },
    );
  }
}
