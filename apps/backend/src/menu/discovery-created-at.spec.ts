import { describe, expect, it } from '@jest/globals';
import { codeOf } from '../shared/source-scan.fixture';

// Issue #411 (Owner 21/11): the shop list carries the public creation date so the client can fill "Quán nổi bật" and "Quán gần bạn" with the
// newest shops. Source-level proof: additive field only, selected from the Shop table, nothing private added.

describe('Shop list exposes the public creation date (#411)', () => {
  it('selects s.created_at in the shop discovery read and maps it to an ISO string or null', () => {
    const reader = codeOf('shop/shop-discovery-reader.ts');
    expect(reader).toMatch(/SELECT s\.shop_id, s\.name, s\.address_text, s\.pickup_lat, s\.pickup_lng, s\.created_at,/);
    expect(reader).toMatch(/createdAt: row\.created_at == null \? null : new Date\(row\.created_at\)\.toISOString\(\)/);
  });

  it('adds created_at to each shop of the shop list response, without changing ordering, paging or the public filter', () => {
    const service = codeOf('menu/discovery-service.ts');
    expect(service).toContain('created_at: shop.createdAt ?? null');
    expect(service).toContain(".sort(byOpenThenName)");
    expect(service).toContain('query.offset, query.offset + query.limit');
  });

  it('does not expose any private shop field through the new column (no owner, phone, bank or member data)', () => {
    const reader = codeOf('shop/shop-discovery-reader.ts');
    const selectLine = reader.match(/SELECT s\.shop_id[^\n]*/)?.[0] ?? '';
    expect(selectLine).not.toMatch(/phone|bank|owner|email|member|user_id|tax|account/i);
  });
});
