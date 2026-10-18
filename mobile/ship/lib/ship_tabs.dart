import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_home.dart';
import 'ship_m07.dart';
import 'ship_wallet.dart';

// M01 phone tabs. Home follows the approved Offline/Online reference; later-module actions remain gated.

List<TabSpec> buildShipTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', fullBleed: true, showAppBar: false, body: (BuildContext context, ShellActions actions) => ShipHome(session: session, reset: flows?.reset, onNotifications: () => actions.goTab('notifications'))),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => _orders(session, flows)),
    TabSpec(id: 'income', label: 'Thu nhập', icon: Icons.bar_chart_outlined, title: 'Thu nhập', body: _income),
    TabSpec(id: 'notifications', label: 'Thông báo', icon: Icons.notifications_outlined, title: 'Thông báo', body: _notifications),
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
        Text(label, style: N11Text.lead),
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
    return ShipperDeliveryHub(source: deliveries, mapBuilder: shipMapBuilder(), pinPicker: shipPinPicker(), locationSlot: (BuildContext context) => ShipLocationShareCard(reporter: reporterFor(session)));
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
      Row(
        children: <Widget>[
          N11Button(key: const Key('orders-active'), label: 'Đang giao', compact: true, kind: _view == OrdersView.active ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _view = OrdersView.active)),
          const SizedBox(width: N11Space.gap3),
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

Widget _income(BuildContext context, ShellActions actions) {
  return vstack(<Widget>[
    // M04 UI: entry to the wallet screens. Not-wired in real builds (the screens say so); sample data only in a preview build.
    const WalletEntry(),
    const GatedButton(label: 'Chọn khoảng ngày', reason: 'Chọn ngày sẽ có khi dữ liệu thu nhập sẵn sàng.', kind: ButtonKind.secondary, icon: Icons.schedule),
    _unknownFigure(label: 'Tổng thu nhập', note: 'Chưa có dữ liệu. "—" nghĩa là chưa biết, không phải 0 đồng.'),
    const EmptyState(icon: Icons.bar_chart_outlined, title: 'Chưa có dữ liệu thu nhập', text: FrameReasons.empty),
  ]);
}

// ---- S04: notifications (presentation only) ---------------------------------------------------------------------------

Widget _notifications(BuildContext context, ShellActions actions) {
  return const EmptyState(
    icon: Icons.notifications_outlined,
    title: 'Chưa có dữ liệu thông báo',
    text: 'Thông báo sẽ hiển thị khi tính năng sẵn sàng.',
  );
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
      // S12-S14 (M03): the Shipper profile, bank account, review status, receiving orders and stopping activity, all connected to the server.
      if (driver != null)
        N11ListItem(
          key: const Key('driver-entry'),
          icon: Icons.badge_outlined,
          title: 'Hồ sơ shipper',
          sub: 'Hồ sơ, ngân hàng, nhận đơn và ngừng hoạt động.',
          onTap: () => Navigator.of(context).push(n11Route(DriverProfileScreen(controller: driver))),
        ),
    ],
    entries: <Widget>[
      const WalletListItem(key: Key('account-wallet-entry')),
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
