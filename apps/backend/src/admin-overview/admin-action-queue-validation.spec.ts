import { describe, expect, it } from '@jest/globals';
import { parseVietnamDay } from '../admin-m12/vietnam-time';
import { parseActionQueueQuery, QUEUE_KINDS } from './admin-overview-validation';

describe('action queue query', () => {
  it('defaults to the oldest wait first with no filter', () => {
    expect(parseActionQueueQuery({})).toEqual({ kind: null, status: null, fromMs: null, toMs: null, sort: 'oldest' });
    expect(parseActionQueueQuery({ kind: '', status: '', from: '', to: '' })).toMatchObject({ kind: null, status: null, fromMs: null, toMs: null });
  });

  it('reads every kind, a status, newest-first and a Vietnam-day window that includes the last day', () => {
    for (const kind of QUEUE_KINDS) {
      expect(parseActionQueueQuery({ kind }).kind).toBe(kind);
    }
    const parsed = parseActionQueueQuery({ kind: 'TOPUP_PENDING', status: 'PENDING', from: '2026-10-01', to: '2026-10-02', sort: 'newest' });
    const first = parseVietnamDay('2026-10-01') as number;
    expect(parsed).toEqual({ kind: 'TOPUP_PENDING', status: 'PENDING', fromMs: first, toMs: first + 2 * 86_400_000, sort: 'newest' });
  });

  it('refuses anything outside the closed lists, half-valid days, reversed windows and unknown parameters', () => {
    const bad: unknown[] = [
      { kind: 'CHAT_MESSAGE' },
      { kind: ['COMPLAINT'] },
      { status: 'pending' },
      { status: "PENDING'; DROP TABLE x" },
      { from: '2026-02-30' },
      { to: '01/10/2026' },
      { from: '2026-10-02', to: '2026-10-01' },
      { sort: 'random' },
      { limit: '5' },
      null,
      [],
      'kind=COMPLAINT',
    ];
    for (const query of bad) {
      expect(() => parseActionQueueQuery(query)).toThrow();
    }
  });
});
