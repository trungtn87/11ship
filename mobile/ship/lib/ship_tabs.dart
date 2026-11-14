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
        case TargetType.financeRequest:
          if (target.id != null) await navigator.push(n11Route(FinanceRequestsScreen(session: flows.session, shopPayments: false, requestId: target.id)));
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
          // Only a live signed-in session reaches the wallet; a notification opened after logout does nothing (#295).
          if (session.status == SessionStatus.signedIn) await navigator.push(walletHomeRoute(session, buildWalletSource(session: session)));
        case TargetType.profile:
          final DriverController? driver = flows.driver;
          if (driver != null) {
            await navigator.push(driverWalletRoute(session, (WalletSource wallet) => DriverProfileScreen(controller: driver, walletSource: wallet)));
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
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => _orders(session, flows, actions)),
    TabSpec(id: 'income', label: 'Thu nhập', icon: Icons.bar_chart_outlined, title: 'Thu nhập', body: (BuildContext context, ShellActions actions) => _income(context, actions, session, flows)),
    TabSpec(id: 'notifications', label: 'Thông báo', icon: Icons.notifications_outlined, title: 'Thông báo', fullBleed: true, body: (BuildContext context, ShellActions actions) => _notifications(session, flows, actions)),
    TabSpec(id: 'account', label: 'Tài khoản', icon: Icons.person_outline, title: 'Tài khoản', body: (BuildContext context, ShellActions actions) => _account(session, actions, flows)),
  ];
}

Widget _soonChip() => const Center(child: N11Chip('Sắp có', kind: ChipKind.soon));

// ---- S02: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session, AppFlows? flows, ShellActions actions) {
  final ShipperDeliverySource? deliveries = flows?.shipperDeliveries;
  final String onboarding = session.identity?.driverOnboarding ?? 'NOT_STARTED';
  final bool shipper = session.status == SessionStatus.signedIn && (onboarding == 'ACTIVE' || onboarding == 'CLOSING');
  if (deliveries != null && shipper) {
    // M07: offers, my deliveries, drop-off and pickup confirmation, result and history.
    return ShipperDeliveryHub(source: deliveries, mapBuilder: shipMapBuilder(), pinPicker: shipPinPicker(), locationSlot: (BuildContext context) => ShipLocationStatusLine(online: shipOnlineFor(session, driver: flows?.driver)..attach()), feedbackSlot: _feedbackSlot(flows));
  }
  return OrdersBody(onHome: () => actions.goTab('home'));
}

enum OrdersView { active, history }

class OrdersBody extends StatefulWidget {
  const OrdersBody({super.key, this.onHome});

  /// "Về trang chủ": switches to the Home tab (S01) where the receiving status is set. Null = no button.
  final VoidCallback? onHome;

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
      const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Chưa có đơn nào được giao cho bạn. Đơn chỉ hiện khi bạn đang nhận đơn.'),
      if (widget.onHome != null)
        N11Button(key: const Key('orders-home'), label: 'Về trang chủ', kind: ButtonKind.secondary, onPressed: widget.onHome),
      _soonChip(),
    ]);
  }
}

// ---- S03: income -----------------------------------------------------------------------------------------------------

Widget _income(BuildContext context, ShellActions actions, SessionController session, AppFlows? flows) {
  if (session.status != SessionStatus.signedIn) {
    // S03 guest (Owner 14/11): only the process & benefits card and the sign-in / sign-up actions. No income figures, no wallet.
    return vstack(<Widget>[
      _processCard(),
      N11Button(key: const Key('income-guest-login'), label: 'Đăng nhập', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: shipBrand, reset: flows?.reset)))),
      N11Button(key: const Key('income-guest-register'), label: 'Đăng ký làm shipper', onPressed: () => Navigator.of(context).push(n11Route(RegisterScreen(session: session, brand: shipBrand)))),
    ]);
  }
  return vstack(<Widget>[
    const GatedButton(label: 'Chọn khoảng ngày', reason: 'Chọn ngày sẽ có khi dữ liệu thu nhập sẵn sàng.', kind: ButtonKind.secondary, icon: Icons.schedule),
    // "Tổng thu nhập" stays on top: no confirmed figure yet, so it reads "-- đ" (never a made-up number) and opens the wallet.
    N11Card(
      key: const Key('income-summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[const Icon(Icons.insights_outlined, color: N11Colors.ink2), const SizedBox(width: N11Space.gap2), Expanded(child: Text('Tổng thu nhập', style: N11Text.h2))]),
          const SizedBox(height: N11Space.gap2),
          const Text('-- đ', style: N11Text.title),
          const SizedBox(height: N11Space.gap2),
          const ReasonNote('Thu nhập sẽ hiện khi có dữ liệu xác nhận.'),
          const SizedBox(height: N11Space.gap2),
          Align(
            alignment: Alignment.centerRight,
            child: N11Button(key: const Key('income-open-wallet'), label: 'Xem ví shipper', kind: ButtonKind.secondary, compact: true, onPressed: () => Navigator.of(context).push(walletHomeRoute(session, buildWalletSource(session: session)))),
          ),
        ],
      ),
    ),
    // M04: entry to the wallet screens, connected to the server through the session (kept for signed-in people).
    WalletEntry(session: session),
    // Replaces the duplicate empty card: recent transactions live in the wallet history.
    N11Card(
      key: const Key('income-recent'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[const Icon(Icons.history, color: N11Colors.ink2), const SizedBox(width: N11Space.gap2), Expanded(child: Text('Giao dịch gần đây', style: N11Text.h2))]),
          const SizedBox(height: N11Space.gap2),
          const Text('Chưa có giao dịch để hiển thị. Lịch sử đầy đủ nằm trong ví.', style: N11Text.body),
        ],
      ),
    ),
  ]);
}

/// The process and benefits of a driver, for guests (S03 and S05). Text only: no new screen, no figures.
Widget _processCard() => N11Card(
      key: const Key('driver-process-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[const Icon(Icons.route_outlined, color: N11Colors.ink2), const SizedBox(width: N11Space.gap2), Expanded(child: Text('Quy trình & quyền lợi tài xế', style: N11Text.h2))]),
          const SizedBox(height: N11Space.gap2),
          const Text('Đăng ký tài khoản, gửi hồ sơ shipper để được duyệt, rồi bật nhận đơn khi đủ điều kiện. Thu nhập và ví chỉ hiện sau khi bạn đăng nhập.', style: N11Text.body),
        ],
      ),
    );

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
    registerLabel: 'Đăng ký làm shipper',
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
          onTap: () => Navigator.of(context).push(driverWalletRoute(session, (WalletSource wallet) => DriverProfileScreen(controller: driver, walletSource: wallet))),
        ),
    ],
    entries: <Widget>[
      if (session.status == SessionStatus.signedIn) WalletListItem(key: const Key('account-wallet-entry'), session: session),
      if (session.status == SessionStatus.signedIn) N11ListItem(icon: Icons.chat_outlined, title: 'Trao đổi nạp tiền', sub: 'Yêu cầu, chưa đọc và lịch sử xử lý', onTap: () => Navigator.of(context).push(n11Route(FinanceRequestsScreen(session: session)))),
      if (driver != null && session.status == SessionStatus.signedIn)
        N11ListItem(
          key: const Key('account-closure-entry'),
          icon: Icons.account_balance_outlined,
          title: 'Dừng hoạt động / Rút tiền',
          sub: 'Hoàn tất đơn và rút toàn bộ số dư ví',
          onTap: () => Navigator.of(context).push(driverWalletRoute(session, (WalletSource wallet) => DriverActivityScreen(controller: driver, walletSource: wallet))),
        ),
      // S05 guest: no "Hồ sơ shipper" row; the process & benefits entry instead.
      if (session.status != SessionStatus.signedIn)
        const N11ListItem(key: Key('driver-process-entry'), icon: Icons.route_outlined, title: 'Quy trình & quyền lợi tài xế', sub: 'Đăng ký, duyệt hồ sơ và nhận đơn'),
      if (driver == null && session.status == SessionStatus.signedIn)
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
