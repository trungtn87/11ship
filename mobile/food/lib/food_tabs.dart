import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Food screens of the app (catalog F01-F04). Same layout, wording and rules as apps/food-web/src/screens.ts: nobody is
// signed in and every business action is unavailable with a visible reason. No screen invents shops, dishes, orders, balances or
// activity: an empty screen says "no data yet".


List<TabSpec> buildFoodTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', showAppBar: false, fullBleed: true, body: (BuildContext context, ShellActions actions) => _home(session, actions, flows)),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => _orders(session, flows)),
    if (session.status == SessionStatus.signedIn && (session.identity?.availableRoles.contains('SHOP_OWNER') == true || session.identity?.shopOnboarding == 'INCOMPLETE' || session.identity?.shopOnboarding == 'COMPLETED'))
      TabSpec(
        id: 'shop',
        label: 'Quán',
        icon: Icons.storefront_outlined,
        title: 'Quán',
        body: (BuildContext context, ShellActions actions) => flows?.m02 == null
            ? const EmptyState(icon: Icons.storefront_outlined, title: 'Quán của bạn', text: 'Khu vực quản lý quán chưa sẵn sàng trong bản này.')
            : ShopTab(session: session, flows: flows!.m02!),
      ),
    TabSpec(id: 'account', label: 'Tài khoản', icon: Icons.person_outline, title: 'Tài khoản', body: (BuildContext context, ShellActions actions) => _account(session, actions, flows)),
  ];
}

Widget _guestPrompt(SessionController session, String text, [AppFlows? flows]) => GuestPrompt(session: session, brand: foodBrand, text: text, reset: flows?.reset, shop: flows?.shop);

Widget _soonChip() => const Center(child: N11Chip('Sắp có', kind: ChipKind.soon));

// ---- F01: home -------------------------------------------------------------------------------------------------------

Widget _home(SessionController session, ShellActions actions, AppFlows? flows) {
  final M02Flows? m02 = flows?.m02;
  if (m02 == null) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap4),
      child: Column(children: <Widget>[
        Align(alignment: Alignment.centerLeft, child: BrandLogo(brand: foodBrand)),
        const SizedBox(height: N11Space.gap4),
        const EmptyState(icon: Icons.restaurant, title: 'Danh sách quán chưa sẵn sàng', text: 'Bản này chưa nối danh sách quán.'),
      ]),
    );
  }
  return DiscoveryHome(controller: m02.discovery, publicApi: m02.publicApi);
}

// ---- F03: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session, AppFlows? flows) {
  return vstack(<Widget>[
    _guestPrompt(session, 'Đăng nhập để xem đơn hàng của bạn.', flows),
    const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Đơn hàng của bạn sẽ hiện ở đây khi tính năng đặt món sẵn sàng.'),
    _soonChip(),
  ]);
}

// ---- F04: account (guest) --------------------------------------------------------------------------------------------

Widget _account(SessionController session, ShellActions actions, AppFlows? flows) {
  final ShopController? shop = flows?.shop;
  return Builder(builder: (BuildContext context) => AccountTab(
    session: session,
    brand: foodBrand,
    actions: actions,
    reset: flows?.reset,
    shop: shop,
    settingsEntries: <Widget>[
      if (flows?.addresses != null) addressBookEntry(context, flows!.addresses!),
    ],
    entries: const <Widget>[
      N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
    ],
  ));
}
