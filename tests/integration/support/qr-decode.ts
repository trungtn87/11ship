// A small, independent QR (model 2) reader for the browser test. It exists so the test can prove that what the page
// DRAWS is a real, valid QR symbol whose text is the otpauth URI, instead of trusting the generator that drew it.
// It reads a pristine module matrix (no camera noise): format information, mask, zigzag data modules, de-interleaving
// of the blocks, a Reed-Solomon check of every block (a valid symbol), and the byte-mode text. It does not correct errors.
// Layout rules are from ISO/IEC 18004; the error-correction block table is the Medium row (the page encodes with ECC M).

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

export interface DecodedQr {
  readonly version: number;
  /** 'M' is the only level the page uses; any other value fails the test. */
  readonly level: 'L' | 'M' | 'Q' | 'H';
  readonly mask: number;
  readonly text: string;
  /** Every block's Reed-Solomon remainder matched the ECC modules read from the symbol. */
  readonly eccValid: boolean;
}

/** Rebuilds the module matrix from the page's SVG path ("M{x} {y}h{n}v1h-{n}z" runs, offset by the quiet zone). */
export function matrixFromPath(d: string, size: number, quiet: number): boolean[][] {
  const dark = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const run = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
  let consumed = 0;
  for (let match = run.exec(d); match !== null; match = run.exec(d)) {
    const x = Number(match[1]) - quiet;
    const y = Number(match[2]) - quiet;
    const width = Number(match[3]);
    for (let i = 0; i < width; i += 1) {
      const row = dark[y];
      if (row === undefined || x + i < 0 || x + i >= size) {
        throw new Error('QR path outside the symbol');
      }
      row[x + i] = true;
    }
    consumed += match[0].length;
  }
  if (consumed !== d.length) {
    throw new Error('QR path has content that is not a module run');
  }
  return dark;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) {
    return [];
  }
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = version * 4 + 10; positions.length < count; position -= step) {
    positions.splice(1, 0, position);
  }
  return positions;
}

function functionModules(version: number): boolean[][] {
  const size = version * 4 + 17;
  const fn = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const mark = (x: number, y: number): void => {
    const row = fn[y];
    if (row !== undefined && x >= 0 && x < size) {
      row[x] = true;
    }
  };
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [cx, cy] of [[0, 0], [size - 8, 0], [0, size - 8]] as const) {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        mark(cx + x, cy + y);
      }
    }
  }
  const align = alignmentPositions(version);
  for (let a = 0; a < align.length; a += 1) {
    for (let b = 0; b < align.length; b += 1) {
      const last = align.length - 1;
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          mark((align[a] ?? 0) + dx, (align[b] ?? 0) + dy);
        }
      }
    }
  }
  for (let i = 0; i < 9; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        mark(size - 11 + x, y);
        mark(y, size - 11 + x);
      }
    }
  }
  return fn;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    result -= (25 * count - 10) * count - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonRemainder(data: readonly number[], degree: number): number[] {
  const divisor = Array.from({ length: degree }, () => 0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      divisor[j] = gfMultiply(divisor[j] ?? 0, root);
      if (j + 1 < degree) {
        divisor[j] = (divisor[j] ?? 0) ^ (divisor[j + 1] ?? 0);
      }
    }
    root = gfMultiply(root, 0x02);
  }
  const result = Array.from({ length: degree }, () => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] = (result[index] ?? 0) ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

export function decodeQrMatrix(dark: readonly (readonly boolean[])[]): DecodedQr {
  const size = dark.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new Error(`not a QR size: ${String(size)}`);
  }
  const at = (x: number, y: number): boolean => dark[y]?.[x] === true;

  // Format information (first copy), XOR 0x5412: 2 bits of level, 3 bits of mask, 10 bits of BCH.
  let format = 0;
  const formatPositions: [number, number][] = [];
  for (let i = 0; i <= 5; i += 1) formatPositions.push([8, i]);
  formatPositions.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i <= 14; i += 1) formatPositions.push([14 - i, 8]);
  formatPositions.forEach(([x, y], bit) => {
    if (at(x, y)) {
      format |= 1 << bit;
    }
  });
  format ^= 0x5412;
  const levelBits = (format >>> 13) & 3;
  const mask = (format >>> 10) & 7;
  const level = ({ 1: 'L', 0: 'M', 3: 'Q', 2: 'H' } as const)[levelBits as 0 | 1 | 2 | 3];

  const isFunction = functionModules(version);
  const bits: boolean[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunction[y]?.[x] !== true) {
          bits.push(at(x, y) !== (MASKS[mask]?.(x, y) ?? false));
        }
      }
    }
  }
  const raw = Math.floor(rawDataModules(version) / 8);
  const codewords: number[] = [];
  for (let i = 0; i < raw; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) {
      byte = (byte << 1) | (bits[i * 8 + b] === true ? 1 : 0);
    }
    codewords.push(byte);
  }

  // De-interleave into blocks of (data + ecc) and check every block's Reed-Solomon remainder.
  const numBlocks = BLOCKS_M[version] ?? 0;
  const eccLength = ECC_PER_BLOCK_M[version] ?? 0;
  const shortBlocks = numBlocks - (raw % numBlocks);
  const shortLength = Math.floor(raw / numBlocks);
  const blocks: number[][] = Array.from({ length: numBlocks }, () => []);
  let k = 0;
  for (let i = 0; i <= shortLength; i += 1) {
    for (let j = 0; j < numBlocks; j += 1) {
      if (i !== shortLength - eccLength || j >= shortBlocks) {
        blocks[j]?.push(codewords[k] ?? 0);
        k += 1;
      }
    }
  }
  let eccValid = true;
  const data: number[] = [];
  for (const block of blocks) {
    const body = block.slice(0, block.length - eccLength);
    const ecc = block.slice(block.length - eccLength);
    const expected = reedSolomonRemainder(body, eccLength);
    if (expected.some((value, index) => value !== ecc[index])) {
      eccValid = false;
    }
    data.push(...body);
  }

  // Byte-mode segment: 0100, 8 (versions 1-9) or 16 bits of length, then the bytes (UTF-8).
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_unused, b) => ((byte >>> (7 - b)) & 1) === 1));
  let cursor = 0;
  const take = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value = (value << 1) | (stream[cursor + i] === true ? 1 : 0);
    }
    cursor += count;
    return value;
  };
  if (take(4) !== 0b0100) {
    throw new Error('QR is not a byte-mode symbol');
  }
  const length = take(version <= 9 ? 8 : 16);
  const bytes = Uint8Array.from({ length }, () => take(8));
  return { version, level, mask, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), eccValid };
}
