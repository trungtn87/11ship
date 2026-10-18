import '../addresses/address_controller.dart';
import '../addresses/address_models.dart';
import '../addresses/http_address_api.dart';
import '../config.dart';
import '../flows/driver_controller.dart';
import '../flows/location.dart';
import '../flows/reset_controller.dart';
import '../flows/shop_controller.dart';
import '../m02/m02_flows.dart';
import '../m02/discovery_models.dart';
import '../m02/http_m02_api.dart';
import '../m02/menu_models.dart';
import '../m07/m07_http.dart';
import '../m07/m07_sample.dart';
import '../m07/m07_source.dart';
import '../m10/m10_cart.dart';
import '../m10/m10_http.dart';
import '../m10/m10_sample.dart';
import '../m10/m10_source.dart';
import '../m08/m08_controller.dart';
import '../m08/m08_http.dart';
import '../m08/m08_push.dart';
import '../m08/m08_source.dart';
import 'api_client.dart';
import 'device_bridge.dart';
import 'native_auth.dart';
import 'session_controller.dart';

/// The real wiring of one app: HTTPS to the configured server (normal TLS verification only), the Keystore bridge, and the session.
/// A build without a valid HTTPS server address or without the device environment cannot sign in; its screens say so.
/// [transport] and [bridge] are replaced by tests only.
SessionController createSessionController(ClientApp app, AppConfig config, {ApiTransport? transport, DeviceBridge? bridge}) {
  final Uri? base = config.apiUri;
  final bool ready = base != null && config.deviceEnvironment.isNotEmpty;
  final DeviceBridge deviceBridge = bridge ?? MethodChannelDeviceBridge(environment: config.deviceEnvironment);
  final ApiTransport http = transport ?? HttpApiTransport(base: base ?? Uri.parse('https://invalid.invalid'));
  return SessionController(
    api: NativeAuthApi(app: app, transport: http, bridge: deviceBridge, environment: config.deviceEnvironment),
    bridge: deviceBridge,
    ready: ready,
  );
}

/// The three connected flows of an app, built on its session. [location] is for tests; the real one is the Kotlin channel.
class AppFlows {
  AppFlows({required this.session, required this.reset, this.shop, this.driver, this.m02, this.addresses, this.shopDeliveries, this.shipperDeliveries, this.orders, this.notifications, this.notificationSource, this.push});

  final SessionController session;
  final ResetController reset;
  final ShopController? shop;
  final DriverController? driver;

  /// Food only: the M02 shop-management, menu and customer screens.
  final M02Flows? m02;

  /// Food only: the customer's delivery address book (M05).
  final AddressBookController? addresses;

  /// Food only: the shop's delivery requests (M07). Sample data only in a preview build.
  final ShopDeliverySource? shopDeliveries;

  /// Ship only: the Shipper's offers and deliveries (M07).
  final ShipperDeliverySource? shipperDeliveries;

  /// Food only: the cart and the food Orders of both sides (M10). Sample data only in a preview build.
  final OrderRuntime? orders;

  /// M08: this account's inbox in this app, its server source, and the phone's push link. Null only in a test that builds no notifications.
  final NotificationController? notifications;
  final NotificationSource? notificationSource;
  final PushSync? push;
}

AppFlows createFlows(
  ClientApp app,
  SessionController session,
  AppConfig config, {
  ApiTransport? transport,
  LocationProvider? location,
  MenuApi? menuApi,
  PublicShopApi? publicApi,
  DiscoveryApi? discoveryApi,
  ImagePickerPort picker = const NoImagePicker(),
  AddressApi? addressApi,
  NotificationSource? notificationSource,
  PushPort pushPort = const NoPushPort(),
  OrderRuntime? orderRuntime,
}) {
  final ApiTransport http = transport ?? HttpApiTransport(base: config.apiUri ?? Uri.parse('https://invalid.invalid'));
  final LocationProvider where = location ?? MethodChannelLocationProvider();
  final Uri base = config.apiUri ?? Uri.parse('https://invalid.invalid');
  final ShopController? shop = app == ClientApp.food ? ShopController(session: session, location: where) : null;
  final NotificationSource inbox = notificationSource ?? HttpNotificationSource(session: session);
  final NotificationController inboxController = NotificationController(session: session, source: inbox);
  final AddressBookController? book = app == ClientApp.food ? AddressBookController(api: addressApi ?? HttpAddressApi(session: session), session: session) : null;
  final OrderRuntime? orders = app == ClientApp.food ? (orderRuntime ?? _orderRuntime(session, book)) : null;
  OrderRuntime.current = orders;
  return AppFlows(
    orders: orders,
    notificationSource: inbox,
    notifications: inboxController,
    push: PushSync(session: session, source: inbox, port: pushPort, onTap: inboxController.requestOpen),
    session: session,
    reset: ResetController(transport: http, session: session),
    shop: shop,
    driver: app == ClientApp.ship ? DriverController(session: session) : null,
    addresses: book,
    shopDeliveries: app == ClientApp.food ? (kM07UiPreview ? SampleShopSource() : HttpShopDeliverySource(session: session)) : null,
    shipperDeliveries: app == ClientApp.ship ? (kM07UiPreview ? SampleShipperSource() : HttpShipperDeliverySource(session: session)) : null,
    m02: app == ClientApp.food
        ? createM02Flows(
            session: session,
            location: where,
            onboarding: shop,
            // The real server contract unless a test passes its own ports.
            menuApi: menuApi ?? HttpMenuApi(session: session, base: base),
            publicApi: publicApi ?? HttpPublicShopApi(transport: http, base: base),
            discoveryApi: discoveryApi ?? HttpDiscoveryApi(transport: http, base: base),
            picker: picker,
          )
        : null,
  );
}

/// The cart and the order sources of 11Food. The cart belongs to the signed-in account: it is read when a person signs in and dropped when the session
/// ends, so the next person never sees it.
OrderRuntime _orderRuntime(SessionController session, AddressBookController? book) {
  final SampleOrderStore? store = kM10UiPreview ? SampleOrderStore() : null;
  final CustomerOrderSource customer = store != null ? SampleCustomerOrders(store) : HttpCustomerOrderSource(session: session);
  final ShopOrderSource shop = store != null ? SampleShopOrders(store) : HttpShopOrderSource(session: session);
  final CartController cart = CartController(source: customer);
  SessionStatus last = session.status;
  session.addListener(() {
    final SessionStatus now = session.status;
    if (now == last) {
      return;
    }
    last = now;
    if (now == SessionStatus.signedIn) {
      cart.load();
    } else if (now == SessionStatus.guest) {
      cart.adopt(null);
    }
  });
  if (session.status == SessionStatus.signedIn) {
    cart.load();
  }
  return OrderRuntime(
    customer: customer,
    shop: shop,
    cart: cart,
    addresses: book,
    session: session,
    canOrder: () => session.status == SessionStatus.signedIn && (session.identity?.customerAccess ?? false) && session.identity?.activeRole != 'SHOP_OWNER',
  );
}
