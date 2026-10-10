# Three Windows app launchers (M00)

**State: PR / awaiting CI and Owner acceptance. Not deployed or merged.**

Use one checkout at `D:\11ship`. Double-click:
- `tools/local/11Ship-Admin.cmd` — Web Admin (only after its source and npm scripts are merged).
- `tools/local/11Ship-Food.cmd` — reserved for customer/shop application.
- `tools/local/11Ship-Ship.cmd` — reserved for driver application.

Each launcher calls the existing guarded M00 `Update` (fetch and fast-forward only), then `Start` (local DEV database and shared backend). It leaves the backend running when the browser closes. Admin builds its frontend and opens HTTPS localhost:8443 only if available and healthy. No automatic PR merge, destructive reset, database deletion, or forced migration. M00 may request explicit approval for pending DEV migrations; launcher never bypasses this.

**Important:** The current main branch does not yet include the Web Admin frontend or the Food/Ship applications. The three shortcuts exist, but the relevant launcher must fail clearly until its application is integrated. This PR is infrastructure, not proof of app readiness.

**Owner acceptance checklist:** clean-main auto-update; dirty tracked file refuses update; non-fast-forward refuses update; network failure refuses stale launch; missing app reports failure; Admin build/HTTPS start after frontend integration; re-launch does not spawn duplicate backend; browser closing leaves backend running; DB TEST remains isolated; secrets do not appear in logs. Test on Windows before merging. `npm run launcher:test` and CI must pass on final PR SHA.
