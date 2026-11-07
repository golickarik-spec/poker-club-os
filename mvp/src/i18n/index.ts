/**
 * Localisation.
 *
 * Messages live in flat dictionaries keyed by dotted ids. English is the source
 * of truth; any key missing from another language falls back to English, and a
 * test checks that Hebrew covers every key. Adding a language means adding one
 * dictionary file and one entry in `LANGUAGES`.
 */
import type { Lang } from '../platform/types.ts';
import { en } from './en.ts';
import { he } from './he.ts';

export const LANGUAGES: { id: Lang; label: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'he', label: 'עברית', dir: 'rtl' },
];

const DICTIONARIES: Record<Lang, Record<string, string>> = { en, he };

export type Params = Record<string, string | number>;

export function hasMessage(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/**
 * In right-to-left text a left-to-right value ("River Kings", "+3%", "2 / 6") is reordered by the
 * characters around it. Wrapping it in a directional isolate keeps it intact. Plain integers and
 * values that are themselves Hebrew need no wrapping.
 */
function isolate(value: string | number): string {
  const text = String(value);
  if (/^\d+$/.test(text) || /[\u0590-\u05FF]/.test(text)) return text;
  return `\u2066${text}\u2069`;
}

export function translate(lang: Lang, key: string, params?: Params): string {
  const template = DICTIONARIES[lang][key] ?? en[key] ?? key;
  if (!params) return template;
  const rtl = lang === 'he';
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? (rtl ? isolate(params[name]!) : String(params[name])) : match));
}

/** Plural-aware lookup: uses `<key>_one` for exactly one, `<key>_other` otherwise. */
export function translateCount(lang: Lang, key: string, count: number, params?: Params): string {
  return translate(lang, `${key}_${count === 1 ? 'one' : 'other'}`, { count, ...params });
}

export const dirOf = (lang: Lang): 'ltr' | 'rtl' => (lang === 'he' ? 'rtl' : 'ltr');
