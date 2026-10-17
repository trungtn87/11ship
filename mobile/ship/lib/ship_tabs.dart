import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_home.dart';
import 'ship_wallet.dart';

// M01 phone tabs. Home follows the approved Offline/Online reference; later-module actions remain gated.

List<TabSpec> buildShipTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', fullBleed: true, showAppBar: false, body: (BuildContext context, ShellActions actions) => ShipHome(session: session, reset: flows?.reset, onNotifications: () => actions.goTab('notifications'))),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => const OrdersBody()),
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
      // S12/S13: the driver profile, connected to the server. Sending it never receives orders or changes the context.
      if (driver != null)
        N11ListItem(
          key: const Key('driver-entry'),
          icon: Icons.badge_outlined,
          title: 'Hồ sơ shipper',
          sub: 'Gửi và xem hồ sơ shipper của bạn.',
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
