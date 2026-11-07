import type { Blinds } from '../engine/holdem.ts';
import type { Lang } from '../platform/types.ts';

const numberFormat = new Intl.NumberFormat('en-US');

/** Chip counts: full digits with separators, or compact (12.5K, 1.2M) for tight spaces. */
export function chips(n: number, compact = false): string {
  if (!compact || Math.abs(n) < 10_000) return numberFormat.format(Math.round(n));
  if (Math.abs(n) >= 1_000_000) return `${trim(n / 1_000_000, n >= 10_000_000 ? 1 : 2)}M`;
  return `${trim(n / 1_000, n >= 100_000 ? 0 : 1)}K`;
}

const trim = (x: number, digits: number): string => x.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');

export const num = (n: number): string => numberFormat.format(n);
export const bigBlinds = (stack: number, bb: number): string => (bb > 0 ? trim(stack / bb, stack / bb >= 100 ? 0 : 1) : '0');
export const percent = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)}%`;

export function blindsLabel(b: Pick<Blinds, 'sb' | 'bb' | 'ante'>, compact = true): string {
  const base = `${chips(b.sb, compact)}/${chips(b.bb, compact)}`;
  return b.ante > 0 ? `${base} (${chips(b.ante, compact)})` : base;
}

/** mm:ss, or h:mm:ss from an hour up. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function durationLabel(minutes: number, lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (lang === 'he') return h > 0 ? (m > 0 ? `${h} ש׳ ${m} ד׳` : `${h} ש׳`) : `${m} ד׳`;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const locale = (lang: Lang): string => (lang === 'he' ? 'he-IL' : 'en-GB');

export const timeOfDay = (ts: number, lang: Lang): string =>
  new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit', hour12: false }).format(ts);

export const dateShort = (ts: number, lang: Lang): string =>
  new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(ts);

export const dateLong = (ts: number, lang: Lang): string =>
  new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);

export const dateTime = (ts: number, lang: Lang): string =>
  new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(ts);

/** Date and time in a specific timezone (a club's), for moments defined in club time. */
export const dateTimeIn = (ts: number, lang: Lang, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(ts);
  } catch {
    return dateTime(ts, lang);
  }
};

export const weekday = (ts: number, lang: Lang): string => new Intl.DateTimeFormat(locale(lang), { weekday: 'short' }).format(ts);

export const monthLabel = (key: string, lang: Lang): string =>
  new Intl.DateTimeFormat(locale(lang), { month: 'short' }).format(new Date(`${key}-15T00:00:00Z`));

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** 0 = today, 1 = tomorrow, -1 = yesterday … in the viewer's local time. */
export const dayOffset = (ts: number, now: number): number => Math.round((startOfDay(ts) - startOfDay(now)) / 86_400_000);

export function relativeTime(ts: number, now: number, lang: Lang): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto', style: 'short' });
  if (abs < 45_000) return rtf.format(0, 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** Black or white ink, whichever reads better on the given background colour. */
export function readableInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#03110f';
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return luminance > 0.36 ? '#06100f' : '#ffffff';
}

export const ordinal = (n: number, lang: Lang): string => {
  if (lang === 'he') return `${n}`;
  const rule = new Intl.PluralRules('en', { type: 'ordinal' }).select(n);
  return `${n}${{ one: 'st', two: 'nd', few: 'rd', other: 'th', zero: 'th', many: 'th' }[rule]}`;
};

/** "2026-09" as "September 2026" in the reader's language. */
export function monthYear(period: string, lang: Lang): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Value for a `datetime-local` input, in the browser's own time zone. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}
