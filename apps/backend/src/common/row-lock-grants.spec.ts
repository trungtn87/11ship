import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Static guard (narrow): every table that backend SQL locks with FOR UPDATE / FOR NO KEY UPDATE / FOR SHARE / FOR KEY SHARE must be granted
// UPDATE to the runtime role ship11_app in ops/selfhosted/02-runtime-grants.sql. PostgreSQL requires UPDATE privilege for all four lock modes;
// the CI test role owns the tables and therefore never hits that check, so only a static comparison catches a missing grant before the VPS does.
//
// Limits (deliberately narrow): it reads SQL string literals of non-spec .ts files under apps/backend/src, strips comments, expands same-file
// `const X = \`...\`` interpolations and resolves `FOR ... OF alias` through the aliases declared in the same file. Anything it cannot resolve
// fails the test (it is never silently skipped). It does not analyse dynamic SQL built outside a literal, nor other services under apps/.

const REPO_ROOT = process.cwd();
const SOURCE_ROOT = path.join(REPO_ROOT, 'apps', 'backend', 'src');
const GRANTS_FILE = path.join(REPO_ROOT, 'ops', 'selfhosted', '02-runtime-grants.sql');

const LOCK = /\bFOR\s+(?:NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b/;
const NOT_ALIAS = new Set(['where', 'on', 'left', 'right', 'inner', 'outer', 'join', 'order', 'group', 'limit', 'set', 'for', 'lateral', 'cross', 'using', 'as', 'natural', 'and', 'or', 'union', 'having', 'returning']);

/** Accepted, reviewed exceptions: a table that is locked but not granted UPDATE. Each entry must still be a real gap (the test fails when it is fixed, so the entry is removed). */
const KNOWN_GAPS: ReadonlyArray<{ readonly table: string; readonly file: string; readonly reason: string }> = [
  {
    table: 'wallet_commission_policies',
    file: 'apps/backend/src/wallet/commission-policy-repository.ts',
    reason:
      'VERIFIED 2026-11-21 on local PostgreSQL 17.11: the SYSTEM commission change (admin-finance-read-service.changeCommission) cannot run with the runtime grants SELECT, INSERT. ' +
      '(1) CommissionPolicyRepository.lockCurrent takes FOR UPDATE: permission denied. (2) Even without it, insertNext fires the guard trigger wallet_commission_policies_guard, which runs LOCK TABLE ... SHARE ROW EXCLUSIVE: permission denied (LOCK needs UPDATE). ' +
      'The table is append-only (UPDATE refused by trigger), so a plain SELECT fix would not restore the write. Needs a Claude Lead decision (grant UPDATE, or redesign the guard lock with an advisory lock by migration). Not fixed in PR #423.',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function literalsOf(source: string): string[] {
  const out: string[] = [];
  const re = /`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) out.push(match[1] ?? match[2] ?? match[3] ?? '');
  return out;
}

function constantsOf(source: string): Map<string, string> {
  const consts = new Map<string, string>();
  const re = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) consts.set(match[1] as string, match[2] as string);
  return consts;
}

function expand(text: string, consts: Map<string, string>): string {
  let out = text;
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => consts.get(name) ?? whole);
  }
  return out;
}

function grantedUpdateTables(): Set<string> {
  const granted = new Set<string>();
  for (const line of readFileSync(GRANTS_FILE, 'utf8').split('\n')) {
    const match = /^GRANT ([A-Z, ]+) ON app\.([a-z_]+) TO ship11_app;/.exec(line);
    if (match !== null && /\bUPDATE\b/.test(match[1] as string)) granted.add(match[2] as string);
  }
  return granted;
}

/** One FOR-lock clause in a SQL literal with the relations of its own query block (same parenthesis depth). */
function lockBlocks(text: string): Array<{ readonly of: string[]; readonly blockTables: string[] }> {
  type Event = { readonly kind: 'lock'; readonly depth: number; readonly of: string[] } | { readonly kind: 'table'; readonly depth: number; readonly table: string };
  const events: Event[] = [];
  let depth = 0;
  const token = /\(|\)|\bFOR\s+(?:NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b(?:\s+OF\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*))?|\b(?:FROM|JOIN|UPDATE|INTO)\s+app\.([a-z_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    const word = match[0];
    if (word === '(') depth += 1;
    else if (word === ')') depth -= 1;
    else if (/^FOR\b/i.test(word)) events.push({ kind: 'lock', depth, of: (match[1] ?? '').split(',').map((a) => a.trim().toLowerCase()).filter((a) => a !== '') });
    else events.push({ kind: 'table', depth, table: (match[2] as string).toLowerCase() });
  }
  return events
    .filter((e): e is Extract<Event, { kind: 'lock' }> => e.kind === 'lock')
    .map((lock) => ({
      of: lock.of,
      blockTables: [...new Set(events.filter((e): e is Extract<Event, { kind: 'table' }> => e.kind === 'table' && e.depth === lock.depth).map((e) => e.table))],
    }));
}

interface LockFinding {
  readonly file: string;
  readonly table: string | null;
  readonly unresolved?: string;
}

function findLocks(): LockFinding[] {
  const findings: LockFinding[] = [];
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    const source = stripComments(readFileSync(file, 'utf8'));
    const consts = constantsOf(source);
    // Alias -> table, from every FROM/JOIN app.<table> <alias> in this file (a table without alias maps to itself).
    const aliases = new Map<string, string>();
    const literals = literalsOf(source).map((text) => expand(text, consts));
    for (const text of literals) {
      for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+app\.([a-z_]+)(?:\s+(?:AS\s+)?([a-z_]+))?/gi)) {
        const table = (match[1] as string).toLowerCase();
        aliases.set(table, table);
        const alias = match[2]?.toLowerCase();
        if (alias !== undefined && !NOT_ALIAS.has(alias)) aliases.set(alias, table);
      }
    }
    for (const text of literals) {
      if (!LOCK.test(text)) continue;
      for (const lock of lockBlocks(text)) {
        let targets: string[];
        if (lock.of.length > 0) {
          // FOR UPDATE OF alias: only the named relations are locked.
          targets = lock.of.map((alias) => aliases.get(alias) ?? `UNRESOLVED_ALIAS:${alias}`);
        } else {
          // Without OF: every relation of the query block that holds this FOR clause (same parenthesis depth; subqueries are other blocks).
          targets = lock.blockTables;
        }
        if (targets.length === 0) {
          findings.push({ file: relative, table: null, unresolved: text.replace(/\s+/g, ' ').slice(0, 120) });
          continue;
        }
        for (const table of targets) findings.push({ file: relative, table });
      }
    }
  }
  return findings;
}

describe('row locks in backend SQL need UPDATE on the runtime role (ops/selfhosted/02-runtime-grants.sql)', () => {
  const granted = grantedUpdateTables();
  const findings = findLocks();

  it('the scan finds lock statements at all (guards against the scanner silently seeing nothing)', () => {
    expect(findings.length).toBeGreaterThan(50);
  });

  it('every lock statement resolves to a table (no statement is skipped without a reason)', () => {
    const unresolved = findings.filter((f) => f.unresolved !== undefined || f.table?.startsWith('UNRESOLVED_ALIAS:'));
    expect(unresolved.map((f) => `${f.file}: ${f.unresolved ?? f.table}`)).toEqual([]);
  });

  it('every table that is locked is granted UPDATE to ship11_app, except the reviewed known gaps', () => {
    const missing = new Map<string, Set<string>>();
    for (const finding of findings) {
      if (finding.table === null || finding.table.startsWith('UNRESOLVED_ALIAS:') || granted.has(finding.table)) continue;
      const files = missing.get(finding.table) ?? new Set<string>();
      files.add(finding.file);
      missing.set(finding.table, files);
    }
    const unexpected = [...missing.entries()]
      .filter(([table, files]) => ![...files].every((file) => KNOWN_GAPS.some((gap) => gap.table === table && gap.file === file)))
      .map(([table, files]) => `${table} <- ${[...files].join(', ')}`);
    expect(unexpected).toEqual([]);
  });

  it('a known gap is still a real gap (remove its entry once the grant or the code is fixed)', () => {
    for (const gap of KNOWN_GAPS) {
      const stillLocked = findings.some((f) => f.table === gap.table && f.file === gap.file);
      expect({ table: gap.table, stillLocked: stillLocked && !granted.has(gap.table) }).toEqual({ table: gap.table, stillLocked: true });
    }
  });

  it('route_snapshots is not locked anywhere (the immutable snapshot table is SELECT and INSERT only for the runtime role)', () => {
    expect(findings.filter((f) => f.table === 'route_snapshots')).toEqual([]);
  });
});
