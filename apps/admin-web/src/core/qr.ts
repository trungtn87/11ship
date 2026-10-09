import { qrcodegen } from '../vendor/qrcodegen.js';

/** A QR symbol as rows of booleans (true = dark module), quiet zone not included. */
export interface QrMatrix {
  readonly size: number;
  readonly dark: readonly (readonly boolean[])[];
}

/**
 * Encodes the otpauth URI locally (error correction M, the smallest version that fits). The URI is never sent anywhere.
 */
export function encodeQr(text: string): QrMatrix {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const dark: boolean[][] = [];
  for (let y = 0; y < qr.size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < qr.size; x += 1) {
      row.push(qr.getModule(x, y));
    }
    dark.push(row);
  }
  return { size: qr.size, dark };
}

/**
 * One SVG path ("d" attribute) covering every dark module, offset by the quiet zone. Horizontal runs are merged so
 * the path stays short. Coordinates are in modules; the caller sets viewBox to size + 2 * quiet.
 */
export function qrPath(matrix: QrMatrix, quiet: number): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y += 1) {
    const row = matrix.dark[y] ?? [];
    let x = 0;
    while (x < matrix.size) {
      if (row[x] !== true) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < matrix.size && row[x] === true) {
        x += 1;
      }
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`);
    }
  }
  return parts.join('');
}
