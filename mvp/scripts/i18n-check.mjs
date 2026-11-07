/**
 * Lists message keys used in the source and reports any that are missing from
 * the English or Hebrew dictionaries. Dynamic keys (template literals) are
 * printed so they can be checked by hand.
 *   node --import tsx scripts/i18n-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { en } = await import('../src/i18n/en.ts');
const { he } = await import('../src/i18n/he.ts');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !full.includes('/i18n/')) out.push(full);
  }
  return out;
}

const used = new Set();
const plural = new Set();
const dynamic = new Set();
for (const file of walk(path.join(root, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\.n\(\s*'([a-zA-Z0-9_.]+)'/g)) plural.add(m[1]);
  for (const m of src.matchAll(/key:\s*'([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'((?:notif|err)\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt(?:\.n)?\(\s*`([^`]+)`/g)) dynamic.add(`${path.relative(root, file)}: ${m[1]}`);
  for (const m of src.matchAll(/\b(?:translate|hasMessage)\([^,)]*,?\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
}
for (const p of plural) {
  used.add(`${p}_one`);
  used.add(`${p}_other`);
}
const missingEn = [...used].filter((k) => !(k in en)).sort();
const missingHe = Object.keys(en).filter((k) => !(k in he)).sort();
const extraHe = Object.keys(he).filter((k) => !(k in en)).sort();
console.log(`keys used (static): ${used.size}; in en: ${Object.keys(en).length}; in he: ${Object.keys(he).length}`);
if (process.argv.includes('--dynamic')) console.log('dynamic keys:\n  ' + [...dynamic].sort().join('\n  '));
console.log(`missing in en (${missingEn.length}):\n  ${missingEn.join('\n  ')}`);
if (process.argv.includes('--he')) console.log(`missing in he (${missingHe.length}):\n  ${missingHe.join('\n  ')}\nextra in he: ${extraHe.join(', ')}`);
process.exitCode = missingEn.length > 0 ? 1 : 0;
