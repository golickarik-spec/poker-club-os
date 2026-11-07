/** Personal calendar (v0.4): what appears, who may set reminders, when reminders fire, and the .ics export. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import * as cal from '../src/platform/calendar.ts';
import { tick } from '../src/platform/automation.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { DomainError, type DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const DAY = 86_400_000;
const { player: PLAYER, newcomer: NEWCOMER } = DEMO_USERS;

let db: DB;
const realNow = api.clock.now;
beforeEach(() => {
  api.clock.now = () => NOW;
  db = createSeedDb(NOW);
});
afterEach(() => {
  api.clock.now = realNow;
});

const upcomingFor = (userId: string) =>
  Object.values(db.tournaments).find((t) => t.status === 'REGISTRATION_OPEN' && t.access === 'members' && !t.accessCode && t.startMode === 'scheduled' && t.startAt > NOW + 2 * 60 * 60_000 && t.registrations.filter((r) => r.status === 'registered').length < t.maxPlayers && !t.registrations.some((r) => r.userId === userId))!;

describe('calendar', () => {
  it('lists visible tournaments and league seasons for the period, registered ones marked', () => {
    api.registerForTournament(db, PLAYER, upcomingFor(PLAYER).id);
    const all = cal.eventsFor(db, PLAYER, NOW - 30 * DAY, NOW + 60 * DAY);
    assert.ok(all.length > 5);
    assert.ok(all.every((e, i) => i === 0 || e.at >= all[i - 1]!.at), 'sorted by time');
    assert.ok(all.some((e) => e.kind === 'tournament' && e.mine === 'registered'), 'the seat just taken is marked');
    assert.ok(all.some((e) => e.kind === 'league_start' || e.kind === 'league_end'), 'league seasons appear');
    assert.ok(!all.some((e) => e.status === 'DRAFT' || e.status === 'CANCELLED'));
    const mine = cal.eventsFor(db, PLAYER, NOW - 30 * DAY, NOW + 60 * DAY, { onlyMine: true });
    assert.ok(mine.length > 0 && mine.every((e) => e.kind === 'tournament' && e.mine !== null));
  });

  it('a newcomer with no clubs sees nothing; following a club fills the calendar', () => {
    assert.equal(cal.eventsFor(db, NEWCOMER, NOW - 30 * DAY, NOW + 60 * DAY).length, 0);
    api.followClub(db, NEWCOMER, CLUB_IDS.midnight);
    assert.ok(cal.eventsFor(db, NEWCOMER, NOW - 30 * DAY, NOW + 60 * DAY).some((e) => e.clubId === CLUB_IDS.midnight));
  });

  it('reminders: one hour or one day before, only for a fixed start, delivered once as an in-app notification', () => {
    const t = upcomingFor(PLAYER);
    api.registerForTournament(db, PLAYER, t.id);
    assert.throws(() => cal.setReminder(db, PLAYER, t.id, 30), (e: unknown) => e instanceof DomainError && e.code === 'reminder_window');
    const r = cal.setReminder(db, PLAYER, t.id, 60)!;
    assert.equal(r.minutesBefore, 60);
    assert.equal(cal.setReminder(db, PLAYER, t.id, 1440)!.id, r.id, 'changing the window keeps one reminder');
    assert.equal(cal.eventsFor(db, PLAYER, NOW, NOW + 60 * DAY).find((e) => e.tournamentId === t.id)?.reminder, 1440);

    const before = db.notifications.filter((n) => n.userId === PLAYER && n.key === 'notif.personal_reminder').length;
    assert.equal(cal.runPersonalReminders(db, t.startAt - 2 * DAY), false, 'too early');
    assert.equal(cal.runPersonalReminders(db, t.startAt - 23 * 60 * 60_000), true);
    const sent = db.notifications.filter((n) => n.userId === PLAYER && n.key === 'notif.personal_reminder');
    assert.equal(sent.length, before + 1);
    assert.equal(sent.at(-1)!.params.name, t.name);
    assert.equal(sent.at(-1)!.link?.params?.id, t.id);
    assert.equal(cal.runPersonalReminders(db, t.startAt - 60_000), false, 'not sent twice');

    cal.setReminder(db, PLAYER, t.id, null);
    assert.equal(db.reminders.filter((x) => x.userId === PLAYER && x.tournamentId === t.id).length, 0);
  });

  it('the automation tick runs personal reminders too', () => {
    const t = upcomingFor(PLAYER);
    api.registerForTournament(db, PLAYER, t.id);
    cal.setReminder(db, PLAYER, t.id, 60);
    tick(db, t.startAt - 30 * 60_000);
    assert.ok(db.notifications.some((n) => n.userId === PLAYER && n.key === 'notif.personal_reminder' && n.params.name === t.name));
  });

  it('exports an iCalendar file with one VEVENT per event', () => {
    const events = cal.eventsFor(db, PLAYER, NOW, NOW + 30 * DAY);
    const ics = cal.toIcs(events, NOW);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, events.length);
    assert.ok(ics.includes(`SUMMARY:${events[0]!.title.replace(/,/g, '\\,')}`));
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  });
});
