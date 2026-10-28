import 'package:flutter/widgets.dart';
import 'package:n11_shared/v5_preview.dart';

// Isolated UI demo: flutter run -t lib/v5_main.dart
// Customer nav: --dart-define=V5_SHOP_OWNER=false
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const owner = bool.fromEnvironment('V5_SHOP_OWNER', defaultValue: true);
  runApp(const V5PreviewApp(isFood: true, shopOwner: owner));
}
