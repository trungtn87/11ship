import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:n11_shared/n11_shared.dart';

const String kOnlineReason = 'Tính năng online và nhận đơn chưa khả dụng trong M01.';

/// Presentation only: M01 has no online mutation or operational GPS controller.
/// Never turn the reference image's sample figures or location into account data.
class ShipHome extends StatelessWidget {
  const ShipHome({super.key, required this.session, required this.onNotifications, this.reset});

  final SessionController session;
  final ResetController? reset;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: session,
    builder: (BuildContext context, Widget? child) => ShipHomeLayout(
      // M01 has no operational online API. Never infer this from profile approval.
      online: false,
      reason: kOnlineReason,
      onNotifications: onNotifications,
      footer: session.status == SessionStatus.guest
          ? N11Link(
              'Đăng nhập tài khoản shipper',
              key: const Key('guest-login'),
              onPressed: session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: shipBrand, reset: reset))) : null,
            )
          : null,
    ),
  );
}

/// Approved visual states without account mutations. The runtime passes Offline;
/// visual tests can exercise Online without granting a role or starting a session.
class ShipHomeLayout extends StatelessWidget {
  const ShipHomeLayout({super.key, required this.online, required this.reason, required this.onNotifications, this.footer});

  final bool online;
  final String reason;
  final VoidCallback onNotifications;
  final Widget? footer;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (BuildContext context, BoxConstraints constraints) {
      final double mapHeight = (constraints.maxHeight - 230).clamp(240.0, 900.0).toDouble();
      return SingleChildScrollView(
        key: const Key('ship-home-scroll'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            SizedBox(
              height: mapHeight,
              child: Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  const _HomeMap(),
                  Positioned(
                    top: 12,
                    left: 16,
                    right: 16,
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: DecoratedBox(
                              decoration: BoxDecoration(color: const Color(0xF0FFFFFF), borderRadius: BorderRadius.circular(12)),
                              child: const Padding(padding: EdgeInsets.all(8), child: BrandLogo(brand: shipBrand, height: 32)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        if (online)
                          const N11Chip('Đang online', kind: ChipKind.ok)
                        else
                          Material(
                            color: N11Colors.white,
                            shape: const CircleBorder(),
                            child: IconButton(
                              key: const Key('home-notifications'),
                              tooltip: 'Thông báo',
                              onPressed: onNotifications,
                              icon: const Icon(Icons.notifications_outlined, color: N11Colors.black),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const Positioned(
                    left: 16,
                    right: 16,
                    bottom: 40,
                    child: N11Chip('Bản đồ khu vực · Chưa có vị trí GPS'),
                  ),
                ],
              ),
            ),
            ShipActivityPanel(online: online, reason: reason, footer: footer),
          ],
        ),
      );
    },
  );
}

class _HomeMap extends StatefulWidget {
  const _HomeMap();

  @override
  State<_HomeMap> createState() => _HomeMapState();
}

class _HomeMapState extends State<_HomeMap> {
  bool _failed = false;
  int _generation = 0;

  @override
  Widget build(BuildContext context) {
    final int generation = _generation;
    return Semantics(
      label: 'Bản đồ khu vực Thành phố Hồ Chí Minh, không phải vị trí hiện tại của bạn',
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          FlutterMap(
          key: const Key('home-map'),
          options: const MapOptions(
            // The reference shows HCMC. This is a regional overview, never a GPS fix.
            initialCenter: LatLng(10.7769, 106.7009),
            initialZoom: 12,
            minZoom: 3,
            maxZoom: 18,
            backgroundColor: N11Colors.bg,
            interactionOptions: InteractionOptions(flags: InteractiveFlag.drag | InteractiveFlag.pinchZoom | InteractiveFlag.doubleTapZoom),
          ),
          children: <Widget>[
            TileLayer(
              key: ValueKey<int>(generation),
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'vn.eleven.ship.test',
              // A failed tile stays neutral; never substitute invented roads or a GPS dot.
              errorTileCallback: (tile, error, stackTrace) {
                WidgetsBinding.instance.addPostFrameCallback((Duration timestamp) {
                  if (mounted && generation == _generation && !_failed) setState(() => _failed = true);
                });
              },
            ),
            const RichAttributionWidget(
              attributions: <SourceAttribution>[TextSourceAttribution('© OpenStreetMap contributors')],
            ),
          ],
        ),
          if (_failed)
            Positioned(
              top: 76,
              left: 16,
              right: 16,
              child: Material(
                color: N11Colors.white,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.only(left: 12),
                  child: Row(
                    children: <Widget>[
                      const Expanded(child: Text('Chưa tải được bản đồ. Kiểm tra kết nối.', style: N11Text.caption)),
                      IconButton(
                        tooltip: 'Tải lại bản đồ',
                        icon: const Icon(Icons.refresh),
                        onPressed: () => setState(() { _failed = false; _generation++; }),
                      ),
                    ],
                  ),
                ),
              ),
            ),
      ],
      ),
    );
  }
}

/// Both approved visual states, kept independent from business state. Runtime
/// passes offline and a null callback until a real online API is connected.
class ShipActivityPanel extends StatelessWidget {
  const ShipActivityPanel({super.key, required this.online, required this.reason, this.onToggle, this.footer});

  final bool online;
  final String reason;
  final VoidCallback? onToggle;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final Color buttonColor = online ? N11Colors.black : N11Colors.yellow;
    final Color buttonInk = online ? N11Colors.white : N11Colors.black;
    return Container(
      key: const Key('home-activity-panel'),
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
      decoration: const BoxDecoration(
        color: N11Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: <BoxShadow>[BoxShadow(color: Color(0x10000000), blurRadius: 16, offset: Offset(0, -4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: online ? N11Colors.successSoft : N11Colors.bg, shape: BoxShape.circle),
                child: Icon(online ? Icons.check_circle : Icons.power_settings_new, color: online ? N11Colors.success : N11Colors.ink2),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(online ? 'Bạn đang online' : 'Bạn đang offline', key: const Key('home-activity-status'), style: N11Text.h2),
                    const SizedBox(height: 2),
                    Text(online ? 'Trạng thái hoạt động' : 'Bật online khi đủ điều kiện hoạt động', style: N11Text.caption),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(reason, key: const Key('home-online-reason'), style: N11Text.caption),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('online-button'),
            onPressed: onToggle,
            style: FilledButton.styleFrom(
              backgroundColor: buttonColor,
              foregroundColor: buttonInk,
              disabledBackgroundColor: buttonColor,
              disabledForegroundColor: buttonInk,
              minimumSize: const Size.fromHeight(48),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusControl)),
            ),
            icon: const Icon(Icons.power_settings_new),
            label: Text(online ? 'Tắt online' : 'Bật online', style: const TextStyle(fontWeight: FontWeight.w800)),
          ),
          if (footer != null) Padding(padding: const EdgeInsets.only(top: 12), child: footer),
        ],
      ),
    );
  }
}
