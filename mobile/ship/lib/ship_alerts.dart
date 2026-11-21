import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_m07.dart';
import 'ship_online.dart';

// 11Ship home (#194): ONE alert at the top that says exactly which condition failed and offers the one action that fixes it, and a small always-visible
// location label with an expandable explanation. Both are pure functions of state that already exists (ShipOnline, the reporter's snapshot, the health
// monitor); nothing here sends a position, changes the online switch or invents a second source of GPS.

/// The UI treats a position as live for this long after it was sent/measured (M14: 100 s on screen; the server's own limit is 120 s and it alone decides
/// whether orders are received).
const Duration kLocationLiveWindow = ShipLocationReporter.freshAck;

enum ShipAlertAction { retry, openAppSettings, openLocationSettings, openNotificationSettings }

class ShipAlertButton {
  const ShipAlertButton(this.id, this.label, this.action);

  final String id;
  final String label;
  final ShipAlertAction action;
}

class ShipAlert {
  const ShipAlert({required this.id, required this.title, required this.text, required this.buttons, this.details = const <String>[]});

  /// Stable code of the condition (tests and logs), never shown.
  final String id;
  final String title;
  final String text;
  final List<ShipAlertButton> buttons;

  /// The longer explanation behind "Chi tiết"; the alert itself can never be hidden while the cause lasts.
  final List<String> details;
}

const ShipAlertButton _retry = ShipAlertButton('retry', 'Thử lại', ShipAlertAction.retry);
const ShipAlertButton _locationSettings = ShipAlertButton('location-settings', 'Mở cài đặt vị trí', ShipAlertAction.openLocationSettings);

/// The single alert for the current state, or null. Order of precedence (one alert, never a stack): location permission, GPS off (with the Internet when
/// both are really down), notification permission, Internet down (the phone's own signal), server not answering, no fix, a server-side pause. The
/// "Internet" and "server" messages are never confused: only the operating system's signal may say the phone lost the Internet.
ShipAlert? computeShipAlert({
  required bool intent,
  required bool hasWork,
  required LocationProblem problem,
  required bool? internetAvailable,
  required HealthPhase health,
  required bool paused,
  required bool acquiring,
}) {
  // A shipper who chose to rest (offline, nothing in hand) is not frightened. A failed attempt to go online (a problem set by the tap) is shown.
  if (!intent && !hasWork && problem == LocationProblem.none) {
    return null;
  }
  final bool internetDown = internetAvailable == false;
  final String work = hasWork ? 'Đơn đang giao không bị hủy; vị trí được chia sẻ lại khi sẵn sàng.' : 'Việc nhận đơn tự khôi phục khi đủ điều kiện.';
  if (problem == LocationProblem.permission) {
    return ShipAlert(id: 'permission', title: 'Chưa có quyền vị trí', text: '11Ship chưa được cấp quyền vị trí.', buttons: const <ShipAlertButton>[ShipAlertButton('app-settings', 'Mở cài đặt ứng dụng', ShipAlertAction.openAppSettings), _retry], details: <String>['Cấp quyền Vị trí cho 11Ship trong cài đặt ứng dụng, rồi quay lại.', work]);
  }
  if (problem == LocationProblem.gpsOff && internetDown) {
    return ShipAlert(
      id: 'network-and-gps',
      title: 'Mạng và Vị trí chưa sẵn sàng',
      text: 'Cần xử lý cả hai điều kiện:\n• Internet: điện thoại đang mất kết nối Internet.\n• Vị trí: đang tắt, hãy bật Vị trí.',
      buttons: const <ShipAlertButton>[_locationSettings, ShipAlertButton('retry-network', 'Kiểm tra mạng / Thử lại', ShipAlertAction.retry)],
      details: <String>[work],
    );
  }
  if (problem == LocationProblem.gpsOff) {
    return ShipAlert(id: 'gps-off', title: 'Vị trí đang tắt', text: 'Vị trí đang tắt. Hãy bật Vị trí để tiếp tục nhận đơn.', buttons: const <ShipAlertButton>[_locationSettings, _retry], details: <String>['Bật Vị trí trên điện thoại rồi quay lại 11Ship.', work]);
  }
  if (problem == LocationProblem.notification) {
    return ShipAlert(id: 'notification', title: 'Thiếu quyền thông báo', text: 'Hãy bật thông báo của 11Ship để vị trí được chia sẻ khi bạn dùng ứng dụng khác.', buttons: const <ShipAlertButton>[ShipAlertButton('notification-settings', 'Mở cài đặt thông báo', ShipAlertAction.openNotificationSettings), _retry], details: <String>[work]);
  }
  if (internetDown) {
    return ShipAlert(id: 'internet', title: 'Mất kết nối Internet', text: 'Điện thoại đang mất kết nối Internet.', buttons: const <ShipAlertButton>[ShipAlertButton('retry-network', 'Kiểm tra mạng / Thử lại', ShipAlertAction.retry)], details: <String>['Bật dữ liệu di động hoặc Wi-Fi rồi thử lại.', work]);
  }
  if (healthPhaseIsServerProblem(health)) {
    // The phone may well have Internet: only say that the server cannot be reached.
    return ShipAlert(id: 'server', title: 'Chưa kết nối được máy chủ', text: 'Chưa kết nối được máy chủ. Vui lòng thử lại.', buttons: const <ShipAlertButton>[_retry], details: <String>[if (health == HealthPhase.tlsFailed) 'Kết nối bảo mật tới máy chủ bị từ chối; ứng dụng không bỏ qua bước kiểm tra này.', work]);
  }
  if (problem == LocationProblem.upload) {
    return ShipAlert(id: 'upload', title: 'Chưa gửi được vị trí', text: 'Chưa gửi được vị trí. Kiểm tra kết nối rồi thử lại.', buttons: const <ShipAlertButton>[_retry], details: <String>[work]);
  }
  if (problem == LocationProblem.noFix) {
    return ShipAlert(id: 'no-fix', title: 'Chưa lấy được vị trí', text: 'Chưa lấy được vị trí. Hãy ra nơi thoáng hơn rồi thử lại.', buttons: const <ShipAlertButton>[_retry], details: <String>[work]);
  }
  if (intent && paused && !acquiring) {
    // The server's own verdict (its position is older than 120 s, or never arrived): receiving is paused, nothing is cancelled.
    return ShipAlert(id: 'paused', title: 'Tạm dừng nhận đơn', text: 'Tạm dừng nhận đơn — chưa có vị trí mới.', buttons: const <ShipAlertButton>[_retry], details: <String>[work]);
  }
  return null;
}

enum ShipLocationTone { sharing, acquiring, problem, stale, stopped }

/// The small label on the home map and the text behind its (i).
class ShipLocationView {
  const ShipLocationView({required this.label, required this.tone, required this.paragraphs, required this.facts, required this.showPin, this.brief = const <String>[], this.warnings = const <String>[], this.defaultLine});

  final String label;
  final ShipLocationTone tone;

  /// One short line shown under the map by default (#194 Owner 20/11): the server time of the last valid ACK and the accuracy, only when they are live. Null when neither is.
  final String? defaultLine;

  /// The full long explanation: shown only behind the small (i) inside the opened panel (#392 follow-up: too much text by default).
  final List<String> paragraphs;

  /// The opened panel by default: at most three short lines (last update and accuracy; sharing; the recenter button sends nothing).
  final List<String> brief;

  /// Position problems (not yet on the server; last update is old). Shown whenever the panel is open, never folded into the long text.
  final List<String> warnings;

  /// "Máy chủ nhận vị trí lần cuối: HH:mm", "Độ chính xác ước tính: ~N m", "Vị trí trên điện thoại — chưa gửi lên máy chủ": only fields the data supports.
  final List<String> facts;

  /// Whether the shipper's own marker may be drawn: only for a position that is still live. A stale sample is never drawn as if it were live.
  final bool showPin;
}

String clockText(DateTime t) {
  final DateTime l = t.toLocal();
  return '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

/// [fixAt] is the phone's own measurement time and [ackAt] the server's ACK of the last accepted report: two different facts, never merged.
ShipLocationView buildLocationView({
  required bool intent,
  required bool hasWork,
  required bool starting,
  required bool sharing,
  required LocationProblem problem,
  required bool uploadFailed,
  required DateTime now,
  required DateTime? ackAt,
  required DateTime? fixAt,
  required double? accuracyMetres,
  required bool hasFix,
}) {
  final bool wants = intent || hasWork;
  final bool ackFresh = sharing && ackAt != null && now.difference(ackAt) < kLocationLiveWindow;
  final bool fixLive = hasFix && fixAt != null && now.difference(fixAt) >= Duration.zero && now.difference(fixAt) < kLocationLiveWindow;
  // Owner copy (#392, 2026-11-20 rewrite): these exact sentences are used in the opened panel and in the long text behind the (i).
  const String sharingOnline = 'Khi Online, vị trí được gửi 1 phút/lần, kể cả khi khóa màn hình; người theo dõi đơn xem được vị trí shipper khi có đơn.';
  const String sharingOffline = 'Offline, không có đơn: không chia sẻ vị trí. Khi Online, vị trí được gửi 1 phút/lần, kể cả khi khóa màn hình.';
  const String sharingHandedOff = 'Đã tắt nhận đơn mới nhưng vẫn chia sẻ vị trí cho đơn đang xử lý';
  const String recenterNote = 'Nút định vị chỉ dời bản đồ về GPS của máy';
  final String sharingLine = !wants
      ? sharingOffline
      : intent
          ? sharingOnline
          : sharingHandedOff;
  const String second = 'Vị trí trên điện thoại (GPS) và vị trí đã gửi lên máy chủ là hai việc khác nhau. Chỉ máy chủ quyết định bạn có nhận được đơn; nút “Về vị trí hiện tại” chỉ dời bản đồ về GPS của máy, không gửi vị trí.';
  final bool stale = wants && ackAt != null && !ackFresh;
  final bool phoneOnly = wants && fixLive && (ackAt == null || fixAt.difference(ackAt) > const Duration(seconds: 20));
  final List<String> warnings = <String>[
    if (phoneOnly) 'Vị trí trên điện thoại — chưa gửi lên máy chủ',
    if (stale) 'Vị trí lần cuối lúc ${clockText(ackAt)} — chưa được cập nhật',
  ];
  final List<String> summaryParts = <String>[
    if (ackAt != null) 'Cập nhật lần cuối ${clockText(ackAt)}',
    if (accuracyMetres != null && fixLive) 'độ chính xác ~${accuracyMetres.round()} m',
  ];
  final List<String> facts = <String>[
    if (ackAt != null) ackFresh || !wants ? 'Máy chủ nhận vị trí lần cuối: ${clockText(ackAt)}' : 'Vị trí lần cuối lúc ${clockText(ackAt)} — chưa được cập nhật',
    if (wants && fixLive && (ackAt == null || fixAt.difference(ackAt) > const Duration(seconds: 20))) 'Vị trí trên điện thoại — chưa gửi lên máy chủ',
    if (accuracyMetres != null && fixLive) 'Độ chính xác ước tính: ~${accuracyMetres.round()} m',
  ];
  final List<String> defaultParts = <String>[
    if (ackAt != null && ackFresh) 'Máy chủ nhận vị trí: ${clockText(ackAt)}',
    if (accuracyMetres != null && fixLive) 'Độ chính xác GPS: ~${accuracyMetres.round()} m',
  ];
  final ShipLocationTone tone;
  final String label;
  if (!wants) {
    tone = ShipLocationTone.stopped;
    label = 'Đã dừng chia sẻ vị trí';
  } else if (ackFresh) {
    tone = ShipLocationTone.sharing;
    label = 'Đang chia sẻ vị trí';
  } else if (starting || (problem == LocationProblem.none && !uploadFailed && ackAt == null)) {
    tone = ShipLocationTone.acquiring;
    label = 'Đang lấy vị trí';
  } else if (uploadFailed || problem == LocationProblem.upload) {
    tone = ShipLocationTone.problem;
    label = 'Chưa gửi được vị trí mới';
  } else if (ackAt != null) {
    tone = ShipLocationTone.stale;
    label = 'Vị trí lần cuối ${clockText(ackAt)}';
  } else {
    tone = ShipLocationTone.problem;
    label = 'Chưa gửi được vị trí mới';
  }
  return ShipLocationView(
    label: label,
    tone: tone,
    paragraphs: <String>[sharingLine, second],
    facts: facts,
    showPin: wants && fixLive,
    brief: <String>[if (summaryParts.isNotEmpty) summaryParts.join(' · '), sharingLine, recenterNote],
    warnings: warnings,
    defaultLine: defaultParts.isEmpty ? null : defaultParts.join(' · '),
  );
}

/// The alert, drawn once at the top of the home screen. The explanation can be folded; the alert itself cannot be dismissed.
class ShipAlertBanner extends StatefulWidget {
  const ShipAlertBanner({super.key, required this.alert, required this.onAction});

  final ShipAlert alert;
  final void Function(ShipAlertAction action) onAction;

  @override
  State<ShipAlertBanner> createState() => _ShipAlertBannerState();
}

class _ShipAlertBannerState extends State<ShipAlertBanner> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final ShipAlert a = widget.alert;
    return Padding(
      key: const Key('ship-alert'),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Semantics(
        liveRegion: true,
        container: true,
        child: N11Banner(
          kind: BannerKind.error,
          icon: a.id == 'internet' || a.id == 'network-and-gps' ? Icons.wifi_off : a.id == 'server' ? Icons.cloud_off : Icons.location_off,
          title: a.title,
          text: a.text,
          trailing: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: N11Space.gap3,
                runSpacing: N11Space.gap2,
                children: <Widget>[for (final ShipAlertButton b in a.buttons) N11Button(key: Key('ship-alert-${b.id}'), label: b.label, kind: ButtonKind.secondary, compact: true, onPressed: () => widget.onAction(b.action))],
              ),
              if (a.details.isNotEmpty) ...<Widget>[
                TextButton(key: const Key('ship-alert-more'), style: TextButton.styleFrom(foregroundColor: N11Colors.errorInk), onPressed: () => setState(() => _open = !_open), child: Text(_open ? 'Thu gọn' : 'Chi tiết')),
                if (_open) Column(crossAxisAlignment: CrossAxisAlignment.start, key: const Key('ship-alert-details'), children: <Widget>[for (final String d in a.details) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(d, style: N11Text.caption))]),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The label on the map (always visible while signed in) with its (i). It only reports taps; [ShipLocationExplainer] is the text behind it.
class ShipLocationBadge extends StatelessWidget {
  const ShipLocationBadge({super.key, required this.view, required this.open, required this.onToggle});

  final ShipLocationView view;
  final bool open;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final Color dot = switch (view.tone) {
      ShipLocationTone.sharing => N11Colors.success,
      ShipLocationTone.acquiring => N11Colors.yellow,
      ShipLocationTone.stale => N11Colors.yellowStrong,
      ShipLocationTone.problem => N11Colors.error,
      ShipLocationTone.stopped => N11Colors.ink3,
    };
    return Container(
      key: const Key('home-location-badge'),
      decoration: BoxDecoration(color: N11Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: N11Colors.lineStrong)),
      child: InkWell(
        key: const Key('home-location-info'),
        borderRadius: BorderRadius.circular(20),
        onTap: onToggle,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
            child: Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
              Container(width: 10, height: 10, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
              const SizedBox(width: 8),
              Flexible(child: Text(view.label, key: const Key('home-location-label'), style: N11Text.caption, maxLines: 2)),
              const SizedBox(width: 6),
              Icon(open ? Icons.expand_less : Icons.info_outline, size: 20, color: N11Colors.ink2),
            ]),
          ),
        ),
      ),
    );
  }
}

/// What the map (i) opens: at most three short lines by default (last update and accuracy, sharing, the recenter button), then any position
/// warning in red (never folded away). The long text with the facts sits behind a small (i) inside, closed by default (#392 follow-up).
class ShipLocationExplainer extends StatefulWidget {
  const ShipLocationExplainer({super.key, required this.view});

  final ShipLocationView view;

  @override
  State<ShipLocationExplainer> createState() => _ShipLocationExplainerState();
}

class _ShipLocationExplainerState extends State<ShipLocationExplainer> {
  bool _detail = false;

  @override
  Widget build(BuildContext context) {
    final ShipLocationView v = widget.view;
    final TextStyle small = N11Text.caption.copyWith(fontSize: 12, height: 16 / 12);
    return Container(
      key: const Key('home-location-explainer'),
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(color: N11Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: N11Colors.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
              for (final String line in v.brief)
                Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(line, key: const Key('home-location-brief'), style: small)),
            ]),
          ),
          IconButton(
            key: const Key('home-location-detail'),
            tooltip: _detail ? 'Thu gọn chi tiết vị trí' : 'Chi tiết vị trí',
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            onPressed: () => setState(() => _detail = !_detail),
            icon: Icon(_detail ? Icons.info : Icons.info_outline, size: 18, color: N11Colors.ink2),
          ),
        ]),
        for (final String w in v.warnings)
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 8),
            child: Text(w, key: const Key('home-location-warning'), style: N11Text.bodyStrong.copyWith(fontSize: 12, color: N11Colors.errorInk)),
          ),
        if (_detail) ...<Widget>[
          const SizedBox(height: 6),
          for (final String f in v.facts) Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(f, key: const Key('home-location-fact'), style: small)),
          for (final String p in v.paragraphs) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(p, key: const Key('home-location-long'), style: small)),
        ],
      ]),
    );
  }
}

/// The one retry of the home alert: asks the server again, re-reads the phone's GPS/network state, and retries what the shipper wanted. It never turns
/// the switch on by itself (a shipper who switched off stays off), and the reads are local except one health check.
Future<void> runShipAlertAction(ShipAlertAction action, {required ShipOnline online, required ShipLocationReporter reporter, HealthMonitor? monitor}) async {
  switch (action) {
    case ShipAlertAction.openAppSettings:
      await online.openSettings('app');
    case ShipAlertAction.openLocationSettings:
      await online.openSettings('location');
    case ShipAlertAction.openNotificationSettings:
      await online.openSettings('notifications');
    case ShipAlertAction.retry:
      if (monitor != null) unawaited(monitor.check());
      await reporter.refresh();
      await online.retry();
  }
}
