# Vendored third-party code

| File | Upstream | Commit | License |
|---|---|---|---|
| `qrcodegen.ts` | https://github.com/nayuki/QR-Code-generator (`typescript-javascript/qrcodegen.ts`) | `3c6d0b3cefb4e049dc337e82237c9644399716a8` | MIT (header kept in the file) |

The only change is the final `export { qrcodegen };` so the file is an ES module. It is vendored because the work
environment cannot install npm packages and the lockfile must stay unchanged; the QR is drawn locally from the
`otpauth_uri` and never sent to an external service. ESLint ignores this folder so the upstream text stays untouched.
