# 11Ship — Claude implementation contract

Read [AGENTS.md](AGENTS.md) and [the delivery workflow](docs/process/11ship-delivery-workflow.md). The 2026-10-12 proportional process supersedes conflicting process demands in older handoffs.

Implement the approved scope/UI. Return actual missing or conflicting business decisions to ChatGPT/Owner; routine technical choices remain Claude's responsibility.

During development, run focused tests for affected behavior. Add regression coverage for meaningful bugs/risks. Prove a regression test detects the old bug locally when feasible; do not push deliberately failing commits merely to obtain full-CI RED evidence. If local dependencies are unavailable, report this and use final CI evidence without manufacturing a separate RED run.

Push a coherent implementation/fix package. Use existing applicable CI checks as the integration gate; do not duplicate the full suite locally and again for ChatGPT without a concrete reason. Fix failures by cause; retry infrastructure/flaky failures only with an explanation.

Report final code SHA, changed behavior, relevant checks/results (links are sufficient), known limitations and how Owner can run it. Review fixes require affected tests and review of the delta, not a new module acceptance cycle. Documentation-only follow-ups do not invalidate tests for unchanged executable files; record which code SHA the evidence covers.

Use the short task section of [the checklist](docs/templates/module-delivery-checklist.md). Prepare runnable local/device builds at the relevant delivery/acceptance stage; do not rebuild every app for every backend/doc change. Owner local acceptance precedes final device acceptance. Owner decides module closure; small-package merge follows standing authorization.

## VPS = real operating build (Owner decision 2026-10-14)

Read [the production profile](docs/current/M01-production-profile-20261014.md): it replaces the earlier VPS-test / `DISABLED_TEST` / test-SMS-inbox directions. Keep `ship11_staging` and its data, the origin, the applicationIds and the signing key; no fixture, accept-all, WEB fallback or disabled TLS; the SMS Gateway (#101/#103) is the only OTP channel and fails honestly when not ready. Do not claim the VPS works or M01 closed without real evidence.

## M01 workstreams — Owner revision 2026-10-12

Start from [the M01 workstream plan](docs/current/M01-workstreams-20261012.md). Read only the mapped sections and relevant changed dependencies; reuse implemented endpoints, schema, screens and shared components. Deliver the missing portion of one assigned flow; do not advance into other packages automatically. Focused checks establish that the changed flow runs; do not arrange independent per-package bug hunts or repeated module acceptance. One module-wide review/verification occurs after M01 implementation and connection; fix findings and recheck only affected behavior. Existing mandatory CI still applies without extra manual duplicates. Older task matrices and reporting instructions yield to this process revision.
