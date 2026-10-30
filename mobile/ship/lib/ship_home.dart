import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_m14/n11_m14.dart';

import 'ship_alerts.dart';
import 'ship_m07.dart';
import 'ship_online.dart';

const String kOnlineReason =
    'Chưa có dữ liệu trạng thái hoạt động. Chưa thể bật online.';

class ShipHome extends StatefulWidget {
  const ShipHome({
    super.key,
    required this.session,
    required this.onNotifications,
    this.reset,
    this.notifications,
    this.driver,
    this.walletSource,
    this.onlineOverride,
    this.liveTick = const Duration(seconds: 15),
  });
  final SessionController session;
  final DriverController? driver;
  final WalletSource? walletSource;
  final ResetController? reset;
  final VoidCallback onNotifications;
  final NotificationController? notifications;

  /// For tests: the online controller to use instead of the session's own.
  final ShipOnline? onlineOverride;

  /// How often the home re-reads the phone's own GPS/network state and re-evaluates what is live while the shipper wants to share (a local read, no request).
  final Duration liveTick;

  @override
  State<ShipHome> createState() => _ShipHomeState();
}

class _ShipHomeState extends State<ShipHome> {
  late ShipLocationReporter reporter;
  late ShipOnline online;
  int _epoch = -1;
  Timer? _tick;
  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(widget.liveTick, (Timer _) {
      if (!mounted) return;
      // Only while the shipper wants to share: re-read the phone (a local call) so a GPS/network change shows without a tap, and let "live" age out.
      if (online.intent || online.hasActiveWork) unawaited(reporter.refresh());
      setState(() {});
    });
    // The online state lives with the session, not with this screen: this only makes sure it is watching.
    online =
        (widget.onlineOverride ??
              shipOnlineFor(widget.session, driver: widget.driver))
          ..attach();
    // The one reporter online already uses: the same GPS source feeds the button, the alert, the label and the map.
    reporter = online.reporter;
    widget.session.addListener(_readDriver);
    _readDriver();
  }

  void _readDriver() {
    if (widget.session.status == SessionStatus.signedIn &&
        _epoch != widget.session.sessionEpoch) {
      _epoch = widget.session.sessionEpoch;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.driver?.load();
      });
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    widget.session.removeListener(_readDriver);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final HealthMonitor? monitor = HealthScope.maybeOf(context);
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[
        widget.session,
        reporter,
        online,
        if (widget.driver != null) widget.driver!,
      ]),
      builder: (BuildContext context, Widget? child) =>
          _layout(context, monitor),
    );
  }

  Widget _layout(BuildContext context, HealthMonitor? monitor) {
    final bool signedIn = widget.session.status == SessionStatus.signedIn;
    final bool acquiring =
        reporter.starting ||
        online.busy ||
        (reporter.sharing && reporter.lastUpload == null) ||
        (!reporter.sharing &&
            reporter.lastUpload == null &&
            online.problem == LocationProblem.none);
    final ShipAlert? alert = !signedIn
        ? null
        : computeShipAlert(
            intent: online.intent,
            hasWork: online.hasActiveWork,
            problem: online.problem,
            internetAvailable: reporter.internetAvailable,
            health: monitor?.snapshot.phase ?? HealthPhase.ready,
            paused: online.paused,
            acquiring: acquiring,
          );
    final ShipLocationView? view = !signedIn || widget.driver?.profile == null
        ? null
        : buildLocationView(
            intent: online.intent,
            hasWork: online.hasActiveWork,
            starting: reporter.starting,
            sharing: reporter.sharing,
            problem: online.problem,
            uploadFailed: reporter.uploadFailed,
            now: reporter.now,
            ackAt: reporter.serverAckAt,
            fixAt: reporter.fixMeasuredAt,
            accuracyMetres: reporter.fixAccuracyMetres,
            hasFix: reporter.position != null,
          );
    return ShipHomeLayout(
      online: widget.driver?.profile?.acceptingDeliveries,
      reason: widget.driver?.profile == null
          ? kOnlineReason
          : (widget.driver!.profile!.readiness.canAccept
                ? 'Ví đủ điều kiện. Bạn có thể bật hoạt động.'
                : widget.driver!.profile!.readiness.blocks
                      .map(driverBlockLabel)
                      .join('\n')),
      onToggle:
          widget.driver?.profile == null ||
              widget.driver!.busy ||
              online.busy ||
              !(widget.driver!.profile!.acceptingDeliveries ||
                  widget.driver!.profile!.readiness.canAccept)
          ? null
          : () => widget.driver!.setAccepting(
              !widget.driver!.profile!.acceptingDeliveries,
            ),
      paused: online.paused,
      busy: online.busy,
      message: online.message,
      // One alert replaces the three separate notices (connection banner, GPS line, problem note): the alert when there is a cause, else the normal
      // connection banner, else nothing.
      alert: alert == null
          ? null
          : ShipAlertBanner(
              alert: alert,
              onAction: (ShipAlertAction a) => unawaited(
                runShipAlertAction(
                  a,
                  online: online,
                  reporter: reporter,
                  monitor: monitor,
                ),
              ),
            ),
      connection: alert == null && monitor != null
          ? ConnectionBanner(monitor: monitor)
          : null,
      locationView: view,
      position: view != null && !view.showPin ? null : reporter.position,
      onNotifications: widget.onNotifications,
      bell: widget.notifications == null
          ? null
          : NotificationBell(
              controller: widget.notifications!,
              onPressed: widget.onNotifications,
            ),
      footer: widget.session.status == SessionStatus.guest
          ? N11Link(
              'Đăng nhập tài khoản shipper',
              key: const Key('guest-login'),
              onPressed: widget.session.ready
                  ? () => Navigator.of(context).push(
                      n11Route(
                        LoginScreen(
                          session: widget.session,
                          brand: shipBrand,
                          reset: widget.reset,
                        ),
                      ),
                    )
                  : null,
            )
          : widget.walletSource == null
          ? null
          : Column(
              children: <Widget>[
                N11Button(
                  label: 'Ví tiền / Nạp tiền',
                  onPressed: () => Navigator.of(context).push(
                    n11Route(WalletHomeScreen(source: widget.walletSource!)),
                  ),
                ),
                if (widget.driver != null)
                  N11Link(
                    'Cập nhật điều kiện nhận đơn',
                    onPressed: widget.driver!.load,
                  ),
                if (widget.driver != null)
                  N11Link(
                    'Thông tin và hoạt động shipper',
                    onPressed: () => Navigator.of(context).push(
                      n11Route(
                        DriverProfileScreen(
                          controller: widget.driver!,
                          walletSource: widget.walletSource,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class ShipHomeLayout extends StatelessWidget {
  const ShipHomeLayout({
    super.key,
    this.online,
    required this.reason,
    required this.onNotifications,
    this.bell,
    this.footer,
    this.gpsStatus,
    this.position,
    this.onToggle,
    this.paused = false,
    this.busy = false,
    this.message,
    this.problem,
    this.alert,
    this.connection,
    this.locationView,
  });
  final bool? online;
  final String reason;
  final VoidCallback onNotifications;
  final VoidCallback? onToggle;
  final Widget? bell;
  final Widget? footer;

  /// The one small status line (null: nothing to say). Comes from the same state as the online button.
  final String? gpsStatus;
  final Map<String, dynamic>? position;
  final bool paused;
  final bool busy;
  final String? message;
  final Widget? problem;

  /// The single alert above the map (#194), or null. [connection] is the normal connection banner, shown only when there is no alert.
  final Widget? alert;
  final Widget? connection;

  /// The map label and its explanation; when given it replaces the small [gpsStatus] line.
  final ShipLocationView? locationView;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (BuildContext context, BoxConstraints constraints) {
      final double mapHeight = (constraints.maxHeight * .40)
          .clamp(N11V5.shipMapMinHeight, N11V5.shipMapMaxHeight)
          .toDouble();
      return SingleChildScrollView(
        key: const Key('ship-home-scroll'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Row(
                children: <Widget>[
                  const Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: BrandLogo(
                        brand: shipBrand,
                        height: N11V5.logoHeight,
                      ),
                    ),
                  ),
                  bell ??
                      IconButton(
                        key: const Key('home-notifications'),
                        tooltip: 'Thông báo',
                        onPressed: onNotifications,
                        icon: const Icon(
                          Icons.notifications_outlined,
                          color: N11Colors.black,
                        ),
                      ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Text(
                'Nhận đơn giao hàng',
                style: N11Text.title.copyWith(fontSize: N11V5.homeTitleSize),
              ),
            ),
            if (alert != null) alert! else if (connection != null) connection!,
            if (gpsStatus != null && locationView == null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Text(
                  gpsStatus!,
                  key: const Key('home-gps-status'),
                  style: N11Text.caption,
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(N11Space.pad),
              child: ShipActivityPanel(
                online: online,
                reason: reason,
                footer: footer,
                onToggle: onToggle,
                paused: paused,
                busy: busy,
                message: message,
                problem: problem,
              ),
            ),

            Container(
              key: const Key('home-v5-map-panel'),
              margin: const EdgeInsets.symmetric(horizontal: N11Space.pad),
              padding: const EdgeInsets.all(N11Space.gap3),
              decoration: BoxDecoration(
                color: N11Colors.white,
                boxShadow: N11V5.cardShadow,
                borderRadius: BorderRadius.circular(N11V5.shipMapRadius),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: N11Space.gap2,
                    runSpacing: N11Space.gap2,
                    children: <Widget>[
                      const Text('Khu vực nhận đơn', style: N11Text.h2),
                      Container(
                        key: Key(
                          position == null
                              ? 'home-radius-pending'
                              : 'home-radius-ready',
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: position == null
                              ? N11Colors.disabledBg
                              : N11Colors.yellowSoft,
                          borderRadius: BorderRadius.circular(kRadiusPill),
                        ),
                        child: Text(
                          position == null
                              ? 'Chờ vị trí để hiện bán kính'
                              : 'Bán kính 3 km',
                          style: N11Text.caption,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: N11Space.gap3),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(N11V5.inputRadius),
                    child: locationView == null
                        ? _HomeMap(height: mapHeight, position: position)
                        : _MapWithLocation(
                            height: mapHeight,
                            position: position,
                            view: locationView!,
                          ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

/// The map with the location label laid over its top-left corner; the (i) opens the explanation right under the map, in the same screen (no dialog).
class _MapWithLocation extends StatefulWidget {
  const _MapWithLocation({
    required this.height,
    required this.position,
    required this.view,
  });
  final double height;
  final Map<String, dynamic>? position;
  final ShipLocationView view;
  @override
  State<_MapWithLocation> createState() => _MapWithLocationState();
}

class _MapWithLocationState extends State<_MapWithLocation> {
  bool _open = false;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: <Widget>[
      Stack(
        children: <Widget>[
          _HomeMap(
            height: widget.height,
            position: widget.position,
            topInset: 56,
          ),
          Positioned(
            top: 8,
            left: 12,
            right: 12,
            child: Align(
              alignment: Alignment.topLeft,
              child: ShipLocationBadge(
                view: widget.view,
                open: _open,
                onToggle: () => setState(() => _open = !_open),
              ),
            ),
          ),
        ],
      ),
      if (_open) ShipLocationExplainer(view: widget.view),
    ],
  );
}

class _HomeMap extends StatefulWidget {
  const _HomeMap({required this.height, this.position, this.topInset = 0});
  final double height;

  /// Space kept free at the top for the location label laid over the map.
  final double topInset;
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
  void initState() {
    super.initState();
    _wait();
  }

  void _wait() {
    _timeout?.cancel();
    if (kM14MapEnabled) {
      _timeout = Timer(
        const Duration(seconds: 30),
        () => _failed(
          'Bản đồ Cao Bằng chưa sẵn sàng. Thử lại hoặc cập nhật ứng dụng có gói bản đồ.',
        ),
      );
    }
  }

  void _failed(String message) {
    if (!mounted) return;
    _timeout?.cancel();
    setState(() => _error = message);
  }

  @override
  void dispose() {
    _timeout?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String? unavailable = !kM14MapEnabled
        ? 'Bản cài này chưa bật gói bản đồ Cao Bằng. Cập nhật ứng dụng có bản đồ offline.'
        : _error;
    if (unavailable != null) {
      return Padding(
        padding: EdgeInsets.fromLTRB(16, 8 + widget.topInset, 16, 8),
        child: N11Card(
          key: const Key('home-map-unavailable'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(unavailable, style: N11Text.caption),
              if (kM14MapEnabled)
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _error = null;
                      _ready = false;
                      _generation++;
                    });
                    _wait();
                  },
                  icon: const Icon(Icons.refresh),
                  label: const Text('Thử lại bản đồ'),
                ),
            ],
          ),
        ),
      );
    }
    final Map<String, dynamic>? position = widget.position;
    return Semantics(
      container: true,
      explicitChildNodes: true,
      liveRegion: _ready,
      label: _ready
          ? 'Bản đồ offline Cao Bằng đã hiển thị'
          : 'Đang mở bản đồ offline Cao Bằng',
      child: SizedBox(
        height: widget.height,
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            M14OfflineMap(
              key: ValueKey<int>(_generation),
              centerRequest: _centerRequest,
              pins: <Map<String, dynamic>>[
                if (position != null)
                  <String, dynamic>{
                    'lat': position['lat'],
                    'lon': position['lon'],
                    'label': 'Vị trí của bạn',
                    'color': 0xFF1976D2,
                  },
              ],
              radiusCircle: position == null
                  ? null
                  : <String, dynamic>{
                      'lat': position['lat'],
                      'lon': position['lon'],
                      'radius_m': 3000.0,
                      'color': 0xFF1976D2,
                      'fill_color': 0x241976D2,
                    },
              onReady: () {
                _timeout?.cancel();
                if (mounted) setState(() => _ready = true);
              },
              onError: _failed,
            ),
            if (!_ready) const Center(child: Text('Đang mở bản đồ Cao Bằng…')),
            Positioned(
              right: 12,
              bottom: 28,
              child: IconButton.filledTonal(
                key: const Key('home-recenter'),
                tooltip: 'Về vị trí hiện tại',
                onPressed: _ready && position != null
                    ? () => setState(() => _centerRequest++)
                    : null,
                icon: const Icon(Icons.my_location),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Unknown until the real activity source is connected in M03.
class ShipActivityPanel extends StatelessWidget {
  const ShipActivityPanel({
    super.key,
    this.online,
    required this.reason,
    this.onToggle,
    this.footer,
    this.paused = false,
    this.busy = false,
    this.message,
    this.problem,
  });

  /// The switch ([online]) is on. Receiving orders also needs [paused] to be false: the server holds a current position.
  final bool? online;
  final String reason;
  final VoidCallback? onToggle;
  final Widget? footer;
  final bool paused;
  final bool busy;

  /// A plain sentence when the server refused turning on (never a code or an id).
  final String? message;

  /// The short instruction and button of a location problem; shown only when there is one.
  final Widget? problem;

  @override
  Widget build(BuildContext context) => N11Card(
    key: const Key('home-activity-panel'),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(N11Space.gap2),
              decoration: BoxDecoration(
                color: online == true && !paused
                    ? N11Colors.successSoft
                    : N11Colors.yellowSoft,
                borderRadius: BorderRadius.circular(N11V5.inputRadius),
              ),
              child: Icon(
                online == true && !paused
                    ? Icons.wifi_tethering
                    : Icons.power_settings_new,
                color: online == true && !paused
                    ? N11Colors.successInk
                    : N11Colors.black,
              ),
            ),
            const SizedBox(width: N11Space.gap3),
            Expanded(
              child: Text(
                online == null
                    ? 'Chưa xác định trạng thái hoạt động'
                    : online!
                    ? (paused ? 'Tạm dừng nhận đơn' : 'Bạn đang online')
                    : 'Bạn đang offline',
                key: const Key('home-activity-status'),
                style: N11Text.h2,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          reason,
          key: const Key('home-online-reason'),
          style: N11Text.caption,
        ),
        if (message != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              message!,
              key: const Key('home-online-message'),
              style: N11Text.captionInk2,
            ),
          ),
        if (problem != null) problem!,
        const SizedBox(height: 12),
        FilledButton.icon(
          key: const Key('online-button'),
          onPressed: online == null || busy ? null : onToggle,
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(56),
            textStyle: N11Text.bodyStrong,
          ),
          icon: busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.power_settings_new),
          label: Text(
            online == null
                ? 'Bật online · Chưa khả dụng'
                : busy
                ? 'Đang xử lý…'
                : online!
                ? 'Tắt online'
                : 'Bật online',
          ),
        ),
        if (online == false)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'Bật online sẽ chia sẻ vị trí của bạn khoảng 1 phút một lần, kể cả khi khóa màn hình, để nhận đơn gần bạn và cho quán biết bạn đang tới. Tắt online để ngừng nhận đơn mới.',
              key: Key('home-online-disclosure'),
              style: N11Text.caption,
            ),
          ),
        if (footer != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: footer),
      ],
    ),
  );
}
