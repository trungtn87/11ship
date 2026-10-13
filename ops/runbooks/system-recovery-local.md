# SYSTEM password recovery — local/CI only (M01-RESET)

`npm run admin-auth:recover-system -- --check|--apply` recovers the password of the **existing** SYSTEM account on a **local development/test database**. It is not a production/VPS procedure and not an email-recovery bypass: no recovery email, OTP or `verified_at` is involved. TOTP stays as it is.

## Preconditions (checked before any connection or secret is read)
- `APP_ENV=development|test`, `HOST` loopback, `DATABASE_URL` host loopback, and the connected database/`current_user`/`session_user` are `ship11_dev` or `ship11_test`. Anything else (staging, production, remote host, missing variable) is refused with exit 1.
- `npm run build` was run (the launcher uses the compiled app).

## Safe input
Input is one JSON object on standard input; never an argument, environment variable or file path. Keep the password out of shell history: type it into a file with restricted permissions or use a here-document from a script you do not log, e.g.

```
read -rs PW; printf '{"phone":"0912345678","password":"%s","expected_version":%s,"confirmation":"RESET_SYSTEM_LOCAL_TEST"}' "$PW" "$VERSION" | npm run admin-auth:recover-system -- --apply; unset PW
```
(Passwords containing `"` or `\` need JSON escaping.) Bounded to 4 KiB; extra/missing fields are refused.

## Steps
1. `--check` with `{"phone":"..."}` → `SYSTEM_FOUND version=N` (read-only; not a permission to apply). Not found → `refused: SYSTEM_TARGET_NOT_FOUND`.
2. `--apply` with `{"phone","password","expected_version":N,"confirmation":"RESET_SYSTEM_LOCAL_TEST"}` → `RECOVERED version=N+1`. It sets the new Argon2id password, revokes every app and admin session, supersedes unconsumed admin preauth, and writes audit `admin.auth.system_password_recovered.v1` in the same transaction. Roles, statuses (a DISABLED account stays locked), profile and the TOTP factor are untouched. Next login: new password, then the same TOTP.
3. Exit codes: 0 success, 1 refusal/failure, 2 usage (missing/wrong mode or extra argument).

## Errors
- `refused: VERSION_CONFLICT` — the version moved (another apply won, or a stale value). Run `--check` again. Never auto-retried; a replay of an old `expected_version` changes nothing.
- `OUTCOME_UNKNOWN` — the commit answer was lost. **Do not resend.** Run `--check`: version N+1 means it applied; then try to log in with the new password.
- Output never contains phone, password, hash, user id, URL or raw database errors.

## Limits
When verified recovery email exists, this command must first gain the email gate in any environment that has it; this local version is not a bypass for remote environments. No API/UI.
