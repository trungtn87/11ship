import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_m14/n11_m14.dart';

import 'ship_m07.dart';

const String kOnlineReason = 'Chưa có dữ liệu trạng thái hoạt động. Chưa thể bật online.';

class ShipHome extends StatefulWidget {
  const ShipHome({super.key, required this.session, required this.onNotifications, this.reset, this.notifications});
  final SessionController session;
  final ResetController? reset;
  final VoidCallback onNotifications;
  final NotificationController? notifications;

  @override
  State<ShipHome> createState() => _ShipHomeState();
}

class _ShipHomeState extends State<ShipHome> {
  late ShipLocationReporter reporter;
  @override
  void initState() {
    super.initState();
    reporter = reporterFor(widget.session);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge(<Listenable>[widget.session, reporter]),
    builder: (BuildContext context, Widget? child) {
      if (widget.session.status == SessionStatus.signedIn) reporter.observe();
      return ShipHomeLayout(
      reason: kOnlineReason,
      gpsStatus: reporter.gpsStatus,
      position: reporter.position,
      onNotifications: widget.onNotifications,
      bell: widget.notifications == null ? null : NotificationBell(controller: widget.notifications!, onPressed: widget.onNotifications),
      footer: widget.session.status == SessionStatus.guest
          ? N11Link('Đăng nhập tài khoản shipper', key: const Key('guest-login'),
              onPressed: widget.session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: widget.session, brand: shipBrand, reset: widget.reset))) : null)
          : null,
    );
    },
  );
}

class ShipHomeLayout extends StatelessWidget {
  const ShipHomeLayout({super.key, this.online, required this.reason, required this.onNotifications, this.bell, this.footer,
    this.gpsStatus = 'Chưa bật chia sẻ vị trí', this.position});
  final bool? online;
  final String reason;
  final VoidCallback onNotifications;
  final Widget? bell;
  final Widget? footer;
  final String gpsStatus;
  final Map<String, dynamic>? position;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (BuildContext context, BoxConstraints constraints) {
    final double mapHeight = (constraints.maxHeight * .48).clamp(180.0, 440.0).toDouble();
    return SingleChildScrollView(
      key: const Key('ship-home-scroll'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
        Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Row(children: <Widget>[
          const Expanded(child: Align(alignment: Alignment.centerLeft, child: BrandLogo(brand: shipBrand, height: 32))),
          bell ?? IconButton(key: const Key('home-notifications'), tooltip: 'Thông báo', onPressed: onNotifications,
            icon: const Icon(Icons.notifications_outlined, color: N11Colors.black)),
        ])),
        Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 8), child: Text(gpsStatus, key: const Key('home-gps-status'), style: N11Text.caption)),
        _HomeMap(height: mapHeight, position: position),
        ShipActivityPanel(online: online, reason: reason, footer: footer),
      ]),
    );
  });
}

class _HomeMap extends StatefulWidget {
  const _HomeMap({required this.height, this.position});
  final double height;
  final Map<String, dynamic>? position;
  @override
  State<_HomeMap> createState() => _HomeMapState();
}

class _HomeMapState extends State<_HomeMap> {
  String? _error;
  bool _ready = false;
  int _generation = 0;
  int _centerRequest = 0;
  Timer? _timeout;

  @override
  void initState() { super.initState(); _wait(); }
  void _wait() {
    _timeout?.cancel();
    if (kM14MapEnabled) _timeout = Timer(const Duration(seconds: 30), () => _failed('Bản đồ Cao Bằng chưa sẵn sàng. Thử lại hoặc cập nhật ứng dụng có gói bản đồ.'));
  }
  void _failed(String message) {
    if (!mounted) return;
    _timeout?.cancel();
    setState(() => _error = message);
  }
  @override
  void dispose() { _timeout?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final String? unavailable = !kM14MapEnabled
        ? 'Bản cài này chưa bật gói bản đồ Cao Bằng. Cập nhật ứng dụng có bản đồ offline.' : _error;
    if (unavailable != null) {
      return Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: N11Card(
        key: const Key('home-map-unavailable'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          Text(unavailable, style: N11Text.caption),
          if (kM14MapEnabled) TextButton.icon(onPressed: () { setState(() { _error = null; _ready = false; _generation++; }); _wait(); },
            icon: const Icon(Icons.refresh), label: const Text('Thử lại bản đồ')),
        ]),
      ));
    }
    final Map<String, dynamic>? position = widget.position;
    return SizedBox(height: widget.height, child: Stack(fit: StackFit.expand, children: <Widget>[
      Semantics(label: 'Bản đồ offline Cao Bằng; tâm khu vực không phải vị trí shipper', child: M14OfflineMap(
        key: ValueKey<int>(_generation),
        centerRequest: _centerRequest,
        pins: <Map<String, dynamic>>[if (position != null) <String, dynamic>{'lat': position['lat'], 'lon': position['lon'], 'label': 'Vị trí của bạn', 'color': 0xFF1976D2}],
        onReady: () { _timeout?.cancel(); if (mounted) setState(() => _ready = true); },
        onError: _failed,
      )),
      if (!_ready) const Center(child: Text('Đang mở bản đồ Cao Bằng…')),
      Positioned(right: 12, bottom: 28, child: IconButton.filledTonal(
        key: const Key('home-recenter'), tooltip: 'Về vị trí hiện tại',
        onPressed: _ready && position != null ? () => setState(() => _centerRequest++) : null,
        icon: const Icon(Icons.my_location),
      )),
    ]));
  }
}

/// Unknown until the real activity source is connected in M03.
class ShipActivityPanel extends StatelessWidget {
  const ShipActivityPanel({super.key, this.online, required this.reason, this.onToggle, this.footer});
  final bool? online;
  final String reason;
  final VoidCallback? onToggle;
  final Widget? footer;

  @override
  Widget build(BuildContext context) => Container(
    key: const Key('home-activity-panel'),
    padding: const EdgeInsets.all(16),
    decoration: const BoxDecoration(color: N11Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
      Text(online == null ? 'Chưa xác định trạng thái hoạt động' : online! ? 'Bạn đang online' : 'Bạn đang offline',
        key: const Key('home-activity-status'), style: N11Text.h2),
      const SizedBox(height: 8),
      Text(reason, key: const Key('home-online-reason'), style: N11Text.caption),
      const SizedBox(height: 12),
      FilledButton.icon(
        key: const Key('online-button'), onPressed: online == null ? null : onToggle,
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        icon: const Icon(Icons.power_settings_new),
        label: Text(online == null ? 'Bật online · Chưa khả dụng' : online! ? 'Tắt online' : 'Bật online'),
      ),
      if (footer != null) Padding(padding: const EdgeInsets.only(top: 8), child: footer),
    ]),
  );
}
