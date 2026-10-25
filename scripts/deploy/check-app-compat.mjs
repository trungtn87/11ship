#!/usr/bin/env node
// APK–backend compatibility preflight (issue #193).
//
// The minimum client versionCode a backend demands lives in apps/backend/src/ops/app-compatibility.json and is deployed WITH the backend. Raising it is a
// breaking change: phones below it are told to update, so a PUBLISHED, downloadable APK at or above the new minimum must already exist, and the old API
// must stay alive until phones moved. This script refuses a promote that would break that, and prints the compatibility matrix for the deploy report.
//
//   node scripts/deploy/check-app-compat.mjs --static                 schema check only (CI, no network)
//   node scripts/deploy/check-app-compat.mjs --live <https origin>    before promote: new matrix vs what production serves and has published
//   node scripts/deploy/check-app-compat.mjs --live <origin> --after  after deploy: production now serves the matrix and a phone below the minimum is never told "up to date"
//
// Exit 0 = allowed, 1 = refused (reasons on stderr), 2 = usage. Nothing here loosens a rule; there is no override flag.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MATRIX_PATH = path.join(root, 'apps/backend/src/ops/app-compatibility.json');
export const COMPONENTS = ['FOOD', 'SHIP'];

/** Validates the matrix file shape; returns { revision, mins } or throws. */
export function parseMatrix(raw) {
  if (raw === null || typeof raw !== 'object' || raw.schema !== 1 || !Number.isInteger(raw.contract_revision) || raw.contract_revision < 1) {
    throw new Error('app-compatibility.json: schema/contract_revision invalid');
  }
  const mins = {};
  for (const c of COMPONENTS) {
    const e = raw.components?.[c];
    if (!e || !Number.isInteger(e.min_client_version_code) || e.min_client_version_code < 1 || e.min_client_version_code > 2_000_000_000) {
      throw new Error(`app-compatibility.json: ${c}.min_client_version_code invalid`);
    }
    if (e.reason !== null && (typeof e.reason !== 'string' || e.reason.length === 0 || e.reason.length > 300)) {
      throw new Error(`app-compatibility.json: ${c}.reason invalid`);
    }
    if (e.min_client_version_code > 1 && e.reason === null) {
      throw new Error(`app-compatibility.json: ${c} raises the minimum above 1 and must say why (reason, plain Vietnamese, shown to the user)`);
    }
    mins[c] = e.min_client_version_code;
  }
  return { revision: raw.contract_revision, mins };
}

/**
 * Pure decision. `live` is what production answers on /v1/app-updates/compatibility (null = it could not be read; `notFound` = an older backend without it,
 * which implicitly demands versionCode 1 and tells nothing about published builds).
 * Returns { ok, errors, warnings, rows }.
 */
export function evaluatePreflight({ matrix, live }) {
  const errors = [];
  const warnings = [];
  const rows = [];
  if (live !== null && live.notFound !== true && (live.contract_revision > matrix.revision)) {
    errors.push(`contract_revision ${matrix.revision} is lower than production's ${live.contract_revision}: this would roll the contract back.`);
  }
  for (const c of COMPONENTS) {
    const min = matrix.mins[c];
    const prod = live === null ? undefined : live.notFound === true ? { min_client_version_code: 1, published_version_code: null, artifact_ready: false } : live.components?.[c];
    const prodMin = prod?.min_client_version_code ?? null;
    const published = prod?.published_version_code ?? null;
    const ready = prod?.artifact_ready === true;
    const satisfied = published !== null && published >= min && ready;
    const raising = prodMin === null ? min > 1 : min > prodMin;
    if (live !== null && live.notFound !== true && live.contract_revision === matrix.revision && prodMin !== null && prodMin !== min) {
      errors.push(`${c}: minimum changed (${prodMin} -> ${min}) without a new contract_revision.`);
    }
    if (live !== null && live.notFound !== true && live.contract_revision < matrix.revision && prodMin === min) {
      warnings.push(`${c}: contract_revision rose but the minimum did not; nothing breaks.`);
    }
    if (min > 1) {
      if (live === null) {
        errors.push(`${c}: minimum ${min} requires proof that a downloadable APK exists, but production could not be asked. Not promoting a breaking change blind.`);
      } else if (!satisfied) {
        const why = published === null ? 'no APK is PUBLISHED' : published < min ? `the newest PUBLISHED APK is versionCode ${published}` : 'the APK file is not downloadable (missing or wrong size in OPS_ARTIFACT_DIR)';
        (raising ? errors : warnings).push(`${c}: backend minimum ${min} but ${why}. ${raising ? 'Prepare, sign, register and PUBLISH a compatible APK (SYSTEM) and keep the old API compatible until phones moved, then promote.' : 'Production is already in this state: phones below the minimum have nothing to download.'}`);
      }
    }
    rows.push({ component: c, contract_min: min, production_min: prodMin, published_version_code: published, artifact_ready: prod === undefined ? null : ready, status: min <= 1 ? 'BASELINE' : satisfied ? 'OK' : raising ? 'BLOCKED' : 'UNSATISFIED' });
  }
  return { ok: errors.length === 0, errors, warnings, rows };
}

/** After the deploy: production serves the same contract, and the check never calls a below-minimum phone "up to date". */
export function evaluateAfter({ matrix, live, checks }) {
  const errors = [];
  if (live === null || live.notFound === true) {
    errors.push('production does not serve /v1/app-updates/compatibility after the deploy.');
    return { ok: false, errors, warnings: [], rows: [] };
  }
  if (live.contract_revision !== matrix.revision) {
    errors.push(`production serves contract_revision ${live.contract_revision}, expected ${matrix.revision}.`);
  }
  for (const c of COMPONENTS) {
    if (live.components?.[c]?.min_client_version_code !== matrix.mins[c]) {
      errors.push(`${c}: production minimum ${live.components?.[c]?.min_client_version_code ?? 'missing'}, expected ${matrix.mins[c]}.`);
    }
    const below = checks?.[c];
    if (matrix.mins[c] > 1 && below !== undefined) {
      if (below.status === 'COMPATIBLE' || below.status === 'UPDATE_OPTIONAL' || below.update_available !== true) {
        errors.push(`${c}: a phone at versionCode ${matrix.mins[c] - 1} is told "${below.status}" and offered ${below.update_available === true ? 'a build' : 'nothing'}; it must get UPDATE_REQUIRED with a download.`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings: [], rows: [] };
}

export function renderMarkdown(result) {
  const lines = ['| App | Backend min versionCode | Production min | Published APK versionCode | Downloadable | Status |', '|---|---|---|---|---|---|'];
  for (const r of result.rows) {
    lines.push(`| ${r.component} | ${r.contract_min} | ${r.production_min ?? '?'} | ${r.published_version_code ?? 'none'} | ${r.artifact_ready === null ? '?' : r.artifact_ready ? 'yes' : 'no'} | ${r.status} |`);
  }
  return lines.join('\n');
}

async function getJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data;
}

async function main(argv) {
  const live = argv.includes('--live') ? argv[argv.indexOf('--live') + 1] : undefined;
  const staticOnly = argv.includes('--static');
  const after = argv.includes('--after');
  if (!staticOnly && (live === undefined || !/^https:\/\/[^/\s]+$/.test(live))) {
    console.error('usage: check-app-compat.mjs --static | --live https://origin [--after]');
    return 2;
  }
  let matrix;
  try {
    matrix = parseMatrix(JSON.parse(readFileSync(MATRIX_PATH, 'utf8')));
  } catch (error) {
    console.error(`::error title=APK compatibility matrix::${error.message}`);
    return 1;
  }
  if (staticOnly) {
    console.log(`app-compatibility.json valid (contract_revision ${matrix.revision}; FOOD>=${matrix.mins.FOOD}, SHIP>=${matrix.mins.SHIP}).`);
    return 0;
  }
  let data = null;
  try {
    data = await getJson(`${live}/v1/app-updates/compatibility`);
  } catch (error) {
    console.error(`production compatibility could not be read: ${error.message}`);
  }
  let result;
  if (after) {
    const checks = {};
    for (const c of COMPONENTS) {
      if (matrix.mins[c] > 1) {
        try {
          checks[c] = await getJson(`${live}/v1/app-updates/check?component=${c}&version_code=${matrix.mins[c] - 1}`);
        } catch (error) {
          console.error(`${c}: update check failed: ${error.message}`);
        }
      }
    }
    result = evaluateAfter({ matrix, live: data, checks });
  } else {
    result = evaluatePreflight({ matrix, live: data });
  }
  if (result.rows.length > 0) console.log(renderMarkdown(result));
  for (const w of result.warnings) console.log(`::warning title=APK compatibility::${w}`);
  for (const e of result.errors) console.error(`::error title=APK compatibility::${e}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
