import 'package:flutter/widgets.dart';
import 'package:n11_shared/v5_preview.dart';

// Isolated UI demo: flutter run -t lib/v5_main.dart
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const V5PreviewApp(isFood: false));
}
