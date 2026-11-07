/**
 * Personal calendar (v0.4): everything with a date that concerns one person — tournaments
 * they can see from their clubs, the ones they hold a seat in, and league seasons — plus
 * their own reminders, which arrive as in-app notifications. Pure reads except `setReminder`
 * and the reminder tick.
 */
import { canViewTournament, registrationOf } from './api.ts';
import { clock, fail, newId, notify } from './core.ts';
import { visibleLeagues } from './competition.ts';
import { feedClubIds, tournamentsForUser } from './selectors.ts';
import type { VariantId } from '../engine/variants.ts';
import type { DB, PersonalReminder, Tournament } from './types.ts';

const MIN = 60_000;

export type CalendarKind = 'tournament' | 'league_start' | 'league_end';

export interface CalendarEvent {
  id: string;
  kind: CalendarKind;
  at: number;
  title: string;
  clubId: string;
  clubName: string;
  timezone: string;
  tournamentId?: string;
  leagueId?: string;
  game?: VariantId;
  /** The person holds a seat (registered) or a pending place (requested / waitlisted). */
  mine: 'registered' | 'pending' | null;
  status?: Tournament['status'];
  /** Minutes before the start the person asked to be reminded, if they did. */
  reminder: number | null;
}

export const REMINDER_OPTIONS = [60, 1440] as const;

/** Tournaments the person is registered for anywhere they may see, even outside the clubs in their feed. */
function myTournaments(db: DB, userId: string): Tournament[] {
  const feed = new Set(feedClubIds(db, userId));
  return Object.values(db.tournaments).filter((t) => !feed.has(t.clubId) && t.status !== 'DRAFT' && registrationOf(t, userId) && canViewTournament(db, userId, t));
}

export function eventsFor(db: DB, userId: string, from: number, to: number, opts: { onlyMine?: boolean } = {}): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const reminderOf = (tournamentId: string) => db.reminders.find((r) => r.userId === userId && r.tournamentId === tournamentId)?.minutesBefore ?? null;
  for (const t of [...tournamentsForUser(db, userId), ...myTournaments(db, userId)]) {
    if (t.status === 'CANCELLED') continue;
    const at = t.status === 'COMPLETED' ? (t.completedAt ?? t.startAt) : t.startAt;
    if (at < from || at >= to) continue;
    const reg = registrationOf(t, userId);
    const mine: CalendarEvent['mine'] = reg?.status === 'registered' ? 'registered' : reg && (reg.status === 'requested' || reg.status === 'waitlisted' || reg.status === 'approved') ? 'pending' : null;
    if (opts.onlyMine && !mine) continue;
    const club = db.clubs[t.clubId]!;
    out.push({ id: `t:${t.id}`, kind: 'tournament', at, title: t.name, clubId: t.clubId, clubName: club.name, timezone: t.timezone, tournamentId: t.id, game: t.game, mine, status: t.status, reminder: reminderOf(t.id) });
  }
  if (!opts.onlyMine) {
    for (const clubId of feedClubIds(db, userId)) {
      const club = db.clubs[clubId]!;
      for (const l of visibleLeagues(db, userId, clubId)) {
        if (l.status === 'archived') continue;
        for (const [kind, at] of [
          ['league_start', l.startAt],
          ['league_end', l.endAt],
        ] as const) {
          if (at < from || at >= to) continue;
          out.push({ id: `${kind}:${l.id}`, kind, at, title: l.name, clubId, clubName: club.name, timezone: club.timezone, leagueId: l.id, mine: null, reminder: null });
        }
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
}

/** Ask for (or remove, with `null`) a personal reminder before a tournament the person is registered for. */
export function setReminder(db: DB, userId: string, tournamentId: string, minutesBefore: number | null): PersonalReminder | null {
  const t = db.tournaments[tournamentId];
  if (!t) fail('not_found', 'This tournament no longer exists.');
  if (!canViewTournament(db, userId, t)) fail('forbidden', 'You cannot see this tournament.');
  const idx = db.reminders.findIndex((r) => r.userId === userId && r.tournamentId === tournamentId);
  if (minutesBefore === null) {
    if (idx >= 0) db.reminders.splice(idx, 1);
    return null;
  }
  if (!REMINDER_OPTIONS.includes(minutesBefore as (typeof REMINDER_OPTIONS)[number])) fail('reminder_window', 'Reminders are one hour or one day before the start.');
  if (t.startMode !== 'scheduled') fail('reminder_no_time', 'This tournament has no fixed start time.');
  if (t.status === 'COMPLETED' || t.status === 'CANCELLED' || t.status === 'RUNNING' || t.status === 'PAUSED') fail('reminder_started', 'This tournament has already started.');
  const reminder: PersonalReminder = { id: idx >= 0 ? db.reminders[idx]!.id : newId(db, 'rm'), userId, tournamentId, minutesBefore, startAt: t.startAt, sentAt: null };
  if (idx >= 0) db.reminders[idx] = reminder;
  else db.reminders.push(reminder);
  return reminder;
}

/** Sends due personal reminders as in-app notifications. Returns true when anything changed. */
export function runPersonalReminders(db: DB, now: number = clock.now()): boolean {
  let changed = false;
  for (const r of db.reminders) {
    if (r.sentAt !== null) continue;
    const t = db.tournaments[r.tournamentId];
    if (!t || t.status === 'CANCELLED' || t.status === 'COMPLETED') {
      r.sentAt = now; // nothing to remind about any more
      changed = true;
      continue;
    }
    if (t.startAt !== r.startAt) r.startAt = t.startAt; // follows a rescheduled start
    if (now < t.startAt - r.minutesBefore * MIN) continue;
    if (now < t.startAt) {
      const minutes = Math.max(1, Math.round((t.startAt - now) / MIN));
      notify(db, r.userId, 'reminder', 'notif.personal_reminder', { name: t.name, minutes }, { name: 'tournament', params: { id: t.id } }, { clubId: t.clubId, dedupeKey: `prm:${r.id}:${t.startAt}` });
    }
    r.sentAt = now;
    changed = true;
  }
  return changed;
}

// ----- Export ----------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const escapeIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** An iCalendar file of the given events, importable into any calendar app. Tournaments get a nominal two hours. */
export function toIcs(events: CalendarEvent[], now: number = clock.now()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Poker Club OS//Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@pokerclubos.example`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.at)}`);
    if (e.kind === 'tournament') lines.push(`DTEND:${stamp(e.at + 2 * 60 * MIN)}`);
    lines.push(`SUMMARY:${escapeIcs(e.kind === 'tournament' ? e.title : `${e.title} (${e.kind === 'league_start' ? 'season starts' : 'season ends'})`)}`, `DESCRIPTION:${escapeIcs(e.clubName)}`);
    if (e.tournamentId) lines.push(`URL:https://app.pokerclubos.example/#/tournament?id=${e.tournamentId}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
