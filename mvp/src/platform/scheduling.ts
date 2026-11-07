/**
 * Templates and recurring schedules (v0.4). A template is a saved tournament draft; a recurring
 * schedule publishes a tournament from a template on chosen weekdays at a club-local time, a
 * few days ahead, every time the housekeeping tick runs. Times are resolved in the club's
 * timezone day by day, so daylight-saving changes keep the wall-clock time.
 */
import { createTournament, draftOf, publishTournament, type TournamentDraft } from './api.ts';
import { audit, clock, DAY, fail, newId } from './core.ts';
import { requirePermission } from './permissions.ts';
import type { DB, RecurringSchedule, TournamentTemplate } from './types.ts';

// ----- Timezone arithmetic ------------------------------------------------------------------------

function offsetMinutes(ts: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    return Math.round((asUtc - Math.floor(ts / 60_000) * 60_000) / 60_000);
  } catch {
    return 0;
  }
}

/** The instant that is `y-m-d h:min` on the wall clock of `timeZone`. */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m, d, h, min);
  let ts = guess - offsetMinutes(guess, timeZone) * 60_000;
  ts = guess - offsetMinutes(ts, timeZone) * 60_000; // second pass settles DST edges
  return ts;
}

function localDate(ts: number, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return { y: Number(get('year')), m: Number(get('month')) - 1, d: Number(get('day')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
  } catch {
    const x = new Date(ts);
    return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), weekday: x.getUTCDay() };
  }
}

/** Start times of the schedule from `from` over the next `days` days, in order. */
export function occurrences(s: Pick<RecurringSchedule, 'weekdays' | 'hour' | 'minute' | 'timezone'>, from: number, days: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= days; i++) {
    const day = localDate(from + i * DAY, s.timezone);
    if (!s.weekdays.includes(day.weekday)) continue;
    const ts = zonedTime(day.y, day.m, day.d, s.hour, s.minute, s.timezone);
    if (ts > from) out.push(ts);
  }
  return out;
}

// ----- Templates ---------------------------------------------------------------------------------

export function listTemplates(db: DB, clubId: string): TournamentTemplate[] {
  return db.templates.filter((x) => x.clubId === clubId).sort((a, b) => a.name.localeCompare(b.name));
}

export function saveTemplate(db: DB, actorId: string, clubId: string, name: string, draft: TournamentDraft, existingId?: string): TournamentTemplate {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const clean = name.trim().slice(0, 60);
  if (clean.length < 2) fail('bad_name', 'Give the template a name.');
  const now = clock.now();
  const body: TournamentDraft = { ...draft, registrationOpensAt: 0, startAt: 0 };
  const existing = existingId ? db.templates.find((x) => x.id === existingId && x.clubId === clubId) : undefined;
  if (existing) {
    existing.name = clean;
    existing.draft = body;
    existing.updatedAt = now;
    audit(db, actorId, clubId, 'template.saved', { name: clean });
    return existing;
  }
  if (listTemplates(db, clubId).length >= 20) fail('too_many', 'A club keeps up to 20 templates.');
  const tpl: TournamentTemplate = { id: newId(db, 'tpl'), clubId, name: clean, draft: body, createdBy: actorId, createdAt: now, updatedAt: now };
  db.templates.push(tpl);
  audit(db, actorId, clubId, 'template.saved', { name: clean });
  return tpl;
}

export function deleteTemplate(db: DB, actorId: string, clubId: string, id: string): void {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const i = db.templates.findIndex((x) => x.id === id && x.clubId === clubId);
  if (i < 0) fail('not_found', 'Template not found.');
  if (db.schedules.some((s) => s.templateId === id)) fail('in_use', 'A recurring schedule uses this template. Stop the schedule first.');
  const [tpl] = db.templates.splice(i, 1);
  audit(db, actorId, clubId, 'template.deleted', { name: tpl!.name });
}

/** A draft for the wizard, from a template, with the next sensible start. */
export function draftFromTemplate(db: DB, clubId: string, templateId: string, now: number = clock.now()): TournamentDraft | null {
  const tpl = db.templates.find((x) => x.id === templateId && x.clubId === clubId);
  if (!tpl) return null;
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  return { ...structuredClone(tpl.draft), startAt: d.getTime(), registrationOpensAt: now };
}

// ----- Recurring schedules -------------------------------------------------------------------------

export interface ScheduleInput {
  name: string;
  templateId: string;
  weekdays: number[];
  hour: number;
  minute: number;
  /** Publish each occurrence this many days before it starts (1–14). */
  leadDays: number;
}

export function listSchedules(db: DB, clubId: string): RecurringSchedule[] {
  return db.schedules.filter((s) => s.clubId === clubId).sort((a, b) => a.name.localeCompare(b.name));
}

function validate(db: DB, clubId: string, input: ScheduleInput): ScheduleInput {
  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) fail('bad_name', 'Give the schedule a name.');
  if (!db.templates.some((x) => x.id === input.templateId && x.clubId === clubId)) fail('not_found', 'Template not found.');
  const weekdays = [...new Set(input.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (weekdays.length === 0) fail('no_weekdays', 'Choose at least one weekday.');
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23 || !Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) fail('bad_time', 'Choose a valid time.');
  const leadDays = Math.min(14, Math.max(1, Math.round(input.leadDays)));
  return { name, templateId: input.templateId, weekdays, hour: input.hour, minute: input.minute, leadDays };
}

export function createSchedule(db: DB, actorId: string, clubId: string, input: ScheduleInput): RecurringSchedule {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  if (listSchedules(db, clubId).length >= 10) fail('too_many', 'A club keeps up to 10 recurring schedules.');
  const v = validate(db, clubId, input);
  const now = clock.now();
  const s: RecurringSchedule = { id: newId(db, 'rs'), clubId, ...v, timezone: db.clubs[clubId]!.timezone, enabled: true, createdBy: actorId, createdAt: now, lastRunAt: null };
  db.schedules.push(s);
  audit(db, actorId, clubId, 'schedule.created', { name: s.name });
  return s;
}

export function updateSchedule(db: DB, actorId: string, clubId: string, id: string, input: ScheduleInput): RecurringSchedule {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const s = db.schedules.find((x) => x.id === id && x.clubId === clubId);
  if (!s) return fail('not_found', 'Schedule not found.');
  Object.assign(s, validate(db, clubId, input));
  audit(db, actorId, clubId, 'schedule.updated', { name: s.name });
  return s;
}

export function setScheduleEnabled(db: DB, actorId: string, clubId: string, id: string, enabled: boolean): void {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const s = db.schedules.find((x) => x.id === id && x.clubId === clubId);
  if (!s) fail('not_found', 'Schedule not found.');
  s!.enabled = enabled;
  audit(db, actorId, clubId, enabled ? 'schedule.resumed' : 'schedule.paused', { name: s!.name });
}

/** Removes the schedule. Tournaments it already published stay as they are. */
export function deleteSchedule(db: DB, actorId: string, clubId: string, id: string): void {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const i = db.schedules.findIndex((x) => x.id === id && x.clubId === clubId);
  if (i < 0) fail('not_found', 'Schedule not found.');
  const [s] = db.schedules.splice(i, 1);
  audit(db, actorId, clubId, 'schedule.deleted', { name: s!.name });
}

/** Tournaments a schedule has published, upcoming first. */
export function scheduleTournaments(db: DB, scheduleId: string) {
  return Object.values(db.tournaments)
    .filter((t) => t.scheduleId === scheduleId)
    .sort((a, b) => a.startAt - b.startAt);
}

/**
 * Housekeeping: publish the occurrences that fall inside each schedule's lead window and do not
 * exist yet. Idempotent — an occurrence is identified by schedule and start time.
 */
export function runSchedules(db: DB, now: number = clock.now()): number {
  let made = 0;
  for (const s of db.schedules) {
    if (!s.enabled) continue;
    const club = db.clubs[s.clubId];
    const tpl = db.templates.find((x) => x.id === s.templateId);
    if (!club || club.status !== 'active' || !tpl) continue;
    const have = new Set(Object.values(db.tournaments).filter((t) => t.scheduleId === s.id).map((t) => t.startAt));
    for (const at of occurrences(s, now, s.leadDays)) {
      if (have.has(at) || at - now > s.leadDays * DAY) continue;
      const draft: TournamentDraft = { ...structuredClone(tpl.draft), startMode: 'scheduled', startAt: at, registrationOpensAt: now, timezone: s.timezone };
      try {
        const t = createTournament(db, s.createdBy, s.clubId, draft);
        t.scheduleId = s.id;
        publishTournament(db, s.createdBy, t.id, { announce: false });
        s.lastRunAt = now;
        made++;
      } catch {
        // The creator may have lost permission or the club hit a limit; the schedule simply waits.
        break;
      }
    }
  }
  return made;
}

/** Keeps `draftOf` reachable for callers that build a template from an existing tournament. */
export const templateDraftOf = draftOf;
