import 'dart:async';

import '../widgets/discovery_controls.dart';

import 'package:flutter/material.dart';

import '../account/account_views.dart' show n11Route;
import '../account/session_controller.dart';
import '../shell.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm08_controller.dart';
import 'm08_models.dart';
import 'm08_push.dart';
import 'm08_source.dart';

// The M08 screens of both apps: the bell with its unread count, the inbox (Tất cả / Chưa đọc, grouped by day, mark one or all read, open the object) and
// the notification settings. They draw what the server said. A push shown on the status bar is never counted as read; opening from the inbox is.

const String kOfflineText = 'Mất kết nối — dữ liệu có thể chưa cập nhật';
const String kNoAccessText = 'Bạn không còn quyền xem nội dung này';
const String kOfferGoneText = 'Đơn này không còn có thể nhận';
const String kEndedText = 'Nội dung này đã kết thúc. Bạn đang xem ở lịch sử.';

/// Where "Hôm nay / Hôm qua / Trước đó" and "5 phút trước" are counted from: the phone's clock, only for wording (the order of rows is the server's).
String groupLabel(DateTime when, DateTime now) {
  final DateTime day = DateTime(when.year, when.month, when.day);
  final DateTime today = DateTime(now.year, now.month, now.day);
  final int diff = today.difference(day).inDays;
  return diff <= 0 ? 'Hôm nay' : (diff == 1 ? 'Hôm qua' : 'Trước đó');
}

String relativeTime(DateTime when, DateTime now) {
  final Duration age = now.difference(when);
  if (age.inSeconds < 60) {
    return 'Vừa xong';
  }
  if (age.inMinutes < 60) {
    return '${age.inMinutes} phút trước';
  }
  if (age.inHours < 24) {
    return '${age.inHours} giờ trước';
  }
  if (age.inDays < 7) {
    return '${age.inDays} ngày trước';
  }
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(when.day)}/${two(when.month)}/${when.year}';
}

IconData _iconOf(NotificationItem item) => switch (item.kind) {
  'NEW_OFFERS' => Icons.inventory_2_outlined,
  'PICKUP_REMINDER' => Icons.inventory_2_outlined,
  'SEARCH_REMINDER' => Icons.schedule,
  'SEARCH_STOPPED' => Icons.priority_high,
  'DELIVERY_FAILED' ||
  'DELIVERY_CANCELLED' ||
  'ASSIGNMENT_RELEASED_BY_ADMIN' => Icons.close,
  'DELIVERY_COMPLETED' => Icons.check,
  'DELIVERY_PICKED_UP' => Icons.delivery_dining_outlined,
  'DELIVERY_ACCEPTED' => Icons.storefront_outlined,
  'TOPUP_CONFIRMED' ||
  'TOPUP_REJECTED' ||
  'WITHDRAWAL_REQUESTED' ||
  'WITHDRAWAL_PROCESSING' ||
  'WITHDRAWAL_RECONCILING' ||
  'WITHDRAWAL_PAID' ||
  'WITHDRAWAL_CANCELLED' => Icons.account_balance_wallet_outlined,
  'PROFILE_APPROVED' ||
  'PROFILE_REJECTED' ||
  'PROFILE_SUSPENDED' ||
  'PROFILE_REOPENED' => Icons.badge_outlined,
  _ => Icons.notifications_outlined,
};

/// The status chip of a row (always text, never colour alone), or null.
(String, ChipKind)? _chipOf(NotificationItem item) {
  if (item.expired &&
      (item.kind == 'NEW_OFFERS' ||
          item.kind == 'PICKUP_REMINDER' ||
          item.kind == 'SEARCH_REMINDER')) {
    return ('Hết hiệu lực', ChipKind.neutral);
  }
  return switch (item.kind) {
    'SEARCH_REMINDER' => ('Đang tìm', ChipKind.warn),
    'SEARCH_STOPPED' => ('Cần xử lý', ChipKind.warn),
    'DELIVERY_FAILED' => ('Giao thất bại', ChipKind.bad),
    'TOPUP_REJECTED' || 'PROFILE_REJECTED' => ('Bị từ chối', ChipKind.bad),
    _ => null,
  };
}

/// The bell at the top of a screen, with the number of unread notifications.
class NotificationBell extends StatelessWidget {
  const NotificationBell({
    super.key,
    required this.controller,
    required this.onPressed,
  });

  final NotificationController controller;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final int unread = controller.unreadCount;
        return Semantics(
          button: true,
          label: unread > 0 ? 'Thông báo, $unread chưa đọc' : 'Thông báo',
          excludeSemantics: true,
          child: Stack(
            clipBehavior: Clip.none,
            children: <Widget>[
              IconButton(
                key: const Key('bell'),
                tooltip: 'Thông báo',
                constraints: const BoxConstraints(
                  minWidth: kTapMin,
                  minHeight: kTapMin,
                ),
                onPressed: onPressed,
                icon: const Icon(
                  Icons.notifications_outlined,
                  color: N11Colors.black,
                ),
              ),
              if (unread > 0)
                Positioned(
                  right: 4,
                  top: 4,
                  child: NotificationBadge(
                    key: const Key('bell-count'),
                    count: unread,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// Routes an opened notification to its object. The apps implement it (what a delivery detail or a wallet screen is differs per app).
typedef NotificationRouter = Future<void> Function(
  BuildContext context,
  NotificationItem? item,
  OpenOutcome outcome,
  ShellActions actions,
);

/// Opens one notification: asks the server (right and state are re-checked now), then routes, or says why it cannot be opened. Shared by the inbox row and by
/// a tap on a push. A lost connection is stated and nothing is shown as read.
Future<void> openNotification(
  BuildContext context,
  NotificationController controller,
  NotificationRouter router,
  ShellActions actions, {
  NotificationItem? item,
  String? id,
}) async {
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  OpenOutcome outcome;
  final String notificationId = item?.id ?? id!;
  final String? openingUserId = controller.session.identity?.userId;
  try {
    outcome = item != null
        ? await controller.open(item)
        : await controller.openById(notificationId);
  } on NotificationFailure catch (failure) {
    if (failure.kind == NotificationFailureKind.sessionEnded) {
      controller.requestOpen(notificationId, expectedUserId: openingUserId);
      actions.goTab('account');
    }
    messenger.showSnackBar(
      SnackBar(
        content: Text(switch (failure.kind) {
          NotificationFailureKind.offline => kOfflineText,
          NotificationFailureKind.notFound => 'Không tìm thấy thông báo này.',
          NotificationFailureKind.sessionEnded => 'Phiên đăng nhập đã hết hạn.',
          NotificationFailureKind.deviceProofRefused =>
            'Chưa xác thực được thiết bị. Hãy thử lại.',
          NotificationFailureKind.server =>
            'Chưa mở được thông báo. Hãy thử lại.',
        }),
      ),
    );
    return;
  }
  if (!context.mounted) {
    return;
  }
  if (outcome.kind == OpenKind.noAccess) {
    // Food accounts can own both hats. The first open is deliberately made
    // under the current server context; only a server-granted second context
    // is tried, and the object endpoint is checked again after switching.
    final SessionController session = controller.session;
    final String? originalRole = session.identity?.activeRole;
    final String? alternateRole =
        originalRole == 'CUSTOMER' &&
            session.identity?.availableRoles.contains('SHOP_OWNER') == true
        ? 'SHOP_OWNER'
        : originalRole == 'SHOP_OWNER' &&
              session.identity?.availableRoles.contains('CUSTOMER') == true
        ? 'CUSTOMER'
        : null;
    if (alternateRole != null) {
      try {
        await session.selectContext(alternateRole);
        outcome = await controller.openById(notificationId);
      } on Object {
        outcome = const OpenOutcome(kind: OpenKind.noAccess, expired: false);
      }
      if (outcome.kind == OpenKind.noAccess &&
          originalRole != null &&
          session.identity?.activeRole != originalRole) {
        try {
          await session.selectContext(originalRole);
        } on Object {
          // The server may have revoked that context meanwhile; never invent it locally.
        }
      }
    }
    if (outcome.kind == OpenKind.noAccess) {
      messenger.showSnackBar(const SnackBar(content: Text(kNoAccessText)));
      return;
    }
  }
  if (outcome.expired && (item?.kind == 'NEW_OFFERS')) {
    messenger.showSnackBar(const SnackBar(content: Text(kOfferGoneText)));
  } else if (outcome.kind == OpenKind.ended) {
    messenger.showSnackBar(const SnackBar(content: Text(kEndedText)));
  }
  if (!context.mounted) {
    return;
  }
  await router(context, item, outcome, actions);
}

// ---- inbox -------------------------------------------------------------------------------------------------------------------

class NotificationInboxBody extends StatefulWidget {
  const NotificationInboxBody({
    super.key,
    required this.controller,
    required this.router,
    required this.actions,
    this.now,
  });

  final NotificationController controller;
  final NotificationRouter router;
  final ShellActions actions;

  /// Tests only.
  final DateTime Function()? now;

  @override
  State<NotificationInboxBody> createState() => _NotificationInboxBodyState();
}

class _NotificationInboxBodyState extends State<NotificationInboxBody> {
  NotificationController get c => widget.controller;
  DateTime _now() => widget.now?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(c.load());
    });
  }

  Future<void> _tap(NotificationItem item) =>
      openNotification(context, c, widget.router, widget.actions, item: item);

  Widget _filters() => Row(
    children: <Widget>[
      Expanded(
        child: N11Button(
          key: const Key('filter-all'),
          label: 'Tất cả',
          compact: false,
          kind: c.unreadOnly ? ButtonKind.secondary : ButtonKind.primary,
          onPressed: () => unawaited(c.setUnreadOnly(false)),
        ),
      ),
      const SizedBox(width: N11Space.gap3),
      Expanded(
        child: N11Button(
          key: const Key('filter-unread'),
          label: c.unreadCount > 0 ? 'Chưa đọc (${c.unreadCount})' : 'Chưa đọc',
          kind: c.unreadOnly ? ButtonKind.primary : ButtonKind.secondary,
          onPressed: () => unawaited(c.setUnreadOnly(true)),
        ),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final DateTime now = _now();
        final List<Widget> body = <Widget>[
          if (c.offline)
            const N11Banner(
              key: Key('inbox-offline'),
              kind: BannerKind.warn,
              title: kOfflineText,
            ),
          _filters(),
        ];
        switch (c.state) {
          case InboxLoad.idle:
          case InboxLoad.loading:
            if (c.items.isEmpty) {
              body.add(const _InboxSkeleton());
            } else {
              body.addAll(_rows(now));
            }
          case InboxLoad.failed:
            body.addAll(<Widget>[
              const N11StateBlock(
                kind: StateKind.warn,
                title: 'Không tải được thông báo',
                text: 'Chưa nhận được dữ liệu từ máy chủ. Chưa có gì bị thay đổi.',
              ),
              N11Button(
                key: const Key('inbox-retry'),
                label: 'Thử lại',
                onPressed: () => unawaited(c.load()),
              ),
            ]);
          case InboxLoad.ready:
            if (c.items.isEmpty) {
              body.add(
                EmptyState(
                  icon: Icons.notifications_none,
                  title: c.unreadOnly
                      ? 'Không có thông báo chưa đọc'
                      : 'Chưa có thông báo',
                  text: c.unreadOnly ? 'Bạn đã đọc hết thông báo.' : 'Thông báo về đơn hàng, giao hàng, ví và hồ sơ sẽ hiện ở đây.',
                ),
              );
            } else {
              body.addAll(_rows(now));
            }
        }
        return RefreshIndicator(
          onRefresh: c.load,
          child: ListView(
            key: const Key('inbox-list'),
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(
              N11Space.pad,
              N11Space.gap4,
              N11Space.pad,
              N11Space.gap8,
            ),
            children: <Widget>[
              for (final Widget w in body)
                Padding(
                  padding: const EdgeInsets.only(bottom: N11Space.gap3),
                  child: w,
                ),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _rows(DateTime now) {
    final List<Widget> out = <Widget>[];
    String? group;
    for (final NotificationItem item in c.items) {
      final String label = groupLabel(item.createdAt, now);
      if (label != group) {
        group = label;
        out.add(
          Padding(
            padding: const EdgeInsets.only(left: 4, top: N11Space.gap2),
            child: Text(
              label,
              style: N11Text.label.copyWith(color: N11Colors.ink2),
            ),
          ),
        );
      }
      out.add(
        NotificationRow(
          key: Key('row-${item.id}'),
          item: item,
          now: now,
          onTap: () => unawaited(_tap(item)),
        ),
      );
    }
    if (c.hasMore) {
      out.add(
        N11Button(
          key: const Key('inbox-more'),
          label: 'Xem thêm',
          kind: ButtonKind.secondary,
          loading: c.loadingMore,
          onPressed: () => unawaited(c.loadMore()),
        ),
      );
    }
    return out;
  }
}

class _InboxSkeleton extends StatelessWidget {
  const _InboxSkeleton();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Đang tải thông báo',
      child: Column(
        key: const Key('inbox-skeleton'),
        children: <Widget>[
          for (int i = 0; i < 4; i++)
            Container(
              height: 76,
              margin: const EdgeInsets.only(bottom: N11Space.gap3),
              decoration: BoxDecoration(
                color: N11Colors.white,
                border: Border.all(color: N11Colors.line),
                borderRadius: BorderRadius.circular(kRadiusCard),
              ),
            ),
        ],
      ),
    );
  }
}

class NotificationRow extends StatelessWidget {
  const NotificationRow({
    super.key,
    required this.item,
    required this.now,
    required this.onTap,
  });

  final NotificationItem item;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bool unread = !item.read;
    final (String, ChipKind)? chip = _chipOf(item);
    final bool negative = <String>{
      'DELIVERY_FAILED',
      'DELIVERY_CANCELLED',
      'ASSIGNMENT_RELEASED_BY_ADMIN',
      'TOPUP_REJECTED',
    }.contains(item.kind);
    final bool positive = <String>{
      'DELIVERY_COMPLETED',
      'TOPUP_CONFIRMED',
      'PROFILE_APPROVED',
    }.contains(item.kind);
    final Color tile = negative
        ? N11Colors.errorSoft
        : (positive
              ? N11Colors.successSoft
              : (unread ? N11Colors.yellowSoft : N11Colors.chipSoon));
    final Color ink = negative
        ? N11Colors.error
        : (positive ? N11Colors.success : N11Colors.black);
    return Semantics(
      button: true,
      label: '${unread ? 'Chưa đọc. ' : ''}${item.title}. ${item.body}',
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: unread ? N11Colors.yellowFaint : N11Colors.white,
        shape: RoundedRectangleBorder(
          side: BorderSide(
            color: unread ? N11Colors.yellowSoft : N11Colors.line,
          ),
          borderRadius: BorderRadius.circular(kRadiusCard),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: tile,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(_iconOf(item), size: 22, color: ink),
                ),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              item.title,
                              style: TextStyle(
                                fontSize: 15,
                                height: 1.35,
                                fontWeight: unread
                                    ? FontWeight.w800
                                    : FontWeight.w700,
                                color: N11Colors.black,
                              ),
                            ),
                          ),
                          if (chip != null) ...<Widget>[
                            const SizedBox(width: 6),
                            N11Chip(chip.$1, kind: chip.$2),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(item.body, style: N11Text.caption),
                      const SizedBox(height: 4),
                      Text(
                        relativeTime(item.createdAt, now),
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.4,
                          fontWeight: FontWeight.w500,
                          color: N11Colors.ink3,
                        ),
                      ),
                    ],
                  ),
                ),
                if (unread)
                  Container(
                    key: const Key('unread-dot'),
                    margin: const EdgeInsets.only(left: 8, top: 4),
                    width: 10,
                    height: 10,
                    decoration: const BoxDecoration(
                      color: N11Colors.yellow,
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The inbox as a page opened from the bell (back arrow, "Đánh dấu đã đọc").
class NotificationInboxScreen extends StatelessWidget {
  const NotificationInboxScreen({
    super.key,
    required this.controller,
    required this.router,
    required this.actions,
    this.settingsBuilder,
  });

  final NotificationController controller;
  final NotificationRouter router;
  final ShellActions actions;

  /// Opens the settings page (an entry at the top right).
  final WidgetBuilder? settingsBuilder;

  Future<void> _markAll(BuildContext context) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await controller.markAllRead();
    } on NotificationFailure catch (failure) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            failure.kind == NotificationFailureKind.offline
                ? kOfflineText
                : 'Chưa đánh dấu được. Hãy thử lại.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: N11Colors.bg,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Container(
              constraints: const BoxConstraints(minHeight: 52),
              decoration: const BoxDecoration(
                color: N11Colors.white,
                border: Border(bottom: BorderSide(color: N11Colors.line)),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Row(
                children: <Widget>[
                  IconButton(
                    tooltip: 'Quay lại',
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(
                      Icons.chevron_left,
                      size: 32,
                      color: N11Colors.black,
                    ),
                  ),
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: const Text('Thông báo', style: N11Text.barTitle),
                    ),
                  ),
                  TextButton.icon(
                    key: const Key('mark-all'),
                    onPressed: () => unawaited(_markAll(context)),
                    icon: const Icon(
                      Icons.done_all,
                      size: 18,
                      color: N11Colors.black,
                    ),
                    label: const Text(
                      'Đánh dấu\nđã đọc',
                      textAlign: TextAlign.left,
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.2,
                        fontWeight: FontWeight.w600,
                        color: N11Colors.black,
                      ),
                    ),
                  ),
                  if (settingsBuilder != null)
                    IconButton(
                      key: const Key('open-notification-settings'),
                      tooltip: 'Cài đặt thông báo',
                      onPressed: () =>
                          Navigator.of(context)
                              .push(n11Route(settingsBuilder!(context))),
                      icon: const Icon(Icons.tune, color: N11Colors.black),
                    ),
                ],
              ),
            ),
            Expanded(
              child: NotificationInboxBody(
                controller: controller,
                router: router,
                actions: actions,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The inbox as the body of the existing "Thông báo" tab (Ship), with the same mark-all and settings entries on top.
class NotificationTabBody extends StatelessWidget {
  const NotificationTabBody({
    super.key,
    required this.controller,
    required this.router,
    required this.actions,
    this.settingsBuilder,
  });

  final NotificationController controller;
  final NotificationRouter router;
  final ShellActions actions;
  final WidgetBuilder? settingsBuilder;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Align(
          alignment: Alignment.centerRight,
          child: Wrap(
            children: <Widget>[
              TextButton.icon(
                key: const Key('mark-all'),
                onPressed: () async {
                  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(
                    context,
                  );
                  try {
                    await controller.markAllRead();
                  } on NotificationFailure catch (failure) {
                    messenger.showSnackBar(
                      SnackBar(
                        content: Text(
                          failure.kind == NotificationFailureKind.offline
                              ? kOfflineText
                              : 'Chưa đánh dấu được. Hãy thử lại.',
                        ),
                      ),
                    );
                  }
                },
                icon: const Icon(
                  Icons.done_all,
                  size: 18,
                  color: N11Colors.black,
                ),
                label: const Text(
                  'Đánh dấu tất cả đã đọc',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: N11Colors.black,
                  ),
                ),
              ),
              if (settingsBuilder != null)
                IconButton(
                  key: const Key('open-notification-settings'),
                  tooltip: 'Cài đặt thông báo',
                  onPressed: () =>
                      Navigator.of(context)
                          .push(n11Route(settingsBuilder!(context))),
                  icon: const Icon(Icons.tune, color: N11Colors.black),
                ),
            ],
          ),
        ),
        Expanded(
          child: NotificationInboxBody(
            controller: controller,
            router: router,
            actions: actions,
          ),
        ),
      ],
    );
  }
}

// ---- settings ----------------------------------------------------------------------------------------------------------------

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({
    super.key,
    required this.source,
    required this.push,
    required this.shipper,
  });

  final NotificationSource source;
  final PushSync push;

  /// Only the Shipper app has the "Đơn có thể nhận" group.
  final bool shipper;

  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen>
    with WidgetsBindingObserver {
  NotificationSettings? _settings;
  bool _failed = false;
  bool _offline = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back from the phone's own settings: read the permission again.
    if (state == AppLifecycleState.resumed) {
      unawaited(
        widget.push.resync().then((_) {
          if (mounted) {
            setState(() {});
          }
        }),
      );
    }
  }

  Future<void> _load() async {
    setState(() {
      _failed = false;
      _offline = false;
    });
    try {
      final NotificationSettings s = await widget.source.settings();
      await widget.push.resync();
      if (mounted) {
        setState(() => _settings = s);
      }
    } on NotificationFailure catch (failure) {
      if (mounted) {
        setState(() {
          _failed = true;
          _offline = failure.kind == NotificationFailureKind.offline;
        });
      }
    }
  }

  /// The change is shown only after the server confirmed it; a lost answer leaves the switch where it was and says so.
  Future<void> _change(NotificationSettings next) async {
    if (_saving) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final NotificationSettings saved = await widget.source.updateSettings(
        next,
      );
      if (mounted) {
        setState(() => _settings = saved);
      }
    } on NotificationFailure catch (failure) {
      if (mounted) {
        setState(
          () => _error = failure.kind == NotificationFailureKind.offline
              ? kOfflineText
              : 'Chưa lưu được. Hãy thử lại.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  Widget _switch(
    Key key,
    IconData icon,
    String title,
    String? sub,
    bool value,
    NotificationSettings Function(bool) next,
  ) {
    return N11ListItem(
      icon: icon,
      title: title,
      sub: sub,
      trailing: Switch(
        key: key,
        value: value,
        activeThumbColor: N11Colors.black,
        activeTrackColor: N11Colors.yellow,
        onChanged: _saving ? null : (bool v) => unawaited(_change(next(v))),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final NotificationSettings? s = _settings;
    final PushSync push = widget.push;
    final Widget body;
    if (s == null) {
      body = _failed
          ? Column(
              children: <Widget>[
                N11StateBlock(
                  kind: StateKind.warn,
                  title: _offline ? kOfflineText : 'Không tải được cài đặt',
                  text: 'Chưa có gì bị thay đổi.',
                ),
                N11Button(
                  key: const Key('settings-retry'),
                  label: 'Thử lại',
                  onPressed: () => unawaited(_load()),
                ),
              ],
            )
          : const Center(
              child: Padding(
                padding: EdgeInsets.all(N11Space.gap8),
                child: CircularProgressIndicator(color: N11Colors.yellow),
              ),
            );
    } else {
      final String permission = !push.supported
          ? 'Chưa hỗ trợ trên bản này'
          : (push.permission == PushPermission.granted
                ? 'Đang bật'
                : (push.permission == PushPermission.denied
                      ? 'Đang tắt'
                      : 'Chưa cấp'));
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: N11Space.gap3),
              child: N11Banner(
                key: const Key('settings-error'),
                kind: BannerKind.error,
                title: _error!,
              ),
            ),
          if (!s.pushAvailable)
            const Padding(
              padding: EdgeInsets.only(bottom: N11Space.gap3),
              child: N11Banner(
                key: Key('push-unavailable'),
                kind: BannerKind.info,
                title: 'Thông báo đẩy chưa sẵn sàng',
                text: 'Thông báo vẫn vào hộp thông báo khi bạn mở ứng dụng.',
              ),
            ),
          N11List(
            title: 'Nhận thông báo về',
            children: <Widget>[
              _switch(
                const Key('set-orders'),
                Icons.inventory_2_outlined,
                'Đơn hàng và giao hàng',
                null,
                s.orders,
                (bool v) => s.copyWith(orders: v),
              ),
              _switch(
                const Key('set-reminders'),
                Icons.notifications_outlined,
                'Nhắc việc',
                null,
                s.reminders,
                (bool v) => s.copyWith(reminders: v),
              ),
              _switch(
                const Key('set-wallet'),
                Icons.account_balance_wallet_outlined,
                'Ví và hồ sơ',
                null,
                s.walletProfile,
                (bool v) => s.copyWith(walletProfile: v),
              ),
              if (widget.shipper && s.available != null)
                _switch(
                  const Key('set-available'),
                  Icons.two_wheeler,
                  'Đơn có thể nhận',
                  'Dành cho shipper',
                  s.available!,
                  (bool v) => s.copyWith(available: v),
                ),
            ],
          ),
          const SizedBox(height: N11Space.gap4),
          N11List(
            title: 'Cài đặt âm thanh',
            children: <Widget>[
              _switch(
                const Key('set-sound'),
                Icons.music_note_outlined,
                'Âm thanh',
                null,
                s.sound,
                (bool v) => s.copyWith(sound: v),
              ),
              _switch(
                const Key('set-vibrate'),
                Icons.smartphone,
                'Rung',
                null,
                s.vibrate,
                (bool v) => s.copyWith(vibrate: v),
              ),
            ],
          ),
          const SizedBox(height: N11Space.gap4),
          N11List(
            children: <Widget>[
              N11ListItem(
                key: const Key('system-permission'),
                icon: Icons.settings_outlined,
                title: 'Quyền thông báo',
                sub: permission,
                onTap: !push.supported
                    ? null
                    : () => unawaited(
                        push.permission == PushPermission.unknown
                            ? push.askPermission().then(
                                (_) => mounted ? setState(() {}) : null,
                              )
                            : widget.push.port.openSystemSettings(),
                      ),
              ),
            ],
          ),
          if (push.supported && push.permission != PushPermission.granted)
            const Padding(
              padding: EdgeInsets.only(top: N11Space.gap3),
              child: N11Banner(
                key: Key('permission-help'),
                kind: BannerKind.warn,
                title: 'Chưa nhận được thông báo khi tắt màn hình',
                text: 'Mở Cài đặt điện thoại › Thông báo và bật thông báo cho ứng dụng. Mở ứng dụng vẫn cập nhật trạng thái.',
              ),
            ),
          const Padding(
            padding: EdgeInsets.fromLTRB(4, N11Space.gap3, 4, 0),
            child: Row(
              children: <Widget>[
                Icon(Icons.info_outline, size: 16, color: N11Colors.ink2),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Tắt âm thanh không làm tắt nhận đơn.',
                    style: N11Text.caption,
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    }
    return Scaffold(
      backgroundColor: N11Colors.bg,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            const N11AppBarBack(title: 'Thông báo'),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  N11Space.pad,
                  N11Space.gap4,
                  N11Space.pad,
                  N11Space.gap8,
                ),
                child: body,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The app bar of a pushed page: back arrow and title.
class N11AppBarBack extends StatelessWidget {
  const N11AppBarBack({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) =>
      N11AppBar(title: title, onBack: () => Navigator.of(context).maybePop());
}
