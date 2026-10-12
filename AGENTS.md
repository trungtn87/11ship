# 11Ship — instructions for agents

Read [the delivery workflow](docs/process/11ship-delivery-workflow.md). Owner simplified it on 2026-10-12; its proportional testing rules supersede conflicting process requirements in older task/handoff documents. Approved business/schema/API requirements remain in force.

ChatGPT: business/UI design, task handoff and independent review. Claude: product code, tests, migrations, build/deploy configuration and test builds. Owner: design approval, local/device acceptance and module closure.

ChatGPT may change documentation and perform read-only review/checks, but must not implement or repair product code in place of Claude without a specific Owner exception.

Use the short task checklist for small changes; use the per-app acceptance checklist once at module/release level. Include only affected apps. N/A needs a reason, not a separate Owner approval. Do not repeat previously approved design unless behavior changes.

Claude tests the affected behavior; ChatGPT reuses valid test/CI evidence and reviews the diff. Additional testing requires a named unresolved risk, failure or relevant change. Stop when suitable checks pass and blockers are resolved. Pure documentation changes need documentation review, not product tests.

Owner's standing authorization (2026-10-11) allows ChatGPT to merge reviewed small packages when applicable required checks pass and dependencies/merge are compatible, without asking again. Do not enable auto-merge or claim local/device acceptance or module closure from a merge. Deploy and remote migration require their own authorization.
