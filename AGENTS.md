# 11Ship — instructions for agents

Read [the delivery workflow](docs/process/11ship-delivery-workflow.md). Owner simplified it on 2026-10-12; its proportional testing rules supersede conflicting process requirements in older task/handoff documents. Approved business/schema/API requirements remain in force.

ChatGPT: business/UI design, task handoff and independent review. Claude Code Cloud: default implementation agent (code, tests, migrations, build/deploy configuration and test builds). Codex Cloud: scoped implementation or focused review only when explicitly assigned; implementation follows the same scope and checks as Claude. Owner: design approval, local/device acceptance and module closure.

ChatGPT may change documentation and perform read-only review/checks, but must not implement or repair product code in place of the assigned agent without a specific Owner exception.

## Two-cloud-agent handoff — Owner decision 2026-10-13

- One lead agent per task/branch/PR. Claude is the default coder; Codex receives a distinct non-overlapping coding task or a focused review only when assigned. Do not duplicate implementation, routine review or tests across agents.
- Handoff only: **agent + desired outcome + existing work/PR/SHA (if known) + missing scope + exact reference sections/file entry points + necessary checks**. For M01, use the existing workstream map. Don't reread unrelated documents or recreate finished code.
- Check latest `main` and related in-progress PR/branch before coding. Continue the existing branch/PR when assigned follow-up work; never silently overwrite the other agent's changes. Parallel tasks must have non-overlapping ownership.
- Return only **PR/commit SHA + what changed + relevant check evidence + blockers + how Owner can try it**. Use existing CI evidence; no extra audit/test pass without a named risk. Deployment and module closure still require their existing approvals.

Use the short task checklist for small changes; use the per-app acceptance checklist once at module/release level. Include only affected apps. N/A needs a reason, not a separate Owner approval. Do not repeat previously approved design unless behavior changes.

Claude tests the affected behavior; ChatGPT reuses valid test/CI evidence and reviews the diff. Additional testing requires a named unresolved risk, failure or relevant change. Stop when suitable checks pass and blockers are resolved. Pure documentation changes need documentation review, not product tests.

Owner's standing authorization (2026-10-11) allows ChatGPT to merge reviewed small packages when applicable required checks pass and dependencies/merge are compatible, without asking again. Do not enable auto-merge or claim local/device acceptance or module closure from a merge. Deploy and remote migration require their own authorization.

## Owner priority — 2026-10-12

“Nhanh, đủ, đúng” means deliver a working test build and fix observable user problems first. Owner explicitly asks to save tokens: keep handoffs, progress updates and reports short; reuse available context and valid evidence instead of repeated reading, reporting or testing. Do not expand scope with speculative edge cases or optional improvements. Deep tests need a concrete material risk to money, data, security or the requested behavior. When relevant checks pass, deliver and move on. ChatGPT is responsible for keeping the work proportionate; Owner should not need to repeat this instruction.

## Android test updates — Owner decision 2026-10-12

11Food and 11Ship test APKs must update in place, preserving local data: persistent signing keys, unchanged applicationIds and increasing versionCode. Missing signing secrets must stop APK distribution; do not fall back to throw-away keys. Manual APK download/update is sufficient; no automatic updater is required. See [mobile signing and update requirements](mobile/README.md#owner-decision--2026-10-12-update-in-place). Claude must update the existing ephemeral-signing workflow to satisfy this requirement before distributing further test builds.

## M01 — Owner revision 2026-10-12

Use [the M01 workstream plan](docs/current/M01-workstreams-20261012.md) as the current task/read map. Reuse existing code and designs; hand off only missing work with exact document sections and file entry points. UI documents contain presentation, not duplicated business contracts. Do not conduct independent bug-hunting reviews after each small M01 package: conduct one module-wide review once M01 is implemented and connected. During implementation check that the affected flow works and fix observed defects; before integration check scope/dependencies and existing required CI. After final review fixes, review the delta and affected behavior only. This Owner revision supersedes conflicting per-package audit demands above and in old handoffs; module closure remains Owner's decision.
