import { describe, expect, it } from '@jest/globals';
import { inflateRawSync } from 'node:zlib';
import { buildCsv, buildXlsx, crc32, safeText } from './report-format';

/** Reads the entries of a zip written by buildXlsx (central directory, deflate), verifying every CRC: the file is a real archive, not just bytes that look like one. */
function unzip(buffer: Buffer): Map<string, string> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = inflateRawSync(buffer.subarray(start, start + compressed));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString('utf8'));
    offset += 46 + nameLength;
  }
  return out;
}

describe('M12-E report formats', () => {
  it('writes a text that a spreadsheet could run as a formula with a leading apostrophe, and nothing else', () => {
    for (const hostile of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1', '=HYPERLINK("http://x","y")']) {
      expect(safeText(hostile)).toBe(`'${hostile}`);
    }
    for (const fine of ['Quán A', '12', 'a=b', 'Hà Nội - Cầu Giấy', '']) {
      expect(safeText(fine)).toBe(fine);
    }
    expect(safeText('a\u0000b\u0007c')).toBe('abc');
  });

  it('CSV: BOM, CRLF, quoting, formulas neutralised in text but numbers left alone', () => {
    const csv = buildCsv([['Quán', 'Ghi chú', 'Số'], ['=cmd|calc', 'a, "b"', -5], [null, 'dòng\nmới', 1.5]]).toString('utf8');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.split('\r\n')).toEqual(['﻿Quán,Ghi chú,Số', `'=cmd|calc,"a, ""b""",-5`, ',"dòng\nmới",1.5', '']);
  });

  it('XLSX: a real archive with the five parts, numbers as numbers, text escaped and neutralised, sheet names valid and unique', () => {
    const file = buildXlsx([
      { name: 'Báo cáo: Giao hàng/Quán', rows: [['Mã', 'Phí'], ['=1+1', 12000], ['<b>&"x"', null]] },
      { name: 'Báo cáo: Giao hàng/Quán', rows: [['Điều kiện lọc'], ['Kỳ', '2026-10-01']] },
    ]);
    const parts = unzip(file);
    expect([...parts.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    const workbook = parts.get('xl/workbook.xml') as string;
    expect(workbook).toContain('name="Báo cáo  Giao hàng Quán"');
    expect(workbook).toContain('name="Báo cáo  Giao hàng Quán 2"');
    const sheet = parts.get('xl/worksheets/sheet1.xml') as string;
    expect(sheet).toContain('<c r="B2"><v>12000</v></c>');
    expect(sheet).toContain("'=1+1");
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('&lt;b&gt;&amp;&quot;x&quot;');
    expect(sheet).not.toContain('r="B3"');
  });
});
