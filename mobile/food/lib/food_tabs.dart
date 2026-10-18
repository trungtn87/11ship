import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Food screens of the app (catalog F01-F04). Same layout, wording and rules as apps/food-web/src/screens.ts: nobody is
// signed in and every business action is unavailable with a visible reason. No screen invents shops, dishes, orders, balances or
// activity: an empty screen says "no data yet".


/// How an opened notification reaches its object in 11Food: a delivery opens its detail (which loads the CURRENT state and decides the right again), a list
/// opens the Orders tab, the shop profile opens the shop tab. Nothing here decides a right.
NotificationRouter foodNotificationRouter(AppFlows flows) => (BuildContext context, NotificationItem? item, OpenOutcome outcome, ShellActions actions) async {
      final NotificationTarget? target = outcome.target;
      if (target == null) {
        return;
      }
      final NavigatorState navigator = Navigator.of(context);
      switch (target.type) {
        case TargetType.delivery:
          final ShopDeliverySource? source = flows.shopDeliveries;
          if (source != null && target.id != null) {
            await navigator.push(n11Route(ShopDeliveryDetailScreen(source: source, deliveryId: target.id!)));
          } else {
            navigator.popUntil((Route<dynamic> r) => r.isFirst);
            actions.goTab('orders');
          }
        case TargetType.deliveryList:
          navigator.popUntil((Route<dynamic> r) => r.isFirst);
          actions.goTab('orders');
        case TargetType.profile:
          navigator.popUntil((Route<dynamic> r) => r.isFirst);
          actions.goTab('shop');
        case TargetType.order:
          final OrderRuntime? orders = flows.orders;
          if (orders != null && target.id != null) {
            // The detail loads the CURRENT order and decides the right again: the shop's hat opens the shop's view, the customer's the customer's.
            final bool shopHat = flows.session.identity?.activeRole == 'SHOP_OWNER';
            await navigator.push(n11Route(shopHat ? ShopOrderDetailScreen(runtime: orders, orderId: target.id!, deliveries: flows.shopDeliveries) : CustomerOrderDetailScreen(runtime: orders, orderId: target.id!)));
          } else {
            navigator.popUntil((Route<dynamic> r) => r.isFirst);
            actions.goTab('orders');
          }
        case TargetType.walletTxn || TargetType.none:
          break;
      }
    };

/// The bell at the top of the Food home and the page it opens (no new bottom tab).
Widget? _bell(BuildContext context, AppFlows? flows, ShellActions actions) {
  final NotificationController? inbox = flows?.notifications;
  final NotificationSource? source = flows?.notificationSource;
  final PushSync? push = flows?.push;
  if (inbox == null || source == null || push == null) {
    return null;
  }
  return NotificationBell(
    controller: inbox,
    onPressed: () => Navigator.of(context).push(n11Route(NotificationInboxScreen(
      controller: inbox,
      router: foodNotificationRouter(flows!),
      actions: actions,
      settingsBuilder: (BuildContext context) => NotificationSettingsScreen(source: source, push: push, shipper: false),
    ))),
  );
}

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
  return Builder(builder: (BuildContext context) => DiscoveryHome(controller: m02.discovery, publicApi: m02.publicApi, bell: _bell(context, flows, actions)));
}

// ---- F03: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session, AppFlows? flows) {
  final ShopDeliverySource? deliveries = flows?.shopDeliveries;
  final OrderRuntime? orders = flows?.orders;
  final bool signedIn = session.status == SessionStatus.signedIn;
  final bool owner = signedIn && session.identity?.availableRoles.contains('SHOP_OWNER') == true;
  final bool shopHat = owner && session.identity?.activeRole != 'CUSTOMER';
  if (shopHat && orders != null) {
    // M10 + M07: "Đơn món" (ordered in the app) and "Giao hàng" (calls for a Shipper: from an order or direct).
    return ShopOrdersTab(runtime: orders, deliveries: deliveries);
  }
  if (shopHat && deliveries != null) {
    return ShopDeliveryHub(source: deliveries);
  }
  if (signedIn && orders != null && session.identity?.customerAccess == true) {
    // M10: the customer's orders — Đang xử lý / Đơn hẹn / Lịch sử.
    return CustomerOrdersView(runtime: orders);
  }
  return vstack(<Widget>[
    _guestPrompt(session, 'Đăng nhập để xem đơn hàng của bạn.', flows),
    const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Đơn hàng của bạn sẽ hiện ở đây sau khi bạn đặt món.'),
    // M06 UI: fee, distance and who pays. Not ready in real builds (the screen says what is missing).
    const ShippingFeeEntry(),
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
      if (flows?.notificationSource != null && flows?.push != null)
        N11ListItem(
          key: const Key('open-notification-settings'),
          icon: Icons.notifications_outlined,
          title: 'Cài đặt thông báo',
          sub: 'Âm thanh, rung và nhóm thông báo',
          onTap: () => Navigator.of(context).push(n11Route(NotificationSettingsScreen(source: flows!.notificationSource!, push: flows.push!, shipper: false))),
        ),
    ],
    entries: const <Widget>[
      N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
    ],
  ));
}
