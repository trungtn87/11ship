# PR 3 — 11Ship UI v4

Based on integrated PR1 and PR2: main `bf7849dee0662b0ac9bb139cb0ec6240d64064b0` (PR #243).

- Home uses the shared V4 card for online status, a clear state icon and a 56dp activity action. The existing single GPS/network alert, location explanation, map, recenter control and disclosure remain intact. No refresh timing, precision, presence threshold or online guard changes.
- Offers emphasize the server-provided fee and shop name. Responsive metadata rows retain distance, goods value, payer, expiry and eligibility. Status headers wrap on small screens. No customer contact/map is exposed before accepting.
- Current/history cards make the fee easier to scan. Delivery map uses the existing lazy `OrderSection`, collapsed by default; opening it uses the same map adapter and pins. Quick calls, chat, feedback and capability-based pickup/completion remain.
- Fee-proposal dialog scrolls with the keyboard and has a primary submit button; parsing, range, ownership, idempotency and approval semantics are unchanged. Release uses the shared soft destructive style.
- Wallet transactions adapt their amount/status placement to narrow screens and large text. Existing shared key/value rows replace duplicate wallet row layout. Transaction details scroll; all original amounts, holds, ledger signs, statuses and request actions remain. Available balance typography is 28sp. No finance calculations or mutations change.
- Income's existing unavailable-data presentation gets shared heading typography. The data source is still absent on main: unknown remains “—”, never invented revenue. Wallet entry and the disabled date action remain.
- Account/settings, notifications, ratings/complaints and chat continue using the integrated shared V4 components; their authorization and navigation are unchanged.

## Concurrent work and limits

Compared open PRs #225–234 and #189. #225's `ship_tabs.dart` changes concern notification deep links/account entries; only `_unknownFigure` presentation is changed here. Its finance widgets and models are untouched. The other grouped PRs currently contain handoff documents only; their future map/route, income, navigation and courier business changes are not imported into this PR. #227 owns camera/gestures; this PR only changes map disclosure using an existing widget. #228/#239 own route/fee corrections; source distance/amount is never replaced or synthesized. #231 owns offer-action changes; existing actions are preserved here.

## Validation

Standalone Dart formatting/parser checks and diff whitespace checks run locally. Local Flutter execution remains blocked after automatic approval review rejected bootstrap metadata access; use the existing GitHub-hosted Mobile APK workflow for analysis, shared/app tests, native tests, signed builds and guest Android smoke.

Added ship widget checks at 320/390/600dp, including 2× text at 320dp: offer acceptance callback, online-toggle callback, opening transaction details, and lazy map open/close while completion remains available. The ordinary Ship test step emits opt-in fixture renders with bundled text/icon fonts, so there is no extra full-suite invocation. Existing GPS/offline/error/disabled, wallet and delivery-flow tests remain mandatory.

Fixture renders and emulator smoke do not establish real GPS/network, keyboard/back behavior on every device or production transaction acceptance. Record CI/APK links in the PR. No deployment or module closure.
