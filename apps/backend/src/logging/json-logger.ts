import { appendFileSync, chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogWriter = (line: string) => void;

// Only these metadata keys can ever reach a log line. Anything else is dropped at runtime,
// so request bodies, query strings, DSNs, SQL and raw error messages cannot be logged by accident.
export const LOG_META_WHITELIST = [
  'request_id',
  'method',
  'status',
  'code',
  'duration_ms',
  'port',
  'error_class',
  'app',
  'module',
  'route',
] as const;

const MAX_VALUE_LENGTH = 128;

function sanitizeString(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, MAX_VALUE_LENGTH);
}

function defaultWriter(line: string): void {
  process.stdout.write(`${line}\n`);
}

export interface SafeErrorEvent {
  readonly time: string;
  readonly level: 'warn' | 'error';
  readonly event: 'request_failed';
  readonly request_id: string;
  readonly status: number;
  readonly code: string;
  readonly method?: string;
  readonly error_class?: string;
  readonly app?: string;
  readonly module?: string;
  readonly route?: string;
}

export interface ErrorLogQuery {
  readonly requestId?: string;
  readonly code?: string;
  readonly app?: string;
  readonly status?: number;
  readonly level?: 'warn' | 'error';
  readonly module?: string;
  readonly from?: number;
  readonly to?: number;
  readonly page: number;
  readonly limit: number;
}

const MAX_ERROR_FILE_BYTES = 1024 * 1024;
const MAX_ERRORS_IN_MEMORY = 1200;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ROUTE = /^\/[A-Za-z0-9/:._-]{0,127}$/;

export interface ErrorLogOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly retentionDays?: number;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export interface ErrorLogGroup extends SafeErrorEvent {
  readonly count: number;
  readonly occurrences: { time: string; request_id: string }[];
}

function parseSafeEvent(value: unknown): SafeErrorEvent | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.event !== 'request_failed' || (raw.level !== 'warn' && raw.level !== 'error') ||
      typeof raw.time !== 'string' || !Number.isFinite(Date.parse(raw.time)) ||
      typeof raw.request_id !== 'string' || !UUID.test(raw.request_id) ||
      typeof raw.code !== 'string' || !/^[A-Z0-9_]{1,128}$/.test(raw.code) ||
      typeof raw.status !== 'number' || !Number.isInteger(raw.status) || raw.status < 400 || raw.status > 599) return undefined;
  const copy = (key: string): string | undefined =>
    typeof raw[key] === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(raw[key] as string) ? raw[key] as string : undefined;
  return {
    time: raw.time, level: raw.level, event: 'request_failed', request_id: raw.request_id,
    code: raw.code, status: raw.status,
    ...(copy('method') === undefined ? {} : { method: copy('method') }),
    ...(copy('error_class') === undefined ? {} : { error_class: copy('error_class') }),
    ...(copy('app') === undefined ? {} : { app: copy('app') }),
    ...(copy('module') === undefined ? {} : { module: copy('module') }),
    ...(typeof raw.route === 'string' && ROUTE.test(raw.route) ? { route: raw.route } : {}),
  };
}

/** M13: strictly sanitized error-only, bounded memory and optional persistent JSONL.
 * File path is SERVER configured, never user-provided. No request URL/body/SQL/stack/token is saved.
 * A write/storage failure never interrupts money or other business operations.
 */
export class JsonLogger {
  readonly #recent: SafeErrorEvent[] = [];
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #retentionMs: number;
  #fileAvailable = false;
  #fileBytes = 0;

  constructor(private readonly write: LogWriter = defaultWriter, private readonly errorFilePath?: string, options: ErrorLogOptions = {}) {
    this.#maxEntries = bounded(options.maxEntries, MAX_ERRORS_IN_MEMORY, 1, 10000);
    this.#maxBytes = bounded(options.maxBytes, MAX_ERROR_FILE_BYTES, 1024, 4 * 1024 * 1024);
    this.#retentionMs = bounded(options.retentionDays, 7, 1, 30) * 86400 * 1000;
    if (errorFilePath) {
      // Read the previous format's rotated file as well. Ignore individual damaged lines.
      for (const file of [errorFilePath + '.1', errorFilePath]) {
        try {
          if (!existsSync(file) || statSync(file).size > this.#maxBytes + 2048) continue;
          for (const line of readFileSync(file, 'utf8').split('\n')) {
            if (!line) continue;
            try {
              const event = parseSafeEvent(JSON.parse(line) as unknown);
              if (event !== undefined) this.#remember(event);
            } catch { /* keep the valid lines after a damaged record */ }
          }
        } catch { /* storage may be unavailable; the API continues with RAM */ }
      }
      this.#compact();
    }
  }

  #remember(event: SafeErrorEvent): boolean {
    const cutoff = Date.now() - this.#retentionMs;
    let expired = false;
    while (this.#recent.length && Date.parse(this.#recent[0]!.time) < cutoff) {
      this.#recent.shift();
      expired = true;
    }
    if (Date.parse(event.time) < cutoff) return expired;
    // Recovery may see the same entry in both old and current files.
    if (this.#recent.some((r) => r.request_id === event.request_id)) return expired;
    const previous = this.#recent.at(-1);
    this.#recent.push(event);
    if (previous && Date.parse(previous.time) > Date.parse(event.time)) {
      this.#recent.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    }
    if (this.#recent.length > this.#maxEntries) this.#recent.shift();
    return expired;
  }

  #compact(): void {
    if (!this.errorFilePath) return;
    try {
      const lines = this.#recent.map((r) => JSON.stringify(r) + '\n');
      let bytes = lines.reduce((n, line) => n + Buffer.byteLength(line), 0);
      while (bytes > this.#maxBytes && lines.length) bytes -= Buffer.byteLength(lines.shift()!);
      writeFileSync(this.errorFilePath, lines.join(''), { mode: 0o600 });
      chmodSync(this.errorFilePath, 0o600);
      // Truncate legacy rotation so records past retention do not remain there.
      if (existsSync(this.errorFilePath + '.1')) {
        writeFileSync(this.errorFilePath + '.1', '', { mode: 0o600 });
        chmodSync(this.errorFilePath + '.1', 0o600);
      }
      this.#fileBytes = bytes;
      this.#fileAvailable = true;
    } catch { this.#fileAvailable = false; }
  }

  /** Group only after filtering so counts and occurrences describe the selected interval. */
  errorEvents(query: ErrorLogQuery): { items: ErrorLogGroup[]; total: number; storage: string } {
    const rows = this.#recent.filter((r) => {
      const ms = Date.parse(r.time);
      return ms >= Date.now() - this.#retentionMs &&
        (query.requestId === undefined || r.request_id === query.requestId) &&
        (query.code === undefined || r.code === query.code) &&
        (query.app === undefined || r.app === query.app) &&
        (query.level === undefined || r.level === query.level) &&
        (query.module === undefined || r.module === query.module) &&
        (query.status === undefined || r.status === query.status) &&
        (query.from === undefined || ms >= query.from) &&
        (query.to === undefined || ms <= query.to);
    }).reverse();
    const groups = new Map<string, { entry: SafeErrorEvent; occurrences: ErrorLogGroup['occurrences'] }>();
    for (const row of rows) {
      const key = JSON.stringify([row.app, row.module, row.method, row.route, row.code, row.status, row.level, row.error_class]);
      const group = groups.get(key);
      const occurrence = { time: row.time, request_id: row.request_id };
      if (group) group.occurrences.push(occurrence);
      else groups.set(key, { entry: row, occurrences: [occurrence] });
    }
    const grouped = [...groups.values()].map(({ entry, occurrences }) => ({ ...entry, count: occurrences.length, occurrences }));
    return { items: grouped.slice((query.page - 1) * query.limit, query.page * query.limit),
      total: grouped.length, storage: this.#fileAvailable ? 'configured-file' : 'memory-only' };
  }

  log(level: LogLevel, event: string, meta: Record<string, unknown> = {}): void {
    const entry: Record<string, string | number> = {
      time: new Date().toISOString(),
      level,
      event: sanitizeString(event),
    };

    for (const key of LOG_META_WHITELIST) {
      const value = meta[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        entry[key] = value;
      } else if (typeof value === 'string') {
        entry[key] = sanitizeString(value);
      }
    }

    const line = JSON.stringify(entry);
    this.write(line);
    if (event === 'request_failed') {
      const saved = parseSafeEvent(entry);
      if (saved !== undefined) {
        const expired = this.#remember(saved);
        if (this.errorFilePath) {
          const safeLine = JSON.stringify(saved) + '\n';
          if (expired || !this.#fileAvailable || this.#fileBytes + Buffer.byteLength(safeLine) > this.#maxBytes) {
            this.#compact();
          } else {
            try {
              appendFileSync(this.errorFilePath, safeLine, { mode: 0o600 });
              this.#fileBytes += Buffer.byteLength(safeLine);
            } catch { this.#fileAvailable = false; }
          }
        }
      }
    }
  }
}
