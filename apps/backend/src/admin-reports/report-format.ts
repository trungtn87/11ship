import { deflateRawSync } from 'node:zlib';

// The two export formats of the administration reports (M12-E), written by hand so nothing is added to the build: a CSV text and a minimal .xlsx (a zip of five XML parts).
// A cell is a number or a text. A TEXT that starts with = + - @ TAB or CR would be run as a formula by a spreadsheet, so it is written with a leading apostrophe
// (the OWASP rule); a number is written as a number and never as text. Control characters are removed from every text.

export type Cell = string | number | null;

export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
}

const FORMULA_START = /^[=+\-@\t\r]/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** The text a spreadsheet must show for `value`: no control characters, and never something it could run as a formula. */
export function safeText(value: string): string {
  const clean = value.replace(CONTROL, '');
  return FORMULA_START.test(clean) ? `'${clean}` : clean;
}

function csvCell(cell: Cell): string {
  if (cell === null) {
    return '';
  }
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? String(cell) : '';
  }
  const text = safeText(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 with a byte order mark (Excel opens Vietnamese text correctly) and CRLF line ends. */
export function buildCsv(rows: readonly (readonly Cell[])[]): Buffer {
  return Buffer.from(`﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8');
}

// ---- xlsx ---------------------------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const xml = (text: string): string => text.replace(CONTROL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows: readonly (readonly Cell[])[]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${columnName(c)}${String(r + 1)}`;
          if (cell === null) {
            return '';
          }
          if (typeof cell === 'number') {
            return Number.isFinite(cell) ? `<c r="${ref}"><v>${String(cell)}</v></c>` : '';
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(safeText(cell))}</t></is></c>`;
        })
        .join('');
      return `<row r="${String(r + 1)}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** The sheet name rules of Excel: at most 31 characters, none of : \ / ? * [ ]. */
const sheetName = (name: string): string => name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';

function zip(files: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export function buildXlsx(sheets: readonly Sheet[]): Buffer {
  const names = sheets.map((sheet, index) => `${sheetName(sheet.name)}${sheets.slice(0, index).some((other) => sheetName(other.name) === sheetName(sheet.name)) ? ` ${String(index + 1)}` : ''}`);
  const text = (value: string): Buffer => Buffer.from(value, 'utf8');
  const files = [
    {
      name: '[Content_Types].xml',
      data: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('')}</Types>`,
      ),
    },
    { name: '_rels/.rels', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    {
      name: 'xl/workbook.xml',
      data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('')}</sheets></workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join('')}</Relationships>`),
    },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${String(i + 1)}.xml`, data: text(sheetXml(sheet.rows)) })),
  ];
  return zip(files);
}
