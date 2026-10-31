import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'image_picker_adapter.dart';
import 'ship_online.dart';
import 'ship_tabs.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final AppConfig config = AppConfig.fromEnvironment();
  final SessionController session = createSessionController(ClientApp.ship, config);
  final AppFlows flows = createFlows(ClientApp.ship, session, config, picker: DeviceImagePicker(), pushPort: MethodChannelPushPort());
  // Cold start: the stored token is checked with the server (`me`) before anything personal is shown.
  session.start();
  // Sharing the position follows the session and what the server says is needed, not a screen: it starts watching here, before any tab is built.
  shipOnlineFor(session, driver: flows.driver).attach();
  // M13: update check (a notice only), version report and the offline error queue. Null when this build has no server address.
  final OpsClient? ops = createOpsClient(ClientApp.ship, session, config);
  ops?.installCrashHooks();
  ops?.start();
  runApp(ListenableBuilder(listenable: session, builder: (BuildContext context, Widget? child) => N11App(navigationIdentity: session.identity?.userId, brand: shipBrand, tabs: buildShipTabs(session, flows: flows), config: config, updates: ops?.updates, notifications: NotificationShell(controller: flows.notifications!, router: shipNotificationRouter(session, flows), push: flows.push))));
}
