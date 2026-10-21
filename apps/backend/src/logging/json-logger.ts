import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';

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
}

export interface ErrorLogQuery {
  readonly requestId?: string;
  readonly code?: string;
  readonly app?: string;
  readonly status?: number;
  readonly from?: number;
  readonly to?: number;
  readonly page: number;
  readonly limit: number;
}

const MAX_ERROR_FILE_BYTES = 1024 * 1024;
const MAX_ERRORS_IN_MEMORY = 1200;
const RETENTION_MS = 7 * 86400 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9-]{27,36}$/;

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
  };
}

/** M13: strictly sanitized error-only, bounded memory and optional persistent JSONL.
 * File path is SERVER configured, never user-provided. No request URL/body/SQL/stack/token is saved.
 * A write/storage failure never interrupts money or other business operations.
 */
export class JsonLogger {
  readonly #recent: SafeErrorEvent[] = [];
  constructor(private readonly write: LogWriter = defaultWriter, private readonly errorFilePath?: string) {
    if (errorFilePath) {
      for (const file of [errorFilePath + '.1', errorFilePath]) {
        try {
          if (!existsSync(file) || statSync(file).size > MAX_ERROR_FILE_BYTES + 2048) continue;
          for (const line of readFileSync(file, 'utf8').split('\n')) {
            if (!line) continue;
            const event = parseSafeEvent(JSON.parse(line) as unknown);
            if (event !== undefined) this.#remember(event);
          }
        } catch { /* journal may be absent/truncated: continue with available events */ }
      }
    }
  }

  #remember(event: SafeErrorEvent): void {
    if (Date.parse(event.time) < Date.now() - RETENTION_MS) return;
    this.#recent.push(event);
    if (this.#recent.length > MAX_ERRORS_IN_MEMORY) this.#recent.shift();
  }

  /** Called exclusively after authentication as SYSTEM by the controller. */
  errorEvents(query: ErrorLogQuery): { items: SafeErrorEvent[]; total: number; storage: string } {
    const rows = this.#recent.filter((r) => {
      const ms = Date.parse(r.time);
      return ms >= Date.now() - RETENTION_MS &&
        (query.requestId === undefined || r.request_id === query.requestId) &&
        (query.code === undefined || r.code === query.code) &&
        (query.app === undefined || r.app === query.app) &&
        (query.status === undefined || r.status === query.status) &&
        (query.from === undefined || ms >= query.from) &&
        (query.to === undefined || ms <= query.to);
    }).reverse();
    return { items: rows.slice((query.page - 1) * query.limit, query.page * query.limit),
      total: rows.length, storage: this.errorFilePath ? 'configured-file' : 'memory-only' };
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
        this.#remember(saved);
        if (this.errorFilePath) {
          try {
            if (existsSync(this.errorFilePath) && statSync(this.errorFilePath).size > MAX_ERROR_FILE_BYTES) {
              renameSync(this.errorFilePath, this.errorFilePath + '.1');
            }
            appendFileSync(this.errorFilePath, line + '\n', { mode: 0o600 });
          } catch { /* journal failure must never alter API responses or wallet transactions */ }
        }
      }
    }
  }
}
