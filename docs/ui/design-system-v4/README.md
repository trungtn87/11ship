# Design System v4 — Flutter foundation

Owner scope: 26/10/2026, 11Food + 11Ship, UI only. Reference: supplied
`11Ship_DesignSystem_v4_Starter.zip` (`tokens.json`, `DESIGN_GUIDE.md` and SVGs).
The supplied archive is sufficient; implementation has no Figma dependency.

## Ownership and sequence

1. Foundation: `src/tokens.dart`, shared `widgets/components.dart`, discovery
   controls, and narrow substitutions of the existing search field and bell count.
2. 11Food screen redesign: start from **main after foundation is merged**.
3. 11Ship screen redesign: start from the same integrated foundation.

Do not merge or deploy these PRs without Owner instruction. PR2/3 are not started
on independent copies of the theme. This foundation alone is not a claim that
all screens have been redesigned or accepted on Android hardware.

Initial base inspected: main `576e4f52`; refresh from latest main before pushing. Open work checked before implementation:
#225 finance; #226 navigation/role notifications; #227 map gestures/camera;
#228 routes/fees; #229 addresses; #230 order money/rating; #231 courier calls;
#232 address changes; #233 finance retries; #234 Admin tasks. #225 currently
changes finance/menu/models and app tabs, not the foundation files. The other
mobile groups were handoff-only at this preflight. Recheck their actual diff
before each screen PR, especially discovery, notification, shell and order views.
Existing business issues #238/#239 (editing unconfirmed orders and wrong fee
estimates) remain separate; V4 must not invent route results or recalculate money.

## Tokens and compatibility

`N11Colors`, `N11Space`, `N11Text` and `buildN11Theme()` remain the public API.
Existing screens inherit V4 immediately, including Material buttons, fields,
cards, dialogs and sheets. This does not replace their layout or controllers.

Primary #FFC400; pressed #E9B000; soft #FFF5C2; text #191919/#667085;
canvas #F7F8FA; surface white; border #EAECF0; success #18794E/#E7F5EC;
warning #B54708/#FFF0D7; error #B42318/#FEE4E2. `yellowStrong` is a darker
readable link ink, **not** the primary pressed token. Keep original logo artwork.
Controls/cards: radius 12/16dp. Touch targets: at least 48dp. Spacing remains
4/8/12/16/24/32dp, default page padding 16dp. Do not clamp system text scaling.

Keep bundled Plus Jakarta Sans with Vietnamese coverage. Inter is not already
bundled; no network font or additional APK font payload is introduced.

## Component reuse map

| Requested concept | Existing/shared implementation |
| --- | --- |
| AppButton | `N11Button`, `ButtonKind.primary/secondary/ghost/dark`, loading + disabled; keep `validate` and callbacks |
| AppTextField / SearchField | `N11Field` / `N11SearchField` (controller owned by caller) |
| AppCard / ShopCard / OrderCard | `N11Card` / existing `ShopCard` / `OrderSummaryCard`, `OfferCard`; screen layout changes belong to PR2/3 |
| StatusBadge / CategoryChip | `N11Chip` / `CategoryChip` |
| Empty / error / loading | `EmptyState`, `N11StateBlock`, `N11Banner`; existing `M02LoadFailed`, `M02Skeleton`, `M07Loader` |
| BottomNavigation / AppHeader | `N11BottomNav` / `N11AppBar`; keep selection callbacks and routing |
| PriceSummary / FeeProposal | existing `OrderMoneyCard`, `MoneySummary`, `FeeAgreementCard`, proposal dialogs; preserve calculation/approval logic |
| ContactActions / NotificationBadge | existing `ContactRow`, `QuickCall`, shop contact actions / `NotificationBadge` used by `NotificationBell` |
| Dialog / BottomSheet | shared Material theme + existing confirmation helpers; retain dismiss/submit rules |
| MapContainer / GPSWarning | existing `OrderMapCard`, `OrderSection`, map adapters and ship GPS alerts; no new tracking/GPS policy |

Avoid aliases or parallel wrappers for existing widgets. Use `CategoryChip` in
screen redesign where categories actually exist; it does not add filtering policy.

## Verification

`design_system_v4_test.dart` checks disabled/loading action suppression, search
edit/clear callbacks, 320/390/600dp, 1x/1.3x/2x system text, keyboard insets,
scrolling to a lower field and five-tab selection. It can render PNGs with real
bundled fonts (illustrative data, not a server transaction):

```sh
cd mobile/packages/n11_shared
N11_V4_SCREENSHOTS=../../../../docs/ui/design-system-v4/screenshots flutter test test/design_system_v4_test.dart
```

Run shared/app analysis and relevant existing tests. The existing Mobile APK PR
workflow builds and signs both apps using the persistent key and exact head SHA.
Do not distribute a debug/temporary-key build as an update. Record actual local,
CI, APK and hardware results separately in the PR; backend integration is left to
existing required CI rather than manually triggered repeatedly for this UI change.

Local environment: Dart formatter and font glyph coverage check ran. Flutter
bootstrap was stopped after automatic approval review detected a metadata-service
request; no further local Flutter execution is used. Analysis/widget tests and
signed APK builds run in the existing GitHub-hosted workflow. The Test step emits
foundation PNGs during its normal test run (no duplicate full test invocation).
