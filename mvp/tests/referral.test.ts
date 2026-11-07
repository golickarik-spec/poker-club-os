/** Personal referral links (v0.4): creation, attribution, the journey, recognition, and the limits that stay in place. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import * as crm from '../src/platform/crm.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { DomainError, type DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const { player: PLAYER, newcomer: NEWCOMER, owner: OWNER } = DEMO_USERS;
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

describe('referrals', () => {
  it('only approved members get a personal link; one per member and campaign', () => {
    assert.throws(() => crm.personalLink(db, NEWCOMER, MIDNIGHT), (e: unknown) => e instanceof DomainError && e.code === 'not_member');
    const a = crm.personalLink(db, PLAYER, MIDNIGHT);
    const b = crm.personalLink(db, PLAYER, MIDNIGHT);
    assert.equal(a.id, b.id, 'same link on repeat');
    assert.equal(a.referrerId, PLAYER);
    assert.equal(a.source, 'friend');
    assert.equal(a.createdBy, PLAYER);
    const c = crm.personalLink(db, PLAYER, MIDNIGHT, 'Autumn push');
    assert.notEqual(c.id, a.id);
    assert.equal(c.campaign, 'Autumn push');
    assert.ok(crm.linkUrl(a.token).includes(a.token));
  });

  it('the journey: open → request → approve, attributed to the referrer, without skipping approval', () => {
    const link = crm.personalLink(db, PLAYER, MIDNIGHT);
    // The referrer opening their own link is not a referral.
    const base = crm.myReferrals(db, PLAYER, MIDNIGHT).summary; // the demo seeds a few earlier referrals
    api.openInvite(db, PLAYER, crm.linkUrl(link.token));
    assert.equal(crm.myReferrals(db, PLAYER, MIDNIGHT).summary.opens, base.opens);

    const opened = api.openInvite(db, NEWCOMER, crm.linkUrl(link.token));
    assert.equal(opened.club.id, MIDNIGHT);
    assert.equal(crm.referrerFor(db, MIDNIGHT, NEWCOMER)?.id, PLAYER);
    let mine = crm.myReferrals(db, PLAYER, MIDNIGHT);
    assert.equal(mine.summary.opens, base.opens + 1);
    assert.equal(mine.people[0]!.status, 'opened');
    assert.equal(mine.people[0]!.name, '', 'invitee names are hidden until they are approved');
    assert.equal(api.canViewTournament(db, NEWCOMER, Object.values(db.tournaments).find((t) => t.clubId === MIDNIGHT && t.visibility === 'private')!), false, 'opening a link grants nothing');

    api.requestJoin(db, NEWCOMER, MIDNIGHT, 'link', { linkToken: link.token });
    mine = crm.myReferrals(db, PLAYER, MIDNIGHT);
    assert.equal(mine.people[0]!.status, 'requested');
    const report = crm.referralReport(db, OWNER, MIDNIGHT);
    assert.equal(report.summary.requested, base.requested + 1 + report.referrers.filter((r) => r.referrerId !== PLAYER).reduce((n, r) => n + r.requested, 0));
    assert.ok(report.referrers.some((r) => r.referrerId === PLAYER));
    assert.throws(() => crm.referralReport(db, NEWCOMER, MIDNIGHT), /permission/);

    api.approveMember(db, OWNER, MIDNIGHT, NEWCOMER);
    mine = crm.myReferrals(db, PLAYER, MIDNIGHT);
    assert.equal(mine.people[0]!.status, 'approved');
    assert.equal(mine.people[0]!.name, 'Daniel Levy');
    assert.equal(mine.summary.approved, base.approved + 1);
    assert.ok(api.approvedReferrals(db, MIDNIGHT, PLAYER).includes(NEWCOMER));
    assert.ok(db.achievements.some((a) => a.userId === PLAYER && a.key === 'referral_first' && a.source.clubId === MIDNIGHT), 'first referral milestone');
    assert.equal(db.achievements.some((a) => a.userId === PLAYER && a.key === 'referral_five'), base.approved + 1 >= 5);
  });

  it('first touch wins: a person already known to the club keeps their original source', () => {
    const link = crm.personalLink(db, PLAYER, MIDNIGHT);
    // Daniel is already in the Midnight CRM through a seeded source? Make sure by following first.
    api.followClub(db, NEWCOMER, MIDNIGHT);
    const before = db.crm.profiles[`${MIDNIGHT}:${NEWCOMER}`]!.source;
    api.openInvite(db, NEWCOMER, crm.linkUrl(link.token));
    const after = db.crm.profiles[`${MIDNIGHT}:${NEWCOMER}`]!;
    if (before !== 'unknown') assert.equal(after.source, before);
    else assert.equal(after.source, 'friend');
  });
});
