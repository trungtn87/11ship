# 11Ship — Widgetbook V5 UI-only sandbox

This is a **separate Flutter web application** inside 11Ship.

**Full upstream repository**: `third_party/widgetbook` is an actual pinned Git
submodule of `https://github.com/widgetbook/widgetbook` at v3.25.0,
commit `66c1eb2f002aab2c90cceddff9f7a84db1959dc2`. The catalog depends
on its **local source** (`../../third_party/widgetbook/packages/widgetbook`),
not a reimplementation or a separate HTML mock. Widgetbook's own source,
examples, tests and license remain in this complete upstream checkout.
Use `git submodule update --init --recursive` whenever a fresh clone/worktree
is created or the pinned SHA changes; `git pull` alone does not populate it. It is not the
live 11Food / 11Ship application and does not change production entrypoints,
business logic, API, database, GPS or delivery state. Sample shop/order data
and the painted map in V5 are only visual placeholders.

## Run on your PC

Flutter SDK >= 3.44 (CI uses Flutter 3.47.8). From repository root:

    git submodule update --init --recursive
    cd mobile/v5_widgetbook
    flutter pub get
    flutter run -d chrome

For a shareable offline build:

    flutter build web --release

Output: mobile/v5_widgetbook/build/web/ (locally hosted static web files).

## Catalog

- 11Food V5 / Trang chủ + điều hướng / khách 3 tabs, chủ quán 4 tabs
- 11Ship V5 / Trang chủ + điều hướng / shipper 5 tabs
- Shared Design System / official PNG logos (BrandLogo), N11Button
  states, N11Card styles, and colors/fonts from n11_shared tokens.dart.

**Knobs tab is now functional**: toggle Food banner; adjust card radius,
search background color, Ship map height, third card and online initial state;
edit real N11Button text/icon/enabled status and the shared N11Card title/font.
Knob adjustments change the running Flutter use-case only: source tokens and
Flutter production files are NOT rewritten. Permanent changes require committing
Dart code followed by review and CI. All these are native Widgetbook 3.25 Knobs.

The home previews render **V5PreviewApp itself** from n11_shared, not copied
screenshots or a second UI implementation. Fixed preview reference size:
390 x 844 logical pixels. Press the tab bar to try navigation. For 11Ship
the Online button is local demo state only.

Every home story links to the corresponding Figma node. PNG logos come from
n11_shared/assets/brand and are not redrawn. No payment, backend or order
actions work. Use Chrome responsive tools and Widgetbook add-ons to inspect
mobile layout and text scale.

## QA

    flutter analyze
    flutter test
    flutter build web --release

GitHub Actions workflow: "V5 Widgetbook Catalog" runs the same checks and
uploads a static web artifact. V5 screenshot workflow remains independent and
continues to provide the actual Flutter home PNGs.

Keep PR #249 separate from main until Owner review and explicit merge approval.
