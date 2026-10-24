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
  // M13: update check, version report and the offline error queue. Null when this build has no server address.
  final OpsClient? ops = createOpsClient(ClientApp.food, session, config);
  ops?.installCrashHooks();
  ops?.start();
  runApp(ListenableBuilder(listenable: session, builder: (BuildContext context, Widget? child) => N11App(navigationIdentity: session.identity?.userId, brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, updates: ops?.updates, notifications: NotificationShell(controller: flows.notifications!, router: foodNotificationRouter(flows), push: flows.push))));
}
