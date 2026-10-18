# M01 registration — Codex, 18/10/2026

Base main: `68b5eea413f34c184a8751d839c5def5ea9a95dd`. Owner explicitly assigned Codex; no parallel Claude work. Latest open PR search for registration/OTP/attestation found no overlapping package.

## Proven code defect / changes

11Ship's submit required `RegistrationMode.required` and always opened the OTP page. It now allows a known mode: REQUIRED keeps SMS verification; NOT_REQUIRED calls `SessionController.register` directly. The existing controller omits `verification_token` in that mode. Unknown config keeps its explanation and retry.

11Food's “Máy chủ chưa sẵn sàng cho bản Android” is the generic `serverUnavailable` message, not proof of an SMS or revocation failure. The chain is `_begin` → `obtainGrant` → POST `/v1/client-auth/device/challenges` → POST `/v1/client-auth/device/registrations` → signed POST `/v1/client-auth/register`. Device verification may return 503 for an unavailable verifier or unavailable/stale revocation; registration may also return 503 when consent is absent. No production cause has been established.

Failures at those three stages now retain static endpoint, HTTP status, bounded machine error code and server request UUID, displayed in the error banner. No request body, password, OTP, token, server message or error details are retained by these diagnostics. A definite 503 allows submitting the form again; unknown outcomes retain the existing same-intent retry behavior.

## Verification and delivery limits

Regression cases added: Food direct submit; Ship NOT_REQUIRED direct submit without SMS/proof, REQUIRED SMS verification through completion; unknown config explanation/retry; both apps' 503 at each native/register stage and successful retry; malformed diagnostic metadata rejection. Existing OTP/controller tests remain applicable. `git diff --check` passes. Local Flutter SDK is absent; Flutter execution and signed APKs require existing Mobile APK CI. Do not infer device acceptance from doubles.

Endpoint remains `https://103.9.78.67.sslip.io`, device environment `ship11-test`. No applicationId, signing, versionCode sequence or workflow change: Mobile APK uses persistent secrets and increasing `github.run_number`. No merge, production deploy, migration, config change or real SMS authorized/executed.

## Production investigation — BLOCKED, not fixed

The managed environment has no VPS identity/secret binding, VPN or TCP destination grant. Git CLI also cannot reach its configured proxy; GitHub connector remains available. Thus the actual failing endpoint/status/code/request_id, verifier config, file ownership/age/readability, timer and production logs are **unverified**.

Read-only checks once access is available (do not print env/secret contents):

```sh
systemctl show 11ship-staging -p User -p Group -p SupplementaryGroups
systemctl cat 11ship-attestation-refresh.service 11ship-attestation-refresh.timer
systemctl list-timers --all 11ship-attestation-refresh.timer
stat -c '%a %U:%G %y %n' /etc/11ship/trust/android-*
sudo -u ship11 test -r /etc/11ship/trust/android-attestation-revocation.json
node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync("/etc/11ship/trust/android-attestation-revocation.json","utf8")); console.log({fetched_at:x.fetched_at,age_hours:(Date.now()-Date.parse(x.fetched_at))/3600000})'
```

Inspect configured verifier and consent variable presence/validity without values; correlate only allowlisted structured log fields (`request_id`, `status`, `code`, `error_class`) with the APK diagnostic. Do not dump logs containing sensitive data. Confirm service binary SHA and refresh script path against the current release.

The runbook §4 directly runs the first refresh as root. The script creates a new temp file with mode 0640 and renames it, inheriting the invoking process group; a root:root first snapshot is possible. Timer service explicitly has `Group=ship11`, so its successful refresh may replace that file with root:ship11. This is a reproducible procedural risk, **not a confirmed VPS finding**.

Only if wrong ownership is proven: proposed production action for approval is `chown root:ship11 /etc/11ship/trust/android-attestation-revocation.json` plus `chmod 0640` on that exact file, then read test as the actual service user. If stale, separately approve starting `11ship-attestation-refresh.service` after confirming its Group and release path; verify fresh age and readability. Effect: restores the existing verifier's access, no guard/24h policy change, DB write or SMS. No restart is normally needed (trust is re-read on mtime). Future initial creation should use the installed service with its explicit group. Other causes need evidence before proposing changes.
