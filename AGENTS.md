> **OWNER APPROVED — AI Governance v1.1 (2026-10-27): MANDATORY FIRST READ FOR EVERY TASK AND RESUMED SESSION.** Read [agent governance, permissions, and non-blocking local/GitHub synchronization](docs/ai-governance/README.md), [Codex-specific contract](docs/ai-governance/CODEX-EXECUTION.md) when assigned to Codex, and [start/end execution checklist](docs/ai-governance/AGENT-EXECUTION-CHECKLIST.md) BEFORE touching code. Claude local is primary; Codex currently executes via GitHub/Cloud as backup. One active agent per PR. Both must preflight before work and postflight at end, report state on GitHub, and escalate scope/business ambiguity to ChatGPT, never self-decide. An unsynced local does NOT universally block independent work; preserve it without destructive Git operations. **Owner explicitly approves merge, production deployment, APK publication and issue closure. Older standing small-PR merge authorization and conflicting Cloud-only language below are superseded.** Documentation does not itself install an automated Windows guard.

# 11Ship — instructions for agents

Read [the delivery workflow](docs/process/11ship-delivery-workflow.md). Owner simplified it on 2026-10-12; its proportional testing rules supersede conflicting process requirements in older task/handoff documents. Approved business/schema/API requirements remain in force.

ChatGPT: business/UI design, task handoff and independent review. Claude Code on Windows local is the primary implementer; Codex (currently GitHub/Cloud) is the standby implementer when explicitly assigned. One active implementation agent per task/branch/PR. Owner approves design, merge, production deploy, APK publication and issue closure. See the mandatory governance entrypoint above.

ChatGPT may change documentation and perform read-only review/checks, but must not implement or repair product code in place of the assigned agent without a specific Owner exception.

## Single-agent handoff — updated Owner decision 2026-10-27

- One active lead agent per task/branch/PR: Claude local first, Codex backup. Transferring the same PR requires safe checkpoint, verified current SHA and old executor stopping. Read the governance protocol before every start/resume. Do not run both agents simultaneously on the same task.
- Handoff: **agent + approved outcome/scope + PR/branch/head SHA + checked local/remote status + completed/missing work + referenced contracts + focused checks and blocker**. Use existing workstream maps where relevant; do not reread unrelated files or recreate finished code.
- Check latest `main` and related in-progress PR/branch before coding. Continue the existing branch/PR when assigned follow-up work; never silently overwrite the other agent's changes. Parallel tasks must have non-overlapping ownership.
- At start record the mandatory reading acknowledgement and safe sync preflight. At end record PR/verified remote SHA, work completed/pending, test evidence, blocker, safe sync postflight and how Owner can try it. Keep reports concise; use existing valid CI evidence.

Use the short task checklist for small changes; use the per-app acceptance checklist once at module/release level. Include only affected apps. N/A needs a reason, not a separate Owner approval. Do not repeat previously approved design unless behavior changes.

Claude tests the affected behavior; ChatGPT reuses valid test/CI evidence and reviews the diff. Additional testing requires a named unresolved risk, failure or relevant change. Stop when suitable checks pass and blockers are resolved. Pure documentation changes need documentation review, not product tests.

Owner decision (2026-10-27): ChatGPT may merge **only after explicit Owner approval for that PR** and successful applicable checks/review. No standing auto-merge permission remains. Production deploy, remote migration, APK publication and issue closure require their applicable Owner authorization.

## Owner priority — 2026-10-14 (results first, all modules M00–M12)

**The 14/10/2026 Owner instruction supersedes conflicting earlier workflow, review and handoff rules.** ChatGPT owns end-to-end coordination, status tracking and quality gates; Claude/Codex handle implementation, integration and technical troubleshooting under one accountable lead per task. Owner sees *working results* and approves business, merge, production deployment, APK publication, cost, security and material data-risk decisions — never routine SSH/CI/SQL/Git chores. Deliver functioning connected web/APKs and service, not just green CI or open PRs. Reuse existing work, avoid repeated audit/review/testing, fix the scoped bug, request Owner's explicit merge approval for the reviewed PR, and report working output and blockers. Preserve real deployment/migration authorization and necessary risk-based safeguards. Full policy: [delivery workflow — Owner 14/10/2026](docs/process/11ship-delivery-workflow.md#quy-tắc-ưu-tiên--owner-chốt-ngày-14102026-giao-kết-quả-ai-chịu-trách-nhiệm-quá-trình).

## Owner priority — 2026-10-12

“Nhanh, đủ, đúng” means deliver a working test build and fix observable user problems first. Owner explicitly asks to save tokens: keep handoffs, progress updates and reports short; reuse available context and valid evidence instead of repeated reading, reporting or testing. Do not expand scope with speculative edge cases or optional improvements. Deep tests need a concrete material risk to money, data, security or the requested behavior. When relevant checks pass, deliver and move on. ChatGPT is responsible for keeping the work proportionate; Owner should not need to repeat this instruction.

## Android test updates — Owner decision 2026-10-12

11Food and 11Ship test APKs must update in place, preserving local data: persistent signing keys, unchanged applicationIds and increasing versionCode. Missing signing secrets must stop APK distribution; do not fall back to throw-away keys. Manual APK download/update is sufficient; no automatic updater is required. See [mobile signing and update requirements](mobile/README.md#owner-decision--2026-10-12-update-in-place). Claude must update the existing ephemeral-signing workflow to satisfy this requirement before distributing further test builds.

## VPS is the real operating build — Owner decision 2026-10-14

[docs/current/M01-production-profile-20261014.md](docs/current/M01-production-profile-20261014.md) **supersedes** every earlier instruction that treats the VPS as a test server (`DISABLED_TEST`, fixture mode, test SMS inbox/PC tool, "test build" wording). The VPS runs `APP_ENV=production` on the same database (`ship11_staging`, never renamed or moved), real SMS OTP through the one SMS Gateway, real device proof. Food/Ship ship as phone apps only; Web Admin stays web. Never loosen a guard to "make it pass": production has explicit, tested policies. Update procedure: [ops/runbooks/vps-production-update-20261014.md](ops/runbooks/vps-production-update-20261014.md).

## M01 — Owner revision 2026-10-12

Use [the M01 workstream plan](docs/current/M01-workstreams-20261012.md) as the current task/read map. Reuse existing code and designs; hand off only missing work with exact document sections and file entry points. UI documents contain presentation, not duplicated business contracts. Do not conduct independent bug-hunting reviews after each small M01 package: conduct one module-wide review once M01 is implemented and connected. During implementation check that the affected flow works and fix observed defects; before integration check scope/dependencies and existing required CI. After final review fixes, review the delta and affected behavior only. This Owner revision supersedes conflicting per-package audit demands above and in old handoffs; module closure remains Owner's decision.

## Shared release versions — Owner decision 2026-10-19

Read and apply [the release versioning convention](docs/process/release-versioning-20261019.md) for merges, builds, APK naming, VPS deployment reports and M13.07/M13.08. Apply it immediately: one immutable release version per merged main SHA; artifacts with that version come from that SHA. Preserve actual running/device versions, Android signing/applicationIds and increasing versionCode. Do not wait for M13 or claim automation/deployment from this documentation change.

## Deploy includes APK update readiness — Owner decision 2026-10-27

For every VPS deployment, follow [the APK publication and update-check procedure](ops/runbooks/github-vps-deploy.md#apk-và-thông-báo-cập-nhật--owner-bổ-sung-27102026). Check which apps need a release, publish authorized FOOD/SHIP APKs through existing SYSTEM/M13 controls, verify old/new version responses and downloadable APK checksums, and report backend deployment, APK publication and device acceptance separately. GitHub artifacts alone are not published updates. Keep compatible existing APKs for backend/documentation-only changes; never raise minimums merely to trigger a banner. Reuse #193 and existing workflows; this documentation does not claim upload/publish automation is implemented or authorize unrelated releases.
