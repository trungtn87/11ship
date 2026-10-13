import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_tabs.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final AppConfig config = AppConfig.fromEnvironment();
  final SessionController session = createSessionController(ClientApp.ship, config);
  final AppFlows flows = createFlows(ClientApp.ship, session, config);
  // Cold start: the stored token is checked with the server (`me`) before anything personal is shown.
  session.start();
  runApp(N11App(brand: shipBrand, tabs: buildShipTabs(session, flows: flows), config: config));
}
