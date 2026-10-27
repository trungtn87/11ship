# 11Ship AI Governance v1.1 — Owner approved 2026-10-27

Status: approved policy; effective on merge to main. This is the authoritative **agent permissions, handoff and local/GitHub synchronization** policy. Business contracts, production safety runbooks, release signing and risk-based tests remain in force. Older workflow wording (including standing permission to merge small PRs and Cloud-only executor labels) is superseded where inconsistent.

## 1. Accountability and permissions

| Actor | Responsible for | May not do |
| --- | --- | --- |
| Owner | Final product/business decisions; authorize implementation scope, merge, production deployment, APK publication and closure | N/A |
| ChatGPT | Investigate, challenge requirements, design, document decisions, create/manage issues, define PR scope/acceptance, assign developer, review code/results, request corrections, execute merge/deploy **only with Owner's explicit approval** | Unilaterally change approved business/UX, skip material review, or implement product code absent specific Owner exception |
| Claude Code | Primary implementation agent; local Windows preferred; code, migrations/tests/build preparation, focused test, commit/push, PR evidence, report and escalate | Decide new business/UX rules or expand scope; merge, deploy production, release APK or close issues |
| Codex | Backup implementation agent, Cloud/GitHub currently; same coding responsibilities and same limits; local capability not assumed | Independently decide missing product requirements; silently omit scope; merge/deploy/release/close |
| GitHub Actions | Required CI/build/test evidence and authorized deploy workflows | Substitute for Owner acceptance or grant itself release approval |

Only **one active implementation owner for a given task/branch/PR**. Transfers require handoff and the previous actor to stop editing that branch. Routine implementation choices are owned by developer, but ambiguity affecting product behavior, financial values, user permissions, data, security, UI contract or order lifecycle must be escalated to ChatGPT; ChatGPT brings changes to approved scope to Owner.

## 2. Mandatory reading before EVERY task or resumed session

Both Claude and Codex, irrespective of Cloud/local:
1. Read root `AGENTS.md`, this document and their specific instructions (`CLAUDE.md` for Claude). Read `docs/process/11ship-delivery-workflow.md` for proportional tests and applicable domain/runbook docs.
2. Read assigned Issue(s), exact PR/branch, current approved acceptance criteria, latest agent report and unresolved decisions. Check current main and PR HEAD before changing code.
3. State acknowledgement in the task's PR (or Issue if no PR exists) **before first code change**: executor, execution environment, scope, worktree/branch, baseline SHA, synchronization status, planned checks, blockers/assumptions. Do not create redundant status messages for every small edit.
4. If instruction files or scope changed while paused, reread before resuming.

No self-reported “I read it” can prove compliance alone: see automation section and PR review gate below.

## 3. Mandatory local ↔ GitHub preflight AND postflight

Run before starting/resuming **every assigned PR**, on executor transfer and on completion. GitHub is the canonical shared **committed** record; local worktrees can contain valid work not yet pushed. Never claim GitHub can see uncommitted local files.

**Preflight**: `git fetch` when reachable; identify repo/worktree/branch and upstream; `git status --porcelain`; local HEAD, remote branch and main SHA; ahead/behind/divergence; open PR head; working changes/untracked files, concurrent agent ownership; dependencies on unpushed local work. Codex Cloud **cannot inspect Windows D:\\11Ship**: require fresh Local Sync Guard report from PC when available; if it is unavailable, record `LOCAL_UNVERIFIED` and reason rather than inventing local state.

**Non-blocking by default**: if clean and fast-forwardable, synchronize automatically; if out of sync but task is independent, continue on a safe named branch/worktree with pinned base SHA and report pending synchronization. LOCAL_AHEAD, REMOTE_AHEAD, DIVERGED or LOCAL_UNVERIFIED are NOT universal blockers. When work depends on uncommitted/unpushed work, first hand it off safely or stop only the dependent part. No automatic destructive `reset --hard`, `clean`, `push --force`, blind `pull` or overwrite. Never commit secrets.

**Postflight**: commit/push owned changes where safe, verify remote branch SHA (not just local commit success); record remaining uncommitted work and unsynced commits, test/CI linkage, synchronization state and next actor. After Codex Cloud pushes, local PC must fetch and safely fast-forward or preserve changes in a separate worktree; Codex must not falsely certify local synchronization. The repo now contains `scripts/ai-governance/sync-guard.mjs` for task pre/postflight and `monitor-local.mjs` for read-only background observation. These do not install themselves on the owner's PC. One-time Windows observer installation is required; each active developer must invoke the pre/postflight guard.

**Conflict policy**: protect state; isolate unrelated work into separate worktrees if safe; block only the conflicting or dependent operation and escalate with evidence. A PR requiring a specific local-only change is not ready for integration until that change is captured and reviewed. All synchronization checks are automatic where actual runner/hook integration exists; without it agents execute and report the checks without Owner prompting.

## 4. Execution, reporting and escalation

Before coding: checklist each approved requirement and test; flag missing design decisions. During execution: update PR at substantive milestones and on blocker; report what is DONE / IN PROGRESS / NOT DONE / NOT TESTED, current SHA and affected tests. Do not wait for final turn to report material blockers. If communication channel unavailable, create durable PR/Issue report when possible and stop the affected decision.

On blockers: ask ChatGPT via task report with evidence, options and recommendation. Never silently choose business behavior, omit hard requirements, split PR to evade fixes or treat silence as approval. Other independent work can continue.

Finish: provide PR URL/branch and remote HEAD SHA, requirements checklist, code summary, tests and CI with exact SHA, unresolved items, synchronization pre/post findings and device testing instructions. ChatGPT independently reviews against approved design; CI green alone does not authorize merge. Fix material findings **within the same open PR** and rerun affected checks.

## 5. Standard GitHub record

Each Issue holds requirements and approvals. Each new ready PR must place the machine-readable `<!-- 11ship-agent-report:v1 -->` block in the **PR description**; interim updates and blockers may also be comments. Draft PRs can retain placeholders while coding. Existing PRs receive transitional treatment:
- Owner approval and approved Issue IDs, executor and environment, branch, worktree (if local), start SHA
- Preflight (time, local/remote SHA, ahead/behind, dirty/untracked status, sync state)
- Milestones/checklist, blockers/questions and decisions with links
- Tests/CI links and code SHA under test, known gaps
- Postflight (local/remote SHA, pending work, transfer checkpoint and next steps)
- Final ChatGPT review and Owner's specific merge/deploy approval; release SHAs/version and confirmation after deployment

Do **not** manually edit `docs/PROGRESS.md`; it is generated. Do not paste credentials/tokens or sensitive logs into PR comments.

## 6. Transfer / release gates

Transfer Claude → Codex or back: previous executor stops; checkpoint code safely to remote where possible, document exact SHA and local-only work, checklist, blockers and test evidence; new executor verifies the handoff before editing. Codex Cloud can proceed on remote-independent scope even if local unverified, but must record risk.

**Merge**: ChatGPT only after Owner gives explicit approval for the specified PR/scope, and independent review and applicable checks pass. Old standing small-PR auto-merge permission is revoked by this policy. **Deploy, production migration, APK publication and issue closure** each need applicable Owner approval; keep production runbooks/version rules.

## 7. Enforcement vs aspiration

`AGENTS.md` and `CLAUDE.md` are required read-entrypoints; `docs/ai-governance/AGENT-EXECUTION-CHECKLIST.md` is the shared report template. PR review must reject absent reading acknowledgment, report, or materially unsupported acceptance. GitHub's `AI Governance readiness` workflow checks PR-body evidence for new ready PRs and opted-in existing PRs, leaving Draft PRs free to code. The readiness check uses trusted main-branch scripts and read-only permissions; it is not an independently verified proof that a model actually read every file. Configure branch protection to require that check before calling it a hard merge gate. A GitHub workflow cannot inspect Windows local changes. The local observer is only active after explicit one-time installation on the Owner PC.

Changes to this governance require Owner approval, reviewed PR and historical record.

## 8. Local implementation and installation

Claude local must run, without an Owner reminder, before and after every assigned/resumed task in the **actual worktree**:

~~~powershell
node scripts/ai-governance/sync-guard.mjs --phase preflight --repo D:\11Ship --report .11ship-local\preflight.json
# After approved code, focused tests and commit:
node scripts/ai-governance/sync-guard.mjs --phase postflight --repo D:\11Ship --report .11ship-local\postflight.json
~~~

Replace D:\11Ship with the assigned worktree path. Preflight auto-fetches and fast-forwards only a clean behind branch. Postflight pushes only clean ahead non-main branches with a verified remote tracking branch. Nothing is force-pushed, reset, cleaned or committed automatically. A report may say DIVERGED or LOCAL_UNVERIFIED and still allow independent work.

To register an observer every five minutes, run ONCE on the real Windows PC:

~~~powershell
cd D:\11Ship
powershell -ExecutionPolicy Bypass -File scripts\ai-governance\install-local-monitor.ps1 -Action Install
powershell -ExecutionPolicy Bypass -File scripts\ai-governance\install-local-monitor.ps1 -Action RunOnce
~~~

The observer saves `.11ship-local/ai-sync-observer.json` and only fetches/inspects worktrees. It does NOT alter checked-out files, perform merges or push during another agent's work. It needs an interactive Windows login; Windows sleep, sign-out or connectivity failure limits monitoring. This PR cannot install it remotely.

Codex Cloud cannot independently inspect local files. Without a fresh report published through a trusted PC-to-GitHub bridge, it marks LOCAL_UNVERIFIED and may implement only remote-independent scope. The observer detects remote changes; a local preflight safely integrates them when a relevant worktree is free and clean. A full bidirectional automatic bridge remains uninstalled until separately deployed and verified.

## 9. Focused acceptance scenarios

- Claude local committed changes -> postflight pushes and verifies remote SHA.
- Codex Cloud changes after Claude stops -> preflight detects REMOTE_AHEAD and safely fast-forwards a clean worktree.
- Divergence or dirty worktree -> preserve all data and report, do not force/reset/clean.
- GitHub unreachable -> report remote verification unavailable and preserve independent progress.
- New ready PR missing acknowledgment/checkpoint report -> readiness check fails; Draft and legacy PRs remain workable.
