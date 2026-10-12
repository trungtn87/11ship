import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_tabs.dart';

void main() {
  runApp(N11App(brand: shipBrand, tabs: buildShipTabs(), config: AppConfig.fromEnvironment()));
}
