/** Retention engine (v0.4): inactivity buckets and their segments, staff alerts, derived preferences, heatmap recommendations, weekly report. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import { tick } from '../src/platform/automation.ts';
import * as crm from '../src/platform/crm.ts';
import * as ret from '../src/platform/retention.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import type { DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const DAY = 86_400_000;
const { owner: OWNER, player: PLAYER, newcomer: NEWCOMER } = DEMO_USERS;
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

describe('retention', () => {
  it('inactivity alerts split members into 7 / 14 / 30-day buckets that match the built-in segments exactly', () => {
    const alerts = ret.inactivityAlerts(db, OWNER, MIDNIGHT, NOW);
    assert.deepEqual(alerts.map((a) => a.days), [7, 14, 30]);
    const all = alerts.flatMap((a) => a.userIds);
    assert.equal(new Set(all).size, all.length, 'nobody is in two buckets');
    assert.ok(alerts[2]!.userIds.length > 0, 'a seeded club has long-inactive members');
    for (const a of alerts) {
      assert.ok(a.segmentId, `segment for ${a.days}`);
      const seg = crm.resolveSegment(db, MIDNIGHT, a.segmentId!);
      assert.deepEqual([...seg].sort(), [...a.userIds].sort(), `segment ${a.days} holds exactly the alert's people`);
    }
    assert.throws(() => ret.inactivityAlerts(db, NEWCOMER, MIDNIGHT, NOW), /permission/);
  });

  it('staff get one in-app alert per day when someone crosses a bucket', () => {
    const before = db.notifications.filter((n) => n.userId === OWNER && n.key === 'notif.inactivity_alert').length;
    // Advance day by day until a crossing happens; each day sends at most one alert per staff member.
    let sent = 0;
    for (let d = 1; d <= 10; d++) {
      tick(db, NOW + d * DAY);
      const now = db.notifications.filter((n) => n.userId === OWNER && n.key === 'notif.inactivity_alert').length - before;
      assert.ok(now - sent <= 1, 'at most one per day');
      sent = now;
    }
    assert.ok(sent >= 1, 'over ten days someone crosses 7, 14 or 30 days');
    const n = db.notifications.find((x) => x.userId === OWNER && x.key === 'notif.inactivity_alert')!;
    assert.equal(n.link?.name, 'console.crm');
    assert.ok(!db.notifications.some((x) => x.userId === PLAYER && x.key === 'notif.inactivity_alert'), 'players are not told');
  });

  it('new system segments: game family, league participation, referred members', () => {
    const seg = (key: string) => db.crm.segments.find((s) => s.clubId === MIDNIGHT && s.system === key)!;
    const holdem = crm.resolveSegment(db, MIDNIGHT, seg('holdem_players').id);
    const omaha = crm.resolveSegment(db, MIDNIGHT, seg('omaha_players').id);
    assert.ok(holdem.length > omaha.length && omaha.length > 0);
    const league = crm.resolveSegment(db, MIDNIGHT, seg('league_players').id);
    assert.ok(league.length > 0);
    const referred = crm.resolveSegment(db, MIDNIGHT, seg('referred_members').id);
    assert.ok(referred.length > 0);
    assert.ok(referred.every((id) => crm.referrerFor(db, MIDNIGHT, id) !== null));
    const vip = crm.resolveSegment(db, MIDNIGHT, seg('vip').id);
    assert.ok(vip.length > 0 && vip.length < holdem.length);
  });

  it('derived preferences describe how a person actually plays', () => {
    const p = ret.playerPreferences(db, OWNER, MIDNIGHT, PLAYER);
    assert.ok(p.tournaments > 0);
    assert.ok(p.family === 'holdem' || p.family === 'omaha');
    assert.ok(p.familyShare > 0 && p.familyShare <= 1);
    assert.ok(p.weekday !== null && p.weekday >= 0 && p.weekday <= 6);
    assert.ok(p.hour !== null && p.hour >= 0 && p.hour < 24);
    const empty = ret.playerPreferences(db, OWNER, MIDNIGHT, NEWCOMER);
    assert.equal(empty.tournaments, 0);
    assert.equal(empty.family, null);
  });

  it('heatmap recommends slots with at least two tournaments, best average field first, with the next occurrence in club time', () => {
    const h = ret.activityHeatmap(db, OWNER, MIDNIGHT, 120, NOW);
    assert.equal(h.avgEntrants.length, 7);
    assert.ok(h.avgEntrants.every((r) => r.length === 24));
    assert.ok(h.sample > 10);
    assert.ok(h.recommendations.length >= 1 && h.recommendations.length <= 3);
    for (const r of h.recommendations) {
      assert.ok(r.tournaments >= 2);
      assert.ok(r.nextAt > NOW && r.nextAt <= NOW + 8 * DAY);
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(r.nextAt);
      assert.equal(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.weekday], parts.find((p) => p.type === 'weekday')!.value);
      assert.equal(Number(parts.find((p) => p.type === 'hour')!.value) % 24, r.hour);
      assert.equal(parts.find((p) => p.type === 'minute')!.value, '00');
    }
    assert.ok(h.recommendations.every((r, i) => i === 0 || r.avgEntrants <= h.recommendations[i - 1]!.avgEntrants));
    assert.equal(h.recommendations[0]!.score, 1);
  });

  it('weekly report counts the week and compares with the one before', () => {
    const r = ret.weeklyReport(db, OWNER, MIDNIGHT, NOW - 7 * DAY);
    assert.equal(r.to - r.from, 7 * DAY);
    assert.equal(new Date(r.from).getUTCDay(), 1, 'weeks start on Monday');
    assert.ok(r.tournaments > 0 && r.entries >= r.tournaments);
    assert.ok(r.uniquePlayers <= r.entries);
    assert.equal(r.firstTimers + r.returning, r.uniquePlayers);
    assert.ok(r.topPlayers.length <= 5 && r.topPlayers.every((p) => !db.users[p.userId]!.isBot));
    assert.deepEqual(r.inactive.map((x) => x.days), [7, 14, 30]);
    assert.ok(r.busiest && r.busiest.entrants > 0);
  });
});
