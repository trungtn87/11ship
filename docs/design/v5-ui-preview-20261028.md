# V5 Flutter UI preview — 2026-10-28

Scope: UI-only and bottom tab navigation. No real business/data/API functionality.

- 11Food: cd mobile/food && flutter run -t lib/v5_main.dart
- Food customer 3 tabs: add --dart-define=V5_SHOP_OWNER=false
- Food shop owner 4 tabs: default demo.
- 11Ship: cd mobile/ship && flutter run -t lib/v5_main.dart
- 11Ship has 5 tabs. Its online button only changes local text/color.

Both entrypoints use shared widgets in mobile/packages/n11_shared/lib/v5_preview.dart
and existing brand tokens/logo. Production main.dart files are unchanged.

Shop names, ratings, distances and prices are sample visual content.
Preview map is drawn with CustomPainter; not GPS, delivery tracking or offline tiles.
Order-card buttons are display-only; API, billing and checkout are NOT connected.

Workflow .github/workflows/v5-preview.yml renders two actual Flutter 390x844
home screenshots as downloadable artifact v5-home-flutter-390x844.
Widget test screenshots are NOT evidence of Android device acceptance.

Do not merge or deploy without Owner approval.
