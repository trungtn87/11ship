# M01 staging — connect 11Food, 11Ship and SMS Gateway to the VinaHost VPS

> Lịch sử staging: profile VPS hiện hành và gói cập nhật/rollback nằm trong [vps-production-update-20261014.md](vps-production-update-20261014.md). Không chạy hướng dẫn staging bên dưới cho profile vận hành thật.

> Status: **implementation proposed / not deployed**. Does not prove physical Android ↔ VPS connectivity. Start with ALLOWLIST numbers; do not enable open SMS sending.

## Dependencies and ownership

- Android clients and SMS Gateway are implemented in PR #103 (includes the source of #101). This branch is **stacked on PR #103**. Merge/review #103 and this delta in dependency order; do not duplicate the gateway source.
- Ubuntu 24.04, Nginx reverse proxy, PostgreSQL 17, service and artifact deployment live in PR #87 and its `ops/runbooks/ubuntu-vinahost-staging.md` and `ops/runbooks/selfhosted-postgres-staging.md`. Those files are not yet on `main`; do not claim they are installed.
- The actual application release and database migration need a separate authorized VPS operation. This repository change only enables an explicitly guarded staging configuration.

## 1. Diagnose the current VPS **before** changing anything

On the VPS, via a trusted root/admin SSH session, run read-only commands:

```bash
sudo systemctl --no-pager --full status nginx 11ship-staging postgresql@17-main
sudo nginx -t
sudo ss -ltnp | grep -E ':(80|443|3000|5432)[[:space:]]' || true
curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'local live: %{http_code}\n' http://127.0.0.1:3000/v1/health/live
curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'local ready: %{http_code}\n' http://127.0.0.1:3000/v1/health/ready
curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'public live: %{http_code}\n' https://103.9.78.67.sslip.io/v1/health/live
curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w 'public ready: %{http_code}\n' https://103.9.78.67.sslip.io/v1/health/ready
sudo journalctl -u 11ship-staging -n 60 --no-pager
```

Interpretation: local 000 = process down/port mismatch, local 503 = backend up but not ready (often DB), public 000/TLS = DNS/nginx/firewall/certificate; public 502 = nginx cannot reach backend; 404 on a known M01 API = old backend release/missing route. Keep TLS verification enabled; NEVER use `curl -k` to make a green check. Record only HTTP status and redacted logs; never paste secrets or full OTPs.

## 2. Prepare backend release and DB (operator)

- Freeze a reviewed, CI-passing source SHA after integrating #87's deployment package, #103 and this staging patch. Do **not** build/deploy arbitrary unreviewed branch heads or copy a local SQLite database.
- Follow the self-hosted PostgreSQL 17 migration flow with a separate migration credential, verified backup and operator confirmation. Apply the new SMS queue migration **once** using the approved migration tool, never manually with the runtime DB login.
- Back up `/etc/11ship/staging.env`, certificates and the current release pointer; preserve secrets. Keep `HOST=127.0.0.1`, `APP_ENV=staging`, `NODE_ENV=production`, systemd hardening and nginx TLS. Do not move Node to `0.0.0.0`.
- Remove `AUTH_STAGING_FIXTURES_ENABLED` and `AUTH_STAGING_ALLOWED_PHONES` **together** for real SMS registration; fixture mode is incompatible with the real gateway. Evaluate existing seeded fixture accounts separately. Do not turn on `DISABLED_TEST`, `TEST_INBOX`, fake OTP or `reset-test` on this public server.
- A complete, approved terms/privacy text and **separate staging identifiers** are prerequisites to opening registration. The existing `test-*` consent pair is prohibited in staging.

## 3. Staging-only settings (names and safe, non-secret examples)

In the private `/etc/11ship/staging.env`, set after reviewing the actual consent documents and preparing the pinned Android trust files:

```dotenv
APP_ENV=staging
NODE_ENV=production
HOST=127.0.0.1
CLIENT_AUTH_ANDROID_ENABLED=true
CLIENT_AUTH_PHONE_VERIFICATION_MODE=REQUIRED
CLIENT_AUTH_STAGING_CONSENT_APPROVED=true
CLIENT_AUTH_TERMS_VERSION=staging-terms-v1
CLIENT_AUTH_PRIVACY_VERSION=staging-privacy-v1
CLIENT_DEVICE_ENVIRONMENT=ship11-test
CLIENT_DEVICE_ALLOWED_SIGNERS_FILE=/etc/11ship/android-signers.json
CLIENT_DEVICE_ATTESTATION_ROOTS_FILE=/etc/11ship/android-attestation-roots.pem
CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE=/etc/11ship/android-attestation-status.json
SMS_GATEWAY_ENABLED=true
SMS_GATEWAY_RECIPIENT_MODE=ALLOWLIST
ACCOUNT_RECOVERY_MODE=SMS_OTP
```

The two `staging-*-v1` identifiers above are **placeholders, not evidence of Owner approval**; replace with identifiers linked to the actually approved text before setting `CLIENT_AUTH_STAGING_CONSENT_APPROVED=true`. `CLIENT_DEVICE_ENVIRONMENT` must **exactly equal** the value built into both test APKs via `N11_DEVICE_ENVIRONMENT` (do not guess). The persistent APK certificate fingerprints come from the `android-signers.json` artifact of the exact Mobile APK run, with FOOD and SHIP matching; do not generate arbitrary values. Pin the genuine Android hardware-attestation root certificates. Obtain the revocation/status snapshot from the official source and refresh it at least daily (older than 24 hours blocks proof verification).

Also configure the existing runtime DB TLS settings, encryption keyring and OTP HMAC secret; the SMS runbook `ops/runbooks/sms-gateway.md` describes SMS allowlist, cap, pairing and kill switch. Credentials, phone allowlist and encryption keys belong only on the VPS private environment, **not in GitHub or APK binaries**.

The staging exception in this branch refuses startup on insecure/mismatched combinations: without loopback binding, real gateway, REQUIRED OTP, no fixtures, approved consent opt-in, or pinned Android trust. **Production Android remains disabled.**

## 4. Bring up gateway and clients in order

1. Start/restart backend using the reviewed deployment runbook only after migration and private configuration are complete. Check both local and public `/v1/health/live` + `/v1/health/ready` over verified HTTPS.
2. Use the operator CLI `npm run sms-gateway:ctl -- pair --label "Android cu"` with an authorized private DB environment. It outputs a single-use credential **once**. Copy only to the existing Gateway app, not to chat, GitHub, screenshots or logs.
3. Update the existing `vn.eleven.gateway.test` APK with the **same signing identity**, pair to `https://103.9.78.67.sslip.io`, grant SMS/notification permissions, disable battery optimization for the gateway, turn it on, then enable the server-side SMS switch via the CLI. Confirm heartbeat/paired status while no SMS jobs are queued.
4. Build the **two client APKs** from the reviewed commit using the existing Mobile APK workflow with `api_base_url=https://103.9.78.67.sslip.io`; maintain the existing `vn.eleven.food.test`, `vn.eleven.ship.test` package IDs, stable APK signing key, increasing versionCode and `DEVICE_ENVIRONMENT`. Both use the same HTTPS origin. **Do not put the Gateway credential in either APK.**
5. On real devices check connection diagnostics first. Test phone registration with an Owner-controlled number in `SMS_GATEWAY_ALLOWLIST`: create OTP → confirm SMS arrived → verify OTP → create account → login → `/me`. Test logout and password recovery. For ADMIN, confirm reset does not bypass TOTP; SYSTEM must not be SMS-resettable.
6. Test gateway offline, wrong/expired OTP, cap/allowlist, revoked session, app update preserving device keys, two-app session binding, screen locked and network switching. Never claim production readiness from CI alone.

## 5. Stop and rollback

- First stop new SMS jobs through the operator kill switch: `npm run sms-gateway:ctl -- disable`; this must be effective even if the phone remains online.
- Set `CLIENT_AUTH_STAGING_CONSENT_APPROVED=false` to close new registrations and remove/disable `CLIENT_AUTH_ANDROID_ENABLED` to close native login if required. Keep the old release and a verified DB backup; do **not** run down migrations or discard keyring entries while encrypted queued messages may exist.
- If the VPS cannot be reached, **do not** weaken TLS/native proof to claim success. Record last good release SHA, failed step and redacted HTTP/health status.

## Acceptance evidence

M01-SMS/VPS remains **NOT VERIFIED** until the same VPS and APK source SHA, successful backend readiness, actual gateway heartbeat, SMS received on a separate device, Food/Ship registration/login/reset and Owner field tests are documented. PR CI green is necessary but insufficient.
