#!/usr/bin/env node
// Generates docs/PROGRESS.md from docs/progress/plan.yml and the real state on GitHub.
//
//   node scripts/generate-progress.mjs                      read GitHub, write docs/PROGRESS.md
//   node scripts/generate-progress.mjs --check              exit 1 if docs/PROGRESS.md is out of date
//   node scripts/generate-progress.mjs --stdout             print instead of writing
//   node scripts/generate-progress.mjs --snapshot f.json    use a saved snapshot, no network
//   node scripts/generate-progress.mjs --save-snapshot f.json   also save what was read from GitHub
//   node scripts/generate-progress.mjs --print-labels       print `gh label create` commands, then exit
//
// Environment: GITHUB_TOKEN or GH_TOKEN (read access to pull requests, checks, issues and contents),
// GITHUB_REPOSITORY (overrides repo in plan.yml), GITHUB_API_URL.
// Exit codes: 0 ok, 1 stale (--check) or error.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './progress/yaml-subset.mjs';
import { resolveProgress, validatePlan, LABEL } from './progress/resolve.mjs';
import { renderProgress, withPlan } from './progress/render.mjs';
import { collectSnapshot } from './progress/github.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { plan: 'docs/progress/plan.yml', out: 'docs/PROGRESS.md' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--plan') args.plan = value();
    else if (a === '--out') args.out = value();
    else if (a === '--snapshot') args.snapshot = value();
    else if (a === '--save-snapshot') args.saveSnapshot = value();
    else if (a === '--check') args.check = true;
    else if (a === '--stdout') args.stdout = true;
    else if (a === '--print-labels') args.printLabels = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

export function buildMarkdown(plan, snapshot) {
  return renderProgress(withPlan(resolveProgress(plan, snapshot), plan));
}

function labelCommands(plan, repo) {
  const rows = [
    [LABEL.agentClaude, '0e8a16', 'Work done by Claude'],
    [LABEL.agentChatgpt, '8250df', 'Work done by ChatGPT'],
    [LABEL.agentOwner, 'd4a017', 'Work done by the Owner'],
    [LABEL.typeDesign, '1d76db', 'Design / ADR PR (ChatGPT)'],
    [LABEL.typeImplementation, '1d76db', 'Implementation PR (Claude)'],
    [LABEL.typeReviewFix, '1d76db', 'Fixes for review findings (Claude)'],
    [LABEL.typeInfra, 'bfd4f2', 'Project infrastructure, outside the plan'],
    [LABEL.reviewInProgress, 'fbca04', 'ChatGPT review in progress (valid only for the current head)'],
    [LABEL.reviewChangesRequested, 'd93f0b', 'ChatGPT requested changes (valid only for the current head)'],
    [LABEL.reviewPass, '0e8a16', 'ChatGPT review PASS (valid only for the current head)'],
    ...[...plan.tasks].sort((a, b) => a.order - b.order).map((t) => [`${LABEL.modulePrefix}${t.id}`, 'ededed', `Progress plan task ${t.id}`]),
  ];
  return rows.map(([name, color, desc]) => `gh label create "${name}" --repo ${repo} --color ${color} --description "${desc}" --force`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = validatePlan(parseYaml(readFileSync(resolve(root, args.plan), 'utf8')));
  const repo = process.env.GITHUB_REPOSITORY || plan.repo;

  if (args.printLabels) {
    console.log(labelCommands(plan, repo).join('\n'));
    return 0;
  }

  let snapshot;
  if (args.snapshot) {
    snapshot = JSON.parse(readFileSync(resolve(root, args.snapshot), 'utf8'));
  } else {
    // PRs named in the plan (pinned or ignored) always get their check runs, so the dashboard can
    // show e.g. that an ignored PR has green CI and is still not counted.
    const pinned = [
      ...plan.tasks.flatMap((t) => [t.design_pr, t.implementation_pr]),
      ...(plan.ignored_prs ?? []).map((i) => i.number),
    ].filter((n) => n != null);
    snapshot = await collectSnapshot({
      repo,
      mainBranch: plan.main_branch,
      requiredChecks: plan.required_checks,
      pinnedNumbers: pinned,
      evidenceTasks: plan.tasks.filter((t) => t.phase === 'owner_acceptance'),
      ownerLogin: plan.owner_login,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
      apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
    });
    if (args.saveSnapshot) {
      const target = resolve(root, args.saveSnapshot);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
  }

  const markdown = buildMarkdown(plan, snapshot);
  if (args.stdout) {
    process.stdout.write(markdown);
    return 0;
  }
  const target = resolve(root, args.out);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (args.check) {
    if (current === markdown) {
      console.log(`${args.out} is up to date`);
      return 0;
    }
    console.error(`${args.out} is out of date; run: npm run progress:generate`);
    return 1;
  }
  if (current === markdown) {
    console.log(`${args.out} unchanged`);
    return 0;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`wrote ${args.out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Messages are built from status codes and short API messages only; never from the token.
      console.error(`progress generator failed: ${error.message}`);
      process.exit(1);
    },
  );
}

