import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';
import 'food_m14.dart';

// 11Food screens of the app (catalog F01-F04). Same layout, wording and rules as apps/food-web/src/screens.ts: nobody is
// signed in and every business action is unavailable with a visible reason. No screen invents shops, dishes, orders, balances or
// activity: an empty screen says "no data yet".

/// How an opened notification reaches its object in 11Food: a delivery opens its detail (which loads the CURRENT state and decides the right again), a list
/// opens the Orders tab, the shop profile opens the shop tab. Nothing here decides a right.
NotificationRouter foodNotificationRouter(AppFlows flows) =>
    (BuildContext context, NotificationItem? item, OpenOutcome outcome,
        ShellActions actions) async {
      final NotificationTarget? target = outcome.target;
      if (target == null) {
        return;
      }
      Future<void> openInTab(String tab, Widget page) async {
        actions.goTab(tab);
        await WidgetsBinding.instance.endOfFrame;
        if (actions.push != null) {
          await actions.push!.call<dynamic>(n11Route(page));
        } else if (context.mounted) {
          await Navigator.of(context).push(n11Route(page));
        }
      }

      switch (target.type) {
        case TargetType.financeRequest:
          // A notification can be tapped while a shop owner is using the Customer context.
          // Switch context on that explicit action; never open shop finance under a customer session.
          if (target.id == null) break;
          if (flows.session.identity?.activeRole != 'SHOP_OWNER') {
            if (flows.session.identity?.availableRoles.contains('SHOP_OWNER') !=
                true) {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('Tài khoản không có quyền quản lý quán.')));
              }
              break;
            }
            try {
              await flows.session.selectContext('SHOP_OWNER');
            } on Object {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text(
                        'Không thể chuyển sang vai trò Quán. Vui lòng thử lại.')));
              }
              break;
            }
            if (!context.mounted ||
                flows.session.identity?.activeRole != 'SHOP_OWNER') {
              break;
            }
          }
          await openInTab(
              'shop',
              FinanceRequestsScreen(
                  session: flows.session,
                  shopPayments: true,
                  requestId: target.id));
        case TargetType.delivery:
          final ShopDeliverySource? source = flows.shopDeliveries;
          final CustomerDeliverySource? customerSource = flows.customerDeliveries;
          final bool shopHat = flows.session.identity?.activeRole == 'SHOP_OWNER';
          if (shopHat && source != null && target.id != null) {
            // One page per food order: a delivery that belongs to an order opens that order (the server already answers with the order for such a notice; this
            // keeps any other way in from showing a second page). The delivery's own link decides, never a code. A direct delivery opens as itself.
            final String? orderId = await _orderOfDelivery(source, target.id!);
            if (orderId != null && flows.orders != null) {
              await openInTab('orders', _orderPage(flows, orderId));
            } else {
              await openInTab(
                  'orders',
                  ShopDeliveryDetailScreen(
                      source: source,
                      deliveryId: target.id!,
                      feedbackSlot: _feedbackSlot(flows)));
            }
          } else if (!shopHat && customerSource != null && target.id != null) {
            await openInTab(
                'orders',
                CustomerDeliveryDetailScreen(
                    source: customerSource,
                    deliveryId: target.id!,
                    mapBuilder: foodMapBuilder()));
          } else {
            actions.goTab('orders');
          }
        case TargetType.deliveryList:
          actions.goTab('orders');
        case TargetType.profile:
          actions.goTab('shop');
        case TargetType.complaint:
          final M11Source? feedback = flows.feedback;
          if (feedback != null && target.id != null) {
            await openInTab(
                'orders',
                complaintRoute(
                    source: feedback,
                    role: m11RoleOf(flows.session, shipApp: false),
                    complaintId: target.id!,
                    picker: flows.picker));
          }
        case TargetType.order:
          final OrderRuntime? orders = flows.orders;
          if (orders != null && target.id != null) {
            await openInTab('orders', _orderPage(flows, target.id!));
          } else {
            actions.goTab('orders');
          }
        case TargetType.walletTxn || TargetType.none:
          break;
      }
    };

/// The detail of a food order. It loads the CURRENT order and decides the right again: the shop's hat opens the shop's view, the customer's the customer's.
Widget _orderPage(AppFlows flows, String orderId) {
  final bool shopHat = flows.session.identity?.activeRole == 'SHOP_OWNER';
  return shopHat
      ? ShopOrderDetailScreen(
          runtime: flows.orders!,
          orderId: orderId,
          deliveries: flows.shopDeliveries)
      : CustomerOrderDetailScreen(runtime: flows.orders!, orderId: orderId);
}

/// The order a delivery belongs to (its own `order_id`), or null for a direct delivery or when it cannot be read: then the delivery page opens and shows the
/// server's answer (not found / no right) instead of another order.
Future<String?> _orderOfDelivery(
    ShopDeliverySource source, String deliveryId) async {
  try {
    final DeliveryView d = await source.get(deliveryId);
    return d.source == 'ORDER' ? d.orderId : null;
  } on Object {
    return null;
  }
}

/// M11: rating and complaint entries under a finished delivery. Null while the app has no M11 source.
M07FeedbackSlot? _feedbackSlot(AppFlows? flows) => flows?.feedback == null
    ? null
    : shopDeliveryFeedbackSlot(source: flows!.feedback!, picker: flows.picker);

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
    onPressed: () =>
        Navigator.of(context).push(n11Route(NotificationInboxScreen(
      controller: inbox,
      router: foodNotificationRouter(flows!),
      actions: actions,
      settingsBuilder: (BuildContext context) => NotificationSettingsScreen(
          source: source, push: push, shipper: false),
    ))),
  );
}

List<TabSpec> buildFoodTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(
        id: 'home',
        label: 'Trang chủ',
        icon: Icons.home_outlined,
        title: 'Trang chủ',
        showAppBar: false,
        fullBleed: true,
        body: (BuildContext context, ShellActions actions) =>
            _home(session, actions, flows)),
    TabSpec(
        id: 'orders',
        label: 'Đơn hàng',
        icon: Icons.receipt_long_outlined,
        title: 'Đơn hàng',
        body: (BuildContext context, ShellActions actions) =>
            _orders(session, flows)),
    if (session.status == SessionStatus.signedIn &&
        (session.identity?.availableRoles.contains('SHOP_OWNER') == true ||
            session.identity?.shopOnboarding == 'INCOMPLETE' ||
            session.identity?.shopOnboarding == 'COMPLETED'))
      TabSpec(
        id: 'shop',
        label: 'Quán',
        icon: Icons.storefront_outlined,
        title: 'Quán',
        body: (BuildContext context, ShellActions actions) => flows?.m02 == null
            ? const EmptyState(
                icon: Icons.storefront_outlined,
                title: 'Quán của bạn',
                text: 'Khu vực quản lý quán chưa sẵn sàng trong bản này.')
            : ShopTab(session: session, flows: flows!.m02!),
      ),
    TabSpec(
        id: 'account',
        label: 'Tài khoản',
        icon: Icons.person_outline,
        title: 'Tài khoản',
        body: (BuildContext context, ShellActions actions) =>
            _account(session, actions, flows)),
  ];
}

Widget _guestPrompt(SessionController session, String text,
        [AppFlows? flows]) =>
    GuestPrompt(
        session: session,
        brand: foodBrand,
        text: text,
        reset: flows?.reset,
        shop: flows?.shop);

// ---- F01: home -------------------------------------------------------------------------------------------------------

Widget _home(SessionController session, ShellActions actions, AppFlows? flows) {
  final M02Flows? m02 = flows?.m02;
  if (m02 == null) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap4),
      child: Column(children: <Widget>[
        Align(
            alignment: Alignment.centerLeft,
            child: BrandLogo(brand: foodBrand)),
        const SizedBox(height: N11Space.gap4),
        const EmptyState(
            icon: Icons.restaurant,
            title: 'Danh sách quán chưa sẵn sàng',
            text: 'Bản này chưa nối danh sách quán.'),
      ]),
    );
  }
  return Builder(
      builder: (BuildContext context) => DiscoveryHome(
          controller: m02.discovery,
          publicApi: m02.publicApi,
          ratings: flows?.feedback,
          bell: _bell(context, flows, actions)));
}

// ---- F03: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session, AppFlows? flows) {
  final ShopDeliverySource? deliveries = flows?.shopDeliveries;
  final OrderRuntime? orders = flows?.orders;
  final bool signedIn = session.status == SessionStatus.signedIn;
  final bool owner = signedIn &&
      session.identity?.availableRoles.contains('SHOP_OWNER') == true;
  final bool shopHat = owner && session.identity?.activeRole != 'CUSTOMER';
  if (shopHat && orders != null) {
    // M10 + M07: "Đơn món" (ordered in the app) and "Giao hàng" (calls for a Shipper: from an order or direct).
    return ShopOrdersTab(
        runtime: orders,
        deliveries: deliveries,
        deliveriesBuilder: (ShopDeliverySource source) => ShopDeliveryHub(
            source: source,
            mapBuilder: foodMapBuilder(),
            pinPicker: foodPinPicker(),
            feedbackSlot: _feedbackSlot(flows)));
  }
  if (shopHat && deliveries != null) {
    return ShopDeliveryHub(
        source: deliveries,
        mapBuilder: foodMapBuilder(),
        pinPicker: foodPinPicker(),
        feedbackSlot: _feedbackSlot(flows));
  }
  if (signedIn && orders != null && session.identity?.customerAccess == true) {
    // M10 + PR #231: customer orders ("Đơn món") and direct delivery calls ("Giao hàng").
    return CustomerOrdersTab(
        runtime: orders,
        deliveries: flows?.customerDeliveries,
        mapBuilder: foodMapBuilder(),
        pinPicker: foodPinPicker());
  }
  return vstack(<Widget>[
    _guestPrompt(session, 'Đăng nhập để xem đơn hàng của bạn.', flows),
    const EmptyState(
        icon: Icons.receipt_long_outlined,
        title: 'Chưa có đơn hàng',
        text: 'Đơn hàng của bạn sẽ hiện ở đây sau khi bạn đặt món.'),
    // M06 UI: fee, distance and who pays. Not ready in real builds (the screen says what is missing).
    const ShippingFeeEntry(),
  ]);
}

// ---- F04: account (guest) --------------------------------------------------------------------------------------------

Widget _account(
    SessionController session, ShellActions actions, AppFlows? flows) {
  final ShopController? shop = flows?.shop;
  return Builder(
      builder: (BuildContext context) => AccountTab(
            session: session,
            brand: foodBrand,
            actions: actions,
            reset: flows?.reset,
            shop: shop,
            settingsEntries: <Widget>[
              if (flows?.feedback != null)
                ...m11AccountEntries(context,
                    source: flows!.feedback!,
                    picker: flows.picker,
                    role: m11RoleOf(session, shipApp: false)),
              if (flows?.addresses != null)
                addressBookEntry(context, flows!.addresses!),
              if (flows?.notificationSource != null && flows?.push != null)
                N11ListItem(
                  key: const Key('open-notification-settings'),
                  icon: Icons.notifications_outlined,
                  title: 'Cài đặt thông báo',
                  sub: 'Âm thanh, rung và nhóm thông báo',
                  onTap: () => Navigator.of(context).push(n11Route(
                      NotificationSettingsScreen(
                          source: flows!.notificationSource!,
                          push: flows.push!,
                          shipper: false))),
                ),
            ],
            entries: <Widget>[
              if (session.status == SessionStatus.signedIn &&
                  session.identity?.activeRole == 'SHOP_OWNER')
                N11ListItem(
                    icon: Icons.payments_outlined,
                    title: 'Thanh toán và trao đổi',
                    sub: 'Báo đã thanh toán và trao đổi với quản trị',
                    onTap: () => Navigator.of(context).push(n11Route(
                        FinanceRequestsScreen(
                            session: session, shopPayments: true)))),
              const N11ListItem(
                  icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
            ],
          ));
}
