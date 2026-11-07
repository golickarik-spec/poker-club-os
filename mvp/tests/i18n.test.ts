import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { en } from '../src/i18n/en.ts';
import { he } from '../src/i18n/he.ts';
import { translate, translateCount } from '../src/i18n/index.ts';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

test('Hebrew has every English message, and no extras', () => {
  const missing = Object.keys(en).filter((k) => !(k in he));
  const extra = Object.keys(he).filter((k) => !(k in en));
  assert.deepEqual(missing, [], 'missing in he');
  assert.deepEqual(extra, [], 'only in he');
});

test('no message is empty, and translations keep the same placeholders', () => {
  for (const key of Object.keys(en)) {
    assert.ok(en[key]!.trim().length > 0, `empty en message ${key}`);
    assert.ok(he[key]!.trim().length > 0, `empty he message ${key}`);
    const a = placeholders(en[key]!);
    const b = placeholders(he[key]!);
    // A plural "one" form may spell the number out ("one member") instead of using {count}.
    const allowed = key.endsWith('_one') ? b.every((p) => a.includes(p)) : JSON.stringify([...new Set(a)]) === JSON.stringify([...new Set(b)]);
    assert.ok(allowed, `placeholders differ for ${key}: en {${a}} vs he {${b}}`);
  }
});

test('plural messages come in pairs', () => {
  for (const key of Object.keys(en)) {
    if (key.endsWith('_one')) assert.ok(`${key.slice(0, -4)}_other` in en, `${key} has no _other form`);
    if (key.endsWith('_other')) assert.ok(`${key.slice(0, -6)}_one` in en, `${key} has no _one form`);
  }
});

test('every message key used in the source exists', () => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
    }
  })(path.join(import.meta.dirname, '..', 'src'));
  const missing = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!(m[1]! in en)) missing.add(`${m[1]} (${path.basename(file)})`);
    for (const m of source.matchAll(/\bt\.n\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      if (!(`${m[1]}_one` in en) || !(`${m[1]}_other` in en)) missing.add(`${m[1]}_one/_other (${path.basename(file)})`);
    }
    for (const m of source.matchAll(/'((?:notif|err)\.[a-z_]+)'/g)) if (!(m[1]! in en)) missing.add(`${m[1]} (${path.basename(file)})`);
  }
  assert.deepEqual([...missing], []);
});

test('translate fills parameters, falls back to English and picks plural forms', () => {
  assert.equal(translate('en', 'tour.level_n', { n: 3 }), 'Level 3');
  assert.equal(translate('he', 'tour.level_n', { n: 3 }), 'שלב 3');
  assert.equal(translate('en', 'no.such.key'), 'no.such.key');
  assert.equal(translateCount('en', 'clubs.members', 1), '1 member');
  assert.equal(translateCount('en', 'clubs.members', 5), '5 members');
  assert.equal(translateCount('he', 'clubs.members', 5), '5 חברים');
});
