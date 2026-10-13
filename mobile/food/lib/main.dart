import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'food_tabs.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final AppConfig config = AppConfig.fromEnvironment();
  final SessionController session = createSessionController(ClientApp.food, config);
  // Cold start: the stored token is checked with the server (`me`) before anything personal is shown.
  session.start();
  runApp(N11App(brand: foodBrand, tabs: buildFoodTabs(session), config: config));
}
