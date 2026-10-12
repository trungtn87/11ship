import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'food_tabs.dart';

void main() {
  runApp(N11App(brand: foodBrand, tabs: buildFoodTabs(), config: AppConfig.fromEnvironment()));
}
