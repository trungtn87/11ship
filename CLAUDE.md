# 11Ship — Claude implementation contract

Read [AGENTS.md](AGENTS.md) and [the delivery workflow](docs/process/11ship-delivery-workflow.md). The 2026-10-12 proportional process supersedes conflicting process demands in older handoffs.

Implement the approved scope/UI. Return actual missing or conflicting business decisions to ChatGPT/Owner; routine technical choices remain Claude's responsibility.

During development, run focused tests for affected behavior. Add regression coverage for meaningful bugs/risks. Prove a regression test detects the old bug locally when feasible; do not push deliberately failing commits merely to obtain full-CI RED evidence. If local dependencies are unavailable, report this and use final CI evidence without manufacturing a separate RED run.

Push a coherent implementation/fix package. Use existing applicable CI checks as the integration gate; do not duplicate the full suite locally and again for ChatGPT without a concrete reason. Fix failures by cause; retry infrastructure/flaky failures only with an explanation.

Report final code SHA, changed behavior, relevant checks/results (links are sufficient), known limitations and how Owner can run it. Review fixes require affected tests and review of the delta, not a new module acceptance cycle. Documentation-only follow-ups do not invalidate tests for unchanged executable files; record which code SHA the evidence covers.

Use the short task section of [the checklist](docs/templates/module-delivery-checklist.md). Prepare runnable local/device builds at the relevant delivery/acceptance stage; do not rebuild every app for every backend/doc change. Owner local acceptance precedes final device acceptance. Owner decides module closure; small-package merge follows standing authorization.
