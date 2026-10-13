// A minimal, strict ASN.1 DER reader: exactly what the Android key attestation extension and the X.509 extension lookup need.
// Definite lengths only (DER), minimal length encoding enforced, no indefinite form, bounded depth by the callers. It never
// allocates beyond the input buffer and every failure is a plain DerError (callers turn it into a uniform refusal).

export class DerError extends Error {}

export interface DerNode {
  /** The identifier octets as a number: class bits (2) | constructed (1) | tag number. Not the raw first byte. */
  readonly tagClass: 0 | 1 | 2 | 3;
  readonly constructed: boolean;
  readonly tagNumber: number;
  /** Content octets. */
  readonly content: Buffer;
  /** The whole TLV (identifier + length + content). */
  readonly raw: Buffer;
}

export const TAG_BOOLEAN = 1;
export const TAG_INTEGER = 2;
export const TAG_OCTET_STRING = 4;
export const TAG_OID = 6;
export const TAG_ENUMERATED = 10;
export const TAG_SEQUENCE = 16;
export const TAG_SET = 17;

/** Reads one TLV at the start of `buffer`; returns the node and the number of bytes consumed. */
export function readNode(buffer: Buffer, offset = 0): { node: DerNode; end: number } {
  let position = offset;
  const first = byteAt(buffer, position++);
  const tagClass = (first >> 6) as 0 | 1 | 2 | 3;
  const constructed = (first & 0x20) !== 0;
  let tagNumber = first & 0x1f;
  if (tagNumber === 0x1f) {
    tagNumber = 0;
    let count = 0;
    for (;;) {
      const next = byteAt(buffer, position++);
      if (count === 0 && next === 0x80) {
        throw new DerError('non-minimal tag');
      }
      tagNumber = tagNumber * 128 + (next & 0x7f);
      if (++count > 4 || tagNumber > 0x7fffffff) {
        throw new DerError('tag too large');
      }
      if ((next & 0x80) === 0) {
        break;
      }
    }
    if (tagNumber < 31) {
      throw new DerError('non-minimal tag');
    }
  }
  const lengthByte = byteAt(buffer, position++);
  let length: number;
  if (lengthByte < 0x80) {
    length = lengthByte;
  } else {
    const octets = lengthByte & 0x7f;
    if (octets === 0 || octets > 4) {
      throw new DerError('unsupported length');
    }
    length = 0;
    for (let i = 0; i < octets; i++) {
      length = length * 256 + byteAt(buffer, position++);
    }
    if (length < 0x80 || (octets > 1 && length < 256 ** (octets - 1))) {
      throw new DerError('non-minimal length');
    }
  }
  const end = position + length;
  if (end > buffer.length) {
    throw new DerError('truncated');
  }
  return {
    node: {
      tagClass,
      constructed,
      tagNumber,
      content: buffer.subarray(position, end),
      raw: buffer.subarray(offset, end),
    },
    end,
  };
}

function byteAt(buffer: Buffer, index: number): number {
  const value = buffer[index];
  if (value === undefined) {
    throw new DerError('truncated');
  }
  return value;
}

/** Parses `buffer` as exactly one TLV with nothing after it. */
export function parseOne(buffer: Buffer): DerNode {
  const { node, end } = readNode(buffer, 0);
  if (end !== buffer.length) {
    throw new DerError('trailing bytes');
  }
  return node;
}

/** The children of a constructed node (its content is a sequence of TLVs). */
export function children(node: DerNode): DerNode[] {
  if (!node.constructed) {
    throw new DerError('not constructed');
  }
  const result: DerNode[] = [];
  let offset = 0;
  while (offset < node.content.length) {
    const { node: child, end } = readNode(node.content, offset);
    result.push(child);
    offset = end;
  }
  return result;
}

export function isUniversal(node: DerNode, tagNumber: number): boolean {
  return node.tagClass === 0 && node.tagNumber === tagNumber;
}

export function expectUniversal(node: DerNode, tagNumber: number): DerNode {
  if (!isUniversal(node, tagNumber)) {
    throw new DerError('unexpected tag');
  }
  return node;
}

/** A non-negative INTEGER or ENUMERATED that fits in a safe integer. */
export function toSmallInteger(node: DerNode): number {
  if (!(isUniversal(node, TAG_INTEGER) || isUniversal(node, TAG_ENUMERATED)) || node.content.length === 0 || node.content.length > 6) {
    throw new DerError('bad integer');
  }
  const first = node.content[0];
  if (first === undefined || (first & 0x80) !== 0) {
    throw new DerError('negative integer');
  }
  let value = 0;
  for (const byte of node.content) {
    value = value * 256 + byte;
  }
  return value;
}

export function toBoolean(node: DerNode): boolean {
  expectUniversal(node, TAG_BOOLEAN);
  if (node.content.length !== 1) {
    throw new DerError('bad boolean');
  }
  const value = node.content[0];
  if (value !== 0x00 && value !== 0xff) {
    throw new DerError('bad boolean');
  }
  return value === 0xff;
}

export function toOctets(node: DerNode): Buffer {
  return expectUniversal(node, TAG_OCTET_STRING).content;
}

/** Dotted OID text. */
export function toOid(node: DerNode): string {
  expectUniversal(node, TAG_OID);
  const bytes = node.content;
  if (bytes.length === 0) {
    throw new DerError('empty oid');
  }
  const parts: number[] = [];
  let value = 0;
  let started = false;
  for (const byte of bytes) {
    value = value * 128 + (byte & 0x7f);
    started = true;
    if (value > Number.MAX_SAFE_INTEGER / 128) {
      throw new DerError('oid too large');
    }
    if ((byte & 0x80) === 0) {
      if (parts.length === 0) {
        const first = Math.min(Math.floor(value / 40), 2);
        parts.push(first, value - first * 40);
      } else {
        parts.push(value);
      }
      value = 0;
      started = false;
    }
  }
  if (started) {
    throw new DerError('truncated oid');
  }
  return parts.join('.');
}

/** The EXPLICIT [number] context wrapper of an AuthorizationList field, with its single inner node. */
export function explicitInner(node: DerNode): DerNode {
  if (node.tagClass !== 2 || !node.constructed) {
    throw new DerError('not explicit');
  }
  const inner = children(node);
  const only = inner[0];
  if (inner.length !== 1 || only === undefined) {
    throw new DerError('bad explicit');
  }
  return only;
}
