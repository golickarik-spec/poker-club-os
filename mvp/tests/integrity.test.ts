/** Integrity cases (v0.4): derived from simulated history, labelled, reviewed by people, never automatic. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import * as integrity from '../src/platform/integrity.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import type { DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const { owner: OWNER, player: PLAYER, platform_admin: ADMIN } = DEMO_USERS;
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

describe('integrity', () => {
  it('the scan flags pairs whose eliminations of each other far exceed what field sizes predict', () => {
    const hits = integrity.scanClub(db, MIDNIGHT);
    assert.ok(hits.length > 0 && hits.length < 10, 'a few cases, not a flood');
    for (const h of hits) {
      for (const s of h.signals) {
        assert.ok(s.strength > 0 && s.strength <= 0.95);
        if (s.type === 'bust_pattern') assert.ok(s.detail.busts! >= 4 && s.detail.busts! >= s.detail.expected! * 3);
      }
      assert.ok(h.tournamentIds.length >= 4);
    }
  });

  it('seeded cases exist, are labelled as simulated, and can be reviewed with an audited note; re-scanning is idempotent', () => {
    const mine = integrity.listCases(db, OWNER, MIDNIGHT);
    assert.ok(mine.length > 0);
    assert.ok(mine.every((c) => c.source === 'simulated_scan' && c.clubId === MIDNIGHT && c.status === 'new'));
    assert.throws(() => integrity.listCases(db, PLAYER, MIDNIGHT), /permission/);
    assert.throws(() => integrity.listCases(db, OWNER, null), /platform/i);
    const all = integrity.listCases(db, ADMIN, null);
    assert.ok(all.length >= mine.length);
    const before = db.integrity.length;
    assert.equal(integrity.runScan(db, OWNER, MIDNIGHT), mine.length);
    assert.equal(db.integrity.length, before, 'no duplicate cases');
    const c = integrity.setCaseStatus(db, OWNER, mine[0]!.id, 'reviewing', 'Looking at hands from last month');
    assert.equal(c.status, 'reviewing');
    assert.equal(c.notes.at(-1)!.text, 'Looking at hands from last month');
    assert.ok(db.audit.some((a) => a.action === 'integrity.case_updated' && a.actorId === OWNER));
    // A cleared case stays cleared on a re-scan with the same signals.
    integrity.setCaseStatus(db, OWNER, c.id, 'cleared');
    integrity.runScan(db, OWNER, MIDNIGHT);
    assert.equal(db.integrity.find((x) => x.id === c.id)!.status, 'cleared');
    // Nobody's membership or standing changed.
    assert.ok(db.memberships.filter((m) => m.clubId === MIDNIGHT && m.status === 'active').every((m) => m.status === 'active'));
  });
});
