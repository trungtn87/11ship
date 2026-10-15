# 11Ship M01 UI — implementation, 2026-10-15

Status: **awaiting Flutter/Android CI; not device-accepted or module-complete**.
Reference: Owner's `1000002945.jpg`, received in this conversation. Written requirements take precedence: phone before name, two registration steps, no Google login, no fabricated statistics or GPS.

## Changes

- Ship registration information -> separate OTP view, matching passwords, scrollable terms without scroll gating, consent, retained input on back, phone editing drops old proof. Only successful OTP leads to the existing registration call; existing native device proof/session rules remain in force.
- Six-cell OTP presentation uses one accessible input for typing/paste/SMS autofill. Resend countdown reads the existing server-defined cooldown, without changing the rule. Food registration behavior is retained.
- Home: real OpenStreetMap tiles via flutter_map, approved logo, notification bell, white activity panel and yellow lower action. Panning/zoom are map UI only. Regional HCMC overview is explicitly labelled as not the device location. A failed map shows a retry action. No location permission or tracking added.
- Offline and Online activity panel layouts exist. Runtime deliberately stays offline/locked: M01 has no online mutation/GPS operating controller. `ACTIVE` or `accepting_deliveries` is not guessed to be an online session. No order, earnings, bank or verification data invented.
- Tabs: Trang chủ, Đơn hàng, Thu nhập, Thông báo, Tài khoản. Notifications is empty presentation only. Other M01 screens retain their behavior.
- Standalone Vietnamese “xế” / “tài xế” changed to “shipper” in UI/docs/related tests. Database/API/enums/paths unchanged. Generated PROGRESS.md is left to its generator; renderer uses the new terms.

## Verification and delivery

Previous terminology-only checks: TypeScript typecheck and Ship web build passed. They do not validate Flutter. `git diff --check` passed for the new UI. Local Flutter/Android checks are unavailable because neither SDK is installed. Local web tests hit sandbox `spawnSync .../node EPERM`.

Added widget regression coverage: consent/password gating, preserved input, changed phone, invalid/valid OTP, no account before verification, bell navigation and both activity panels at 320px/large text. Cooldown test checks rounded remaining seconds. Existing login/reset/shared/Food tests remain relevant because shared files changed.

The existing Mobile APK workflow will analyze/test/build/sign using persistent signing, unchanged app IDs and increasing run-number versionCode. A Ship-only step exports widget-render screenshots (fixture backend, not Android/device acceptance). Signed APK artifacts remain the existing workflow outputs. No throw-away signing or production bypass.

GitHub connector works despite shell Git/proxy failure. Checked latest main `b39aa12a3c06559afe938db850edda77f2ab3fe5`: compared with local base `3edd66b`, only PROGRESS.md changed. Existing Food PR #115 remains separate; no Food functional changes included here. PR #116 / app code SHA `808192951c9f665a2d03a928984a29b86ecef77f`: Ship Flutter analyze/tests/widget renders have passed in Mobile APK run 38678689390; build/sign still running at this checkpoint. Added a follow-up Android emulator guest smoke job against the signed APK: home, notifications, orders, income, account, registration step 1, login and forgotten-password screens, with screenshots and crash/overflow logs. It never submits a login or requests SMS. OTP success/Online visual state remain widget/controller checks, not Android/real-device acceptance. Pending: final CI result, signed APK link, Android screenshot artifact and real-device acceptance. No real SMS, remote migration or production deployment performed.
