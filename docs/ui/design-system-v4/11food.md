# PR 2 — 11Food UI v4

Base: merged foundation PR #240, main commit `d41773c3bee9c2869877e4c8a8d84c2f15c9ecf3`.

## Presentation changes

- Discovery: full-width search above reusable category chips, compact area heading, 88–96dp shop logos and clearer shop titles. Search results distinguish dish prices, shop/status metadata and quantity controls.
- Shop details/preview and owner menu: reuse `N11SearchField`; larger dish images and readable black prices; quantity/status controls move below text on narrow screens or large system fonts. Existing query limits are preserved.
- Shop management: shared heading typography, lighter card borders and warning tones. Existing profile, hours, menu editor and statistics navigation remain available.
- Cart: separate shop, item and estimated-total cards; responsive item actions and price rows. Checkout groups recipient and direct-payment information. All fee values, availability guards, mutation callbacks and submission logic are unchanged.
- Orders retain the foundation footer approved by Owner: primary confirmation above one row containing **Sửa đơn** and **Từ chối đơn**. Customer cancellation uses a soft-red action. Customer editing remains issue #238; no unavailable action is exposed.
- Existing account, notifications, call-ship, address, chat, rating and order-detail screens continue using the integrated V4 theme/components. No role, route or feature is removed.

## Concurrent work

Compared open PRs before implementation. PR #225 touches two of the same files, in different sections: its menu quota banner is outside `_listBody` in `menu_views.dart`; its `MENU_VISIBLE_LIMIT_REACHED` error mapping is outside `DishRow` in `m02_widgets.dart`. Neither section is edited or copied here. Shared-file formatting is limited to changed widgets to preserve those boundaries. Finance/controller/API/model changes remain in their assigned workstreams.

Routing/fee issues (#228/#239) and customer order editing (#238) remain separate. This PR does not add route-distance fallback values, fee formulas, database changes or fake enabled actions.

## Validation and review evidence

- Standalone Dart formatter parses every changed Dart source; changed widget blocks are formatted. `git diff --check` passes.
- Added a real cart-controller widget regression at 320dp and 2× text scale, exercising increment, decrement and removal through existing callbacks.
- Mobile CI performs Flutter analysis, shared/app tests, persistent-key APK builds and existing Android guest smoke tests. Local Flutter was not run because bootstrap was blocked by automatic approval review; CI is the execution environment.
- Food CI now publishes opt-in renders from the existing discovery/menu/forms screenshot tests, in addition to existing order/cart renders. Material icon font is explicitly loaded to avoid square placeholders. Discovery captures include 320, 360, 390 and 600dp widths.
- Renders use fixture data and are visual evidence only. Android installation, real GPS, keyboard/back/navigation and role-specific connected flows still require device acceptance; do not infer acceptance from screenshots or green CI.

See the PR checks and Actions artifacts for execution results. No deployment or module closure is performed by this UI PR.
