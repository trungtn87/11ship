# M01 — password/OTP sessions, Owner decision 23/10/2026

This decision supersedes mandatory Android hardware attestation in ordinary 11Food/11Ship authentication. No business permissions, money/order data, OTP policy or APK identity/signing configuration changes.

## Authentication and migration

- New APKs register with the configured phone OTP policy, password and consent; login uses phone/password only. HTTPS is unchanged. Android Keystore AES-GCM still encrypts `session.bin` without attestation/StrongBox requirements. No enroll, peer JOIN or ECDSA request signing is invoked by the new shared authentication code.
- Backend stores immutable `app.sessions.auth_method`. Migration defaults every existing session to `LEGACY_DEVICE_PROOF`; new Android sessions minted after successful credentials/registration without a legacy grant use `PASSWORD`. The session mode is never taken from a client header/body, device ID, app claim or absence of a signature on a protected request.
- Existing device-bound sessions retain their original proof and transaction-time binding checks. The transitional old-APK enrollment/auth endpoints remain usable only with the existing configured trust and strict verification. Presenting a legacy grant does not bypass its verification. There is no fallback from an invalid legacy proof to a password session within that attempt.
- New APKs do not convert old tokens. A cold start of a device-bound token without proof is refused, the token is cleared locally and the user signs in again with the password. Account/profile/wallet/order/ledger records stay intact. An unavailable network keeps personal data hidden and the stored session unverified.
- New password login serializes on the user root lock and revokes all prior application sessions before creating the new session. During transition, legacy login also revokes existing PASSWORD sessions. New ordinary sessions therefore allow one active session per account, including when alternating between Food and Ship on the same phone; no untrusted device ID is used to keep a second session alive. Legacy two-app binding behavior is kept only for old sessions until re-login/update.
- Sensitive registration/login idempotency keeps its encrypted result, original token/expiry, request HMAC fingerprint (including password/OTP intent), current-account/session checks and non-replayability after revocation/expiry. A no-proof replay cannot retrieve a legacy device-bound session.
- All existing session expiry, lock/close/password lifecycle policy, live role and transaction-time authorization remain. Hardware binding is skipped only for server-minted PASSWORD sessions. Wallet readiness, fees after pickup, GPS, row versions, ledger gates and Admin rights are unchanged.
- Login rate limit: durable atomic per-normalized-phone HMAC bucket, 30 attempts per minute before Argon2 (unknown phones included), shared by instances. App/device ID changes cannot reset it. No phone/password/token is stored in quota rows or error output.

## Ordered rollout (not executed by this PR)

1. Approve and apply additive migration `1795651200000_password-client-sessions.sql` using the existing production procedure. Existing rows remain legacy; it changes no wallet/order data. Apply/check the updated runtime grants for `app.client_login_limits` using the existing grant scripts.
2. Deploy the reviewed backend before distributing either new APK. Keep existing legacy trust settings/files during rollout so installed old APKs still work. `CLIENT_AUTH_ANDROID_ENABLED` now controls only legacy compatibility; a new installation may leave it false and needs no attestation files for ordinary Android authentication.
3. Confirm backend/password API health and legacy compatibility, then distribute both APKs from the approved release SHA. Preserve existing applicationIds, signing keys and increasing versionCodes; this PR changes none of them. Explain one password re-login for old stored sessions. Do not distribute APKs ahead of the backend.
4. After old APKs have been replaced, legacy attestation may be disabled (`CLIENT_AUTH_ANDROID_ENABLED=false`). This does not disable password sessions. Never restore mandatory attestation for normal registration.

Rollback: do not roll the backend back while leaving PASSWORD sessions active. Revoke them and have affected users sign in on a compatible version; the migration Down explicitly revokes PASSWORD rows before removing the mode. Keep the additive schema when doing an application-only rollback where possible. No account, wallet, order or transaction history is deleted.

## Verification and limits

Backend unit coverage retains old signed-request/refusal/replay cases and adds PASSWORD routes for M03/M04/M07/M08/M10/M11/M14. PostgreSQL integration adds OTP registration → immediate me/replay; replacement including identical device metadata; wrong password, logout, expiry, immutable mode/header spoof refusal; quota expiry; legacy compatibility; shop profile; topup/withdrawal idempotency and no premature credit/debit; and a PASSWORD delivery lifecycle. Existing broader domain/security suites remain enabled.

Flutter tests retain wrong-password/session/late-response/idempotency coverage, reuse PR #169's post-registration disposal regression and replace obsolete ENROLL/JOIN assertions with no-hardware login/register and migration-to-password cases for both apps. Native token storage keeps AES-GCM protection. Local/device testing is not evidence of real-phone acceptance: old/new Android installation, update-in-place and connected runtime acceptance still require actual devices.

No merge, production deployment, remote migration or actual SMS was authorized or performed by this task. PR/CI results are reported separately; tests added to CI are not claimed as passed until the jobs finish.
