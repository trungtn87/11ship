import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_home.dart';
import 'ship_m07.dart';
import 'ship_online.dart';
import 'ship_wallet.dart';

// M01 phone tabs. Home follows the approved Offline/Online reference; later-module actions remain gated.

/// How an opened notification reaches its object in 11Ship: a delivery opens its detail (which loads the CURRENT state and decides the right again, so a
/// delivery this Shipper gave back shows no contact), the offers/active lists open the Orders tab, a top-up opens the wallet, a profile result opens the profile.
NotificationRouter shipNotificationRouter(SessionController session, AppFlows flows) => (BuildContext context, NotificationItem? item, OpenOutcome outcome, ShellActions actions) async {
      final NotificationTarget? target = outcome.target;
      if (target == null) {
        return;
      }
      final NavigatorState navigator = Navigator.of(context);
      switch (target.type) {
        case TargetType.delivery:
          final ShipperDeliverySource? source = flows.shipperDeliveries;
          if (source != null && target.id != null) {
            await navigator.push(n11Route(ShipperDeliveryDetailScreen(
              source: source,
              deliveryId: target.id!,
              mapBuilder: shipMapBuilder(),
              pinPicker: shipPinPicker(),
              locationSlot: (BuildContext context) => ShipLocationStatusLine(online: shipOnlineFor(session, driver: flows.driver)..attach()),
              feedbackSlot: _feedbackSlot(flows),
            )));
          } else {
            navigator.popUntil((Route<dynamic> r) => r.isFirst);
            actions.goTab('orders');
          }
        case TargetType.deliveryList:
          navigator.popUntil((Route<dynamic> r) => r.isFirst);
          actions.goTab('orders');
        case TargetType.walletTxn:
          await navigator.push(n11Route(WalletHomeScreen(source: buildWalletSource(session: session))));
        case TargetType.profile:
          final DriverController? driver = flows.driver;
          if (driver != null) {
            await navigator.push(n11Route(DriverProfileScreen(controller: driver, walletSource: buildWalletSource(session: session))));
          }
        case TargetType.complaint:
          final M11Source? feedback = flows.feedback;
          if (feedback != null && target.id != null) {
            await navigator.push(n11Route(complaintRoute(source: feedback, role: M11Role.shipper, complaintId: target.id!, picker: flows.picker)));
          }
        case TargetType.order || TargetType.none:
          break;
      }
    };

/// M11: the complaint entry under a finished delivery. Null while the app has no M11 source.
M07FeedbackSlot? _feedbackSlot(AppFlows? flows) => flows?.feedback == null ? null : shipperDeliveryFeedbackSlot(source: flows!.feedback!, picker: flows.picker);

WidgetBuilder? _settingsBuilder(AppFlows? flows) {
  final NotificationSource? source = flows?.notificationSource;
  final PushSync? push = flows?.push;
  return source == null || push == null ? null : (BuildContext context) => NotificationSettingsScreen(source: source, push: push, shipper: true);
}

List<TabSpec> buildShipTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', fullBleed: true, showAppBar: false, ownsConnectionBanner: true, body: (BuildContext context, ShellActions actions) => ShipHome(session: session, driver: flows?.driver, walletSource: buildWalletSource(session: session), reset: flows?.reset, notifications: flows?.notifications, onNotifications: () => actions.goTab('notifications'))),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => _orders(session, flows)),
    TabSpec(id: 'income', label: 'Thu nhập', icon: Icons.bar_chart_outlined, title: 'Thu nhập', body: (BuildContext context, ShellActions actions) => _income(context, actions, session)),
    TabSpec(id: 'notifications', label: 'Thông báo', icon: Icons.notifications_outlined, title: 'Thông báo', fullBleed: true, body: (BuildContext context, ShellActions actions) => _notifications(session, flows, actions)),
    TabSpec(id: 'account', label: 'Tài khoản', icon: Icons.person_outline, title: 'Tài khoản', body: (BuildContext context, ShellActions actions) => _account(session, actions, flows)),
  ];
}

Widget _soonChip() => const Center(child: N11Chip('Sắp có', kind: ChipKind.soon));

/// A card with a label, a value that is "—" because nothing is known, and the reason.
Widget _unknownFigure({required String label, required String note}) {
  return N11Card(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(children: <Widget>[const Icon(Icons.insights_outlined, color: N11Colors.ink2), const SizedBox(width: N11Space.gap2), Expanded(child: Text(label, style: N11Text.h2))]),
        const SizedBox(height: N11Space.gap2),
        const Text('—', style: N11Text.title),
        const SizedBox(height: N11Space.gap2),
        ReasonNote(note),
      ],
    ),
  );
}

// ---- S02: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session, AppFlows? flows) {
  final ShipperDeliverySource? deliveries = flows?.shipperDeliveries;
  final String onboarding = session.identity?.driverOnboarding ?? 'NOT_STARTED';
  final bool shipper = session.status == SessionStatus.signedIn && (onboarding == 'ACTIVE' || onboarding == 'CLOSING');
  if (deliveries != null && shipper) {
    // M07: offers, my deliveries, drop-off and pickup confirmation, result and history.
    return ShipperDeliveryHub(source: deliveries, mapBuilder: shipMapBuilder(), pinPicker: shipPinPicker(), locationSlot: (BuildContext context) => ShipLocationStatusLine(online: shipOnlineFor(session, driver: flows?.driver)..attach()), feedbackSlot: _feedbackSlot(flows));
  }
  return const OrdersBody();
}

enum OrdersView { active, history }

class OrdersBody extends StatefulWidget {
  const OrdersBody({super.key});

  @override
  State<OrdersBody> createState() => _OrdersBodyState();
}

class _OrdersBodyState extends State<OrdersBody> {
  OrdersView _view = OrdersView.active;

  @override
  Widget build(BuildContext context) {
    return vstack(<Widget>[
      Wrap(
        spacing: N11Space.gap3,
        runSpacing: N11Space.gap2,
        children: <Widget>[
          N11Button(key: const Key('orders-active'), label: 'Đang giao', compact: true, kind: _view == OrdersView.active ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _view = OrdersView.active)),
          N11Button(key: const Key('orders-history'), label: 'Lịch sử', compact: true, kind: _view == OrdersView.history ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _view = OrdersView.history)),
        ],
      ),
      const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Chưa có đơn nào được giao cho bạn.'),
      // M06 UI: what is shown before accepting, and the batching evaluation. Not ready in real builds (each screen says what is missing).
      const OrderEvaluationEntries(),
      _soonChip(),
    ]);
  }
}

// ---- S03: income -----------------------------------------------------------------------------------------------------

Widget _income(BuildContext context, ShellActions actions, SessionController session) {
  return vstack(<Widget>[
    // M04: entry to the wallet screens, connected to the server through the session (a sample only in a preview build).
    WalletEntry(session: session),
    const GatedButton(label: 'Chọn khoảng ngày', reason: 'Chọn ngày sẽ có khi dữ liệu thu nhập sẵn sàng.', kind: ButtonKind.secondary, icon: Icons.schedule),
    _unknownFigure(label: 'Tổng thu nhập', note: 'Chưa có dữ liệu. "—" nghĩa là chưa biết, không phải 0 đồng.'),
    const EmptyState(icon: Icons.bar_chart_outlined, title: 'Chưa có dữ liệu thu nhập', text: FrameReasons.empty),
  ]);
}

// ---- S04: notifications (M08) ---------------------------------------------------------------------------------------------

Widget _notifications(SessionController session, AppFlows? flows, ShellActions actions) {
  final NotificationController? inbox = flows?.notifications;
  if (inbox == null || session.status != SessionStatus.signedIn) {
    return const EmptyState(icon: Icons.notifications_outlined, title: 'Chưa có thông báo', text: 'Đăng nhập để xem thông báo của bạn.');
  }
  return NotificationTabBody(controller: inbox, router: shipNotificationRouter(session, flows!), actions: actions, settingsBuilder: _settingsBuilder(flows));
}

// ---- S05: account (guest) --------------------------------------------------------------------------------------------

Widget _account(SessionController session, ShellActions actions, AppFlows? flows) {
  final DriverController? driver = flows?.driver;
  return Builder(builder: (BuildContext context) => AccountTab(
    session: session,
    brand: shipBrand,
    actions: actions,
    signedInTitle: 'Shipper',
    showAccountStatus: false,
    showDiagnostics: false,
    settingsEntries: <Widget>[
      N11ListItem(
        key: const Key('open-change-password'),
        icon: Icons.lock_outline,
        title: 'Đổi mật khẩu',
        sub: 'Cập nhật mật khẩu đăng nhập',
        onTap: () => Navigator.of(context).push(n11Route(ChangePasswordScreen(session: session))),
      ),
    ],
    reset: flows?.reset,
    signedInEntries: <Widget>[
      if (flows?.notificationSource != null && flows?.push != null)
        N11ListItem(
          key: const Key('open-notification-settings'),
          icon: Icons.notifications_outlined,
          title: 'Cài đặt thông báo',
          sub: 'Âm thanh, rung, nhóm thông báo và đơn có thể nhận',
          onTap: () => Navigator.of(context).push(n11Route(_settingsBuilder(flows)!(context))),
        ),
      // M11: the Shipper's scores by source and their complaints (no new tab).
      if (flows?.feedback != null) ...m11AccountEntries(context, source: flows!.feedback!, picker: flows.picker, role: M11Role.shipper),
      // S12-S14 (M03): the Shipper profile, bank account, review status, receiving orders and stopping activity, all connected to the server.
      if (driver != null)
        N11ListItem(
          key: const Key('driver-entry'),
          icon: Icons.badge_outlined,
          title: 'Hồ sơ shipper',
          sub: 'Thông tin cá nhân, nhận đơn, dừng hoạt động / rút tiền.',
          onTap: () => Navigator.of(context).push(n11Route(DriverProfileScreen(controller: driver, walletSource: buildWalletSource(session: session)))),
        ),
    ],
    entries: <Widget>[
      WalletListItem(key: const Key('account-wallet-entry'), session: session),
      if (session.status == SessionStatus.signedIn) N11ListItem(icon: Icons.chat_outlined, title: 'Trao đổi nạp tiền', sub: 'Yêu cầu, chưa đọc và lịch sử xử lý', onTap: () => Navigator.of(context).push(n11Route(FinanceRequestsScreen(session: session)))),
      if (driver != null && session.status == SessionStatus.signedIn)
        N11ListItem(
          key: const Key('account-closure-entry'),
          icon: Icons.account_balance_outlined,
          title: 'Dừng hoạt động / Rút tiền',
          sub: 'Hoàn tất đơn và rút toàn bộ số dư ví',
          onTap: () => Navigator.of(context).push(n11Route(DriverActivityScreen(controller: driver, walletSource: buildWalletSource(session: session)))),
        ),
      if (driver == null)
        N11ListItem(
          icon: Icons.badge_outlined,
          title: 'Hồ sơ shipper',
          sub: kNotOnAndroidReason,
          soon: true,
          trailing: const N11Chip('Chưa nối', kind: ChipKind.soon),
        ),
      const N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
    ],
  ));
}
