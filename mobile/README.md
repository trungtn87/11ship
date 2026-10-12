# 11Food and 11Ship test apps (Flutter, Android)

Frame APKs for the Owner to install and check the real server connection (`https://103.9.78.67.sslip.io`, `GET /v1/health/live` and `/v1/health/ready`).
Login, register and every business action are **locked with a visible reason**; there are no fake accounts, balances, shops, orders or GPS.

- `packages/n11_shared` brand, theme, health monitor (5 s timeout, newest-check-wins, normal TLS verification only), widgets, diagnostics.
- `food/` 11Food: Trang chủ, Tìm kiếm, Đơn hàng, Tài khoản (Quản lý cửa hàng is in Tài khoản, locked: needs login).
- `ship/` 11Ship: Trang chủ, Đơn hàng, Thu nhập, Ví, Tài khoản.
- `*/android_overlay` launcher icons and splash generated from the approved icons by `tools/brand/build-brand-assets.py`.
- `tool/prepare-android.sh <food|ship>` generates the Android project (`flutter create` + overlay). The result is not committed.

applicationId: `vn.eleven.food.test`, `vn.eleven.ship.test` (never change them: they identify the app on the phone).

## Get the APKs
GitHub → Actions → **Mobile APK** → open a run → Artifacts: `11Food-test.apk`, `11Ship-test.apk` (zip each, unzip, copy the .apk to the phone). Run it manually with *Run workflow*.

Install: allow "install unknown apps" for the app you open the file with, tap the .apk, install. Open the app; the banner shows the server state, and *Tài khoản → Chẩn đoán kết nối* shows version, build, source commit and both probes.

## Signing (once)
Secrets `ANDROID_TEST_KEYSTORE_BASE64`, `ANDROID_TEST_KEYSTORE_PASSWORD`, `ANDROID_TEST_KEY_ALIAS`, `ANDROID_TEST_KEY_PASSWORD`. Create them with `mobile/tool/create-test-keystore.sh` and keep a private backup of the key file.
Without them CI signs with a throw-away key and says so (job summary and diagnostics): then uninstall the old build before installing a new one.

## Local
`flutter pub get && flutter analyze && flutter test` in `packages/n11_shared`, `food`, `ship`. To run: `tool/prepare-android.sh food`, then `flutter run --dart-define=API_BASE_URL=https://103.9.78.67.sslip.io` in `food/`.
