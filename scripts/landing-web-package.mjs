#!/usr/bin/env node
// Builds the landing site (apps/landing-web/dist) and packs the static folder into landing-web-<7-char SHA>.zip at the repo root.
// The zip is a build output only: it is git-ignored and never committed.
//   npm run package:landing-web
import { execFileSync } from 'node:child_process';
import { crc32, deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps', 'landing-web', 'dist');

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = git(['rev-parse', '--short=7', 'HEAD']);
const dirty = git(['status', '--porcelain', '--', 'apps/landing-web', 'scripts/landing-web-build.mjs', 'scripts/landing-web-package.mjs']);
if (dirty) console.warn(`Cảnh báo: còn thay đổi chưa commit trong nguồn landing-web; zip ${sha} có thể khác commit.`);

execFileSync(process.execPath, [join(root, 'scripts', 'landing-web-build.mjs')], { stdio: 'inherit', cwd: root });

/** Lists every file under dir, relative to dir, with forward slashes. */
function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full).split(sep).join('/')];
  });
}

/** Minimal ZIP writer (deflate, UTF-8 names). DOS date/time = now. */
function zip(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const files = listFiles(dist);
if (!files.includes('index.html') || !files.includes('food/index.html') || !files.includes('ship/index.html') || !files.includes('ho-tro/index.html')) {
  throw new Error('Thư mục build thiếu trang chính (/, /food, /ship, /ho-tro)');
}
const entries = files.sort().map((name) => ({ name, data: readFileSync(join(dist, name)) }));
const out = join(root, `landing-web-${sha}.zip`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip(entries));
console.log(`Đã đóng gói ${entries.length} tệp vào ${out}`);
