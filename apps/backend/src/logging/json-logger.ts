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
] as const;

const MAX_VALUE_LENGTH = 128;

function sanitizeString(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, MAX_VALUE_LENGTH);
}

function defaultWriter(line: string): void {
  process.stdout.write(`${line}\n`);
}

export class JsonLogger {
  constructor(private readonly write: LogWriter = defaultWriter) {}

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

    this.write(JSON.stringify(entry));
  }
}
