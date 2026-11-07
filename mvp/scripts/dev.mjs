/**
 * Development server: rebuilds on change and serves dist/ on http://localhost:5173.
 *   node scripts/dev.mjs            watch + serve
 *   node scripts/dev.mjs --no-watch serve the last build only
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);
const watch = !process.argv.includes('--no-watch');
if (watch && !process.argv.includes('--dev')) process.argv.push('--dev');

let building = false;
let queued = false;
async function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  try {
    await build();
  } catch (err) {
    console.error(err.message || err);
  }
  building = false;
  if (queued) {
    queued = false;
    rebuild();
  }
}

await rebuild();
if (watch) {
  let timer = null;
  fs.watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  });
}

http
  .createServer((req, res) => {
    const file = path.join(root, 'dist', 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500).end('Build first: npm run build');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(data);
    });
  })
  .listen(port, () => console.log(`Poker Club OS → http://localhost:${port}`));
