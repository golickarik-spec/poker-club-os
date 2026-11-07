/** Channel adapters (simulated external delivery, honest counts) and responsible-play breaks. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import { channelSummary, fanOut, registerAdapter } from '../src/platform/channels.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { DomainError, type DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const { player: PLAYER } = DEMO_USERS;
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

describe('notification channels', () => {
  it('external channels are simulated: recorded in the outbox, never counted as delivered', () => {
    api.updateSettings(db, PLAYER, { channels: { email: true, whatsapp: true } });
    const before = db.outbox.length;
    api.notify(db, PLAYER, 'announcement', 'notif.new_public_tournament', { club: 'X', name: 'Y' }, null, { clubId: MIDNIGHT });
    const mine = db.outbox.slice(before);
    assert.deepEqual(mine.map((m) => m.channel).sort(), ['email', 'whatsapp']);
    assert.ok(mine.every((m) => m.status === 'simulated' && m.simulatedBy === 'demo_adapter'));
    const s = channelSummary(db, MIDNIGHT);
    assert.equal(s.email.delivered, 0);
    assert.ok(s.email.simulated >= 1);
    assert.equal(s.email.real, false);
    assert.equal(s.in_app.real, true);
    // A bot inbox is never written, so nothing fans out for bots either.
    const bot = Object.values(db.users).find((u) => u.isBot)!;
    db.settings[bot.id] = { ...db.settings[PLAYER]!, channels: { sms: true } };
    const n = db.outbox.length;
    api.notify(db, bot.id, 'announcement', 'notif.new_public_tournament', { club: 'X', name: 'Y' });
    assert.equal(db.outbox.length, n);
  });

  it('a registered real adapter reports delivery and the summary reflects it', () => {
    registerAdapter({ id: 'push', real: true, send: () => 'delivered' });
    api.updateSettings(db, PLAYER, { channels: { push: true } });
    const out = fanOut(db, PLAYER, 'notif.approved', { club: 'X' }, MIDNIGHT);
    assert.equal(out[0]!.status, 'delivered');
    assert.equal(out[0]!.simulatedBy, null);
    assert.equal(channelSummary(db, MIDNIGHT).push.delivered, 1);
    registerAdapter({ id: 'push', real: false, send: () => 'simulated' }); // restore the demo adapter
  });
});

describe('responsible play', () => {
  it('a self-set break blocks registration until it ends, and can be ended early', () => {
    const t = Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT && x.status === 'REGISTRATION_OPEN' && x.access === 'members' && !x.accessCode && !x.registrations.some((r) => r.userId === PLAYER))!;
    api.setBreak(db, PLAYER, 7);
    assert.equal(api.onBreak(db, PLAYER), true);
    assert.throws(() => api.registerForTournament(db, PLAYER, t.id), (e: unknown) => e instanceof DomainError && e.code === 'on_break');
    assert.equal(api.onBreak(db, PLAYER, NOW + 8 * 86_400_000), false, 'the break expires on its own');
    api.setBreak(db, PLAYER, 0);
    assert.equal(api.onBreak(db, PLAYER), false);
    assert.ok(db.audit.some((a) => a.action === 'play.break_started' && a.actorId === PLAYER));
    assert.throws(() => api.setBreak(db, PLAYER, 400), (e: unknown) => e instanceof DomainError && e.code === 'bad_limit');
  });
});
