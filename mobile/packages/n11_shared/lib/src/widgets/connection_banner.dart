import 'package:flutter/material.dart';

import '../connection.dart';
import '../errors.dart';
import '../health.dart';
import 'components.dart';

/// Connection banner (catalog F06, C03). One element under the app bar of every screen that does not show the connection state
/// itself. It follows the [HealthMonitor]: nothing is shown while the server is ready, so a stale "connected" mark can never stay on
/// screen; when a check runs, or the server is not usable, it says so in Vietnamese and offers "Thử lại".
class ConnectionBanner extends StatefulWidget {
  const ConnectionBanner({super.key, required this.monitor});

  final HealthMonitor monitor;

  @override
  State<ConnectionBanner> createState() => _ConnectionBannerState();
}

const String kRetryLabel = 'Thử lại';
const String kCheckingLabel = 'Đang kiểm tra…';

BannerKind bannerKindOf(HealthPhase phase) {
  switch (phase) {
    case HealthPhase.ready:
      return BannerKind.success;
    case HealthPhase.checking:
      return BannerKind.info;
    case HealthPhase.backendNotReady:
      return BannerKind.warn;
    case HealthPhase.offline:
    case HealthPhase.timeout:
    case HealthPhase.badResponse:
    case HealthPhase.tlsFailed:
    case HealthPhase.notConfigured:
      return BannerKind.error;
  }
}

IconData bannerIconOf(HealthPhase phase) {
  switch (phase) {
    case HealthPhase.ready:
      return Icons.check_circle_outline;
    case HealthPhase.checking:
      return Icons.info_outline;
    case HealthPhase.backendNotReady:
      return Icons.warning_amber_outlined;
    case HealthPhase.offline:
      return Icons.wifi_off;
    case HealthPhase.timeout:
      return Icons.schedule;
    case HealthPhase.badResponse:
    case HealthPhase.tlsFailed:
    case HealthPhase.notConfigured:
      return Icons.error_outline;
  }
}

class _ConnectionBannerState extends State<ConnectionBanner> {
  /// The last phase that was not "checking". A background re-check after a good answer stays invisible (no flicker every poll);
  /// the first check and any re-check after a problem are shown.
  HealthPhase? _settled;

  @override
  void initState() {
    super.initState();
    _remember();
    widget.monitor.addListener(_onChange);
  }

  @override
  void didUpdateWidget(ConnectionBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.monitor != widget.monitor) {
      oldWidget.monitor.removeListener(_onChange);
      _settled = null;
      _remember();
      widget.monitor.addListener(_onChange);
    }
  }

  @override
  void dispose() {
    widget.monitor.removeListener(_onChange);
    super.dispose();
  }

  void _remember() {
    final HealthPhase phase = widget.monitor.snapshot.phase;
    if (phase != HealthPhase.checking) {
      _settled = phase;
    }
  }

  void _onChange() {
    _remember();
    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final HealthSnapshot snapshot = widget.monitor.snapshot;
    final HealthPhase phase = snapshot.phase;
    if (phase == HealthPhase.ready || (phase == HealthPhase.checking && _settled == HealthPhase.ready)) {
      return const SizedBox.shrink();
    }
    final HealthCopy copy = healthCopy(phase);
    final bool checking = phase == HealthPhase.checking;
    final DateTime? last = snapshot.lastCheckedAt;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Semantics(
        liveRegion: true,
        container: true,
        child: KeyedSubtree(
          key: const Key('connection-banner'),
          child: N11Banner(
            kind: bannerKindOf(phase),
            icon: bannerIconOf(phase),
            title: copy.title,
            text: copy.text,
            meta: last == null ? null : 'Lần kiểm tra gần nhất: ${formatStamp(last)}',
            trailing: phase == HealthPhase.notConfigured
                ? null
                : N11Button(
                    key: const Key('connection-retry'),
                    label: checking ? kCheckingLabel : kRetryLabel,
                    kind: ButtonKind.secondary,
                    compact: true,
                    onPressed: checking ? null : () => widget.monitor.check(),
                  ),
          ),
        ),
      ),
    );
  }
}
