import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'image_picker_adapter.dart';
import 'ship_tabs.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final AppConfig config = AppConfig.fromEnvironment();
  final SessionController session = createSessionController(ClientApp.ship, config);
  final AppFlows flows = createFlows(ClientApp.ship, session, config, picker: DeviceImagePicker(), pushPort: MethodChannelPushPort());
  // Cold start: the stored token is checked with the server (`me`) before anything personal is shown.
  session.start();
  runApp(ListenableBuilder(listenable: session, builder: (BuildContext context, Widget? child) => N11App(navigationIdentity: session.identity?.userId, brand: shipBrand, tabs: buildShipTabs(session, flows: flows), config: config, notifications: NotificationShell(controller: flows.notifications!, router: shipNotificationRouter(session, flows), push: flows.push))));
}
