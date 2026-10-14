# SMS Gateway (issue #102) — pairing, switches, limits and field test

The backend never talks to an SMS provider. It writes the OTP message into a PostgreSQL queue (encrypted at rest) and a paired
Android phone (`mobile/gateway`, package `vn.eleven.gateway.test`) connects **out** over HTTPS, takes one job at a time and sends it
with its own SIM. Nothing is deployed or migrated by this change: **applying the migration, setting the variables below and restarting the
VPS are separate steps that need the Owner's own authorization.**

## What is on, what is off (defaults)

| Switch | Default | Effect when off |
|---|---|---|
| `SMS_GATEWAY_ENABLED` (env) | unset = off | no gateway code is wired, no `/v1/sms-gateway/*` route, staging/production still refuse to start without a real OTP provider |
| runtime sending switch (`sms-gateway:ctl enable|disable`) | **absent = disabled** | OTP requests answer 503 and write no challenge; the phone is told `sending_enabled=false` and is handed no job |
| `SMS_GATEWAY_RECIPIENT_MODE` | `ALLOWLIST` | only `SMS_GATEWAY_ALLOWLIST` numbers can receive an SMS; real customers need `OPEN`, i.e. a separate decision |
| `ACCOUNT_RECOVERY_MODE` | `UNAVAILABLE` | `SMS_OTP` is accepted only with `SMS_GATEWAY_ENABLED=true`; `DISABLED_TEST` still needs development/test on loopback |
| Android phone | not paired / paused | the phone is "not ready"; OTP requests answer 503 |

Do **not** enable `OPEN` for real customers before the Owner has confirmed that the SIM / carrier terms allow automatic OTP sending.

## Environment variables (names only — never commit values)

`SMS_GATEWAY_ENABLED`, `SMS_GATEWAY_RECIPIENT_MODE`, `SMS_GATEWAY_ALLOWLIST`, `SMS_GATEWAY_LIMIT_PHONE_PER_HOUR` (3), `SMS_GATEWAY_LIMIT_PHONE_PER_DAY` (5),
`SMS_GATEWAY_LIMIT_GLOBAL_PER_DAY` (30), `SMS_GATEWAY_ONLINE_WINDOW_SECONDS` (90), `SMS_GATEWAY_LEASE_SECONDS` (60), `SMS_GATEWAY_POLL_SECONDS` (5),
`ACCOUNT_RECOVERY_MODE=SMS_OTP`. Needed besides them: `CRYPTO_KEYRING` + `CRYPTO_ACTIVE_KEY_ID` (the queued message is sealed with a purpose key derived from it:
never remove a key id that still has QUEUED/CLAIMED jobs) and `AUTH_OTP_HMAC_SECRET`. A bad value stops startup and names only the variable.

## Pairing a phone (Owner / operator only)

1. On the server (with `DATABASE_URL`/`APP_ENV` as for the other operator commands, after `npm run build`):
   `npm run sms-gateway:ctl -- pair --label "Android cu"` — prints the device id and the 256-bit credential **once**. Only its SHA-256 is stored.
2. In the app *11Ship SMS Gateway*: enter the VPS address (`https://...`, certificate checked against the system CAs; no cleartext, no certificate bypass) and the credential
   -> *Ghép cặp*. The app first asks the VPS to accept the credential, and only then stores it (sealed with an Android Keystore key, never in clear).
3. *Cấp quyền SMS và thông báo*, *Cho phép chạy nền* (battery), then *Bật gateway*. On the server: `npm run sms-gateway:ctl -- enable`.
4. `npm run sms-gateway:ctl -- list` shows each device, its last contact, app version, SMS permission and pause flag, and whether sending is ENABLED.
5. Revoke / replace a credential: `npm run sms-gateway:ctl -- revoke --device-id <uuid>` (effective at once), then pair again. Kill switch: `... disable`.

There is no HTTP route that creates a device or a job, and the gateway token is not a user or admin credential.

## How a code travels

`POST /v1/auth/phone-verifications` (REGISTER) or `POST /v1/account-recovery/otp` (RESET_PASSWORD) -> the challenge is committed as `PENDING_DELIVERY` (cannot be verified)
-> the job is queued (`QUEUED`, sealed) -> the phone claims it (`CLAIMED`, lease) -> sends -> reports `SENT` (the radio accepted it) / `FAILED` / `UNKNOWN`
-> only then the challenge becomes verifiable (`PENDING`). `SmsManager` returning is not "sent": the sent-intent result decides.

* A job is handed out **once**. A lost acknowledgement (lease ends) or a crash of the phone becomes `UNKNOWN`: it is **never** resent; the code stays usable (it was never shown to anybody else) and the user may ask for a new one.
* Cleanup does not depend on the phone: a timer in the backend (every 30 s while `SMS_GATEWAY_ENABLED=true`) closes QUEUED jobs whose OTP is (almost) gone (EXPIRED) and CLAIMED jobs whose lease ended (UNKNOWN), erasing the sealed message and never resending. It is idempotent and safe with several processes.
* On the phone a result that did not reach the server yet is kept in a durable single slot and is **never overwritten**: while it is unreported the app sends heartbeats but claims no new job, and after a restart it reports it first.
* `FAILED` / `EXPIRED` close the challenge (`DELIVERY_FAILED`); asking again is allowed at once. A job whose OTP has (almost) expired is never handed out.
* The message is composed only by the backend from two fixed templates (the phone refuses any other text and any recipient that is not `+84` + nine digits). The OTP is not in any log, audit row or notification, and the sealed message is erased from the row when the job is final.
* Limits (counted before any account lookup, so they answer the same for registered and unknown numbers): per phone per hour/day, whole gateway per day, ALLOWLIST. A gateway that is offline, paused, without SMS permission or switched off gives a 503 — never a fake success.
* Per-IP limits are **not** implemented: the application has no trustworthy client-IP source for these public routes (a forwarded header is client-declared). The per-phone and global caps are the abuse bound.

## Password reset by SMS (USER and ADMIN, never SYSTEM)

`POST /v1/account-recovery/otp {phone}` always gives the same answer (a challenge exists for every number; only an eligible, allowed USER/ADMIN number is queued), `.../otp/{id}/verify {otp}`
gives a one-use `RESET_PASSWORD` proof, `POST /v1/account-recovery/reset {verification_token, password}` (Idempotency-Key) sets the new password (Argon2id), revokes every app / admin session and pending admin
pre-auth step, keeps roles, profile and TOTP, and signs nobody in. SYSTEM, fixtures and out-of-policy accounts are refused even with a valid proof. `reset-test` stays closed outside `DISABLED_TEST`.

## Field test checklist (cannot be replaced by CI)

On the real Android phone, with a test number of the Owner in the allowlist and a second phone to receive:
screen locked for several minutes; app in background and removed from recents; Wi-Fi off/on and mobile data off/on (the status line shows the VPS error and recovers); reboot (the service restarts only if it was paired AND on);
two-SIM phone (the default SMS SIM of Android is used; set it in Settings); revoke the credential on the server (the app shows "VPS từ chối"); then confirm the **SMS really arrives** and that the 6-digit code completes a registration and a password reset.
Do not announce the SMS OTP system as live before this test and the carrier/SIM terms are confirmed.
