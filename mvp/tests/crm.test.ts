/**
 * Tests for the CRM, community and analytics layer. The numbered tests follow
 * the list in the CRM brief (membership and authorization 1–8, CRM 9–17,
 * analytics 18–26). They exercise the service layer directly, which is where
 * every rule is enforced.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { seededRng } from '../src/engine/rng.ts';
import { presetStructure } from '../src/engine/structure.ts';
import * as analytics from '../src/platform/analytics.ts';
import { compute } from '../src/platform/analytics.ts';
import * as api from '../src/platform/api.ts';
import * as automation from '../src/platform/automation.ts';
import { logEvent } from '../src/platform/core.ts';
import * as crm from '../src/platform/crm.ts';
import * as messaging from '../src/platform/messaging.ts';
import { can, membershipOf, ROLE_PERMISSIONS } from '../src/platform/permissions.ts';
import { Runtime } from '../src/platform/runtime.ts';
import { CAST, CLUB_IDS, createSeedDb, DEFAULT_SETTINGS, DEMO_USERS } from '../src/platform/seed.ts';
import { registrationState } from '../src/platform/selectors.ts';
import { Store } from '../src/platform/store.ts';
import { DomainError, ForbiddenError, type DB, type Tournament, type TournamentResult, type User } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DANIEL: string = DEMO_USERS.newcomer;
const ALEX: string = DEMO_USERS.player;
const MICHAEL: string = DEMO_USERS.owner;
const DANA: string = DEMO_USERS.other_owner;
const MAYA: string = DEMO_USERS.tournament_manager;
const ADMIN: string = DEMO_USERS.platform_admin;
const MIDNIGHT: string = CLUB_IDS.midnight;
const RIVER: string = CLUB_IDS.river;
const FINAL: string = CLUB_IDS.final;

let db: DB;
let time = NOW;
const realNow = api.clock.now;

beforeEach(() => {
  time = NOW;
  api.clock.now = () => time;
  db = createSeedDb(NOW);
});
afterEach(() => {
  api.clock.now = realNow;
});

const forbidden = (fn: () => unknown, what = '') => assert.throws(fn, (e: unknown) => e instanceof ForbiddenError, `expected ForbiddenError ${what}`);
const domain = (code: string, fn: () => unknown) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code, `expected DomainError ${code}`);

const draft = (over: Partial<api.TournamentDraft> = {}): api.TournamentDraft => ({
  name: 'Sunday Championship',
  description: 'A private club tournament',
  banner: 'gilded',
  format: 'mtt',
  preset: 'regular',
  startMode: 'scheduled',
  startAt: time + 30 * MIN,
  timezone: 'Asia/Jerusalem',
  registrationOpensAt: time - MIN,
  minPlayers: 2,
  maxPlayers: 100,
  structure: presetStructure('regular'),
  visibility: 'private',
  access: 'members',
  accessCode: null,
  entryPoints: 0,
  simulateRegistrations: false,
  simulatedFill: 0,
  demoSpeed: 1,
  ...over,
});

const publish = (over: Partial<api.TournamentDraft> = {}, clubId = MIDNIGHT, actor = MICHAEL): Tournament => {
  const t = api.createTournament(db, actor, clubId, draft(over));
  api.publishTournament(db, actor, t.id);
  return t;
};

const members = (clubId: string, n: number, skip = 0): string[] =>
  db.memberships
    .filter((m) => m.clubId === clubId && m.status === 'active' && db.users[m.userId]!.isBot && m.role === 'player' && m.userId !== CAST.sarah && m.userId !== CAST.jonathan)
    .slice(skip, skip + n)
    .map((m) => m.userId);

const staffWith = (clubId: string, role: string): string => db.memberships.find((m) => m.clubId === clubId && m.status === 'active' && m.role === role)!.userId;
const tagId = (clubId: string, name: string): string => db.crm.tags.find((t) => t.clubId === clubId && t.name === name)!.id;
const notificationsOf = (userId: string, key?: string) => db.notifications.filter((n) => n.userId === userId && (!key || n.key === key));

/** Join an approval club and get approved. */
const approve = (userId: string, clubId = MIDNIGHT, actor = MICHAEL) => {
  api.requestJoin(db, userId, clubId, 'profile');
  api.approveMember(db, actor, clubId, userId);
};

const makeRuntime = () => {
  const store = new Store({ now: NOW });
  db = store.db;
  const runtime = new Runtime(store, { rng: seededRng(5), botRng: seededRng(6) });
  return { store, runtime };
};
const run = (runtime: Runtime, ms: number, step = 1_000) => {
  for (let t = 0; t < ms; t += step) {
    time += step;
    runtime.tick();
  }
};

// =============================================================================
// Membership and authorization
// =============================================================================

describe('membership and authorization', () => {
  it('1. unapproved players cannot enter private tournaments', () => {
    const t = publish();
    // No relationship with the club at all.
    assert.equal(api.canViewTournament(db, DANIEL, t), false, 'the lobby is not visible');
    assert.equal(api.canWatchTournament(db, DANIEL, t), false);
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id));
    assert.equal(registrationState(db, t, DANIEL, false), 'not_member');
    // A request that is still pending changes nothing.
    api.requestJoin(db, DANIEL, MIDNIGHT, 'profile');
    assert.equal(membershipOf(db, DANIEL, MIDNIGHT)!.status, 'pending');
    assert.equal(api.canViewTournament(db, DANIEL, t), false);
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id));
    // A rejected request changes nothing either.
    api.rejectMember(db, MICHAEL, MIDNIGHT, DANIEL);
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id));
    assert.equal(api.registeredCount(t), 0);
    // Once approved, the same call succeeds.
    approve(DANIEL);
    assert.equal(api.canViewTournament(db, DANIEL, t), true);
    assert.equal(api.registerForTournament(db, DANIEL, t.id).status, 'registered');
  });

  it('1b. an approved member still needs tournament-specific authorisation when the tournament asks for it', () => {
    const byApproval = publish({ access: 'approval' });
    assert.equal(api.registerForTournament(db, ALEX, byApproval.id).status, 'requested', 'a request, not a seat');
    assert.equal(api.registeredCount(byApproval), 0);
    api.rejectRegistration(db, MICHAEL, byApproval.id, ALEX);
    assert.equal(api.registrationOf(byApproval, ALEX)!.status, 'rejected');

    const invitation = publish({ name: 'Invitation Night', access: 'invite' });
    domain('invite_only', () => api.registerForTournament(db, ALEX, invitation.id));
    assert.equal(api.canViewTournament(db, ALEX, invitation), false, 'members who are not invited do not even see it');
    assert.equal(registrationState(db, invitation, ALEX, false), 'invite_only');
    api.authorizePlayer(db, MICHAEL, invitation.id, ALEX);
    assert.equal(api.canViewTournament(db, ALEX, invitation), true);
    assert.equal(registrationState(db, invitation, ALEX, false), 'invited');
    assert.equal(api.registerForTournament(db, ALEX, invitation.id).status, 'registered');
    // Staff can only invite approved members.
    domain('not_member', () => api.authorizePlayer(db, MICHAEL, invitation.id, DANIEL));
    domain('not_member', () => api.authorizePlayer(db, MICHAEL, invitation.id, CAST.david));
  });

  it('1c. a direct attempt to open a private table is refused by the runtime, not only by the screen', () => {
    const { runtime } = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!;
    running.visibility = 'private';
    const options = { turnSeconds: 20, pace: 1 };
    forbidden(() => runtime.attach(null, running.id, 1, false, options), 'nobody signed in');
    forbidden(() => runtime.attach(DANIEL, running.id, 1, false, options), 'not a member');
    forbidden(() => runtime.attach(MICHAEL, running.id, 1, false, options), 'another club\'s owner');
    forbidden(() => runtime.attach(ALEX, running.id, 1, true, options), 'a member without a seat cannot sit down');
    // A member of the club may watch, and sees no hole cards.
    const driver = runtime.attach(ALEX, running.id, 1, false, options);
    assert.equal(driver.viewerId, null);
    assert.ok(driver.view.seats.every((s) => !s || !s.cards || s.cards.every((c) => c === null)), 'an observer is sent no hole cards');
    runtime.detach();
    // Staff of the club may watch too.
    runtime.attach(MAYA, running.id, 1, false, options);
    runtime.detach();
  });

  it('2. following does not grant membership', () => {
    const privateT = publish();
    const publicT = publish({ name: 'Open Showcase', visibility: 'public' });
    const before = api.followerCount(db, MIDNIGHT);
    api.followClub(db, DANIEL, MIDNIGHT);
    assert.equal(api.followerCount(db, MIDNIGHT), before + 1);
    assert.equal(membershipOf(db, DANIEL, MIDNIGHT), undefined, 'no membership row is created');
    assert.equal(can(db, DANIEL, 'console.access', MIDNIGHT), false);
    domain('members_only', () => api.registerForTournament(db, DANIEL, privateT.id));
    domain('members_only', () => api.registerForTournament(db, DANIEL, publicT.id));
    assert.equal(api.canViewTournament(db, DANIEL, privateT), false, 'private tournaments stay hidden from followers');
    assert.equal(api.canViewTournament(db, DANIEL, publicT), true, 'public ones are visible');
    const view = api.clubView(db, DANIEL, MIDNIGHT);
    assert.ok(view.following);
    assert.equal(view.membership, null);
    assert.ok(view.tournaments.every((t) => t.visibility === 'public'), 'the public profile lists public tournaments only');
    assert.ok(view.announcements.every((a) => a.audience.type === 'everyone' || a.audience.type === 'followers'), 'and public announcements only');
    assert.equal(view.hasPrivateSchedule, true);
    // Following is idempotent, and separate from membership in both directions.
    api.followClub(db, DANIEL, MIDNIGHT);
    assert.equal(db.follows.filter((f) => f.userId === DANIEL && f.clubId === MIDNIGHT).length, 1);
    approve(DANIEL);
    api.leaveClub(db, DANIEL, MIDNIGHT);
    assert.ok(api.followOf(db, DANIEL, MIDNIGHT), 'leaving the club does not unfollow it');
    api.unfollowClub(db, DANIEL, MIDNIGHT);
    assert.equal(api.followOf(db, DANIEL, MIDNIGHT), undefined);
    assert.equal(api.followerCount(db, MIDNIGHT), before);
  });

  it('3. a shared tournament password does not bypass authorization', () => {
    const t = publish({ accessCode: 'sunday77' });
    assert.equal(t.accessCode, 'SUNDAY77', 'codes are stored normalised');
    // The right code in the wrong hands.
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id, { code: 'SUNDAY77' }));
    api.followClub(db, DANIEL, MIDNIGHT);
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id, { code: 'SUNDAY77' }));
    api.requestJoin(db, DANIEL, MIDNIGHT, 'profile');
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id, { code: 'SUNDAY77' }));
    assert.equal(db.accessAttempts.length, 0, 'the code is not even looked at before membership');
    // A member needs it, and it is checked case-insensitively.
    domain('code_required', () => api.registerForTournament(db, ALEX, t.id));
    domain('bad_code', () => api.registerForTournament(db, ALEX, t.id, { code: 'nope' }));
    assert.equal(api.registerForTournament(db, ALEX, t.id, { code: ' sunday77 ' }).status, 'registered');

    // With per-tournament approval, the code gets a request, never a seat.
    const both = publish({ name: 'Code and approval', access: 'approval', accessCode: 'ABCD1' });
    assert.equal(api.registerForTournament(db, ALEX, both.id, { code: 'abcd1' }).status, 'requested');
    // With invitations, the code is not enough.
    const invite = publish({ name: 'Code and invitation', access: 'invite', accessCode: 'ABCD2' });
    domain('invite_only', () => api.registerForTournament(db, ALEX, invite.id, { code: 'ABCD2' }));
    domain('invalid', () => api.createTournament(db, MICHAEL, MIDNIGHT, draft({ accessCode: 'a b' })));
  });

  it('3b. wrong codes are rate limited', () => {
    const t = publish({ accessCode: 'SUNDAY77' });
    const member = members(MIDNIGHT, 1)[0]!;
    for (let i = 0; i < 5; i++) domain('bad_code', () => api.registerForTournament(db, member, t.id, { code: `guess${i}` }));
    domain('code_locked', () => api.registerForTournament(db, member, t.id, { code: 'SUNDAY77' }));
    assert.ok(db.audit.some((a) => a.action === 'registration.code_locked'), 'the lock-out is in the audit log');
    // Someone else is not affected, and the lock lifts with time.
    assert.equal(api.registerForTournament(db, ALEX, t.id, { code: 'SUNDAY77' }).status, 'registered');
    time += 11 * MIN;
    assert.equal(api.registerForTournament(db, member, t.id, { code: 'SUNDAY77' }).status, 'registered');
  });

  it('4. club administrators cannot manage another club', () => {
    const midnightMember = members(MIDNIGHT, 1)[0]!;
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!.userId;
    const t = Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT && x.access === 'approval')!;
    const requested = t.registrations.find((r) => r.status === 'requested')!.userId;
    const seated = t.registrations.find((r) => r.status === 'registered')!.userId;
    const tag = tagId(MIDNIGHT, 'VIP Member');
    const conversation = db.conversations.find((c) => c.clubId === MIDNIGHT)!;
    // Dana owns River Kings. None of that reaches into Midnight.
    for (const intruder of [DANA, MAYA]) {
      forbidden(() => api.approveMember(db, intruder, MIDNIGHT, pending));
      forbidden(() => api.rejectMember(db, intruder, MIDNIGHT, pending));
      forbidden(() => api.banMember(db, intruder, MIDNIGHT, midnightMember));
      forbidden(() => api.suspendMember(db, intruder, MIDNIGHT, midnightMember));
      forbidden(() => api.updateClubProfile(db, intruder, MIDNIGHT, { social: {} }));
      forbidden(() => api.publishAnnouncement(db, intruder, MIDNIGHT, { kind: 'news', title: 'Hello there', body: 'From the club next door' }));
      forbidden(() => api.approveRegistration(db, intruder, t.id, requested));
      forbidden(() => api.revokeRegistration(db, intruder, t.id, seated));
      forbidden(() => api.authorizePlayer(db, intruder, t.id, midnightMember));
      forbidden(() => crm.addTag(db, intruder, MIDNIGHT, [midnightMember], tag));
      forbidden(() => crm.createTag(db, intruder, MIDNIGHT, { name: 'Poached', color: 'red' }));
      forbidden(() => crm.assignStaff(db, intruder, MIDNIGHT, [midnightMember], null));
      forbidden(() => crm.addNote(db, intruder, MIDNIGHT, midnightMember, 'not my club'));
      forbidden(() => crm.createSegment(db, intruder, MIDNIGHT, { name: 'Theirs', match: 'all', rules: [{ field: 'status', op: 'is', value: 'active' }] }));
      forbidden(() => crm.createLink(db, intruder, MIDNIGHT, { kind: 'club', source: 'other', label: 'Hijack', expiresInDays: null, maxUses: null }));
      forbidden(() => crm.updateCrmSettings(db, intruder, MIDNIGHT, { activeDays: 1 }));
      forbidden(() => crm.exportPlayers(db, intruder, MIDNIGHT, [midnightMember]));
      forbidden(() => crm.forgetPlayer(db, intruder, MIDNIGHT, CAST.david));
      forbidden(() => automation.updateRule(db, intruder, MIDNIGHT, 'welcome', { enabled: false }));
      forbidden(() => messaging.sendClubMessage(db, intruder, MIDNIGHT, midnightMember, 'Come and play with us instead'));
      forbidden(() => messaging.setConversationStatus(db, intruder, conversation.id, 'resolved'));
      forbidden(() => messaging.blockPlayer(db, intruder, MIDNIGHT, midnightMember));
    }
    // A tag belongs to one club: it cannot be used in another, even by that club's owner.
    domain('not_found', () => crm.addTag(db, DANA, RIVER, members(RIVER, 1), tag));
    // Platform staff are not club staff either.
    forbidden(() => api.approveMember(db, ADMIN, MIDNIGHT, pending));
    forbidden(() => crm.queryPlayers(db, ADMIN, MIDNIGHT));
    forbidden(() => messaging.clubInbox(db, ADMIN, MIDNIGHT));
  });

  it('4b. each staff role is limited to its own part of the CRM', () => {
    const support = staffWith(MIDNIGHT, 'support_agent');
    const tm = staffWith(MIDNIGHT, 'tournament_manager');
    const manager = staffWith(MIDNIGHT, 'manager');
    const member = members(MIDNIGHT, 1)[0]!;
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!.userId;
    const tag = tagId(MIDNIGHT, 'VIP Member');
    // Support agent: conversations and notes, nothing else.
    crm.addNote(db, support, MIDNIGHT, member, 'Called about the schedule.');
    messaging.sendClubMessage(db, support, MIDNIGHT, member, 'Hello from support.');
    assert.ok(crm.queryPlayers(db, support, MIDNIGHT).rows.length > 0);
    forbidden(() => api.approveMember(db, support, MIDNIGHT, pending));
    forbidden(() => crm.addTag(db, support, MIDNIGHT, [member], tag));
    forbidden(() => crm.exportPlayers(db, support, MIDNIGHT, [member]));
    forbidden(() => analytics.funnelReport(db, support, MIDNIGHT, { kind: 'followers', from: NOW - 90 * DAY, to: NOW, windowDays: 30 }));
    forbidden(() => api.publishAnnouncement(db, support, MIDNIGHT, { kind: 'news', title: 'Not mine to send', body: 'Support agents do not publish.' }));
    forbidden(() => api.createTournament(db, support, MIDNIGHT, draft()));
    // Tournament manager: tournaments and their registrations; no notes, inbox or membership decisions.
    const t = publish({ access: 'approval' }, MIDNIGHT, tm);
    api.registerForTournament(db, ALEX, t.id);
    api.approveRegistration(db, tm, t.id, ALEX);
    forbidden(() => crm.addNote(db, tm, MIDNIGHT, member, 'x y z'));
    forbidden(() => messaging.clubInbox(db, tm, MIDNIGHT));
    forbidden(() => api.approveMember(db, tm, MIDNIGHT, pending));
    forbidden(() => crm.addTag(db, tm, MIDNIGHT, [member], tag));
    assert.equal(crm.playerProfile(db, tm, MIDNIGHT, member).notes, null, 'the profile comes without the private notes');
    // Manager: everything in the CRM, but not the subscription.
    api.approveMember(db, manager, MIDNIGHT, pending);
    crm.addTag(db, manager, MIDNIGHT, [member], tag);
    assert.ok(crm.exportPlayers(db, manager, MIDNIGHT, [member]).csv.includes(db.users[member]!.name));
    assert.equal(can(db, manager, 'billing.view', MIDNIGHT), false);
    assert.deepEqual(ROLE_PERMISSIONS.player, []);
  });

  it('5. revoked membership affects access', () => {
    const t = publish({ entryPoints: 300 });
    const m = membershipOf(db, ALEX, MIDNIGHT)!;
    api.registerForTournament(db, ALEX, t.id);
    assert.equal(m.demoPoints, 9_700);
    api.suspendMember(db, MICHAEL, MIDNIGHT, ALEX);
    assert.equal(api.registrationOf(t, ALEX), undefined, 'the seat is released');
    assert.equal(m.demoPoints, 10_000, 'and the demo points returned');
    assert.equal(api.canViewTournament(db, ALEX, t), false);
    domain('members_only', () => api.registerForTournament(db, ALEX, t.id));
    assert.equal(registrationState(db, t, ALEX, false), 'not_member');
    api.reinstateMember(db, MICHAEL, MIDNIGHT, ALEX);
    assert.equal(api.registerForTournament(db, ALEX, t.id).status, 'registered');

    // A ban removes everything and blocks the ways back in.
    api.followClub(db, ALEX, MIDNIGHT);
    api.banMember(db, MICHAEL, MIDNIGHT, ALEX);
    assert.equal(m.status, 'banned');
    assert.equal(api.registrationOf(t, ALEX), undefined);
    assert.equal(api.followOf(db, ALEX, MIDNIGHT), undefined);
    domain('banned', () => api.requestJoin(db, ALEX, MIDNIGHT, 'profile'));
    domain('banned', () => api.followClub(db, ALEX, MIDNIGHT));
    domain('banned', () => messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, 'Why was I banned?'));
    domain('members_only', () => api.registerForTournament(db, ALEX, t.id));
    assert.equal(membershipOf(db, ALEX, RIVER)!.status, 'active', 'another club is unaffected');
    api.unbanMember(db, MICHAEL, MIDNIGHT, ALEX);
    assert.equal(membershipOf(db, ALEX, MIDNIGHT), undefined, 'lifting a ban does not restore membership');
    assert.equal(api.requestJoin(db, ALEX, MIDNIGHT, 'profile').status, 'pending');
    // Leaving has the same effect on access.
    const other = members(MIDNIGHT, 1)[0]!;
    api.registerForTournament(db, other, t.id);
    api.leaveClub(db, other, MIDNIGHT);
    assert.equal(api.registrationOf(t, other), undefined);
    domain('members_only', () => api.registerForTournament(db, other, t.id));
  });

  it('5b. staff can withdraw one tournament place without touching the membership', () => {
    const t = publish({ entryPoints: 200 });
    api.registerForTournament(db, ALEX, t.id);
    api.revokeRegistration(db, MICHAEL, t.id, ALEX);
    assert.equal(api.registrationOf(t, ALEX)!.status, 'cancelled');
    assert.equal(membershipOf(db, ALEX, MIDNIGHT)!.demoPoints, 10_000);
    assert.equal(membershipOf(db, ALEX, MIDNIGHT)!.status, 'active');
    domain('revoked', () => api.registerForTournament(db, ALEX, t.id));
    assert.equal(registrationState(db, t, ALEX, false), 'revoked');
    assert.ok(notificationsOf(ALEX, 'notif.registration_revoked').length === 1);
    // Staff can let them back in.
    api.authorizePlayer(db, MICHAEL, t.id, ALEX);
    assert.equal(api.registerForTournament(db, ALEX, t.id).status, 'registered');
  });

  it('6. expired invitations are rejected', () => {
    domain('invite_expired', () => api.openInvite(db, DANIEL, 'https://join.pokerclubos.example/mpc-tiktok'));
    domain('invite_revoked', () => api.openInvite(db, DANIEL, 'mpc-flyer'));
    domain('invite_not_found', () => api.openInvite(db, DANIEL, 'https://join.pokerclubos.example/no-such-link'));
    assert.equal(api.findClubByInvite(db, 'mpc-tiktok'), undefined);
    assert.equal(db.crm.profiles[`${MIDNIGHT}:${DANIEL}`], undefined, 'a dead link leaves no trace');
    // A live link works and records where the person came from.
    const opened = api.openInvite(db, DANIEL, 'https://join.pokerclubos.example/mpc-instagram');
    assert.equal(opened.club.id, MIDNIGHT);
    assert.equal(db.crm.profiles[`${MIDNIGHT}:${DANIEL}`]!.source, 'instagram');
    // A link the club makes now stops working when it expires, when its uses run out, and when it is revoked.
    const link = crm.createLink(db, MICHAEL, MIDNIGHT, { kind: 'club', source: 'whatsapp', label: 'Weekend group', expiresInDays: 2, maxUses: null });
    assert.equal(api.openInvite(db, ALEX, link.token).club.id, MIDNIGHT);
    time += 2 * DAY + MIN;
    domain('invite_expired', () => api.openInvite(db, ALEX, link.token));
    const other = crm.createLink(db, MICHAEL, MIDNIGHT, { kind: 'club', source: 'friend', label: 'To revoke', expiresInDays: null, maxUses: null });
    crm.revokeLink(db, MICHAEL, MIDNIGHT, other.id);
    domain('invite_revoked', () => api.openInvite(db, ALEX, other.token));
  });

  it('6b. a tournament invitation link authorises approved members only, and only while it is valid', () => {
    const t = publish({ name: 'By link only', access: 'invite' });
    const link = crm.createLink(db, MICHAEL, MIDNIGHT, { kind: 'tournament', tournamentId: t.id, source: 'other', label: 'Finalists', expiresInDays: 1, maxUses: 2 });
    // Not a member: the link identifies the club but grants nothing.
    assert.equal(api.openInvite(db, DANIEL, link.token).tournament, 'needs_membership');
    assert.equal(api.registrationOf(t, DANIEL), undefined);
    domain('members_only', () => api.registerForTournament(db, DANIEL, t.id));
    assert.equal(link.uses, 0);
    // An approved member is authorised, then takes the seat.
    assert.equal(api.openInvite(db, ALEX, link.token).tournament, 'authorised');
    assert.equal(api.registrationOf(t, ALEX)!.status, 'approved');
    assert.equal(api.registrationOf(t, ALEX)!.viaLinkId, link.id);
    api.openInvite(db, ALEX, link.token);
    assert.equal(link.uses, 1, 'opening it again does not use it twice');
    assert.equal(api.registerForTournament(db, ALEX, t.id).status, 'registered');
    // Use limit.
    const [a, b] = members(MIDNIGHT, 2);
    api.openInvite(db, a!, link.token);
    domain('invite_used_up', () => api.openInvite(db, b!, link.token));
    // Staff of another club cannot make links for this tournament.
    forbidden(() => crm.createLink(db, DANA, MIDNIGHT, { kind: 'tournament', tournamentId: t.id, source: 'other', label: 'Nope', expiresInDays: 1, maxUses: 1 }));
  });

  it('7. duplicate registrations are prevented', () => {
    const t = publish({ maxPlayers: 2, entryPoints: 100 });
    api.registerForTournament(db, ALEX, t.id);
    domain('already_registered', () => api.registerForTournament(db, ALEX, t.id));
    assert.equal(t.registrations.filter((r) => r.userId === ALEX).length, 1);
    assert.equal(membershipOf(db, ALEX, MIDNIGHT)!.demoPoints, 9_900, 'charged once');
    const [a, b] = members(MIDNIGHT, 2);
    api.registerForTournament(db, a!, t.id);
    assert.equal(api.registerForTournament(db, b!, t.id).status, 'waitlisted');
    domain('already_waitlisted', () => api.registerForTournament(db, b!, t.id));
    const byApproval = publish({ name: 'Ask first', access: 'approval' });
    api.registerForTournament(db, ALEX, byApproval.id);
    domain('already_requested', () => api.registerForTournament(db, ALEX, byApproval.id));
    assert.equal(byApproval.registrations.length, 1);
    // The same goes for membership requests and follows.
    api.requestJoin(db, DANIEL, MIDNIGHT, 'profile');
    domain('already_pending', () => api.requestJoin(db, DANIEL, MIDNIGHT, 'profile'));
    assert.equal(db.memberships.filter((m) => m.userId === DANIEL && m.clubId === MIDNIGHT).length, 1);
    api.approveMember(db, MICHAEL, MIDNIGHT, DANIEL);
    domain('already_member', () => api.requestJoin(db, DANIEL, MIDNIGHT, 'profile'));
    assert.equal(notificationsOf(DANIEL, 'notif.approved').length, 1);
  });

  it('8. tournament capacity restrictions are enforced', () => {
    const t = publish({ maxPlayers: 3, access: 'approval' });
    const [a, b, c, d, e] = members(MIDNIGHT, 5);
    for (const id of [a!, b!, c!, d!, e!]) assert.equal(api.registerForTournament(db, id, t.id).status, 'requested');
    assert.equal(api.registeredCount(t), 0, 'requests do not hold seats');
    for (const id of [a!, b!, c!]) api.approveRegistration(db, MICHAEL, t.id, id);
    assert.equal(api.registeredCount(t), 3);
    api.approveRegistration(db, MICHAEL, t.id, d!);
    assert.equal(api.registrationOf(t, d!)!.status, 'waitlisted', 'approved, but the tournament is full');
    api.approveRegistration(db, MICHAEL, t.id, e!);
    assert.equal(api.registeredCount(t), 3, 'never more seats than the capacity');
    domain('full', () => api.promoteWaitlisted(db, MICHAEL, t.id, d!));
    // A freed seat goes to whoever has waited longest.
    api.revokeRegistration(db, MICHAEL, t.id, a!);
    assert.equal(api.registrationOf(t, d!)!.status, 'registered');
    assert.equal(api.registrationOf(t, e!)!.status, 'waitlisted');
    assert.equal(api.registeredCount(t), 3);
    assert.ok(db.crm.events.some((ev) => ev.userId === d && ev.type === 'tournament_registered' && ev.params.from === 'waitlist'));
    // An invited member does not jump the capacity either.
    api.authorizePlayer(db, MICHAEL, t.id, ALEX);
    assert.equal(api.registerForTournament(db, ALEX, t.id).status, 'waitlisted');
    // At the start, the waiting list and undecided requests are released.
    api.beginSeating(db, MICHAEL, t.id);
    assert.equal(api.registrationOf(t, e!)!.status, 'cancelled');
    assert.equal(api.registeredCount(t), 3);
    // A sit & go that starts when full has no waiting list.
    const sng = publish({ name: 'Six-max', format: 'sng', preset: 'sng', structure: presetStructure('sng'), startMode: 'when_full', minPlayers: 6, maxPlayers: 6 });
    for (const id of members(MIDNIGHT, 6, 10)) api.registerForTournament(db, id, sng.id);
    domain('full', () => api.registerForTournament(db, members(MIDNIGHT, 1, 20)[0]!, sng.id));
  });
});

// =============================================================================
// CRM
// =============================================================================

describe('CRM', () => {
  it('9. tags are persistent', () => {
    approve(DANIEL);
    const weekend = tagId(MIDNIGHT, 'Weekend Player');
    assert.equal(crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL], weekend), 1);
    assert.equal(crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL], weekend), 0, 'adding it twice changes nothing');
    // Survives being saved and loaded again (the store persists the database as JSON).
    db = JSON.parse(JSON.stringify(db)) as DB;
    assert.ok(crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).row.tagIds.includes(weekend));
    assert.ok(crm.queryPlayers(db, MICHAEL, MIDNIGHT, { tagIds: [weekend] }).rows.some((r) => r.userId === DANIEL));
    // The tag stays on the club's record even if the person leaves and comes back.
    api.leaveClub(db, DANIEL, MIDNIGHT);
    assert.ok(crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).row.tagIds.includes(weekend));
    // Custom tags can be created, renamed and deleted; names are unique within the club.
    const custom = crm.createTag(db, MICHAEL, MIDNIGHT, { name: 'Late Night Crew', color: 'violet' });
    domain('tag_exists', () => crm.createTag(db, MICHAEL, MIDNIGHT, { name: 'late night crew', color: 'red' }));
    crm.updateTag(db, MICHAEL, MIDNIGHT, custom.id, { name: 'Night Owls', color: 'blue' });
    assert.equal(crm.listTags(db, MICHAEL, MIDNIGHT).find((t) => t.id === custom.id)!.name, 'Night Owls');
    // The same name can exist in another club: tags are isolated per club.
    const theirs = crm.createTag(db, DANA, RIVER, { name: 'Night Owls', color: 'green' });
    assert.notEqual(theirs.id, custom.id);
    assert.ok(!crm.listTags(db, MICHAEL, MIDNIGHT).some((t) => t.id === theirs.id));
    crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL], custom.id);
    crm.deleteTag(db, MICHAEL, MIDNIGHT, custom.id);
    assert.ok(!crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).row.tagIds.includes(custom.id));
  });

  it('10. removing tags updates dynamic segments', () => {
    const weekend = tagId(MIDNIGHT, 'Weekend Player');
    approve(DANIEL);
    const segment = crm.createSegment(db, MICHAEL, MIDNIGHT, {
      name: 'Approved weekend players',
      match: 'all',
      rules: [
        { field: 'tag', op: 'is', value: weekend },
        { field: 'status', op: 'is', value: 'active' },
      ],
    });
    const count = () => crm.listSegments(db, MICHAEL, MIDNIGHT).find((s) => s.id === segment.id)!.count;
    const before = count();
    assert.ok(!crm.resolveSegment(db, MIDNIGHT, segment.id).includes(DANIEL));
    crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL, CAST.david], weekend);
    assert.equal(count(), before + 1, 'Daniel matches; David is tagged but not an approved member');
    assert.ok(crm.resolveSegment(db, MIDNIGHT, segment.id).includes(DANIEL));
    assert.ok(!crm.resolveSegment(db, MIDNIGHT, segment.id).includes(CAST.david));
    crm.removeTag(db, MICHAEL, MIDNIGHT, [DANIEL], weekend);
    assert.equal(count(), before);
    assert.ok(!crm.resolveSegment(db, MIDNIGHT, segment.id).includes(DANIEL));
    // The other condition is live as well.
    crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL], weekend);
    api.suspendMember(db, MICHAEL, MIDNIGHT, DANIEL);
    assert.ok(!crm.resolveSegment(db, MIDNIGHT, segment.id).includes(DANIEL));
    // A preview shows who would match before anything is saved, and "any" widens the match.
    const all = crm.previewSegment(db, MICHAEL, MIDNIGHT, [{ field: 'tag', op: 'is', value: weekend }, { field: 'wins', op: 'gte', value: 1 }], 'all');
    const any = crm.previewSegment(db, MICHAEL, MIDNIGHT, [{ field: 'tag', op: 'is', value: weekend }, { field: 'wins', op: 'gte', value: 1 }], 'any');
    assert.ok(any.userIds.length > all.userIds.length);
    assert.ok(all.rows.every((r) => r.tagIds.includes(weekend) && r.wins >= 1));
    // A saved list, by contrast, does not change.
    const saved = crm.createStaticSegment(db, MICHAEL, MIDNIGHT, 'Snapshot', all.userIds);
    crm.removeTag(db, MICHAEL, MIDNIGHT, all.userIds, weekend);
    assert.equal(crm.resolveSegment(db, MIDNIGHT, saved.id).length, all.userIds.length);
    // A segment of one club cannot be read or used by another.
    forbidden(() => crm.listSegments(db, DANA, MIDNIGHT));
    domain('bad_audience', () => api.publishAnnouncement(db, DANA, RIVER, { kind: 'news', title: 'Borrowed list', body: 'Should not work', audience: { type: 'segment', segmentId: segment.id } }));
    domain('bad_rule', () => crm.createSegment(db, DANA, RIVER, { name: 'Borrowed tag', match: 'all', rules: [{ field: 'tag', op: 'is', value: weekend }] }));
  });

  it('10b. the built-in segments follow tournament records and the CRM settings', () => {
    const segments = crm.listSegments(db, MICHAEL, MIDNIGHT);
    const of = (key: string) => segments.find((s) => s.system === key)!;
    const rows = crm.queryPlayers(db, MICHAEL, MIDNIGHT).rows;
    assert.equal(of('active_players').count, compute.activePlayerIds(db, MIDNIGHT, 30, NOW).size);
    assert.equal(of('winners').count, rows.filter((r) => r.wins >= 1).length);
    assert.equal(of('followers').count, rows.filter((r) => r.following && r.status !== 'active').length);
    assert.equal(of('inactive_players').count, rows.filter((r) => r.lastPlayedAt !== null && NOW - r.lastPlayedAt >= 45 * DAY).length);
    const regulars = crm.resolveSegment(db, MIDNIGHT, of('regulars').id);
    for (const id of regulars) assert.ok(compute.playerParticipations(db, MIDNIGHT, id).filter((p) => p.at >= NOW - 30 * DAY).length >= 5);
    // Changing what "active" means changes the segment.
    crm.updateCrmSettings(db, MICHAEL, MIDNIGHT, { activeDays: 7 });
    assert.equal(crm.listSegments(db, MICHAEL, MIDNIGHT).find((s) => s.system === 'active_players')!.count, compute.activePlayerIds(db, MIDNIGHT, 7, NOW).size);
    domain('system_segment', () => crm.deleteSegment(db, MICHAEL, MIDNIGHT, of('winners').id));
  });

  it('11. player profiles display correct club-specific information', () => {
    const inMidnight = crm.playerProfile(db, MICHAEL, MIDNIGHT, ALEX);
    const inRiver = crm.playerProfile(db, DANA, RIVER, ALEX);
    const played = (clubId: string) => Object.values(db.results).filter((r) => r.clubId === clubId && r.places.some((p) => p.userId === ALEX));
    assert.equal(inMidnight.stats.tournaments, played(MIDNIGHT).length);
    assert.equal(inRiver.stats.tournaments, played(RIVER).length);
    assert.equal(inMidnight.stats.wins, played(MIDNIGHT).filter((r) => r.places[0]!.userId === ALEX).length);
    assert.ok(inMidnight.history.every((p) => p.clubId === MIDNIGHT));
    assert.ok(inRiver.history.every((p) => p.clubId === RIVER));
    assert.notEqual(inMidnight.row.joinedAt, inRiver.row.joinedAt);
    assert.equal(crm.memberId(db.clubs[MIDNIGHT]!, inMidnight.row.memberNo!).startsWith('MPC-'), true);
    assert.equal(crm.memberId(db.clubs[RIVER]!, inRiver.row.memberNo!).startsWith('RK-'), true);
    // Notes, tags and assignment made in one club do not appear in the other.
    assert.ok(inRiver.notes!.some((n) => n.body.startsWith('River Kings note')));
    assert.ok(!inMidnight.notes!.some((n) => n.body.startsWith('River Kings note')));
    crm.addTag(db, MICHAEL, MIDNIGHT, [ALEX], tagId(MIDNIGHT, 'VIP Member'));
    crm.assignStaff(db, MICHAEL, MIDNIGHT, [ALEX], MICHAEL);
    const riverAgain = crm.playerProfile(db, DANA, RIVER, ALEX);
    assert.deepEqual(riverAgain.row.tagIds, inRiver.row.tagIds);
    assert.equal(riverAgain.row.assignedTo, inRiver.row.assignedTo);
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, ALEX).row.assignedTo, MICHAEL);
    // Statistics come from results: a new result changes the profile, nothing else does.
    const t = publish({ minPlayers: 2 });
    api.registerForTournament(db, ALEX, t.id);
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, ALEX).stats.tournaments, inMidnight.stats.tournaments, 'registering is not playing');
    // Contact details appear only with the member's consent for this club.
    assert.equal(inMidnight.email, null);
    api.setMemberPreferences(db, ALEX, MIDNIGHT, { shareContact: true });
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, ALEX).email, db.users[ALEX]!.email);
    assert.equal(crm.playerProfile(db, DANA, RIVER, ALEX).email, null, 'consent given to one club is not consent for another');
    // A club has no profile of someone it has never dealt with.
    domain('not_found', () => crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL));
    domain('not_found', () => crm.addNote(db, MICHAEL, MIDNIGHT, DANIEL, 'Unknown person'));
  });

  it('12. activity timelines reflect actual events', () => {
    const step = () => (time += 5 * MIN);
    api.openInvite(db, DANIEL, 'mpc-instagram');
    step();
    api.followClub(db, DANIEL, MIDNIGHT);
    step();
    api.requestJoin(db, DANIEL, MIDNIGHT, 'profile');
    step();
    api.approveMember(db, MICHAEL, MIDNIGHT, DANIEL);
    step();
    crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL], tagId(MIDNIGHT, 'Weekend Player'));
    step();
    const t = publish({ access: 'approval', minPlayers: 2 });
    api.registerForTournament(db, DANIEL, t.id);
    step();
    api.approveRegistration(db, MICHAEL, t.id, DANIEL);
    step();
    messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, 'See you on Sunday.');
    step();
    crm.addNote(db, MICHAEL, MIDNIGHT, DANIEL, 'First tournament this Sunday.');
    const types = () => crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).timeline.map((i) => i.type).reverse();
    assert.deepEqual(types(), ['link_opened', 'followed', 'membership_requested', 'membership_approved', 'tag_added', 'tournament_requested', 'tournament_approved', 'message_sent', 'note_added']);
    const tagItem = crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).timeline.find((i) => i.type === 'tag_added')!;
    assert.equal(tagItem.params.tag, 'Weekend Player');
    assert.equal(tagItem.actorId, MICHAEL);
    // Participation appears only once a result exists.
    step();
    const result: TournamentResult = {
      tournamentId: t.id, clubId: MIDNIGHT, name: t.name, format: 'mtt', startedAt: time, completedAt: time + HOUR, durationMin: 60, entrants: 2, hands: 30, totalChips: 20_000, levelReached: 4, seeded: false,
      places: [
        { place: 1, userId: DANIEL, name: 'Daniel Levy', isBot: false, points: 14, bustedBy: null, bustLevel: null },
        { place: 2, userId: members(MIDNIGHT, 1)[0]!, name: 'x', isBot: true, points: 10, bustedBy: DANIEL, bustLevel: 4 },
      ],
    };
    api.registerForTournament(db, members(MIDNIGHT, 1)[0]!, t.id);
    api.approveRegistration(db, MICHAEL, t.id, members(MIDNIGHT, 1)[0]!);
    api.beginSeating(db, MICHAEL, t.id);
    api.markRunning(db, t.id);
    api.completeTournament(db, t.id, result);
    const after = types();
    assert.deepEqual(after.slice(-2), ['participated', 'won']);
    // Every entry corresponds to a stored record: events for this person, two per finished tournament, one per announcement received.
    const stored = db.crm.events.filter((e) => e.clubId === MIDNIGHT && e.userId === DANIEL).length;
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).timeline.length, stored + 2);
    // Another club's timeline of the same person is empty of all this.
    forbidden(() => crm.playerProfile(db, DANA, MIDNIGHT, DANIEL));
    domain('not_found', () => crm.playerProfile(db, DANA, RIVER, DANIEL));
  });

  it('13. private notes remain restricted', () => {
    const support = staffWith(MIDNIGHT, 'support_agent');
    const tm = staffWith(MIDNIGHT, 'tournament_manager');
    const note = crm.addNote(db, MICHAEL, MIDNIGHT, ALEX, 'Prefers evening tournaments.');
    assert.equal(note.authorId, MICHAEL);
    assert.equal(note.createdAt, NOW);
    // Who may read them: this club's staff with the notes permission. Nobody else.
    assert.ok(crm.listNotes(db, support, MIDNIGHT, ALEX).some((n) => n.id === note.id));
    forbidden(() => crm.listNotes(db, tm, MIDNIGHT, ALEX), 'tournament manager');
    forbidden(() => crm.listNotes(db, ALEX, MIDNIGHT, ALEX), 'the player the note is about');
    forbidden(() => crm.listNotes(db, DANA, MIDNIGHT, ALEX), 'another club\'s owner');
    forbidden(() => crm.listNotes(db, ADMIN, MIDNIGHT, ALEX), 'platform staff');
    forbidden(() => crm.playerProfile(db, ALEX, MIDNIGHT, ALEX));
    // Even where Dana does have a profile of Alex (her own club), Midnight's note is not in it.
    assert.ok(!crm.playerProfile(db, DANA, RIVER, ALEX).notes!.some((n) => n.id === note.id));
    forbidden(() => crm.updateNote(db, DANA, MIDNIGHT, note.id, 'tampered'));
    domain('not_found', () => crm.updateNote(db, DANA, RIVER, note.id, 'tampered through my own club'));
    // Editing keeps the earlier version, its author and both timestamps.
    time += HOUR;
    crm.updateNote(db, support, MIDNIGHT, note.id, 'Prefers evening tournaments, especially Thursdays.');
    const edited = crm.listNotes(db, MICHAEL, MIDNIGHT, ALEX).find((n) => n.id === note.id)!;
    assert.equal(edited.updatedAt, NOW + HOUR);
    assert.equal(edited.updatedBy, support);
    assert.deepEqual(edited.history, [{ at: NOW, editorId: MICHAEL, body: 'Prefers evening tournaments.' }]);
    // A support agent cannot delete someone else's note; the author or a manager can.
    domain('not_author', () => crm.deleteNote(db, support, MIDNIGHT, note.id));
    crm.deleteNote(db, MICHAEL, MIDNIGHT, note.id);
    assert.ok(!crm.listNotes(db, MICHAEL, MIDNIGHT, ALEX).some((n) => n.id === note.id));
    // The player's own view of the club never contains CRM records.
    const view = JSON.stringify(api.clubView(db, ALEX, MIDNIGHT));
    assert.ok(!view.includes('River Kings note') && !view.includes('Prefers evening'));
  });

  it('14. messages reach the correct club', () => {
    api.followClub(db, DANIEL, MIDNIGHT);
    const first = messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, 'Hi, how do I become a member?');
    assert.equal(first.clubId, MIDNIGHT);
    const inMidnight = messaging.clubInbox(db, MICHAEL, MIDNIGHT).find((i) => i.user.id === DANIEL)!;
    assert.equal(inMidnight.conversation.unreadClub, 1);
    assert.equal(inMidnight.last!.body, 'Hi, how do I become a member?');
    assert.ok(!messaging.clubInbox(db, DANA, RIVER).some((i) => i.user.id === DANIEL), 'River Kings never sees it');
    assert.equal(messaging.inboxUnread(db, DANA, MIDNIGHT), 0);
    forbidden(() => messaging.conversationThread(db, DANA, inMidnight.conversation.id));
    forbidden(() => messaging.conversationThread(db, ADMIN, inMidnight.conversation.id));
    forbidden(() => messaging.conversationThread(db, ALEX, inMidnight.conversation.id), 'another player');
    assert.ok(notificationsOf(MICHAEL, 'notif.message_from_player').some((n) => n.params.user === 'Daniel Levy'));
    assert.equal(notificationsOf(DANA, 'notif.message_from_player').filter((n) => n.params.user === 'Daniel Levy').length, 0);

    // Michael replies; Daniel sees the reply but not the staff-only note.
    messaging.sendClubMessage(db, MICHAEL, MIDNIGHT, DANIEL, 'Press "Request membership" on our page.');
    messaging.sendClubMessage(db, MICHAEL, MIDNIGHT, DANIEL, 'Came through Instagram.', { internal: true });
    const mine = messaging.conversationThread(db, DANIEL, inMidnight.conversation.id);
    assert.equal(mine.viewer, 'player');
    assert.deepEqual(mine.messages.map((m) => m.from), ['player', 'club']);
    assert.equal(messaging.conversationThread(db, MICHAEL, inMidnight.conversation.id).messages.length, 3);
    assert.equal(messaging.unreadMessages(db, DANIEL), 1);
    assert.equal(notificationsOf(DANIEL, 'notif.message_from_club').length, 1);
    messaging.markConversationRead(db, DANIEL, inMidnight.conversation.id);
    assert.equal(messaging.unreadMessages(db, DANIEL), 0);
    assert.equal(inMidnight.conversation.unreadClub, 0, 'answering marks the player\'s message as read');
    assert.equal(db.crm.profiles[`${MIDNIGHT}:${DANIEL}`]!.lastContactedAt, NOW);

    // The same player writing to another club starts a separate conversation there.
    messaging.sendPlayerMessage(db, DANIEL, RIVER, 'Is the daily turbo open to new members?');
    assert.equal(messaging.myConversations(db, DANIEL).length, 2);
    assert.ok(messaging.clubInbox(db, DANA, RIVER).some((i) => i.user.id === DANIEL && i.last!.body.includes('daily turbo')));
    assert.ok(!messaging.clubInbox(db, MICHAEL, MIDNIGHT).some((i) => i.last?.body.includes('daily turbo')));

    // Resolving, reopening and assigning.
    messaging.setConversationStatus(db, MICHAEL, inMidnight.conversation.id, 'resolved');
    time += 20 * MIN;
    messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, 'Thanks, done.');
    assert.equal(inMidnight.conversation.status, 'open', 'a new message reopens the conversation');
    const support = staffWith(MIDNIGHT, 'support_agent');
    messaging.assignConversation(db, MICHAEL, inMidnight.conversation.id, support);
    domain('not_staff', () => messaging.assignConversation(db, MICHAEL, inMidnight.conversation.id, DANA));
  });

  it('14b. messaging has abuse controls: limits, blocking and reports', () => {
    // Someone who is not a member cannot keep writing without an answer.
    for (let i = 0; i < 3; i++) {
      time += 2 * MIN;
      messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, `Message number ${i + 1}`);
    }
    time += 2 * MIN;
    domain('await_reply', () => messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, 'And another'));
    assert.equal(notificationsOf(MICHAEL, 'notif.message_from_player').filter((n) => n.params.user === 'Daniel Levy').length, 1, 'one notification for the burst');
    domain('bad_body', () => messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, '   '));
    domain('too_long', () => messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, 'x'.repeat(2001)));
    // Members are rate limited too, and cannot repeat themselves.
    messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, 'One');
    domain('duplicate_message', () => messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, 'One'));
    for (const text of ['Two', 'Three', 'Four', 'Five']) messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, text);
    domain('rate_limited', () => messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, 'Six'));
    // The club can block a player, and a player can block a club.
    messaging.blockPlayer(db, MICHAEL, MIDNIGHT, DANIEL);
    time += HOUR;
    domain('blocked', () => messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, 'Hello?'));
    messaging.unblockPlayer(db, MICHAEL, MIDNIGHT, DANIEL);
    messaging.blockClub(db, ALEX, MIDNIGHT);
    domain('blocked_by_player', () => messaging.sendClubMessage(db, MICHAEL, MIDNIGHT, ALEX, 'Please come back'));
    domain('you_blocked', () => messaging.sendPlayerMessage(db, ALEX, MIDNIGHT, 'Changed my mind'));
    messaging.unblockClub(db, ALEX, MIDNIGHT);
    // Staff cannot write to people the club has no relationship with.
    const stranger = Object.values(db.users).find((u: User) => u.isBot && !db.crm.profiles[`${MIDNIGHT}:${u.id}`] && !membershipOf(db, u.id, MIDNIGHT))!;
    domain('not_found', () => messaging.sendClubMessage(db, MICHAEL, MIDNIGHT, stranger.id, 'Join our club!'));
    // Reports go to the platform team, who see the report but not the conversation.
    const conversation = db.conversations.find((c) => c.clubId === MIDNIGHT && c.userId === DANIEL)!;
    messaging.reportConversation(db, DANIEL, conversation.id, 'They keep ignoring me');
    domain('already_reported', () => messaging.reportConversation(db, DANIEL, conversation.id, 'Again, ignoring me'));
    const reports = messaging.listReports(db, ADMIN);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.clubName, 'Midnight Poker Club');
    assert.ok(!JSON.stringify(reports).includes('Message number'));
    forbidden(() => messaging.listReports(db, MICHAEL));
    forbidden(() => messaging.conversationThread(db, ADMIN, conversation.id));
  });

  it('15. notifications are delivered to eligible users', () => {
    api.followClub(db, DANIEL, MIDNIGHT); // follower, updates on
    const before = (userId: string) => notificationsOf(userId, 'notif.announcement').length;
    const [d0, a0, dana0] = [before(DANIEL), before(ALEX), before(DANA)];

    // Members only: the follower does not get it.
    const toMembers = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Members meeting', body: 'For approved members.', audience: { type: 'members' } });
    assert.equal(before(DANIEL), d0);
    assert.equal(before(ALEX), a0 + 1);
    assert.equal(api.canReadAnnouncement(db, DANIEL, toMembers), false, 'and cannot read it on the club page either');
    assert.equal(api.canReadAnnouncement(db, ALEX, toMembers), true);

    // Followers: the follower gets it; a member who does not follow does not.
    api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Open evening', body: 'For our followers.', audience: { type: 'followers' } });
    assert.equal(before(DANIEL), d0 + 1);
    assert.equal(before(DANA), dana0, 'someone with no relationship with the club gets nothing');

    // The delivery record adds up, and matches the audience exactly.
    const everyone = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Season finale', body: 'For everybody.', audience: { type: 'everyone' } });
    const batch = db.batches.find((b) => b.id === everyone.batchId)!;
    const activeMembers = db.memberships.filter((m) => m.clubId === MIDNIGHT && m.status === 'active' && m.userId !== MICHAEL).map((m) => m.userId);
    const followers = db.follows.filter((f) => f.clubId === MIDNIGHT).map((f) => f.userId);
    const audience = new Set([...activeMembers, ...followers]);
    audience.delete(MICHAEL);
    assert.equal(batch.eligible, audience.size);
    assert.equal(batch.delivered.length + batch.optedOut, batch.eligible);
    assert.equal(batch.errors, 0);
    assert.ok(batch.delivered.every((id) => audience.has(id)));
    assert.equal(new Set(batch.delivered).size, batch.delivered.length, 'nobody is counted twice, even as both member and follower');
    assert.deepEqual(batch.readBy, []);

    // A segment audience is exactly the segment (minus opt-outs); a tournament audience exactly its players.
    const winners = db.crm.segments.find((s) => s.clubId === MIDNIGHT && s.system === 'winners')!;
    const toWinners = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'community', title: 'Winners circle', body: 'For past winners.', audience: { type: 'segment', segmentId: winners.id } });
    const winnerIds = new Set(crm.resolveSegment(db, MIDNIGHT, winners.id));
    const winnersBatch = db.batches.find((b) => b.id === toWinners.batchId)!;
    // The author never receives their own announcement, even when they are in the segment themselves.
    assert.equal(winnersBatch.eligible, winnerIds.size - (winnerIds.has(MICHAEL) ? 1 : 0));
    assert.ok(winnersBatch.delivered.every((id) => winnerIds.has(id) && id !== MICHAEL));
    const t = Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT && x.name === 'Final Table Qualifier')!;
    const toPlayers = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'reminder', title: 'Qualifier starts on time', body: 'Be seated five minutes early.', audience: { type: 'tournament', tournamentId: t.id } });
    assert.equal(db.batches.find((b) => b.id === toPlayers.batchId)!.eligible, t.registrations.length);
    assert.equal(api.canReadAnnouncement(db, ALEX, toPlayers), false, 'a member who is not in that tournament does not see it');

    // Reading a notification is recorded on the delivery it belongs to.
    const n = notificationsOf(ALEX, 'notif.announcement').find((x) => x.batchId === batch.id)!;
    api.markNotificationRead(db, ALEX, n.id);
    api.markNotificationRead(db, ALEX, n.id);
    assert.deepEqual(batch.readBy, [ALEX]);
    const log = api.clubAnnouncementLog(db, MICHAEL, MIDNIGHT).find((x) => x.announcement.id === everyone.id)!;
    assert.deepEqual({ eligible: log.delivery!.eligible, delivered: log.delivery!.delivered, read: log.delivery!.read }, { eligible: batch.eligible, delivered: batch.delivered.length, read: 1 });
  });

  it('15b. a new public tournament is announced to followers who asked for updates; a private one is not', () => {
    api.followClub(db, DANIEL, MIDNIGHT);
    api.followClub(db, DANA, MIDNIGHT, { notify: false });
    publish({ name: 'Members only night' });
    assert.equal(notificationsOf(DANIEL, 'notif.new_public_tournament').length, 0);
    const pub = publish({ name: 'Open Showcase', visibility: 'public' });
    assert.equal(notificationsOf(DANIEL, 'notif.new_public_tournament').length, 1);
    assert.equal(notificationsOf(DANA, 'notif.new_public_tournament').length, 0, 'followed with updates off');
    assert.equal(notificationsOf(ALEX, 'notif.new_public_tournament').length, 0, 'members get the member notification instead');
    assert.equal(notificationsOf(ALEX, 'notif.tournament_published').filter((n) => n.params.name === 'Open Showcase').length, 1);
    const runs = automation.listRuns(db, MICHAEL, MIDNIGHT, 'new_tournament');
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.delivered + runs[0]!.skipped, runs[0]!.targets);
    void pub;
    // Unpublishing and publishing again does not announce it twice.
    const later = publish({ name: 'Opens tomorrow', visibility: 'public', registrationOpensAt: NOW + 10 * MIN });
    assert.equal(later.status, 'SCHEDULED');
    assert.equal(notificationsOf(DANIEL, 'notif.new_public_tournament').length, 2);
    api.unpublishTournament(db, MICHAEL, later.id);
    api.publishTournament(db, MICHAEL, later.id);
    assert.equal(notificationsOf(DANIEL, 'notif.new_public_tournament').length, 2);
    assert.equal(automation.listRuns(db, MICHAEL, MIDNIGHT, 'new_tournament').length, 2);
  });

  it('16. notification preferences are respected', () => {
    const prefs = (userId: string, patch: Partial<typeof DEFAULT_SETTINGS.notifications>) => api.updateSettings(db, userId, { notifications: { ...db.settings[userId]!.notifications, ...patch } });
    const count = (userId: string, key: string) => notificationsOf(userId, key).length;
    // 1. The person's own switch for announcements.
    prefs(ALEX, { announcements: false });
    const a0 = count(ALEX, 'notif.announcement');
    const first = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Quiet one', body: 'Alex has announcements off.', audience: { type: 'members' } });
    assert.equal(count(ALEX, 'notif.announcement'), a0);
    const firstBatch = db.batches.find((b) => b.id === first.batchId)!;
    assert.ok(!firstBatch.delivered.includes(ALEX));
    assert.ok(firstBatch.optedOut >= 1, 'counted as opted out, not as delivered');
    prefs(ALEX, { announcements: true });
    // 2. The member's switch for this one club.
    api.setMemberPreferences(db, ALEX, MIDNIGHT, { announcements: false });
    api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Muted club', body: 'Alex muted Midnight.', audience: { type: 'everyone' } });
    assert.equal(count(ALEX, 'notif.announcement'), a0);
    const r0 = count(ALEX, 'notif.announcement');
    api.publishAnnouncement(db, DANA, RIVER, { kind: 'news', title: 'Other club', body: 'Still on for River Kings.', audience: { type: 'members' } });
    assert.equal(count(ALEX, 'notif.announcement'), r0 + 1, 'muting one club does not mute another');
    // 3. A follower who turned updates off.
    api.followClub(db, DANIEL, MIDNIGHT);
    api.setFollowNotify(db, DANIEL, MIDNIGHT, false);
    api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'For followers', body: 'Daniel turned updates off.', audience: { type: 'followers' } });
    assert.equal(count(DANIEL, 'notif.announcement'), 0);
    // 4. Messages: the message still arrives in the conversation, without a notification.
    prefs(DANIEL, { messages: false });
    messaging.sendClubMessage(db, MICHAEL, MIDNIGHT, DANIEL, 'Welcome, Daniel.');
    assert.equal(count(DANIEL, 'notif.message_from_club'), 0);
    assert.equal(messaging.unreadMessages(db, DANIEL), 1);
    // 5. Membership and registration notifications.
    prefs(DANIEL, { membership: false });
    approve(DANIEL);
    assert.equal(count(DANIEL, 'notif.approved'), 0);
    prefs(DANIEL, { registrations: false, reminders: false });
    const t = publish({ startAt: NOW + 10 * MIN });
    api.registerForTournament(db, DANIEL, t.id);
    api.registerForTournament(db, ALEX, t.id);
    assert.equal(count(DANIEL, 'notif.registered'), 0);
    assert.equal(count(ALEX, 'notif.registered'), 1);
    // 6. Reminders.
    automation.tick(db, time);
    assert.equal(count(DANIEL, 'notif.starting_soon'), 0);
    assert.equal(notificationsOf(ALEX, 'notif.starting_soon').filter((n) => n.params.name === t.name).length, 1);
    automation.tick(db, time + MIN);
    assert.equal(notificationsOf(ALEX, 'notif.starting_soon').filter((n) => n.params.name === t.name).length, 1, 'one reminder per tournament');
    const run = automation.listRuns(db, MICHAEL, MIDNIGHT, 'reminder').find((r) => r.trigger.params.name === t.name)!;
    assert.deepEqual([run.targets, run.delivered, run.skipped], [2, 1, 1]);
    // System notices cannot be switched off.
    api.setTenantPlan(db, ADMIN, MIDNIGHT, 'enterprise');
    assert.equal(count(MICHAEL, 'notif.plan_changed'), 1);
  });

  it('17. CRM search and filters work', () => {
    const all = crm.queryPlayers(db, MICHAEL, MIDNIGHT);
    assert.equal(all.total, all.rows.length);
    const q = (query: crm.PlayerQuery) => crm.queryPlayers(db, MICHAEL, MIDNIGHT, query).rows;
    // Search by name, username and member id.
    assert.deepEqual(q({ search: 'sarah klein' }).map((r) => r.userId), [CAST.sarah]);
    assert.deepEqual(q({ search: 'SARAHK' }).map((r) => r.userId), [CAST.sarah]);
    const sarah = q({ search: 'Sarah Klein' })[0]!;
    assert.deepEqual(q({ search: crm.memberId(db.clubs[MIDNIGHT]!, sarah.memberNo!) }).map((r) => r.userId), [CAST.sarah]);
    assert.equal(q({ search: 'no such person' }).length, 0);
    // Status.
    for (const status of ['active', 'pending', 'suspended', 'banned', 'rejected'] as const) {
      const rows = q({ statuses: [status] });
      assert.equal(rows.length, db.memberships.filter((m) => m.clubId === MIDNIGHT && m.status === status).length, status);
      assert.ok(rows.every((r) => r.status === status));
    }
    assert.ok(q({ statuses: ['none'] }).some((r) => r.userId === CAST.david), 'followers who are not members');
    // Tags (all listed tags must be present), assignment, following.
    const vip = tagId(MIDNIGHT, 'VIP Member');
    const regular = tagId(MIDNIGHT, 'Regular Player');
    assert.ok(q({ tagIds: [vip, regular] }).every((r) => r.tagIds.includes(vip) && r.tagIds.includes(regular)));
    assert.ok(q({ tagIds: [vip, regular] }).some((r) => r.userId === CAST.sarah));
    assert.ok(q({ assignedTo: MICHAEL }).some((r) => r.userId === CAST.sarah));
    assert.ok(q({ assignedTo: 'none' }).every((r) => r.assignedTo === null));
    assert.equal(q({ following: true }).length, api.followerCount(db, MIDNIGHT));
    // Activity and tournaments.
    assert.equal(q({ active: true }).length, compute.activePlayerIds(db, MIDNIGHT, 30, NOW).size);
    assert.ok(q({ lifecycle: ['returning'] }).every((r) => r.tournaments >= 2));
    assert.ok(q({ lifecycle: ['approved'] }).some((r) => r.userId === CAST.jonathan));
    assert.ok(q({ lifecycle: ['new_follower'] }).some((r) => r.userId === CAST.david));
    assert.ok(q({ minTournaments: 10 }).every((r) => r.tournaments >= 10));
    assert.ok(q({ maxTournaments: 0, statuses: ['active'] }).every((r) => r.tournaments === 0));
    assert.ok(q({ joinedWithinDays: 14 }).every((r) => r.joinedAt !== null && NOW - r.joinedAt <= 14 * DAY));
    assert.ok(q({ joinedWithinDays: 14 }).some((r) => r.userId === CAST.jonathan));
    assert.ok(q({ inactiveForDays: 60 }).every((r) => r.lastActiveAt === null || NOW - r.lastActiveAt > 60 * DAY));
    // Filters combine.
    const combined = q({ statuses: ['active'], tagIds: [regular], minTournaments: 5, active: true });
    assert.ok(combined.length > 0 && combined.every((r) => r.status === 'active' && r.tagIds.includes(regular) && r.tournaments >= 5 && r.active));
    // Sorting.
    const byTournaments = q({ sort: 'tournaments' });
    for (let i = 1; i < byTournaments.length; i++) assert.ok(byTournaments[i - 1]!.tournaments >= byTournaments[i]!.tournaments);
    const byJoined = q({ sort: 'joined', statuses: ['active'] });
    for (let i = 1; i < byJoined.length; i++) assert.ok(byJoined[i - 1]!.joinedAt! >= byJoined[i]!.joinedAt!);
    const byName = q({ sort: 'name' });
    for (let i = 1; i < byName.length; i++) assert.ok(byName[i - 1]!.name.localeCompare(byName[i]!.name) <= 0);
    assert.equal(q({ sort: 'wins' })[0]!.wins, Math.max(...all.rows.map((r) => r.wins)));
    // A segment is a filter too.
    const winners = db.crm.segments.find((s) => s.clubId === MIDNIGHT && s.system === 'winners')!;
    assert.deepEqual(new Set(q({ segmentId: winners.id }).map((r) => r.userId)), new Set(crm.resolveSegment(db, MIDNIGHT, winners.id)));
    // Nobody from another club shows up, and nothing here names another club's tags.
    const riverOnly = db.memberships.find((m) => m.clubId === RIVER && !db.crm.profiles[`${MIDNIGHT}:${m.userId}`])!;
    assert.ok(!all.rows.some((r) => r.userId === riverOnly.userId));
  });

  it('17b. bulk actions and export work on the selected players only', () => {
    const [a, b, c] = members(MIDNIGHT, 3);
    const tag = crm.createTag(db, MICHAEL, MIDNIGHT, { name: 'Bulk test', color: 'teal' }).id;
    assert.equal(crm.addTag(db, MICHAEL, MIDNIGHT, [a!, b!], tag), 2);
    crm.assignStaff(db, MICHAEL, MIDNIGHT, [a!, b!], null);
    assert.equal(crm.assignStaff(db, MICHAEL, MIDNIGHT, [a!, b!], MICHAEL), 2);
    assert.equal(crm.assignStaff(db, MICHAEL, MIDNIGHT, [a!, b!], MICHAEL), 0, 'assigning the same person again changes nothing');
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, c!).row.tagIds.includes(tag), false);
    domain('not_staff', () => crm.assignStaff(db, MICHAEL, MIDNIGHT, [a!], ALEX));
    api.setMemberPreferences(db, a!, MIDNIGHT, { shareContact: true });
    api.setMemberPreferences(db, b!, MIDNIGHT, { shareContact: false });
    const out = crm.exportPlayers(db, MICHAEL, MIDNIGHT, [a!, b!]);
    assert.equal(out.count, 2);
    const lines = out.csv.split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[0]!.startsWith('member_id,name,username,status'));
    assert.ok(out.csv.includes(db.users[a!]!.email), 'an address the member agreed to share');
    assert.ok(!out.csv.includes(db.users[b!]!.email), 'no address without consent');
    assert.ok(!out.csv.includes(db.users[c!]!.name));
    assert.equal(db.audit.at(-1)!.action, 'crm.exported');
    // Erasing the club's records of a former contact.
    crm.addNote(db, MICHAEL, MIDNIGHT, CAST.david, 'Asked about membership twice.');
    domain('still_member', () => crm.forgetPlayer(db, MICHAEL, MIDNIGHT, a!));
    crm.forgetPlayer(db, MICHAEL, MIDNIGHT, CAST.david);
    assert.equal(db.crm.notes.some((n) => n.userId === CAST.david), false);
    assert.equal(db.conversations.some((x) => x.userId === CAST.david && x.clubId === MIDNIGHT), false);
    assert.ok(api.followOf(db, CAST.david, MIDNIGHT), 'the follow is the person\'s own and is left alone');
  });

  it('15c. moving a published tournament tells the people who hold a place in it, once', () => {
    const t = api.createTournament(db, MICHAEL, MIDNIGHT, draft({ access: 'invite', startAt: time + 3 * HOUR, registrationOpensAt: time + 2 * HOUR }));
    api.publishTournament(db, MICHAEL, t.id, { announce: false });
    assert.equal(db.tournaments[t.id]!.status, 'SCHEDULED');
    api.authorizePlayer(db, MICHAEL, t.id, ALEX);
    const moved = () => notificationsOf(ALEX, 'notif.rescheduled').length;
    api.updateTournament(db, MICHAEL, t.id, { ...api.draftOf(db.tournaments[t.id]!), name: 'Renamed, same time' });
    assert.equal(moved(), 0, 'a change that is not the start time sends nothing');
    api.updateTournament(db, MICHAEL, t.id, { ...api.draftOf(db.tournaments[t.id]!), startAt: time + 5 * HOUR });
    assert.equal(moved(), 1);
    api.updateTournament(db, MICHAEL, t.id, { ...api.draftOf(db.tournaments[t.id]!), description: 'Same new time' });
    assert.equal(moved(), 1, 'not repeated');
    assert.equal(notificationsOf(DANIEL, 'notif.rescheduled').length, 0, 'someone with no place in it is not told');
  });

  it('17c. data retention trims the old activity log, keeps the milestones the reports need, and stays inside the club', () => {
    const range = { kind: 'acquisition' as const, from: NOW - 365 * DAY, to: NOW, windowDays: null, now: NOW };
    const funnelBefore = compute.funnel(db, MIDNIGHT, range).stages.map((x) => x.count);
    const riverBefore = db.crm.events.filter((e) => e.clubId === RIVER).length;
    const cutoff = NOW - 30 * DAY;
    const old = db.crm.events.filter((e) => e.clubId === MIDNIGHT && e.at < cutoff);
    const kept = old.filter((e) => ['followed', 'membership_requested', 'membership_approved'].includes(e.type)).length;
    assert.ok(old.length > kept, 'the seed has old entries that are not milestones');
    assert.equal(crm.applyRetention(db, MICHAEL, MIDNIGHT), 0, 'nothing is erased while no limit is set');
    crm.updateCrmSettings(db, MICHAEL, MIDNIGHT, { retentionMonths: 1 });
    forbidden(() => crm.applyRetention(db, DANA, MIDNIGHT));
    forbidden(() => crm.applyRetention(db, MAYA, RIVER), 'a tournament manager cannot erase data');
    const removed = crm.applyRetention(db, MICHAEL, MIDNIGHT);
    assert.equal(removed, old.length - kept);
    assert.equal(db.crm.events.filter((e) => e.clubId === MIDNIGHT && e.at < cutoff).length, kept);
    assert.equal(db.crm.events.filter((e) => e.clubId === RIVER).length, riverBefore, 'another club\'s log is untouched');
    assert.deepEqual(compute.funnel(db, MIDNIGHT, range).stages.map((x) => x.count), funnelBefore, 'the funnel is unchanged');
    assert.equal(db.audit.at(-1)!.action, 'crm.retention_applied');
    // The export marks simulated members.
    const bot = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'active' && db.users[m.userId]!.isBot)!.userId;
    const lines = crm.exportPlayers(db, MICHAEL, MIDNIGHT, [bot, MICHAEL]).csv.split('\n');
    assert.ok(lines[0]!.endsWith(',simulated'));
    assert.deepEqual(lines.slice(1).map((l) => l.split(',').at(-1)).sort(), ['no', 'yes']);
  });
});

// =============================================================================
// Automations
// =============================================================================

describe('automations', () => {
  it('a welcome message is sent once when a membership is approved', () => {
    approve(DANIEL);
    const thread = messaging.myConversations(db, DANIEL);
    assert.equal(thread.length, 1);
    assert.equal(thread[0]!.last!.automated, true);
    assert.equal(thread[0]!.last!.from, 'system');
    assert.equal(notificationsOf(DANIEL, 'notif.approved').length, 1);
    const runs = automation.listRuns(db, MICHAEL, MIDNIGHT, 'welcome');
    assert.equal(runs.length, 1);
    assert.deepEqual([runs[0]!.status, runs[0]!.targets, runs[0]!.delivered], ['ok', 1, 1]);
    // The same trigger again does nothing.
    automation.onMembershipApproved(db, MIDNIGHT, DANIEL, NOW);
    assert.equal(automation.listRuns(db, MICHAEL, MIDNIGHT, 'welcome').length, 1);
    assert.equal(db.messages.filter((m) => m.clubId === MIDNIGHT && m.automated && db.conversations.find((c) => c.id === m.conversationId)!.userId === DANIEL).length, 1);
    // The text is the club's own, and the rule can be switched off.
    automation.updateRule(db, MICHAEL, MIDNIGHT, 'welcome', { message: 'Welcome to Midnight. First tournament is on us.' });
    assert.equal(automation.previewRule(db, MICHAEL, MIDNIGHT, 'welcome').text, 'Welcome to Midnight. First tournament is on us.');
    automation.updateRule(db, MICHAEL, MIDNIGHT, 'welcome', { enabled: false });
    approve(ALEX, FINAL, db.clubs[FINAL]!.ownerId);
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!.userId;
    api.approveMember(db, MICHAEL, MIDNIGHT, pending);
    assert.equal(automation.listRuns(db, MICHAEL, MIDNIGHT, 'welcome').length, 1, 'a disabled rule does not run');
    assert.equal(automation.listRuns(db, db.clubs[FINAL]!.ownerId, FINAL, 'welcome').length, 1, 'each club has its own rules');
    domain('bad_body', () => automation.updateRule(db, MICHAEL, MIDNIGHT, 'welcome', { message: 'Hi' }));
  });

  it('a new membership request notifies the staff who decide, once', () => {
    const manager = staffWith(MIDNIGHT, 'manager');
    void manager;
    const before = notificationsOf(MICHAEL, 'notif.join_request').length;
    api.requestJoin(db, DANIEL, MIDNIGHT, 'profile');
    assert.equal(notificationsOf(MICHAEL, 'notif.join_request').length, before + 1);
    assert.equal(notificationsOf(DANA, 'notif.join_request').length, 0);
    const run = automation.listRuns(db, MICHAEL, MIDNIGHT, 'membership_request')[0]!;
    const deciders = db.memberships.filter((m) => m.clubId === MIDNIGHT && m.status === 'active' && can(db, m.userId, 'members.approve', MIDNIGHT)).length;
    assert.equal(run.targets, deciders);
    automation.onMembershipRequested(db, MIDNIGHT, DANIEL, NOW);
    assert.equal(notificationsOf(MICHAEL, 'notif.join_request').length, before + 1);
  });

  it('the inactive-player rule tags members who stopped playing and clears the tag when they return', () => {
    const run = automation.runInactiveNow(db, MICHAEL, MIDNIGHT);
    const tag = tagId(MIDNIGHT, 'Inactive Member');
    const tagged = crm.queryPlayers(db, MICHAEL, MIDNIGHT, { tagIds: [tag] }).rows;
    assert.equal(run.status, 'ok');
    assert.equal(run.delivered, tagged.length);
    assert.ok(tagged.length > 0);
    // Approved members with no tournament in the inactive period: lapsed players, and members who never played in that time.
    assert.ok(tagged.every((r) => r.status === 'active' && (r.lastPlayedAt === null ? r.joinedAt !== null && NOW - r.joinedAt > 45 * DAY : NOW - r.lastPlayedAt > 45 * DAY)));
    // The tag, the overview figure and the list behind the figure are the same people.
    const overview = analytics.overviewReport(db, MICHAEL, MIDNIGHT, NOW - 30 * DAY, NOW);
    assert.equal(overview.inactiveMembers, tagged.length);
    assert.deepEqual([...overview.inactiveMemberIds].sort(), tagged.map((r) => r.userId).sort());
    assert.equal(db.notifications.filter((n) => n.at === NOW && tagged.some((r) => r.userId === n.userId)).length, 0, 'it tags; it does not write to players');
    // The daily pass does not repeat within the day.
    assert.equal(automation.tick(db, time + HOUR) && automation.listRuns(db, MICHAEL, MIDNIGHT, 'inactive').length > 2, false);
    // One of them plays again: the tag goes at the next pass.
    const back = tagged[0]!.userId;
    const t = publish({ minPlayers: 2 });
    api.registerForTournament(db, back, t.id);
    api.registerForTournament(db, ALEX, t.id);
    api.beginSeating(db, MICHAEL, t.id);
    api.markRunning(db, t.id);
    const again = automation.runInactiveNow(db, MICHAEL, MIDNIGHT);
    assert.equal(again.detail, 'cleared:1');
    assert.ok(!crm.playerProfile(db, MICHAEL, MIDNIGHT, back).row.tagIds.includes(tag));
    // The period is the club's CRM setting; there is one definition of "inactive".
    automation.updateRule(db, MICHAEL, MIDNIGHT, 'inactive', { inactiveDays: 120 });
    assert.equal(crm.getCrmSettings(db, MICHAEL, MIDNIGHT).inactiveDays, 120);
    forbidden(() => automation.runInactiveNow(db, DANA, MIDNIGHT));
  });

  it('a scheduled announcement goes out when its time comes, not before', () => {
    const a = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Tomorrow\'s news', body: 'Scheduled for later.', audience: { type: 'members' }, scheduledAt: NOW + 2 * HOUR });
    assert.equal(a.status, 'scheduled');
    assert.equal(a.batchId, null);
    assert.equal(api.canReadAnnouncement(db, ALEX, a), false);
    assert.equal(api.canReadAnnouncement(db, MICHAEL, a), true, 'staff can see what is queued');
    const before = notificationsOf(ALEX, 'notif.announcement').length;
    assert.equal(api.publishDueAnnouncements(db, NOW + HOUR), 0);
    assert.equal(notificationsOf(ALEX, 'notif.announcement').length, before);
    time = NOW + 2 * HOUR + MIN;
    assert.equal(api.publishDueAnnouncements(db, time), 1);
    assert.equal(a.status, 'published');
    assert.equal(a.at, time, 'it is dated when it actually went out');
    assert.ok(a.batchId);
    assert.equal(notificationsOf(ALEX, 'notif.announcement').length, before + 1);
    assert.equal(api.publishDueAnnouncements(db, time + MIN), 0, 'it is not sent again');
    domain('bad_schedule', () => api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'In the past', body: 'Cannot schedule backwards.', scheduledAt: time - HOUR }));
  });
});

// =============================================================================
// Club profile and social links
// =============================================================================

describe('club profile', () => {
  it('social links are validated, optional and individually public or private', () => {
    api.updateClubProfile(db, MICHAEL, MIDNIGHT, {
      location: 'Tel Aviv',
      social: {
        instagram: { url: 'instagram.com/midnight.example', public: true },
        telegram: { url: 'https://t.me/midnight_example', public: false },
        discord: { url: '', public: true },
      },
    });
    const club = db.clubs[MIDNIGHT]!;
    assert.equal(club.social.instagram!.url, 'https://instagram.com/midnight.example');
    assert.equal(club.social.discord, undefined, 'an empty address removes the link');
    assert.deepEqual(api.clubView(db, DANIEL, MIDNIGHT).social.map((s) => s.key), ['instagram'], 'only public links are shown');
    domain('bad_social_url', () => api.updateClubProfile(db, MICHAEL, MIDNIGHT, { social: { instagram: { url: 'https://example.com/not-instagram', public: true } } }));
    domain('bad_social_url', () => api.updateClubProfile(db, MICHAEL, MIDNIGHT, { social: { website: { url: 'javascript:alert(1)', public: true } } }));
    domain('bad_social_url', () => api.updateClubProfile(db, MICHAEL, MIDNIGHT, { social: { website: { url: 'http://insecure.example', public: true } } }));
    assert.equal(club.social.instagram!.url, 'https://instagram.com/midnight.example', 'a rejected update changes nothing');
    assert.equal(api.checkSocialUrl('x', 'https://twitter.com/club').problem, null);
    assert.equal(api.checkSocialUrl('whatsapp', 'https://wa.me/123').problem, null);
    assert.equal(api.checkSocialUrl('tiktok', 'https://instagram.com/club').problem, 'wrong_site');
  });

  it('the public profile shows a non-member only what the club made public', () => {
    const view = api.clubView(db, DANIEL, FINAL);
    assert.equal(view.members, null, 'this club keeps its member count private');
    assert.equal(view.showResults, false);
    assert.equal(view.tournaments.length, 0);
    assert.equal(view.announcements.length, 0);
    const midnight = api.clubView(db, DANIEL, MIDNIGHT);
    assert.equal(typeof midnight.members, 'number');
    assert.equal(midnight.showResults, true);
    assert.ok(midnight.tournaments.length >= 1 && midnight.tournaments.every((t) => t.visibility === 'public'));
    const asMember = api.clubView(db, ALEX, MIDNIGHT);
    assert.ok(asMember.tournaments.length > midnight.tournaments.length);
    assert.ok(!asMember.tournaments.some((t) => t.access === 'invite'), 'not even members see an invitation-only event they are not invited to');
    assert.ok(!asMember.tournaments.some((t) => t.status === 'DRAFT'));
    assert.ok(asMember.announcements.length > midnight.announcements.length);
  });

  it('a new tenant gets its own empty CRM', () => {
    const club = api.createTenant(db, ADMIN, { clubName: 'Harbor Cardroom', ownerName: 'Noa Ben-Ami', planId: 'starter', joinPolicy: 'open', accent: '#3B82F6' });
    const owner = club.ownerId;
    assert.equal(crm.listTags(db, owner, club.id).length, crm.STARTER_TAGS.length);
    assert.equal(crm.listSegments(db, owner, club.id).length, crm.SYSTEM_SEGMENTS.length);
    assert.equal(automation.listRules(db, owner, club.id).length, 5);
    assert.equal(crm.queryPlayers(db, owner, club.id).rows.length, 1);
    forbidden(() => crm.queryPlayers(db, MICHAEL, club.id));
    // An open club admits at once, and the journey is recorded.
    api.requestJoin(db, DANIEL, club.id, 'club_id');
    const m = compute.milestones(db, club.id).get(DANIEL)!;
    assert.equal(m.requestedAt, NOW);
    assert.equal(m.approvedAt, NOW);
    assert.equal(db.crm.profiles[`${club.id}:${DANIEL}`]!.source, 'direct');
    assert.equal(db.crm.profiles[`${club.id}:${DANIEL}`]!.memberNo, 2);
  });
});

// =============================================================================
// Analytics
// =============================================================================

/** A clean club with a known population, so every figure can be checked by hand. */
function syntheticClub(counts: { followers: number; requested: number; approved: number; first: number; returning: number }, start: number) {
  const club = api.createTenant(db, ADMIN, { clubName: 'Synthetic Club', ownerName: 'Test Owner', planId: 'enterprise', joinPolicy: 'approval', accent: '#3B82F6' });
  const ids: string[] = [];
  for (let i = 0; i < counts.followers; i++) {
    const id = `u_syn${i}`;
    db.users[id] = { id, name: `Synthetic ${i}`, handle: `syn${i}`, hue: 0, isBot: true, style: 'balanced', joinedAt: start, platformRole: null, demoIdentity: null, lang: 'en', email: `syn${i}@example.com`, signupLinkId: null };
    ids.push(id);
    const followedAt = start + i * MIN;
    db.follows.push({ clubId: club.id, userId: id, at: followedAt, notify: true });
    logEvent(db, club.id, id, 'followed', id, {}, followedAt);
    if (i < counts.requested) logEvent(db, club.id, id, 'membership_requested', id, {}, followedAt + DAY);
    if (i < counts.approved) {
      logEvent(db, club.id, id, 'membership_approved', club.ownerId, {}, followedAt + 2 * DAY);
      db.memberships.push({ clubId: club.id, userId: id, role: 'player', status: 'active', requestedAt: followedAt + DAY, joinedAt: followedAt + 2 * DAY, lastActiveAt: followedAt + 2 * DAY, demoPoints: 10_000, via: 'profile', decidedAt: followedAt + 2 * DAY, announcements: true, shareContact: false });
    }
  }
  const result = (n: number, tournamentId: string, startedAt: number): void => {
    const players = ids.slice(0, n);
    db.results[tournamentId] = {
      tournamentId, clubId: club.id, name: tournamentId, format: 'mtt', startedAt, completedAt: startedAt + HOUR, durationMin: 60, entrants: n, hands: 100, totalChips: n * 10_000, levelReached: 8, seeded: false,
      places: players.map((userId, i) => ({ place: i + 1, userId, name: db.users[userId]!.name, isBot: true, points: 1, bustedBy: null, bustLevel: null })),
    };
  };
  result(counts.first, 'syn_t1', start + 6 * DAY);
  result(counts.returning, 'syn_t2', start + 9 * DAY);
  return { club, ids, owner: club.ownerId, result };
}

describe('analytics', () => {
  const START = NOW - 60 * DAY;
  const RANGE = { from: NOW - 61 * DAY, to: NOW - 55 * DAY };
  const SHAPE = { followers: 1000, requested: 600, approved: 480, first: 300, returning: 180 };

  it('18. funnel stages use the correct cohort', () => {
    const { club, ids } = syntheticClub(SHAPE, START);
    const f = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 30, now: NOW });
    assert.deepEqual(f.stages.map((s) => [s.key, s.count]), [['followers', 1000], ['requested', 600], ['approved', 480], ['first', 300], ['returning', 180]]);
    assert.equal(f.cohort, 1000);
    // Each stage is a subset of the one before it: nobody appears later without having passed the earlier stage.
    for (let i = 1; i < f.stages.length; i++) {
      const previous = new Set(f.stages[i - 1]!.userIds);
      assert.ok(f.stages[i]!.userIds.every((id) => previous.has(id)));
    }
    // People outside the cohort never enter it, whatever they did later.
    const late = 'u_late';
    db.users[late] = { ...db.users[ids[0]!]!, id: late, name: 'Late Follower', handle: 'late' };
    logEvent(db, club.id, late, 'followed', late, {}, NOW - 20 * DAY);
    logEvent(db, club.id, late, 'membership_requested', late, {}, NOW - 19 * DAY);
    logEvent(db, club.id, late, 'membership_approved', club.ownerId, {}, NOW - 18 * DAY);
    const again = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 30, now: NOW });
    assert.deepEqual(again.stages.map((s) => s.count), [1000, 600, 480, 300, 180]);
    // Someone who asked to join before following started in the membership pipeline, not as a follower.
    const direct = 'u_direct';
    db.users[direct] = { ...db.users[ids[0]!]!, id: direct, name: 'Direct Invitee', handle: 'direct' };
    logEvent(db, club.id, direct, 'membership_requested', direct, {}, START + HOUR);
    logEvent(db, club.id, direct, 'membership_approved', club.ownerId, {}, START + 2 * HOUR);
    logEvent(db, club.id, direct, 'followed', direct, {}, START + 3 * HOUR);
    const third = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 30, now: NOW });
    assert.equal(third.cohort, 1000);
    assert.equal(third.alreadyInPipeline, 1);
    // An observation window that has not elapsed excludes the person instead of scoring a failure.
    const recent = compute.funnel(db, club.id, { kind: 'followers', from: NOW - 25 * DAY, to: NOW, windowDays: 30, now: NOW });
    assert.equal(recent.cohort, 0);
    assert.equal(recent.tooRecent, 1, 'the late follower is waiting, not lost');
    const toDate = compute.funnel(db, club.id, { kind: 'followers', from: NOW - 25 * DAY, to: NOW, windowDays: null, now: NOW });
    assert.deepEqual(toDate.stages.map((s) => s.count), [1, 1, 1, 0, 0]);
    // A milestone reached after the window does not count inside it.
    const short = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 7, now: NOW });
    assert.deepEqual(short.stages.map((s) => s.count), [1000, 600, 480, 300, 0], 'the second tournament came on day 9');
  });

  it('19. users are counted only once per stage', () => {
    const { club, ids, result } = syntheticClub(SHAPE, START);
    // Repeat everything for the first hundred people: follow again, ask again, play five more times.
    for (const id of ids.slice(0, 100)) {
      logEvent(db, club.id, id, 'unfollowed', id, {}, START + 20 * DAY);
      logEvent(db, club.id, id, 'followed', id, {}, START + 21 * DAY);
      logEvent(db, club.id, id, 'membership_requested', id, {}, START + 22 * DAY);
      logEvent(db, club.id, id, 'membership_approved', club.ownerId, {}, START + 23 * DAY);
    }
    for (let k = 0; k < 5; k++) result(100, `syn_extra${k}`, START + (12 + k) * DAY);
    const f = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 30, now: NOW });
    assert.deepEqual(f.stages.map((s) => s.count), [1000, 600, 480, 300, 180]);
    for (const s of f.stages) assert.equal(new Set(s.userIds).size, s.userIds.length, `${s.key} has no duplicates`);
    // Returning means "played a second tournament", however many more follow.
    assert.equal(compute.lifecycleOf(db, club.id, ids[0]!, START + 20 * DAY).stage, 'returning');
    assert.equal(compute.lifecycleOf(db, club.id, ids[0]!, START + 20 * DAY).tournaments, 7);
  });

  it('20. conversion percentages use correct denominators', () => {
    const { club } = syntheticClub(SHAPE, START);
    const f = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 30, now: NOW });
    const [followers, requested, approved, first, returning] = f.stages;
    // Overall conversion: share of the original cohort.
    assert.deepEqual(f.stages.map((s) => s.ofCohort), [1, 0.6, 0.48, 0.3, 0.18]);
    // Stage-to-stage conversion: share of the previous stage.
    assert.equal(followers!.ofPrevious, null);
    assert.equal(requested!.ofPrevious, 0.6);
    assert.equal(approved!.ofPrevious, 0.8);
    assert.equal(first!.ofPrevious, 0.625);
    assert.equal(returning!.ofPrevious, 0.6);
    // Drop-off: people lost since the previous stage, and that as a share of the previous stage.
    assert.deepEqual(f.stages.map((s) => s.dropOff), [null, 400, 120, 180, 120]);
    assert.deepEqual(f.stages.map((s) => s.dropOffRate), [null, 0.4, 0.2, 0.375, 0.4]);
    // The four headline figures, each with its numerator and denominator.
    const k = compute.conversionKpis(db, club.id, RANGE.from, RANGE.to + 5 * DAY, 30, NOW);
    assert.deepEqual([k.followerToMember.numerator, k.followerToMember.denominator, k.followerToMember.value], [480, 1000, 0.48]);
    assert.deepEqual([k.memberToPlayer.numerator, k.memberToPlayer.denominator, k.memberToPlayer.value], [300, 480, 0.625]);
    const wide = compute.conversionKpis(db, club.id, START, START + 20 * DAY, 30, NOW);
    assert.deepEqual([wide.repeatRate.numerator, wide.repeatRate.denominator, wide.repeatRate.value], [180, 300, 0.6]);
    assert.deepEqual([wide.tournamentsPerActive.numerator, wide.tournamentsPerActive.denominator, wide.tournamentsPerActive.value], [480, 300, 1.6], '480 participations by 300 unique players');
    // An empty period has no rate, not a zero.
    const empty = compute.conversionKpis(db, club.id, START - 200 * DAY, START - 190 * DAY, 30, NOW);
    assert.equal(empty.followerToMember.value, null);
    assert.equal(empty.followerToMember.denominator, 0);
    assert.equal(wide.followerToMember.previous, null, 'nothing happened in the period before, so there is no change to report');
    assert.equal(wide.followerToMember.change, null);
    assert.equal(wide.repeatRate.trend.length, 6);
  });

  it('21. direct invitees appear in the appropriate acquisition view', () => {
    const { club, ids, result } = syntheticClub(SHAPE, START);
    // Fifty people who were invited directly: they asked to join without ever following.
    const direct: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `u_dir${i}`;
      db.users[id] = { ...db.users[ids[0]!]!, id, name: `Direct ${i}`, handle: `dir${i}` };
      direct.push(id);
      logEvent(db, club.id, id, 'membership_requested', id, { via: 'link' }, START + i * MIN);
      if (i < 40) logEvent(db, club.id, id, 'membership_approved', club.ownerId, {}, START + DAY + i * MIN);
    }
    db.results.syn_direct = { ...db.results.syn_t1!, tournamentId: 'syn_direct', startedAt: START + 3 * DAY, completedAt: START + 3 * DAY + HOUR, entrants: 20, places: direct.slice(0, 20).map((userId, i) => ({ place: i + 1, userId, name: userId, isBot: true, points: 1, bustedBy: null, bustLevel: null })) };
    void result;
    // The followers funnel does not count them: they were never followers.
    const followers = compute.funnel(db, club.id, { kind: 'followers', ...RANGE, windowDays: 30, now: NOW });
    assert.deepEqual(followers.stages.map((s) => s.count), [1000, 600, 480, 300, 180]);
    assert.ok(!followers.stages.some((s) => s.userIds.some((id) => id.startsWith('u_dir'))));
    // The acquisition view starts from the request, so it has both groups.
    const acquisition = compute.funnel(db, club.id, { kind: 'acquisition', ...RANGE, windowDays: 30, now: NOW });
    assert.deepEqual(acquisition.stages.map((s) => [s.key, s.count]), [['requested', 650], ['approved', 520], ['first', 320], ['returning', 180]]);
    assert.equal(acquisition.stages[0]!.userIds.filter((id) => id.startsWith('u_dir')).length, 50);
    assert.equal(acquisition.stages[1]!.ofPrevious, 520 / 650);
    // Source attribution: a link's label when there is one, otherwise "unknown". Never a guess.
    const link = crm.createLink(db, club.ownerId, club.id, { kind: 'club', source: 'telegram', label: 'Channel', expiresInDays: null, maxUses: null });
    api.openInvite(db, DANIEL, link.token);
    api.followClub(db, DANIEL, club.id, { linkToken: link.token });
    api.followClub(db, ALEX, club.id);
    const rows = compute.acquisition(db, club.id, NOW - DAY, NOW + DAY);
    const row = (source: string) => rows.find((r) => r.source === source)!;
    assert.deepEqual([row('telegram').links, row('telegram').opens, row('telegram').follows], [1, 1, 1]);
    assert.equal(row('unknown').follows, 1, 'Alex followed from the profile: no source is invented');
    assert.equal(rows.reduce((n, r) => n + r.follows, 0), 2, 'every follower is in exactly one source row');
    // First touch wins: opening another link later does not rewrite the source.
    const second = crm.createLink(db, club.ownerId, club.id, { kind: 'club', source: 'instagram', label: 'Bio', expiresInDays: null, maxUses: null });
    api.openInvite(db, DANIEL, second.token);
    assert.equal(db.crm.profiles[`${club.id}:${DANIEL}`]!.source, 'telegram');
  });

  it('22. tournament registration alone does not count as participation', () => {
    approve(DANIEL);
    const t = publish({ minPlayers: 2 });
    api.registerForTournament(db, DANIEL, t.id);
    assert.equal(compute.playerParticipations(db, MIDNIGHT, DANIEL).length, 0);
    assert.equal(compute.milestones(db, MIDNIGHT).get(DANIEL)!.firstPlayedAt, null);
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL).stage, 'approved');
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).stats.tournaments, 0);
    const funnelBefore = compute.funnel(db, MIDNIGHT, { kind: 'acquisition', from: NOW - DAY, to: NOW + DAY, windowDays: null });
    assert.ok(funnelBefore.stages[1]!.userIds.includes(DANIEL), 'approved');
    assert.ok(!funnelBefore.stages[2]!.userIds.includes(DANIEL), 'but not a participant');
    // A cancelled tournament never becomes participation either.
    api.cancelTournament(db, MICHAEL, t.id, 'Test');
    assert.equal(compute.playerParticipations(db, MIDNIGHT, DANIEL).length, 0);
    // Being dealt in does: once the tournament is running, the player counts.
    const t2 = publish({ name: 'Runs for real', minPlayers: 2 });
    api.registerForTournament(db, DANIEL, t2.id);
    api.registerForTournament(db, ALEX, t2.id);
    const requestedOnly = publish({ name: 'Request only', access: 'approval' });
    api.registerForTournament(db, DANIEL, requestedOnly.id);
    api.beginSeating(db, MICHAEL, t2.id);
    assert.equal(compute.playerParticipations(db, MIDNIGHT, DANIEL).length, 0, 'seating is not yet play');
    api.markRunning(db, t2.id);
    assert.equal(compute.playerParticipations(db, MIDNIGHT, DANIEL).length, 1);
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL).stage, 'first_time');
    assert.equal(api.clubUsage(db, MIDNIGHT).monthlyActive, compute.activePlayerIds(db, MIDNIGHT, 30).size, 'the billing figure is the same count');
  });

  it('23. second-tournament participation updates retention metrics', () => {
    approve(DANIEL);
    const play = (name: string, others: string[]) => {
      const t = publish({ name, minPlayers: 2 });
      for (const id of [DANIEL, ...others]) api.registerForTournament(db, id, t.id);
      api.beginSeating(db, MICHAEL, t.id);
      api.markRunning(db, t.id);
      const ids = [DANIEL, ...others];
      api.completeTournament(db, t.id, {
        tournamentId: t.id, clubId: MIDNIGHT, name, format: 'mtt', startedAt: time, completedAt: time + HOUR, durationMin: 60, entrants: ids.length, hands: 40, totalChips: 20_000 * ids.length, levelReached: 5, seeded: false,
        places: ids.map((userId, i) => ({ place: i + 1, userId, name: db.users[userId]!.name, isBot: db.users[userId]!.isBot, points: 5, bustedBy: null, bustLevel: null })),
      });
    };
    const range: [number, number] = [NOW - DAY, NOW + 30 * DAY];
    // Two different partners with earlier history, so only Daniel is new, repeats and returns in the window.
    const veterans = db.memberships.filter((m) => m.clubId === MIDNIGHT && m.status === 'active' && db.users[m.userId]!.isBot && compute.playerParticipations(db, MIDNIGHT, m.userId).some((p) => p.at < NOW - DAY)).map((m) => m.userId);
    const [partner, partner2] = [veterans[0] ?? ALEX, veterans[1] ?? ALEX];
    const base = compute.retention(db, MIDNIGHT, ...range, NOW + 30 * DAY);
    play('First', [partner]);
    const afterOne = compute.retention(db, MIDNIGHT, ...range, NOW + 30 * DAY);
    assert.equal(afterOne.newParticipants, base.newParticipants + 1);
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL).stage, 'first_time');
    const kpi1 = compute.conversionKpis(db, MIDNIGHT, ...range, null, NOW + 30 * DAY).repeatRate;
    time += 3 * DAY;
    play('Second', [partner2]);
    const afterTwo = compute.retention(db, MIDNIGHT, ...range, NOW + 30 * DAY);
    assert.equal(afterTwo.newParticipants, afterOne.newParticipants, 'still one new participant');
    assert.equal(afterTwo.repeat.find((r) => r.days === 7)!.returned, afterOne.repeat.find((r) => r.days === 7)!.returned + 1);
    assert.equal(afterTwo.playedTwice, afterOne.playedTwice + 1);
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL).stage, 'returning');
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).row.lifecycle, 'returning');
    const kpi2 = compute.conversionKpis(db, MIDNIGHT, ...range, null, NOW + 30 * DAY).repeatRate;
    assert.equal(kpi2.denominator, kpi1.denominator);
    assert.equal(kpi2.numerator, kpi1.numerator + 1);
    const funnel = compute.funnel(db, MIDNIGHT, { kind: 'acquisition', from: NOW - DAY, to: NOW + DAY, windowDays: null });
    assert.ok(funnel.stages[3]!.userIds.includes(DANIEL), 'Daniel is in the returning stage');
    // Lifecycle is about what a person did, not what they may do: a suspended member is still a returning participant.
    api.suspendMember(db, MICHAEL, MIDNIGHT, DANIEL);
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL).stage, 'returning');
    assert.equal(crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL).row.status, 'suspended');
    domain('members_only', () => api.registerForTournament(db, DANIEL, publish({ name: 'Third' }).id));
    // And they become inactive only with time.
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL, time + 46 * DAY).stage, 'inactive');
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL, time + 46 * DAY).active, false);
    // A window that has not elapsed is reported as not measured rather than as zero.
    const early = compute.retention(db, MIDNIGHT, NOW - DAY, NOW + 30 * DAY, NOW + 5 * DAY);
    assert.equal(early.repeat.find((r) => r.days === 30)!.measured, 0);
    assert.equal(early.repeat.find((r) => r.days === 30)!.rate, null);
  });

  it('24. date filters work correctly', () => {
    const { club } = syntheticClub(SHAPE, START);
    const count = (from: number, to: number) => compute.funnel(db, club.id, { kind: 'followers', from, to, windowDays: 30, now: NOW }).cohort;
    // Followers were created one per minute from START.
    assert.equal(count(START, START + 99 * MIN), 100);
    assert.equal(count(START + 100 * MIN, START + 199 * MIN), 100);
    assert.equal(count(START - DAY, START - MIN), 0);
    assert.equal(count(START + 999 * MIN, START + 2000 * MIN), 1, 'the range is inclusive at both ends');
    assert.equal(count(START - 400 * DAY, NOW), 1000, 'all time');
    // The previous period is the same length, immediately before.
    const report = analytics.funnelReport(db, club.ownerId, club.id, { kind: 'followers', from: START + 500 * MIN, to: START + 999 * MIN, windowDays: 30 });
    assert.equal(report.current.cohort, 500);
    assert.equal(report.previous.query.to, START + 500 * MIN - 1, 'ends just before the current period starts');
    assert.equal(report.previous.query.from, START + MIN - 1);
    assert.equal(report.previous.cohort, 499, 'followers 1 to 499; follower 500 belongs to the current period only');
    assert.equal(report.current.stages[0]!.userIds.some((id) => report.previous.stages[0]!.userIds.includes(id)), false, 'the two periods never share a person');
    // Overview and engagement honour the same range.
    const overview = compute.overview(db, club.id, START, START + 3 * DAY, NOW);
    assert.equal(overview.newMembers, 480);
    assert.equal(overview.growth.at(-1)!.value - overview.growth[0]!.value >= 0, true);
    assert.equal(compute.overview(db, club.id, START + 4 * DAY, START + 5 * DAY, NOW).newMembers, 0);
    const week = compute.overview(db, club.id, START + 5 * DAY, START + 7 * DAY, NOW);
    assert.equal(week.activePlayers, 300);
    assert.equal(week.tournamentsPlayed, 1);
    assert.equal(week.returningPlayers, 0);
    const later = compute.overview(db, club.id, START + 8 * DAY, START + 10 * DAY, NOW);
    assert.equal(later.activePlayers, 180);
    assert.equal(later.returningPlayers, 180);
    const e = compute.engagement(db, club.id, START, START + 10 * DAY, NOW);
    assert.equal(e.completedParticipations, 480);
    assert.equal(e.tournamentsCompleted, 2);
    assert.equal(e.averageEntrants, 240);
    assert.equal(e.requests, 600);
    assert.equal(e.approvalRate, 1, '480 decided, 480 approved (the rest were never decided)');
    assert.equal(e.averageApprovalHours, 24);
    assert.equal(e.dau.length, 11);
    // On the seeded club, a longer range never has fewer active players than a shorter one inside it.
    const seven = compute.overview(db, MIDNIGHT, NOW - 7 * DAY, NOW).activePlayers;
    const thirty = compute.overview(db, MIDNIGHT, NOW - 30 * DAY, NOW).activePlayers;
    const ninety = compute.overview(db, MIDNIGHT, NOW - 90 * DAY, NOW).activePlayers;
    assert.ok(seven <= thirty && thirty <= ninety);
    assert.equal(thirty, compute.activePlayerIds(db, MIDNIGHT, 30, NOW).size);
  });

  it('25. funnel drill-down returns the matching player records', () => {
    const report = analytics.funnelReport(db, MICHAEL, MIDNIGHT, { kind: 'followers', from: NOW - 120 * DAY, to: NOW, windowDays: 30 });
    assert.ok(report.current.cohort > 20, 'the seeded club has a real cohort to drill into');
    for (const stage of report.current.stages) {
      const rows = crm.queryPlayers(db, MICHAEL, MIDNIGHT, { userIds: stage.userIds }).rows;
      assert.equal(rows.length, stage.count, `${stage.key}: the list has exactly as many people as the bar says`);
      assert.deepEqual(new Set(rows.map((r) => r.userId)), new Set(stage.userIds));
    }
    // The list really is the stage: everyone under "returning" has played at least twice, by the records.
    const returning = report.current.stages.at(-1)!;
    for (const id of returning.userIds) assert.ok(Object.values(db.results).filter((r) => r.clubId === MIDNIGHT && r.places.some((p) => p.userId === id)).length >= 2);
    const first = report.current.stages[3]!;
    for (const id of first.userIds) assert.ok(compute.milestones(db, MIDNIGHT).get(id)!.firstPlayedAt !== null);
    // From the drill-down, staff can act on exactly that list.
    const saved = crm.createStaticSegment(db, MICHAEL, MIDNIGHT, 'Returning, autumn cohort', returning.userIds);
    assert.deepEqual(new Set(crm.resolveSegment(db, MIDNIGHT, saved.id)), new Set(returning.userIds));
    const tag = tagId(MIDNIGHT, 'Returning Player');
    crm.addTag(db, MICHAEL, MIDNIGHT, returning.userIds, tag);
    assert.ok(returning.userIds.every((id) => db.crm.profiles[`${MIDNIGHT}:${id}`]!.tagIds.includes(tag)));
    const a = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'community', title: 'Good to have you back', body: 'For our returning players.', audience: { type: 'segment', segmentId: saved.id } });
    assert.equal(db.batches.find((b) => b.id === a.batchId)!.eligible, returning.count);
    // KPI numerators match funnel stages for the same query.
    const kpis = analytics.kpiReport(db, MICHAEL, MIDNIGHT, NOW - 120 * DAY, NOW, 30);
    assert.equal(kpis.followerToMember.numerator, report.current.stages[2]!.count);
    assert.equal(kpis.followerToMember.denominator, report.current.cohort);
  });

  it('26. no club can view another club\'s private analytics', () => {
    const range = [NOW - 90 * DAY, NOW] as const;
    for (const intruder of [DANA, MAYA, ALEX, DANIEL, ADMIN]) {
      forbidden(() => analytics.funnelReport(db, intruder, MIDNIGHT, { kind: 'followers', from: range[0], to: range[1], windowDays: 30 }), intruder);
      forbidden(() => analytics.kpiReport(db, intruder, MIDNIGHT, ...range, 30));
      forbidden(() => analytics.retentionReport(db, intruder, MIDNIGHT, ...range));
      forbidden(() => analytics.acquisitionReport(db, intruder, MIDNIGHT, ...range));
      forbidden(() => analytics.engagementReport(db, intruder, MIDNIGHT, ...range));
      forbidden(() => analytics.overviewReport(db, intruder, MIDNIGHT, ...range));
      forbidden(() => crm.queryPlayers(db, intruder, MIDNIGHT));
      forbidden(() => crm.listSegments(db, intruder, MIDNIGHT));
      forbidden(() => crm.listLinks(db, intruder, MIDNIGHT));
      forbidden(() => automation.listRuns(db, intruder, MIDNIGHT));
      forbidden(() => api.clubAnnouncementLog(db, intruder, MIDNIGHT));
    }
    // Each owner sees their own club, and the figures are different clubs' figures.
    const mine = analytics.overviewReport(db, MICHAEL, MIDNIGHT, ...range);
    const theirs = analytics.overviewReport(db, DANA, RIVER, ...range);
    assert.equal(mine.approvedMembers, db.memberships.filter((m) => m.clubId === MIDNIGHT && m.status === 'active').length);
    assert.equal(theirs.approvedMembers, db.memberships.filter((m) => m.clubId === RIVER && m.status === 'active').length);
    assert.notEqual(mine.approvedMembers, theirs.approvedMembers);
    // Activity in one club does not move the other's numbers.
    const before = JSON.stringify(analytics.funnelReport(db, DANA, RIVER, { kind: 'followers', from: range[0], to: range[1], windowDays: null }).current.stages.map((s) => s.count));
    api.followClub(db, DANIEL, MIDNIGHT);
    approve(DANIEL);
    const after = JSON.stringify(analytics.funnelReport(db, DANA, RIVER, { kind: 'followers', from: range[0], to: range[1], windowDays: null }).current.stages.map((s) => s.count));
    assert.equal(after, before);
    // Platform staff get platform-level usage only.
    assert.ok(analytics.platformMonthlyActive(db, ADMIN)[MIDNIGHT]!.length > 0);
    forbidden(() => analytics.platformMonthlyActive(db, MICHAEL));
  });

  it('seeded figures are derived from records, not stored', () => {
    for (const clubId of [MIDNIGHT, RIVER, FINAL]) {
      const o = compute.overview(db, clubId, NOW - 30 * DAY, NOW, NOW);
      const players = new Set<string>();
      const tournaments = new Set<string>();
      for (const r of Object.values(db.results)) {
        if (r.clubId !== clubId || r.startedAt < NOW - 30 * DAY || r.startedAt > NOW) continue;
        tournaments.add(r.tournamentId);
        for (const p of r.places) players.add(p.userId);
      }
      for (const t of Object.values(db.tournaments)) if (t.clubId === clubId && t.status === 'RUNNING') for (const r of t.registrations) players.add(r.userId);
      assert.equal(o.activePlayers, players.size);
      assert.equal(o.tournamentsPlayed, tournaments.size);
      assert.equal(o.followers, db.follows.filter((f) => f.clubId === clubId).length);
      assert.equal(o.includesDemoHistory, true, 'and the report says it includes demo history');
      assert.equal(o.growth.at(-1)!.value, o.approvedMembers, 'the growth line ends on today\'s real member count');
    }
    assert.equal('analytics' in db, false, 'there is no stored analytics series any more');
  });
});

// =============================================================================
// Demo journey (the scripted walk-through, at service level)
// =============================================================================

describe('guided demo', () => {
  it('Daniel follows, joins, is tagged, plays twice and becomes a returning player; another club sees none of it', () => {
    const { runtime } = makeRuntime();
    // 1–3. Follow, request, approve.
    api.followClub(db, DANIEL, MIDNIGHT);
    assert.equal(membershipOf(db, DANIEL, MIDNIGHT), undefined);
    api.requestJoin(db, DANIEL, MIDNIGHT, 'profile');
    assert.equal(membershipOf(db, DANIEL, MIDNIGHT)!.status, 'pending');
    api.approveMember(db, MICHAEL, MIDNIGHT, DANIEL);
    assert.equal(notificationsOf(DANIEL, 'notif.approved').length, 1);
    // 4. Tag.
    crm.addTag(db, MICHAEL, MIDNIGHT, [DANIEL], tagId(MIDNIGHT, 'Weekend Player'));
    // 5. A private tournament: 20,000 chips, 100 seats, ten-minute levels, approval per player.
    const structure = presetStructure('regular');
    structure.startingStack = 20_000;
    const t = api.createTournament(db, MICHAEL, MIDNIGHT, draft({ structure, startMode: 'manual', demoSpeed: 240, access: 'approval' }));
    api.publishTournament(db, MICHAEL, t.id);
    assert.deepEqual([t.visibility, t.access, t.maxPlayers, t.structure.startingStack, t.structure.entries[0]!.minutes], ['private', 'approval', 100, 20_000, 10]);
    // 6. Daniel asks, Michael approves; others cannot get in.
    assert.equal(runtime.register(DANIEL, t.id).status, 'requested');
    api.approveRegistration(db, MICHAEL, t.id, DANIEL);
    assert.equal(api.registrationOf(t, DANIEL)!.status, 'registered');
    domain('members_only', () => runtime.register(CAST.david, t.id));
    assert.equal(runtime.register(CAST.jonathan, t.id).status, 'requested', 'Jonathan is a member but is not authorised for this tournament');
    assert.equal(api.registeredCount(t), 1);
    forbidden(() => api.approveRegistration(db, DANA, t.id, CAST.jonathan));
    // 7. Play it for real.
    assert.equal(runtime.addSimulatedPlayers(MICHAEL, t.id, 7), 7);
    runtime.beginSeating(MICHAEL, t.id);
    assert.equal(api.registrationOf(t, CAST.jonathan)!.status, 'rejected', 'undecided requests are released at the start');
    run(runtime, 8_000);
    assert.equal(t.status, 'RUNNING');
    forbidden(() => runtime.attach(CAST.david, t.id, 1, false, { turnSeconds: 20, pace: 1 }));
    run(runtime, 40 * MIN, 5_000);
    assert.equal(t.status, 'COMPLETED');
    assert.ok(db.results[t.id]!.places.some((p) => p.userId === DANIEL));
    assert.equal(compute.lifecycleOf(db, MIDNIGHT, DANIEL).stage, 'first_time');
    // 8. A second tournament.
    const t2 = api.createTournament(db, MICHAEL, MIDNIGHT, draft({ name: 'Monday Rematch', startMode: 'manual', demoSpeed: 240, startAt: time + 30 * MIN }));
    api.publishTournament(db, MICHAEL, t2.id);
    runtime.register(DANIEL, t2.id);
    runtime.addSimulatedPlayers(MICHAEL, t2.id, 5);
    runtime.beginSeating(MICHAEL, t2.id);
    run(runtime, 40 * MIN, 5_000);
    assert.equal(t2.status, 'COMPLETED');
    // 9. Lifecycle.
    const profile = crm.playerProfile(db, MICHAEL, MIDNIGHT, DANIEL);
    assert.equal(profile.row.lifecycle, 'returning');
    assert.equal(profile.stats.tournaments, 2);
    assert.equal(profile.history.length, 2);
    // 10. A public announcement reaches followers according to their preferences.
    const a = api.publishAnnouncement(db, MICHAEL, MIDNIGHT, { kind: 'news', title: 'Sunday Championship results', body: 'Congratulations to everyone who played.', audience: { type: 'everyone' } });
    const batch = db.batches.find((b) => b.id === a.batchId)!;
    assert.ok(batch.delivered.includes(DANIEL) && batch.delivered.includes(CAST.david));
    assert.equal(batch.delivered.length + batch.optedOut, batch.eligible);
    // 11. Daniel writes, Michael answers.
    messaging.sendPlayerMessage(db, DANIEL, MIDNIGHT, 'Great tournament. When is the next one?');
    messaging.sendClubMessage(db, MICHAEL, MIDNIGHT, DANIEL, 'Next Sunday, same time.');
    assert.equal(messaging.myConversations(db, DANIEL)[0]!.last!.body, 'Next Sunday, same time.');
    // 12. Segment: Tag = Weekend Player AND Status = Approved.
    const segment = crm.createSegment(db, MICHAEL, MIDNIGHT, { name: 'Weekend players', match: 'all', rules: [{ field: 'tag', op: 'is', value: tagId(MIDNIGHT, 'Weekend Player') }, { field: 'status', op: 'is', value: 'active' }] });
    assert.ok(crm.resolveSegment(db, MIDNIGHT, segment.id).includes(DANIEL));
    // 13–14. Funnel and drill-down.
    const funnel = analytics.funnelReport(db, MICHAEL, MIDNIGHT, { kind: 'followers', from: NOW - DAY, to: time, windowDays: null }).current;
    assert.ok(funnel.stages.every((s) => s.userIds.includes(DANIEL)), 'Daniel passed every stage, in order');
    const drill = crm.queryPlayers(db, MICHAEL, MIDNIGHT, { userIds: funnel.stages.at(-1)!.userIds }).rows;
    assert.ok(drill.some((r) => r.userId === DANIEL && r.lifecycle === 'returning'));
    // 15. Another club's administrator sees none of it.
    forbidden(() => crm.playerProfile(db, DANA, MIDNIGHT, DANIEL));
    forbidden(() => crm.listNotes(db, DANA, MIDNIGHT, DANIEL));
    forbidden(() => messaging.clubInbox(db, DANA, MIDNIGHT));
    forbidden(() => analytics.funnelReport(db, DANA, MIDNIGHT, { kind: 'followers', from: NOW - DAY, to: time, windowDays: null }));
    assert.ok(!crm.queryPlayers(db, DANA, RIVER).rows.some((r) => r.userId === DANIEL));
    assert.ok(!messaging.clubInbox(db, DANA, RIVER).some((i) => i.user.id === DANIEL));
  });
});

// =============================================================================
// Architecture
// =============================================================================

describe('architecture', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const outside = files('src').filter((f) => !f.startsWith(join('src', 'platform')));

  it('no screen reads a club\'s private stores directly: they go through the guarded service functions', () => {
    const direct = /\bdb\.(crm|conversations|messages|blocks|reports|batches|accessAttempts)\b/;
    const aliased = /\.crm\.(profiles|events|tags|notes|segments|rules|runs|links|settings)\b/;
    // Route names and message keys ('console.crm.settings', 'crm.notes.title') are text, not store access.
    const code = (f: string): string => readFileSync(f, 'utf8').replace(/'[^'\n]*'|`[^`]*`/g, "''");
    const offenders = outside.filter((f) => !f.includes(join('src', 'i18n')) && (direct.test(readFileSync(f, 'utf8')) || aliased.test(code(f))));
    assert.deepEqual(offenders, []);
  });

  it('no screen reads a tournament access code or the unguarded calculations', () => {
    const offenders = outside.filter((f) => /\bcompute\.|\.accessCode\b(?!\s*[:=!]==?\s*null)/.test(readFileSync(f, 'utf8')) && !/console[\\/](Wizard|TournamentControl)\.tsx$/.test(f));
    assert.deepEqual(offenders, [], 'only the staff tournament screens may handle the code');
  });

  it('the product has no payment, wallet or cash-out code path', () => {
    const banned = /\b(deposit|withdraw(al)?|cash[- ]?out|payout|wallet|iban|credit card|stripe|paypal)\b/i;
    const offenders = files('src')
      .filter((f) => !f.includes(`${join('src', 'i18n')}`))
      .filter((f) => banned.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    assert.deepEqual(offenders, []);
  });
});
