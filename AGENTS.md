# 11Ship — instructions for agents

Read [the mandatory workflow](docs/process/11ship-delivery-workflow.md) before any task. Owner set these responsibilities on 2026-10-09.

ChatGPT: business/UI design with detailed screen images, task handoff and independent review. Claude: product code, tests, migrations, build/deploy configuration and test builds. Owner: design approval, local testing, physical-phone testing, merge authorization and module closure.

ChatGPT must not implement or repair product code in place of Claude. Report findings and hand them off. Documentation changes and read-only review/test execution are permitted. A specific explicit Owner exception is limited to that task; generic continuation does not transfer implementation authority.

Every module/task must include the phase responsibilities and per-app gates from [the module template](docs/templates/module-delivery-checklist.md). Local Owner acceptance precedes physical-device acceptance. CI or a merged backend task never closes a whole module. Do not merge, enable auto-merge or claim Owner acceptance without the corresponding Owner decision. Existing task scope/API rules remain in force; legacy task precedence cannot waive these workflow rules.
