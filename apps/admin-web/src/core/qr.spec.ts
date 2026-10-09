import { describe, expect, it } from '@jest/globals';
import { encodeQr, qrPath } from './qr';

// The decode check of the rendered QR (an otpauth URI read back from a screenshot) is in the browser integration test
// and the evidence; here the structure of the symbol is checked.
describe('admin web QR', () => {
  const uri = 'otpauth://totp/11Ship%20Admin:%2B84912345678?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=11Ship%20Admin&algorithm=SHA1&digits=6&period=30';

  it('encodes an otpauth URI into a valid-size symbol with the three finder patterns', () => {
    const matrix = encodeQr(uri);
    expect((matrix.size - 17) % 4).toBe(0);
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    const finderAt = (x0: number, y0: number) => {
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const ring = x === 0 || x === 6 || y === 0 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          expect(matrix.dark[y0 + y]?.[x0 + x]).toBe(ring || core);
        }
      }
    };
    finderAt(0, 0);
    finderAt(matrix.size - 7, 0);
    finderAt(0, matrix.size - 7);
  });

  it('is deterministic, and different secrets give different symbols', () => {
    expect(encodeQr(uri)).toEqual(encodeQr(uri));
    expect(encodeQr(uri.replace('JBSW', 'KBSW'))).not.toEqual(encodeQr(uri));
  });

  it('draws one path segment per horizontal run, offset by the quiet zone', () => {
    const path = qrPath({ size: 3, dark: [[true, true, false], [false, false, false], [true, false, true]] }, 4);
    expect(path).toBe('M4 4h2v1h-2zM4 6h1v1h-1zM6 6h1v1h-1z');
  });
});
