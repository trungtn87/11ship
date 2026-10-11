// RFC 4648 Base32, upper case, no padding: the alphabet authenticator apps expect in an otpauth secret.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Strict decode of canonical unpadded Base32; undefined for any other text (including non-zero trailing bits). */
export function base32Decode(text: string): Buffer | undefined {
  if (typeof text !== 'string' || !/^[A-Z2-7]+$/.test(text)) {
    return undefined;
  }
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (value !== 0) {
    return undefined;
  }
  const decoded = Buffer.from(bytes);
  return base32Encode(decoded) === text ? decoded : undefined;
}
