/** Delayed spectator feed (v0.4): frames are only served once they are old enough; hidden cards never leak to the public view; streamer mode is gated. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { seededRng } from '../src/engine/rng.ts';
import * as api from '../src/platform/api.ts';
import { Runtime, SPECTATE_MIN_DELAY_MS, STREAM_MIN_DELAY_MS } from '../src/platform/runtime.ts';
import { DEMO_USERS } from '../src/platform/seed.ts';
import { Store } from '../src/platform/store.ts';
import { DomainError, ForbiddenError, type DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const MIN = 60_000;
const { player: PLAYER, newcomer: NEWCOMER } = DEMO_USERS;

let db: DB;
let time = NOW;
const realNow = api.clock.now;
beforeEach(() => {
  time = NOW;
  api.clock.now = () => time;
});
afterEach(() => {
  api.clock.now = realNow;
});

const makeRuntime = () => {
  const store = new Store({ now: NOW });
  db = store.db;
  return new Runtime(store, { rng: seededRng(5), botRng: seededRng(6) });
};
const run = (runtime: Runtime, ms: number, step = 1_000) => {
  for (let t = 0; t < ms; t += step) {
    time += step;
    runtime.tick();
  }
};

describe('delayed spectator feed', () => {
  it('serves nothing younger than the delay, then the newest frame that is old enough', () => {
    const runtime = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!;
    const live = runtime.getLive(running.id)!;
    const tableNo = live.tables.find((x) => !x.closed)!.no;
    run(runtime, 5_000);
    const early = runtime.spectate(PLAYER, running.id, tableNo, 30_000, 'public');
    assert.ok(early && early.waiting && early.view === null, 'nothing is 30 s old yet');
    run(runtime, 40_000);
    const frame = runtime.spectate(PLAYER, running.id, tableNo, 30_000, 'public')!;
    assert.equal(frame.waiting, false);
    assert.ok(frame.view);
    assert.ok(time - frame.at >= 30_000, 'the frame is at least the delay old');
    assert.equal(frame.delayMs, 30_000);
    // Asking for a shorter delay than the floor still gets the floor.
    assert.equal(runtime.spectate(PLAYER, running.id, tableNo, 1_000, 'public')!.delayMs, SPECTATE_MIN_DELAY_MS);
    // A longer delay picks an older frame.
    run(runtime, 2 * MIN);
    const far = runtime.spectate(PLAYER, running.id, tableNo, 2 * MIN, 'public')!;
    assert.ok(time - far.at >= 2 * MIN);
  });

  it('public frames carry no hidden cards; streamer frames carry them, gated by role and a one-minute floor', () => {
    const runtime = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!;
    const tableNo = runtime.getLive(running.id)!.tables.find((x) => !x.closed)!.no;
    const OWNER = db.clubs[running.clubId]!.ownerId;
    run(runtime, 90_000);
    const pub = runtime.spectate(PLAYER, running.id, tableNo, 30_000, 'public')!.view!;
    for (const s of pub.seats) if (s && s.inHand && !s.shown) assert.equal(s.cards, null, 'no cards for a live hand in the public view');
    assert.throws(() => runtime.spectate(PLAYER, running.id, tableNo, 60_000, 'streamer'), ForbiddenError, 'a player cannot stream');
    assert.throws(() => runtime.spectate(OWNER, running.id, tableNo, 30_000, 'streamer'), (e: unknown) => e instanceof DomainError && e.code === 'stream_delay');
    const stream = runtime.spectate(OWNER, running.id, tableNo, STREAM_MIN_DELAY_MS, 'streamer')!;
    assert.equal(stream.mode, 'streamer');
    assert.ok(time - stream.at >= STREAM_MIN_DELAY_MS);
    const inHand = stream.view!.seats.filter((s) => s && s.hasCards);
    assert.ok(inHand.length === 0 || inHand.every((s) => s!.cards && s!.cards.length > 0), 'streamer frames show every held hand');
    // Someone outside the club cannot watch a private tournament at all.
    if (running.visibility === 'private') assert.throws(() => runtime.spectate(NEWCOMER, running.id, tableNo, 30_000, 'public'), ForbiddenError);
  });

  it('keeps the buffer bounded', () => {
    const runtime = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!;
    const tableNo = runtime.getLive(running.id)!.tables.find((x) => !x.closed)!.no;
    run(runtime, 15 * MIN, 500);
    const list = runtime.feeds.get(`${running.id}:${tableNo}`)!;
    assert.ok(list.length > 0 && list.length <= 1200);
    assert.ok(list.slice(1).every((f) => time - f.at <= 10 * MIN + 1_000), 'beyond one anchor frame, nothing older than ten minutes is kept');
  });
});
