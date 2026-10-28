import 'package:flutter/widgets.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:n11_shared/n11_shared.dart';

import 'catalog.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const V5WidgetbookApp());
}

/// Design-only sandbox. This is NOT a new entrypoint for the live Android apps.
class V5WidgetbookApp extends StatelessWidget {
  const V5WidgetbookApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Widgetbook.material(
      directories: buildV5Catalog(),
      lightTheme: buildN11Theme(),
      addons: [
        ViewportAddon([Viewports.none, AndroidViewports.samsungGalaxyNote20]),
        TextScaleAddon(),
      ],
    );
  }
}
