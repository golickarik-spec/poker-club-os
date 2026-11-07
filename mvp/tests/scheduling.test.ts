/** Templates and recurring schedules (v0.4): club-local times across DST, idempotent publishing, limits. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import { tick } from '../src/platform/automation.ts';
import * as sch from '../src/platform/scheduling.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { DomainError, type DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0); // Sunday 11 Oct 2026 21:00 in Jerusalem (UTC+3)
const DAY = 86_400_000;
const { owner: OWNER, player: PLAYER } = DEMO_USERS;
const { midnight: MIDNIGHT } = CLUB_IDS;

let db: DB;
const realNow = api.clock.now;
beforeEach(() => {
  api.clock.now = () => NOW;
  db = createSeedDb(NOW);
});
afterEach(() => {
  api.clock.now = realNow;
});

const jerusalem = (ts: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(ts);
const anyDraft = () => api.draftOf(Object.values(db.tournaments).find((t) => t.clubId === MIDNIGHT && t.format === 'mtt')!);

describe('zoned time', () => {
  it('resolves wall-clock times in the club timezone on both sides of a DST change', () => {
    // Israel leaves DST on 25 Oct 2026 (UTC+3 → UTC+2).
    const before = sch.zonedTime(2026, 9, 20, 20, 0, 'Asia/Jerusalem');
    const after = sch.zonedTime(2026, 9, 27, 20, 0, 'Asia/Jerusalem');
    assert.equal(before, Date.UTC(2026, 9, 20, 17, 0));
    assert.equal(after, Date.UTC(2026, 9, 27, 18, 0));
    const occ = sch.occurrences({ weekdays: [2], hour: 20, minute: 30, timezone: 'Asia/Jerusalem' }, NOW, 21);
    assert.equal(occ.length, 3, 'three Tuesdays in three weeks');
    for (const ts of occ) {
      const p = jerusalem(ts);
      assert.equal(p.find((x) => x.type === 'weekday')!.value, 'Tue');
      assert.equal(`${p.find((x) => x.type === 'hour')!.value}:${p.find((x) => x.type === 'minute')!.value}`, '20:30', 'wall-clock time is kept across the DST change');
    }
  });
});

describe('templates and recurring schedules', () => {
  it('saves a template, starts a draft from it, and refuses deletion while a schedule uses it', () => {
    const seeded = sch.listTemplates(db, MIDNIGHT).length;
    const tpl = sch.saveTemplate(db, OWNER, MIDNIGHT, 'Thursday Deep', { ...anyDraft(), name: 'Thursday Deep Stack' });
    assert.equal(tpl.draft.startAt, 0);
    const d = sch.draftFromTemplate(db, MIDNIGHT, tpl.id, NOW)!;
    assert.equal(d.name, 'Thursday Deep Stack');
    assert.ok(d.startAt > NOW);
    assert.throws(() => sch.saveTemplate(db, PLAYER, MIDNIGHT, 'x', anyDraft()), /permission/);
    const s = sch.createSchedule(db, OWNER, MIDNIGHT, { name: 'Thursdays', templateId: tpl.id, weekdays: [4], hour: 20, minute: 0, leadDays: 7 });
    assert.equal(s.timezone, 'Asia/Jerusalem');
    assert.throws(() => sch.deleteTemplate(db, OWNER, MIDNIGHT, tpl.id), (e: unknown) => e instanceof DomainError && e.code === 'in_use');
    sch.deleteSchedule(db, OWNER, MIDNIGHT, s.id);
    sch.deleteTemplate(db, OWNER, MIDNIGHT, tpl.id);
    assert.equal(sch.listTemplates(db, MIDNIGHT).length, seeded);
  });

  it('publishes each occurrence once, inside the lead window, as a registration-open tournament of the schedule', () => {
    const tpl = sch.saveTemplate(db, OWNER, MIDNIGHT, 'Weekly', { ...anyDraft(), name: 'Weekly Turbo', simulateRegistrations: false });
    const s = sch.createSchedule(db, OWNER, MIDNIGHT, { name: 'Tue & Thu', templateId: tpl.id, weekdays: [2, 4], hour: 20, minute: 0, leadDays: 7 });
    const before = Object.keys(db.tournaments).length;
    assert.equal(sch.runSchedules(db, NOW), 2, 'Tuesday and Thursday of the coming week');
    assert.equal(sch.runSchedules(db, NOW), 0, 'idempotent');
    const made = sch.scheduleTournaments(db, s.id);
    assert.equal(made.length, 2);
    assert.ok(made.every((t) => t.status === 'REGISTRATION_OPEN' && t.name === 'Weekly Turbo' && t.scheduleId === s.id));
    assert.ok(made.every((t) => t.startAt > NOW && t.startAt <= NOW + 7 * DAY));
    assert.equal(Object.keys(db.tournaments).length, before + 2);
    // A week later the next pair appears; the tick does this on its own.
    tick(db, NOW + 7 * DAY);
    assert.equal(sch.scheduleTournaments(db, s.id).length, 4);
    // Paused schedules stop producing; deleting keeps what was published.
    sch.setScheduleEnabled(db, OWNER, MIDNIGHT, s.id, false);
    assert.equal(sch.runSchedules(db, NOW + 14 * DAY), 0);
    sch.deleteSchedule(db, OWNER, MIDNIGHT, s.id);
    assert.equal(sch.scheduleTournaments(db, s.id).length, 4);
  });

  it('validates schedules', () => {
    const tpl = sch.saveTemplate(db, OWNER, MIDNIGHT, 'Tpl', anyDraft());
    const base = { name: 'Weekly', templateId: tpl.id, weekdays: [1], hour: 20, minute: 0, leadDays: 7 };
    assert.throws(() => sch.createSchedule(db, OWNER, MIDNIGHT, { ...base, weekdays: [] }), (e: unknown) => e instanceof DomainError && e.code === 'no_weekdays');
    assert.throws(() => sch.createSchedule(db, OWNER, MIDNIGHT, { ...base, hour: 24 }), (e: unknown) => e instanceof DomainError && e.code === 'bad_time');
    assert.throws(() => sch.createSchedule(db, OWNER, MIDNIGHT, { ...base, templateId: 'nope' }), (e: unknown) => e instanceof DomainError && e.code === 'not_found');
    assert.equal(sch.createSchedule(db, OWNER, MIDNIGHT, { ...base, leadDays: 99 }).leadDays, 14);
  });
});
