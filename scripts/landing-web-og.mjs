#!/usr/bin/env node
// Regenerates apps/landing-web/src/img/og-11.jpg (1200x630 share image) from the unmodified approved logo files and the
// Owner-supplied Ban Gioc photo. Needs Microsoft Edge or Chrome (EDGE_PATH overrides). Run only when the artwork changes.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'apps', 'landing-web', 'src', 'img');
const b64 = (p, t) => `data:${t};base64,${readFileSync(p).toString('base64')}`;
const photo = b64(join(src, 'hero-home.webp'), 'image/webp');
const logo = b64(join(root, 'apps', 'client-shared', 'public', 'brand', 'logo-11-ui.png'), 'image/png');
const logoFood = b64(join(root, 'apps', 'client-shared', 'public', 'brand', 'logo-11food-ui.png'), 'image/png');
const logoShip = b64(join(root, 'apps', 'client-shared', 'public', 'brand', 'logo-11ship-ui.png'), 'image/png');
const font = b64(join(root, 'apps', 'client-shared', 'public', 'fonts', 'PlusJakartaSans-wght.woff2'), 'font/woff2');
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:J;src:url(${font}) format('woff2');font-weight:200 800}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;font-family:J,sans-serif;background:url(${photo}) 70% center/cover;position:relative;overflow:hidden;color:#2A2A2E}
.p{position:absolute;inset:0;background:linear-gradient(90deg,#fff 0,#fff 44%,rgba(255,255,255,.0) 78%)}
.c{position:absolute;left:64px;top:56px;width:560px}
.c img.l{width:250px;display:block}h1{font-size:76px;font-weight:800;line-height:1.05;margin:18px 0 14px;letter-spacing:-.01em}
p{font-size:28px;font-weight:500;line-height:1.35;color:#55555b}.r{display:flex;gap:28px;align-items:center;margin-top:30px}.r img{height:64px;display:block}
.r span{font-size:22px;font-weight:700;color:#b88f0a}.b{position:absolute;left:0;right:0;bottom:0;height:12px;background:#D8AD18}</style>
<div class="p"></div><div class="c"><img class="l" src="${logo}"><h1>Cần là có.</h1><p>Đặt món và giao hàng tại Cao Bằng.</p>
<div class="r"><div><img src="${logoFood}"><span>Thèm là có</span></div><div><img src="${logoShip}"><span>Gọi là có</span></div></div></div><div class="b"></div>`;
const htmlPath = join(process.env.TEMP ?? '.', 'og-11.html');
writeFileSync(htmlPath, html);

const edge = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${join(process.env.TEMP ?? '.', 'og-prof')}`, 'about:blank'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const tab = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
await new Promise((r) => setTimeout(r, 1500));
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
writeFileSync(join(src, 'og-11.jpg'), Buffer.from(shot.result.data, 'base64'));
proc.kill();
console.log('wrote og-11.jpg');
process.exit(0);
