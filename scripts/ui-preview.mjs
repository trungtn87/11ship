#!/usr/bin/env node
// Opens the design preview of the phone/web UIs on this computer only.
//
//   node scripts/ui-preview.mjs [--open] [--no-build] [--port 8460] [--apps ui-foundation,food-web,ship-web]
//
// Builds the design bundles (apps/<app>/dist-design) and serves each on 127.0.0.1. The preview creates no session, calls no
// backend (CSP connect-src 'none') and shows only labelled sample data. Only GET/HEAD are served.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildClientWeb, CLIENT_APPS } from './client-web-build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function resolveFile(dist, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) {
    return undefined;
  }
  const relative = decoded === '/' ? 'design.html' : decoded.replace(/^\/+/, '');
  const full = normalize(join(dist, relative));
  if (full !== dist && !full.startsWith(dist + sep)) {
    return undefined;
  }
  return existsSync(full) && statSync(full).isFile() ? full : undefined;
}

export function makeServer(dist) {
  return createServer((req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolveFile(dist, req.url ?? '/');
    if (file === undefined) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Không tìm thấy');
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  });
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // The address is printed anyway.
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  const base = Number(option('--port') ?? 8460);
  const wanted = (option('--apps') ?? '').split(',').filter(Boolean);
  const candidates = [...CLIENT_APPS, 'admin-web'].filter((app) => existsSync(join(root, 'apps', app, 'public', 'design.html')) || app === 'admin-web');
  const apps = [];
  for (const app of candidates) {
    if (wanted.length > 0 && !wanted.includes(app)) continue;
    if (app === 'admin-web') {
      const mod = await import(pathToFileURL(join(root, 'scripts', 'admin-web-build.mjs')).href).catch(() => ({}));
      if (typeof mod.buildAdminWebDesign !== 'function') continue;
      apps.push({ app, build: () => mod.buildAdminWebDesign({ quiet: true }) });
    } else {
      apps.push({ app, build: () => buildClientWeb(app, { design: true, quiet: true }) });
    }
  }
  if (apps.length === 0) {
    console.error('Không có giao diện nào để xem.');
    process.exit(1);
  }
  const labels = { 'ui-foundation': 'Nền giao diện', 'food-web': '11Food', 'ship-web': '11Ship', 'admin-web': 'Web quản trị' };
  let port = base;
  const urls = [];
  for (const { app, build } of apps) {
    let dist = join(root, 'apps', app, 'dist-design');
    if (!args.includes('--no-build')) {
      dist = build().dist;
    }
    const server = makeServer(dist);
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolveListen);
    });
    urls.push(`http://127.0.0.1:${port}/`);
    console.log(`${labels[app] ?? app}: http://127.0.0.1:${port}/  (dữ liệu minh họa, không kết nối máy chủ)`);
    port += 1;
  }
  console.log('Nhấn Ctrl+C để dừng.');
  if (args.includes('--open')) urls.forEach(openBrowser);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
