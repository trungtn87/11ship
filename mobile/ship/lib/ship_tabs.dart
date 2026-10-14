import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Ship (driver) screens of the app (catalog S01-S05). Same layout, wording and rules as apps/ship-web/src/screens.ts.
// Nobody is signed in, so Online is NEVER available: the switch stays unavailable and says why. No orders, income, balance or
// activity status is invented anywhere; empty means "no data yet", unknown is shown as "—", never as 0.

const String kOnlineReason = 'Nhận đơn: $kNotOnAndroidReason Cần hồ sơ xế được duyệt.';

List<TabSpec> buildShipTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', showLogo: true, body: (BuildContext context, ShellActions actions) => _home(session, flows)),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => const OrdersBody()),
    TabSpec(id: 'income', label: 'Thu nhập', icon: Icons.bar_chart_outlined, title: 'Thu nhập', body: _income),
    TabSpec(id: 'wallet', label: 'Ví', icon: Icons.account_balance_wallet_outlined, title: 'Ví', body: _wallet),
    TabSpec(id: 'account', label: 'Tài khoản', icon: Icons.person_outline, title: 'Tài khoản', body: (BuildContext context, ShellActions actions) => _account(session, actions, flows)),
  ];
}

Widget _guestPrompt(SessionController session, String text, [AppFlows? flows]) => GuestPrompt(session: session, brand: shipBrand, text: text, reset: flows?.reset);

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

// ---- S01: home -------------------------------------------------------------------------------------------------------

Widget _home(SessionController session, AppFlows? flows) {
  return vstack(<Widget>[
    _guestPrompt(session, 'Đăng nhập để theo dõi tài khoản của bạn. Gửi hồ sơ xế trong tab Tài khoản.', flows),
    // Online is only ever possible for an approved, eligible driver; that state does not exist here. Always unavailable: the block of
    // the design (s-home-off) with the switch locked and its reason written under it.
    Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(18)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Đang ngoại tuyến', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: N11Colors.black)),
                    SizedBox(height: 3),
                    Text('Sẵn sàng nhận đơn', style: N11Text.caption),
                  ],
                ),
              ),
              Semantics(
                label: 'Sẵn sàng nhận đơn',
                toggled: false,
                enabled: false,
                excludeSemantics: true,
                child: const Switch(key: Key('online-switch'), value: false, onChanged: null),
              ),
            ],
          ),
          const SizedBox(height: N11Space.gap3),
          const ReasonNote(kOnlineReason),
        ],
      ),
    ),
    const EmptyState(icon: Icons.local_shipping_outlined, title: 'Chưa có đơn nào', text: 'Đơn giao sẽ hiện ở đây khi tính năng giao hàng sẵn sàng.'),
  ]);
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
    const GatedButton(label: 'Chọn khoảng ngày', reason: 'Chọn ngày sẽ có khi dữ liệu thu nhập sẵn sàng.', kind: ButtonKind.secondary, icon: Icons.schedule),
    _unknownFigure(label: 'Tổng thu nhập', note: 'Chưa có dữ liệu. "—" nghĩa là chưa biết, không phải 0 đồng.'),
    const EmptyState(icon: Icons.bar_chart_outlined, title: 'Chưa có dữ liệu thu nhập', text: FrameReasons.empty),
  ]);
}

// ---- S04: wallet -----------------------------------------------------------------------------------------------------

Widget _wallet(BuildContext context, ShellActions actions) {
  return vstack(<Widget>[
    _unknownFigure(label: 'Số dư', note: 'Chưa có dữ liệu ví.'),
    const GatedButton(label: 'Hướng dẫn nạp tiền', reason: 'Nạp tiền sẽ có khi ví sẵn sàng.', kind: ButtonKind.secondary, icon: Icons.account_balance_wallet_outlined),
    const GatedButton(label: 'Liên hệ rút tiền', reason: 'Rút tiền sẽ có khi ví sẵn sàng.', kind: ButtonKind.secondary, icon: Icons.payments_outlined),
    _soonChip(),
  ]);
}

// ---- S05: account (guest) --------------------------------------------------------------------------------------------

Widget _account(SessionController session, ShellActions actions, AppFlows? flows) {
  final DriverController? driver = flows?.driver;
  return Builder(builder: (BuildContext context) => AccountTab(
    session: session,
    brand: shipBrand,
    actions: actions,
    signedInTitle: 'Tài xế',
    reset: flows?.reset,
    signedInEntries: <Widget>[
      // S12/S13: the driver profile, connected to the server. Sending it never receives orders or changes the context.
      if (driver != null)
        N11ListItem(
          key: const Key('driver-entry'),
          icon: Icons.badge_outlined,
          title: 'Hồ sơ xế',
          sub: 'Gửi và xem hồ sơ xế của bạn.',
          onTap: () => Navigator.of(context).push(n11Route(DriverProfileScreen(controller: driver))),
        ),
    ],
    entries: <Widget>[
      if (driver == null)
        N11ListItem(
          icon: Icons.badge_outlined,
          title: 'Hồ sơ xế',
          sub: kNotOnAndroidReason,
          soon: true,
          trailing: const N11Chip('Chưa nối', kind: ChipKind.soon),
        ),
      const N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
      N11ListItem(
        key: const Key('policy-entry'),
        icon: Icons.shield_outlined,
        title: 'Chính sách và điều khoản',
        onTap: () => Navigator.of(context).push(n11Route(PolicyScreen(session: session))),
      ),
    ],
  ));
}
