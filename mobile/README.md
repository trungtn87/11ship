# 11Food and 11Ship test apps (Flutter, Android)

Test APKs for the Owner. They check the real server connection (`GET /v1/health/live` and `/v1/health/ready`) and, since M01-ANDROID, connect the
account flow to the real backend: **register (SMS code) -> login -> own profile (name) -> logout / session end**, on a device-bound session.
Every other business action stays **locked with a visible reason** ("Chưa nối trên Android"); there are no fake accounts, balances, shops, orders or GPS.

- `packages/n11_shared` brand, theme, health monitor (5 s timeout, newest-check-wins, normal TLS verification only), widgets, diagnostics, and the account layer
  (`lib/src/account`: typed server contract, HTTPS transport, device-proof messages, `SessionController`, the login / register / profile / logout screens).
- `food/` 11Food: Trang chủ, Tìm kiếm, Đơn hàng, Tài khoản (Quản lý cửa hàng is in Tài khoản, locked: needs login).
- `ship/` 11Ship: Trang chủ, Đơn hàng, Thu nhập, Thông báo, Tài khoản.
- `*/android_overlay` launcher icons and splash generated from the approved icons by `tools/brand/build-brand-assets.py`.
- `tool/prepare-android.sh <food|ship>` generates the Android project (`flutter create` + overlay + the Kotlin device bridge in `tool/android-templates/kotlin`). The result is not committed;
  everything native is in this repository, so the script rebuilds it. It needs `DEVICE_ENVIRONMENT` (see below).

applicationId: `vn.eleven.food.test`, `vn.eleven.ship.test` (never change them: they identify the app on the phone).

## Get the APKs
GitHub → Actions → **Mobile APK** → open a run → Artifacts: `11Food-test.apk`, `11Ship-test.apk` (zip each, unzip, copy the .apk to the phone). Run it manually with *Run workflow*.

Install: allow "install unknown apps" for the app you open the file with, tap the .apk, install. Open the app; the banner shows the server state, and *Tài khoản → Chẩn đoán kết nối* shows version, build, source commit and both probes.

## Account and device session (M01-ANDROID)

Contract: `docs/design/system-v2-20261011/11-m01-session-device-contract.md` sections 7-9; hand-off `docs/tasks/M01-android-account-session-handoff-20261013.md`.

- **Registration needs the SMS code, and no weaker proof.** The app registers only when the server answers `REQUIRED` (`GET /v1/client-auth/config`); any other answer opens nothing. The device proof, the signatures and TLS are all still required.
  all still required. If the server runs `REQUIRED`, the register screen says that phone verification is not supported on Android; nothing is faked.
- **Device proof.** Each app has an ECDSA P-256 key generated inside the Android Keystore (non-exportable) with the server's challenge as attestation challenge. Every login / register / authenticated request is signed by it; a stolen token
  without the key opens nothing. A phone that cannot attest in TEE / StrongBox with a locked, verified boot gets `DEVICE_PROOF_UNSUPPORTED` (shown as such); there is no software fallback and no compatibility tier.
- **Two apps, one phone.** Food and Ship are signed with the same persistent key. Ship (or Food) finds the other app through a signature-protected Binder service, which endorses the new key for the JOIN of the current binding
  (it signs one fixed message shape, only for the other app, only while it has a binding). Without the other app (or with it cleared) the app logs in on its own binding, like a new phone. A login from another phone replaces the binding
  and ends the sessions of both apps; a login again from one app on the same phone ends only that app's session.
- **Storage.** The access token is AES-GCM encrypted with a Keystore key in the app's no-backup storage; never in preferences, logs, backups or the Binder. The password is never stored. A 401 clears the token and personal data but keeps the device key. A cold start asks `GET /v1/client-auth/me` before showing anything personal.
- **Not wired on Android yet** (locked, reason "Chưa nối trên Android"): receiving orders, wallet.

### Remaining flows (hand-off `docs/tasks/M01-android-remaining-flows-handoff-20261013.md`)
All three reuse the session above and the backend that already exists; nothing is created or granted by the app.
- **Food - shop profile (F20-F23).** *Tài khoản -> Quản lý cửa hàng* (signed in). The app reads `GET /v1/onboarding/shop/profile` first and creates nothing by itself. A draft saves with `PUT` (`expected_version`, `Idempotency-Key`) without a position.
  *Lấy vị trí tại quán* takes **one** real foreground fix on the button press (Android `LocationManager`, FINE + COARSE foreground permission only, mock providers refused, nothing keeps listening). There is no default, cached or typed position;
  denied / disabled / timeout leave the draft and block completion. Service areas come only from `GET /v1/onboarding/shop/service-areas` (ACTIVE). *Hoàn tất hồ sơ* calls `POST /v1/onboarding/shop/complete {expected_version}`:
  the shop becomes ACTIVE with `accepting_orders=false`, SHOP_OWNER is added and CUSTOMER kept. The context changes only when the person taps *Vào quản lý cửa hàng* / *Về giao diện khách hàng* (signed `POST /v1/client-auth/context`).
  ACTIVE and DISABLED shops are read-only. Every write is read back with `GET`; a lost answer is retried with the same key and body only when the person presses *Thử lại*.
- **Ship - driver profile (S12-S13).** *Tài khoản -> Hồ sơ shipper*. `GET /v1/driver/me` first; one `POST /v1/onboarding/driver {full_name, plate_number?}`; then `driver/me` and `me` are read again. PENDING / ACTIVE / SUSPENDED / CLOSING / CLOSED are shown with *Tải lại*.
  Sending the profile never changes the context and never enables receiving orders (still locked).
- **Both - forgotten password (SMS code only).** *Đăng nhập -> Quên mật khẩu?*: the form works only when `GET /v1/account-recovery/config` says `SMS_OTP` (phone -> *Gửi mã* -> code from the SMS -> new password: `POST /v1/account-recovery/otp`, `.../otp/{id}/verify`, `.../reset {verification_token, password}`). The code request answers the same for every number, the proof is one-use and bound to the number that received the code. The old no-OTP route is not used by the app. Email recovery is **not** part of this build.
- **Both - register with an SMS code (issue #102, server `REQUIRED` mode).** The register screen shows *Gửi mã xác minh* under the phone field: `POST /v1/auth/phone-verifications`, then it polls `GET /v1/auth/phone-verifications/{id}` while the server says `PENDING_DELIVERY`
  (the SMS is sent by a paired phone; **the code field is offered only once the server says SENT**), then `POST .../verify` gives the one-use `verification_token`, which rides in the signed `POST /v1/client-auth/register` body next to the device proof
  (the OTP proof does not replace the native device proof). Editing the phone drops the challenge and the proof. Nothing is faked: with no proof the app sends no registration.
- **Permissions (exact allowlist, checked in CI by `mobile/tool/check-apk-permissions.sh`).** Food: INTERNET, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION (+ the signature permission between the two apps). Ship: INTERNET only (+ the signature permission). No background location, camera, contacts or storage.
- When a session ends (logout, 401, another phone), the shop, driver and reset controllers drop every personal value and any pending write.

> **Production note (2026-10-14):** the apps are the real operating build. Server address: `config/endpoints.json` (read by the workflows). Consent pair sent: `terms-20261014-v1` / `privacy-20261014-v1` (texts in `docs/current/M01-terms-privacy-20261014.md`, pending Owner approval). The sections below describe the same inputs; production uses `APP_ENV=production` on a loopback bind behind nginx — see `ops/runbooks/vps-production-update-20261014.md`.

### Server inputs (development/test or production, loopback bind only)
`CLIENT_AUTH_ANDROID_ENABLED=true` plus `CLIENT_DEVICE_ENVIRONMENT`, `CLIENT_DEVICE_ALLOWED_SIGNERS_FILE`, `CLIENT_DEVICE_ATTESTATION_ROOTS_FILE`, `CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE` (see `.env.example`). Staging or a remote bind with the gate on stop the startup; production needs all four inputs.
- Signers file: the **Mobile APK** workflow publishes the public signing-certificate SHA-256 of the persistent key (job summary + the `android-signers.json` artifact: `{"FOOD":{"package_name":"vn.eleven.food.test","signer_sha256":"<hex>"},"SHIP":{...}}`). Nothing secret is printed.
- Roots file: the Android Key Attestation roots that **you pin** (PEM). The app and the server never use the OS trust store for this, and a client can not supply a root.
- Revocation file: a snapshot of the official Android attestation status list with `fetched_at` (`{"fetched_at":"<ISO>","entries":{"<serial hex>":{"status":"REVOKED"}}}`). Older than 24 hours, or unreadable: the server answers 503 at verification.
- `CLIENT_DEVICE_ENVIRONMENT` must equal the repository variable `N11_DEVICE_ENVIRONMENT` the APKs were built with (default `ship11-test`).

### Reaching the PC from a phone (HTTPS, test package only)
1. Start the backend on loopback with the inputs above and `CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST`, `CLIENT_AUTH_TERMS_VERSION`, `CLIENT_AUTH_PRIVACY_VERSION`.
2. `node scripts/native-gateway-cert.mjs <PC-LAN-IP>` then `NATIVE_GATEWAY_HOST=<PC-LAN-IP> node scripts/native-gateway.mjs` (or keep `127.0.0.1` and use `adb reverse tcp:8446 tcp:8446`).
   The gateway forwards an exact allowlist of routes (device, client-auth, own profile, shop/driver onboarding, test reset, health), the body byte for byte and only the proof headers; the existing web fronts are untouched.
3. Copy `.local/native-gateway-tls/cert.pem` to the phone and install it (*Settings -> Security -> Encryption & credentials -> Install a certificate -> CA certificate*). The test APKs trust user CAs through `network_security_config.xml`
   (normal certificate verification; no cleartext, no trust-all). Do not ship that file in a production application id.
4. Run **Mobile APK** with `api_base_url = https://<PC-LAN-IP>:8446`. The default server (`https://103.9.78.67.sslip.io`) has no native verifier deployed: the account screens then say the server is not ready for Android.

### What is verified where
Backend (CI, real PostgreSQL, fixture attestation chains - they prove the server logic, **not a real phone**): `tests/integration/native-device-binding.int.spec.ts` and `native-remaining-flows.int.spec.ts` (shop/context/driver with the proof, binding recheck, public reset). Dart controller/screens (CI): `flutter test`.
Binder join rules (CI): `./gradlew :app:testDebugUnitTest`. **Not run by Claude and required from the Owner:** real-hardware attestation, real GPS at a shop (grant / deny / location off), both apps on one phone (both install orders), update-over-install keeping key and token, two phones replacing each other, background/offline recovery.

## Signing (once)
Secrets `ANDROID_TEST_KEYSTORE_BASE64`, `ANDROID_TEST_KEYSTORE_PASSWORD`, `ANDROID_TEST_KEY_ALIAS`, `ANDROID_TEST_KEY_PASSWORD`. Create them with `mobile/tool/create-test-keystore.sh` and keep a private backup of the key file.
### Owner decision — 2026-10-12: update in place

Every subsequent test APK must install as an update over the previous build, preserving application data and avoiding uninstall/reinstall. The Owner downloads the APK and taps **Update** manually; an automatic updater is not required.

- Use a persistent test signing key for each application's entire lifetime. The two apps may share the existing test keystore; never regenerate it per build. Store credentials in GitHub Secrets, never commit private keys, and keep a private backup.
- Keep applicationIds `vn.eleven.food.test` and `vn.eleven.ship.test` unchanged.
- Increase Android versionCode for each new distributed build; re-running the same build is not a new version. Do not reset the sequence when changing workflows.
- Missing/incomplete signing secrets must stop APK distribution with a clear error. A throw-away signing key is no longer allowed.
- Preserve local data across updates; future schema changes must migrate existing data rather than requiring a reinstall.

Implemented in M01-ANDROID: the workflow has no ephemeral fallback. Its first step (before checkout) fails with a clear error naming the missing secret(s), so nothing is built, signed or uploaded; the Owner has set all four Secrets. The workflow checks the APK's applicationId, versionCode (= `github.run_number`, never reset),
and that the APK is signed with the keystore's certificate, and builds exactly the commit it reports (`SOURCE_SHA`).

If an already installed first APK was signed with an older throw-away key (no longer produced by any workflow), switching to the persistent key can require a **single initial uninstall**. Thereafter test builds must update in place.

## Local
`flutter pub get && flutter analyze && flutter test` in `packages/n11_shared`, `food`, `ship`. To run on a phone: `DEVICE_ENVIRONMENT=local-test tool/prepare-android.sh food`, then in `food/`
`flutter run --dart-define=API_BASE_URL=https://<host> --dart-define=DEVICE_ENVIRONMENT=local-test` (a debug build is signed with the debug key: it can not join a release-signed app of the other kind, by design).

## M01 UI (issue #98)
The Food/Ship screens follow the approved M01 design (Brand Board v1.1: UI yellow #E2B81F, Plus Jakarta Sans bundled in `n11_shared/assets/fonts`, 14 px controls). Only presentation changed; controllers, API calls and sessions are those of the account/flows code above.
Screenshots (fixture data from the test fakes, regenerate with `N11_SCREENSHOTS=<dir> flutter test test/screenshots_test.dart` in `food/` or `ship/`): `docs/ui/android-m01/`.
