import { describe, expect, it } from '@jest/globals';
import { errorAction, errorExplanation, errorSummary, parseErrorPage, vietnamTime } from './error-log';
const id = '11111111-2222-4333-8444-555555555555';
const event = { time: '2026-10-21T07:05:00Z', request_id: id, code: 'INTERNAL_ERROR', status: 500, level: 'error',
  route: '/v1/driver/wallet/topup-requests', method: 'POST', count: 1, occurrences: [{ time: '2026-10-21T07:05:00Z', request_id: id }] };
const page = (row: unknown) => ({ data: { items: [row], total: 1, storage: 'configured-file' } });
describe('M13 readable log presentation', () => {
  it('uses Vietnamese fixed messages, Vietnam time and an honest unknown cause', () => {
    const entry = parseErrorPage(page(event))!.items[0]!;
    expect(errorAction(entry)).toBe('Tạo yêu cầu nạp tiền');
    expect(errorSummary(entry)).toContain('tạo yêu cầu nạp tiền');
    expect(errorExplanation(entry.code)).toContain('Chưa xác định nguyên nhân');
    expect(errorExplanation('TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED')).toContain('chưa cấu hình tài khoản');
    expect(vietnamTime(event.time)).toContain('14:05:00');
  });
  it('does not reflect arbitrary error messages, raw URL, SQL or invalid occurrence identifiers', () => {
    const parsed = parseErrorPage(page({ ...event, message: '<script>SECRET</script>', sql: 'SECRET SQL', route: '/v1/orders?token=SECRET' }));
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
    expect(parsed!.items[0]!.route).toBeUndefined();
    expect(parseErrorPage(page({ ...event, count: 2 }))).toBeUndefined();
    expect(parseErrorPage(page({ ...event, occurrences: [{ time: event.time, request_id: 'SECRET' }] }))).toBeUndefined();
    expect(errorExplanation('UNKNOWN_SECRET')).not.toContain('UNKNOWN_SECRET');
  });
});
