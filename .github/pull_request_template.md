# 11Ship — PR execution and acceptance

The section between the markers is checked by the Governance readiness workflow once this policy is deployed on main. Developers must replace ALL placeholders before moving a PR to Ready for Review. Draft PRs may remain incomplete; do not block ongoing coding.

<!-- 11ship-agent-report:v1 -->
- Executor: PENDING
- Rules-read: PENDING
- Scope: PENDING
- Baseline-SHA: PENDING
- Sync-preflight: PENDING
- Scope-checklist: PENDING
- Tests: PENDING
- Sync-postflight: PENDING
- Remote-head-SHA: PENDING
- Open-blockers: PENDING

## Required content and examples
- Executor: CLAUDE_LOCAL | CLAUDE_CLOUD | CODEX_CLOUD | CODEX_LOCAL (one at a time).
- Rules-read: Confirm reading `AGENTS.md`, `docs/ai-governance/README.md`, assigned workflow and role file, with actual timestamp.
- Scope: Issue IDs, Owner-approved goals, acceptance criteria and any excluded changes.
- Baseline-SHA / Remote-head-SHA: full 40-character commit SHA; never invent these.
- Sync-preflight: local/remote SHA, branch/worktree, dirty/untracked, ahead/behind, LOCAL_UNVERIFIED if Cloud cannot inspect Windows; explain independent scope if unsynced.
- Scope-checklist: What passed, remaining items and exclusions, each grounded.
- Tests: Named targeted tests, CI links and specific code SHA tested; DOCS_REVIEW with evidence for documentation-only work.
- Sync-postflight: GitHub verified SHA, local-only changes, conflicts, transfer checkpoint; Cloud cannot claim local was synced.
- Open-blockers: NONE only when genuinely none; otherwise indicate BLOCKED and ask ChatGPT.

## Escalations and handoff
- Questions/decision links to ChatGPT and Owner:
- Agent transfer confirmation, previous executor stopped, exact checkpoint:
- Steps for Owner Android test:

## Merge, deploy and closure authority (never self-approve)
- ChatGPT independent review conclusion and reference:
- Explicit Owner merge approval for THIS PR (link/reference):
- Explicit Owner VPS deploy / production migration / APK publication approval when applicable:
- Release SHA/version, deployment/Android evidence after authorized actions:

> Code work can continue from an unsynced but independent branch; do not force-push, reset, clean or overwrite local changes. A green CI does not approve merge. GitHub cannot verify uncommitted Windows files without an installed, independently running local helper.
