/** Short weekday names, Sunday first, for club-local slots that are not tied to a specific date. */
import type { Lang } from '../platform/types.ts';

const names = (lang: Lang): string[] => {
  const fmt = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', timeZone: 'UTC' });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(Date.UTC(2026, 9, 4 + i)));
};

export const WEEKDAYS: Record<Lang, string[]> = { en: names('en'), he: names('he') };
