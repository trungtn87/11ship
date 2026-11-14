// Builds the static site into ./dist (no dependencies, Node 20+). Settings: site.config.json. Content: src/pages.mjs.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages, PUBLISH, SITE } from './src/pages.mjs';

/** Manual recursive copy (fs.cpSync can crash Node 24 on Windows). */
function copy(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from)) copy(join(from, e), join(to, e));
  } else {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copy(join(root, 'assets'), dist, { recursive: true });
copy(join(root, 'src', 'site.css'), join(dist, 'site.css'));
copy(join(root, 'src', 'img'), join(dist, 'img'), { recursive: true });
for (const [path, html] of Object.entries(pages)) {
  const dir = path === '/' ? dist : join(dist, path.replace(/^\//, ''));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}
writeFileSync(join(dist, 'robots.txt'), PUBLISH ? `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
if (PUBLISH) {
  const urls = Object.keys(pages).map((r) => `  <url><loc>${SITE}${r}</loc></url>`).join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}
console.log(`Đã build ${Object.keys(pages).length} trang vào ${dist}`);
