/**
 * Build script: esbuild (TypeScript + React bundle) and Tailwind CSS v4 (via its
 * JavaScript API), producing a single self-contained HTML file.
 *
 *   dist/index.html     complete document — open it directly or host it anywhere
 *   dist/artifact.html  the same app as an embeddable fragment (no <html>/<head>)
 *
 * No network access is needed at build time.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
/**
 * Which design to build. `v3` (the default) is the current design; `v2` rebuilds the original
 * v0.2 appearance from the same source: its own tokens, stylesheet, shells, cards and table.
 * Features are shared between the two, so flipping this never loses functionality.
 */
export const DESIGN = (process.argv.find((a) => a.startsWith('--design='))?.slice(9) ?? process.env.PCOS_DESIGN ?? 'v3') === 'v2' ? 'v2' : 'v3';

const TITLE = 'Poker Club OS';
const FONT_LINKS = {
  v2: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..100,500..800&family=Fraunces:opsz,wght@9..144,400..600&family=Heebo:wght@400..700&family=Inter:opsz,wght@14..32,400..700&display=swap">',
  v3: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Fraunces:opsz,wght@9..144,400..600&family=Heebo:wght@400..800&family=Inter:opsz,wght@14..32,400..700&display=swap">',
};
const FONT_LINK = FONT_LINKS[DESIGN];
const STYLE_ENTRY = { v2: 'src/styles/app.css', v3: 'src/styles/app-v3.css' };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function buildCss() {
  const twRoot = path.dirname(require.resolve('tailwindcss/package.json'));
  const entry = path.join(root, STYLE_ENTRY[DESIGN]);
  const { build } = await compile(fs.readFileSync(entry, 'utf8'), {
    base: path.dirname(entry),
    loadStylesheet: async (id, base) => {
      let file = id === 'tailwindcss' ? path.join(twRoot, 'index.css') : id.startsWith('tailwindcss/') ? path.join(twRoot, id.slice(12)) : path.resolve(base, id);
      if (!file.endsWith('.css')) file += '.css';
      return { content: fs.readFileSync(file, 'utf8'), base: path.dirname(file), path: file };
    },
  });
  // Candidate class names: every whitespace/quote-delimited token in the sources. Unknown tokens are ignored by Tailwind.
  const candidates = new Set();
  for (const file of walk(path.join(root, 'src'))) {
    if (file.endsWith('.css')) continue;
    for (const token of fs.readFileSync(file, 'utf8').split(/[\s"'`]+/)) {
      if (token.length > 1 && token.length < 120) candidates.add(token);
    }
  }
  const css = build([...candidates]);
  const min = await esbuild.transform(css, { loader: 'css', minify: !dev, target: ['chrome111', 'safari16.4', 'firefox121'] });
  return min.code;
}

async function buildJs() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.tsx')],
    bundle: true,
    charset: 'utf8',
    write: false,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"', __DESIGN__: JSON.stringify(DESIGN) },
    logLevel: 'warning',
    metafile: true,
  });
  return { code: result.outputFiles[0].text, meta: result.metafile };
}

export async function build() {
  const started = Date.now();
  const [css, js] = await Promise.all([buildCss(), buildJs()]);
  const script = js.code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const body = `<div id="root"></div>\n<script>${script}</script>`;
  const fragment = `<title>${TITLE}</title>\n${FONT_LINK}\n<style>${css}</style>\n${body}\n`;
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${TITLE}</title>
${FONT_LINK}
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), page);
  fs.writeFileSync(path.join(root, 'dist/artifact.html'), fragment);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`built ${DESIGN} in ${Date.now() - started} ms — js ${kb(js.code.length)}, css ${kb(css.length)}, index.html ${kb(page.length)}`);
  return js.meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
