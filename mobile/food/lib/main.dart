import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'food_m14.dart';
import 'food_tabs.dart';
import 'image_picker_adapter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final AppConfig config = AppConfig.fromEnvironment();
  final SessionController session = createSessionController(ClientApp.food, config);
  final AppFlows flows = createFlows(ClientApp.food, session, config, picker: DeviceImagePicker(), pushPort: MethodChannelPushPort(), orderMapBuilder: foodMapBuilder(), orderPinPicker: foodPinPicker());
  // Cold start: the stored token is checked with the server (`me`) before anything personal is shown.
  session.start();
  runApp(ListenableBuilder(listenable: session, builder: (BuildContext context, Widget? child) => N11App(navigationIdentity: session.identity?.userId, brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, notifications: NotificationShell(controller: flows.notifications!, router: foodNotificationRouter(flows), push: flows.push))));
}
