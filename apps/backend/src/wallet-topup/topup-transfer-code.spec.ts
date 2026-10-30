import { describe, expect, it } from '@jest/globals';
import { topupTransferCodeOf } from './topup-transfer-code';

describe('top-up transfer code (#256)', () => {
  const id = 'a1b2c3d4-e5f6-4789-8abc-0123456789ab';

  it('is NAP plus ten upper-case hex characters of the request id, the same on every call', () => {
    expect(topupTransferCodeOf(id)).toBe('NAPA1B2C3D4E5');
    expect(topupTransferCodeOf(id)).toBe(topupTransferCodeOf(id));
    expect(topupTransferCodeOf(id)).toMatch(/^NAP[0-9A-F]{10}$/);
  });

  it('differs between requests and carries nothing about the person', () => {
    expect(topupTransferCodeOf('b1b2c3d4-e5f6-4789-8abc-0123456789ab')).not.toBe(topupTransferCodeOf(id));
    expect(topupTransferCodeOf(id)).not.toMatch(/\d{9,}/);
  });
});
