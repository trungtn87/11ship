import type { Pool } from 'pg';

// "Is a one-time code written in clear anywhere?" — decided on the STRUCTURE of the data, never on the characters next to the code.
//
// A six-digit code can appear by chance inside an identifier (uuid), a timestamp or sealed bytes, so those technical fields are left out of the scan. Everything else is
// searched as a plain substring, whatever surrounds the digits: `123456`, `code123456`, `123456abc`, `otp-123456`, `otp.123456`, `123456-x`, a JSON field, a message,
// a log message. A field is left out only when it is declared technical here, and (for text fields that may hold anything) only when its WHOLE value has the shape of
// an id or a timestamp. A string that merely contains an id is content and is searched in full.

const UUID_WHOLE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const ISO_TIME_WHOLE = '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}(:[0-9]{2})?)?$';
const UUID_RE = new RegExp(UUID_WHOLE);
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Columns that are technical by definition (uuid, timestamp, sealed bytes, counters, key id), per table. A text column that holds ids (actor_id, resource_id) is not here:
 * it is searched unless its whole value is a uuid or a timestamp.
 */
export const TECHNICAL_COLUMNS = {
  sms_jobs: ['job_id', 'verification_id', 'activation_challenge_id', 'attempt_id', 'claimed_by', 'claimed_at', 'lease_expires_at', 'created_at', 'expires_at', 'finished_at', 'delivered_at', 'payload_iv', 'payload_tag', 'payload_ciphertext', 'crypto_key_id'],
  audit_logs: ['audit_id', 'occurred_at', 'request_id', 'resource_version'],
  outbox_events: ['event_id', 'occurred_at', 'available_at', 'locked_at', 'published_at', 'lock_token', 'resource_version', 'event_schema_version', 'attempt_count'],
} as const;

/**
 * True when [otp] appears in any column of the rows of [source] except the technical columns. `source` is a SELECT whose own parameters start at $3 ($1 is the code and
 * $2 the technical columns).
 *
 * Every other column is searched as a plain substring. A jsonb column (metadata, payload) is read value by value: each string, number and key is searched on its own, with
 * nothing removed from it. A value is skipped only when the WHOLE value is a uuid or a timestamp (an id or a time field); a string that merely contains one, a message, a
 * note, a name, is content and is searched in full.
 */
export async function rowsContainClearOtp(pool: Pool, source: string, sourceParams: readonly unknown[], technical: readonly string[], otp: string): Promise<boolean> {
  const result = await pool.query<{ hit: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM (${source}) t,
              LATERAL jsonb_each(to_jsonb(t) - $2::text[]) c(col, val),
              LATERAL (
                SELECT CASE WHEN jsonb_typeof(c.val) IN ('object', 'array') THEN NULL ELSE c.val #>> '{}' END AS x
                UNION ALL
                SELECT leaf #>> '{}'
                  FROM jsonb_path_query(CASE WHEN jsonb_typeof(c.val) IN ('object', 'array') THEN c.val ELSE '[]'::jsonb END, 'strict $.**') leaf
                 WHERE jsonb_typeof(leaf) NOT IN ('object', 'array')
                UNION ALL
                SELECT kv ->> 'key'
                  FROM jsonb_path_query(CASE WHEN jsonb_typeof(c.val) IN ('object', 'array') THEN c.val ELSE '[]'::jsonb END, 'lax $.** ? (@.type() == "object").keyvalue()') kv
              ) s
        WHERE s.x IS NOT NULL AND position($1::text IN s.x) > 0 AND s.x !~ '${UUID_WHOLE}' AND s.x !~ '${ISO_TIME_WHOLE}'
     ) AS hit`,
    [otp, [...technical], ...sourceParams],
  );
  return result.rows[0]?.hit === true;
}

/** True when [otp] is in any column of the table that is not a technical one (see [TECHNICAL_COLUMNS]). */
export function tableContainsClearOtp(pool: Pool, table: keyof typeof TECHNICAL_COLUMNS, otp: string): Promise<boolean> {
  return rowsContainClearOtp(pool, `SELECT * FROM app.${table}`, [], TECHNICAL_COLUMNS[table], otp);
}

function valueContains(value: unknown, otp: string): boolean {
  if (typeof value === 'string') {
    return value.includes(otp);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).includes(otp);
  }
  if (Array.isArray(value)) {
    return value.some((item) => valueContains(item, otp));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => key.includes(otp) || valueContains(item, otp));
  }
  return false;
}

/**
 * True when [otp] is in the log. A line that parses as a JSON object is read field by field: only `time` (a whole ISO timestamp), `request_id` (a whole uuid) and the numeric
 * fields `status`, `duration_ms`, `port` are skipped; every other field, including the event name and any message, is searched in full, with no text removed. A line that does not
 * parse is searched as it is.
 */
export function logContainsClearOtp(lines: readonly string[], otp: string): boolean {
  return lines.some((line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return line.includes(otp);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return line.includes(otp);
    }
    return Object.entries(parsed as Record<string, unknown>).some(([key, value]) => {
      if (key === 'time' && typeof value === 'string' && ISO_TIME_RE.test(value)) {
        return false;
      }
      if (key === 'request_id' && typeof value === 'string' && UUID_RE.test(value)) {
        return false;
      }
      if ((key === 'status' || key === 'duration_ms' || key === 'port') && typeof value === 'number') {
        return false;
      }
      return key.includes(otp) || valueContains(value, otp);
    });
  });
}
