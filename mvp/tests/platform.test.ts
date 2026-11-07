import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { seededRng } from '../src/engine/rng.ts';
import { presetStructure } from '../src/engine/structure.ts';
import { chipsInPlay } from '../src/engine/tournament.ts';
import * as api from '../src/platform/api.ts';
import { canTransition, TRANSITIONS } from '../src/platform/lifecycle.ts';
import { ALL_PERMISSIONS, can, canAssignRole, membershipOf, ROLE_PERMISSIONS, staffClubs } from '../src/platform/permissions.ts';
import { Runtime } from '../src/platform/runtime.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { Store } from '../src/platform/store.ts';
import { DomainError, ForbiddenError, type DB, type TournamentStatus } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const MIN = 60_000;
const { newcomer: NEWCOMER, player: PLAYER, owner: OWNER, other_owner: OTHER_OWNER, tournament_manager: TM, platform_admin: ADMIN } = DEMO_USERS;
const { midnight: MIDNIGHT, river: RIVER, final: FINAL } = CLUB_IDS;

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

const forbidden = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof ForbiddenError);
const domain = (code: string, fn: () => unknown) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code, `expected DomainError ${code}`);

const draft = (over: Partial<api.TournamentDraft> = {}): api.TournamentDraft => ({
  name: 'Test Turbo',
  description: 'A test event',
  banner: 'aurora',
  format: 'mtt',
  preset: 'turbo',
  startMode: 'scheduled',
  startAt: NOW + 30 * MIN,
  timezone: 'Asia/Jerusalem',
  registrationOpensAt: NOW - MIN,
  minPlayers: 6,
  maxPlayers: 27,
  structure: presetStructure('turbo'),
  visibility: 'private',
  access: 'members',
  accessCode: null,
  entryPoints: 200,
  simulateRegistrations: false,
  simulatedFill: 0,
  demoSpeed: 1,
  ...over,
});

const botMembers = (clubId: string, n: number, skip = 0): string[] =>
  db.memberships.filter((m) => m.clubId === clubId && m.status === 'active' && db.users[m.userId]!.isBot && m.role === 'player').slice(skip, skip + n).map((m) => m.userId);

describe('seed data', () => {
  it('has three clubs, six demo identities and consistent references', () => {
    assert.deepEqual(Object.keys(db.clubs).sort(), [FINAL, MIDNIGHT, RIVER].sort());
    for (const id of [NEWCOMER, PLAYER, OWNER, OTHER_OWNER, TM, ADMIN]) assert.equal(db.users[id]!.isBot, false);
    assert.equal(Object.values(db.users).filter((u) => !u.isBot).length, 6, 'everyone else is flagged as simulated');
    for (const m of db.memberships) {
      assert.ok(db.users[m.userId], `member ${m.userId} exists`);
      assert.ok(db.clubs[m.clubId]);
    }
    for (const t of Object.values(db.tournaments)) {
      assert.ok(db.clubs[t.clubId]);
      for (const r of t.registrations) assert.ok(db.users[r.userId]);
      if (t.status === 'COMPLETED') assert.ok(db.results[t.id], `${t.name} has a result`);
    }
    for (const club of Object.values(db.clubs)) {
      assert.equal(membershipOf(db, club.ownerId, club.id)?.role, 'owner');
      assert.equal(db.memberships.filter((m) => m.clubId === club.id && m.role === 'owner').length, 1);
    }
    assert.ok(db.hands.length >= 3, 'seeded hand history exists');
  });

  it('demo identities have the documented roles', () => {
    assert.equal(membershipOf(db, OWNER, MIDNIGHT)?.role, 'owner');
    assert.equal(membershipOf(db, TM, RIVER)?.role, 'tournament_manager');
    assert.equal(membershipOf(db, OTHER_OWNER, RIVER)?.role, 'owner');
    assert.equal(db.memberships.some((m) => m.userId === NEWCOMER), false, 'the newcomer starts with no club at all');
    assert.equal(db.follows.some((f) => f.userId === NEWCOMER), false);
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)?.role, 'player');
    assert.equal(membershipOf(db, PLAYER, FINAL), undefined);
    assert.deepEqual(staffClubs(db, OWNER), [MIDNIGHT]);
    assert.deepEqual(staffClubs(db, TM), [RIVER]);
    assert.deepEqual(staffClubs(db, PLAYER), []);
    assert.deepEqual(staffClubs(db, ADMIN), []);
  });
});

describe('role authorization', () => {
  it('each role has exactly its documented permissions', () => {
    assert.deepEqual([...ROLE_PERMISSIONS.owner].sort(), [...ALL_PERMISSIONS].sort());
    assert.equal(ROLE_PERMISSIONS.manager.includes('billing.view'), false);
    assert.equal(ROLE_PERMISSIONS.tournament_manager.includes('members.approve'), false);
    assert.equal(ROLE_PERMISSIONS.tournament_manager.includes('club.branding'), false);
    assert.equal(ROLE_PERMISSIONS.support_agent.includes('tournaments.create'), false);
    assert.deepEqual(ROLE_PERMISSIONS.player, []);
  });

  it('a player cannot perform any staff action', () => {
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!;
    forbidden(() => api.approveMember(db, PLAYER, MIDNIGHT, pending.userId));
    forbidden(() => api.createTournament(db, PLAYER, MIDNIGHT, draft()));
    forbidden(() => api.updateBranding(db, PLAYER, MIDNIGHT, db.clubs[MIDNIGHT]!.branding));
    forbidden(() => api.publishAnnouncement(db, PLAYER, MIDNIGHT, { kind: 'news', title: 'Hello', body: 'World!' }));
    forbidden(() => api.suspendMember(db, PLAYER, MIDNIGHT, botMembers(MIDNIGHT, 1)[0]!));
    forbidden(() => api.createTicket(db, PLAYER, MIDNIGHT, { category: 'technical', priority: 'low', subject: 'Help me', body: 'Something is wrong here' }));
    forbidden(() => api.createTenant(db, PLAYER, { clubName: 'Sneaky', ownerName: 'Me', planId: 'starter', joinPolicy: 'open', accent: '#112233' }));
  });

  it('a tournament manager can run tournaments but not manage members, branding or billing', () => {
    const t = api.createTournament(db, TM, RIVER, draft());
    api.publishTournament(db, TM, t.id);
    assert.equal(db.tournaments[t.id]!.status, 'REGISTRATION_OPEN');
    const someone = botMembers(RIVER, 1)[0]!;
    forbidden(() => api.suspendMember(db, TM, RIVER, someone));
    forbidden(() => api.setMemberRole(db, TM, RIVER, someone, 'support_agent'));
    forbidden(() => api.updateBranding(db, TM, RIVER, db.clubs[RIVER]!.branding));
    forbidden(() => api.updateClubProfile(db, TM, RIVER, { name: 'River Queens' }));
    assert.equal(can(db, TM, 'billing.view', RIVER), false);
    assert.equal(can(db, TM, 'members.view', RIVER), true);
  });

  it('roles can only be assigned below the actor\'s own, never to oneself, and the owner is protected', () => {
    const [a, b] = botMembers(MIDNIGHT, 2);
    api.setMemberRole(db, OWNER, MIDNIGHT, a!, 'manager');
    assert.equal(membershipOf(db, a!, MIDNIGHT)!.role, 'manager');
    // The new manager can appoint a support agent but not another manager, and cannot touch the owner.
    api.setMemberRole(db, a!, MIDNIGHT, b!, 'support_agent');
    domain('role_not_allowed', () => api.setMemberRole(db, a!, MIDNIGHT, b!, 'manager'));
    domain('role_not_allowed', () => api.setMemberRole(db, a!, MIDNIGHT, OWNER, 'player'));
    domain('role_not_allowed', () => api.setMemberRole(db, a!, MIDNIGHT, a!, 'owner'));
    domain('role_not_allowed', () => api.setMemberRole(db, OWNER, MIDNIGHT, OWNER, 'player'));
    assert.equal(canAssignRole(db, OWNER, MIDNIGHT, b!, 'owner'), false);
    domain('rank', () => api.suspendMember(db, a!, MIDNIGHT, OWNER));
  });

  it('platform staff manage tenants but are not club staff', () => {
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!;
    forbidden(() => api.approveMember(db, ADMIN, MIDNIGHT, pending.userId));
    forbidden(() => api.createTournament(db, ADMIN, MIDNIGHT, draft()));
    api.setTenantPlan(db, ADMIN, MIDNIGHT, 'enterprise');
    assert.equal(db.clubs[MIDNIGHT]!.planId, 'enterprise');
    forbidden(() => api.setTenantPlan(db, OWNER, MIDNIGHT, 'enterprise'));
    forbidden(() => api.suspendTenant(db, OWNER, RIVER, 'rival'));
    forbidden(() => api.updatePlan(db, OWNER, 'starter', { baseFee: 0 }));
  });
});

describe('club data isolation (multi-tenancy)', () => {
  it('an owner of one club has no authority in another club', () => {
    for (const p of ALL_PERMISSIONS) {
      assert.equal(can(db, OWNER, p, MIDNIGHT), true, `owner has ${p} at home`);
      assert.equal(can(db, OWNER, p, RIVER), false, `owner has no ${p} in River Kings`);
      assert.equal(can(db, OWNER, p, FINAL), false);
    }
    const riverMember = botMembers(RIVER, 1)[0]!;
    forbidden(() => api.suspendMember(db, OWNER, RIVER, riverMember));
    forbidden(() => api.createTournament(db, OWNER, RIVER, draft()));
    forbidden(() => api.publishAnnouncement(db, OWNER, RIVER, { kind: 'news', title: 'Come to Midnight', body: 'Better club.' }));
    forbidden(() => api.updateBranding(db, OWNER, FINAL, db.clubs[MIDNIGHT]!.branding));
    forbidden(() => api.updateClubProfile(db, OWNER, RIVER, { description: 'defaced' }));
  });

  it('staff cannot act on another club\'s tournaments or tickets by guessing ids', () => {
    const riverTournament = Object.values(db.tournaments).find((t) => t.clubId === RIVER && t.status === 'REGISTRATION_OPEN')!;
    forbidden(() => api.cancelTournament(db, OWNER, riverTournament.id, 'sabotage'));
    forbidden(() => api.closeRegistration(db, OWNER, riverTournament.id));
    forbidden(() => api.duplicateTournament(db, OWNER, riverTournament.id));
    forbidden(() => api.updateTournament(db, OWNER, riverTournament.id, draft()));
    const riverTicket = db.tickets.find((t) => t.clubId === RIVER)!;
    forbidden(() => api.replyToTicket(db, OWNER, riverTicket.id, 'let me read this'));
    forbidden(() => api.setTicketStatus(db, OWNER, riverTicket.id, 'resolved'));
    const midnightTournament = Object.values(db.tournaments).find((t) => t.clubId === MIDNIGHT && t.access === 'approval')!;
    const pendingReg = midnightTournament.registrations.find((r) => r.status === 'requested')!;
    forbidden(() => api.approveRegistration(db, TM, midnightTournament.id, pendingReg.userId));
  });

  it('a user in two clubs has separate roles, balances and permissions per club', () => {
    const shared = db.memberships.find(
      (m) => m.clubId === MIDNIGHT && m.status === 'active' && m.role === 'player' && membershipOf(db, m.userId, RIVER)?.status === 'active',
    )!;
    api.setMemberRole(db, OWNER, MIDNIGHT, shared.userId, 'manager');
    assert.equal(can(db, shared.userId, 'members.approve', MIDNIGHT), true);
    assert.equal(can(db, shared.userId, 'members.approve', RIVER), false, 'promotion in one club does not leak into another');
    membershipOf(db, shared.userId, MIDNIGHT)!.demoPoints = 123;
    assert.notEqual(membershipOf(db, shared.userId, RIVER)!.demoPoints, 123);
  });

  it('only members can register for a club\'s tournaments', () => {
    const finalTournament = Object.values(db.tournaments).find((t) => t.clubId === FINAL && t.status === 'REGISTRATION_OPEN')!;
    domain('members_only', () => api.registerForTournament(db, PLAYER, finalTournament.id));
  });

  it('suspending a tenant removes all club permissions and blocks play, restoring brings them back', () => {
    api.suspendTenant(db, ADMIN, MIDNIGHT, 'Demo: unpaid invoice');
    assert.equal(can(db, OWNER, 'tournaments.create', MIDNIGHT), false);
    forbidden(() => api.createTournament(db, OWNER, MIDNIGHT, draft()));
    const open = Object.values(db.tournaments).find((t) => t.clubId === MIDNIGHT && t.status === 'REGISTRATION_OPEN' && t.access === 'members' && !t.accessCode)!;
    domain('club_suspended', () => api.registerForTournament(db, PLAYER, open.id));
    domain('already_suspended', () => api.suspendTenant(db, ADMIN, MIDNIGHT, 'again'));
    assert.equal(can(db, TM, 'tournaments.create', RIVER), true, 'other tenants are unaffected');
    api.restoreTenant(db, ADMIN, MIDNIGHT);
    assert.equal(can(db, OWNER, 'tournaments.create', MIDNIGHT), true);
  });
});

describe('membership flows', () => {
  it('open clubs admit immediately; approval clubs create a pending request that staff resolve', () => {
    const outsider = Object.values(db.users).find((u) => u.isBot && !membershipOf(db, u.id, RIVER) && !membershipOf(db, u.id, MIDNIGHT))!;
    assert.equal(api.requestJoin(db, outsider.id, RIVER, 'club_id').status, 'active');
    domain('already_member', () => api.requestJoin(db, outsider.id, RIVER, 'link'));

    assert.equal(api.requestJoin(db, PLAYER, FINAL, 'qr').status, 'pending');
    domain('already_pending', () => api.requestJoin(db, PLAYER, FINAL, 'qr'));
    api.cancelJoinRequest(db, PLAYER, FINAL);
    assert.equal(membershipOf(db, PLAYER, FINAL), undefined);

    api.leaveClub(db, PLAYER, MIDNIGHT);
    assert.equal(api.requestJoin(db, PLAYER, MIDNIGHT, 'link').status, 'pending');
    assert.equal(can(db, PLAYER, 'console.access', MIDNIGHT), false);
    api.approveMember(db, OWNER, MIDNIGHT, PLAYER);
    const m = membershipOf(db, PLAYER, MIDNIGHT)!;
    assert.equal(m.status, 'active');
    assert.equal(m.demoPoints, db.clubs[MIDNIGHT]!.demoAllowance);
    assert.ok(db.notifications.some((n) => n.userId === PLAYER && n.key === 'notif.approved'));
    domain('not_pending', () => api.approveMember(db, OWNER, MIDNIGHT, PLAYER));
  });

  it('finds clubs by Club ID and by invitation link', () => {
    assert.equal(api.findClubByCode(db, '482 913')?.id, MIDNIGHT);
    assert.equal(api.findClubByCode(db, '000000'), undefined);
    assert.equal(api.findClubByInvite(db, api.inviteLink(db.clubs[RIVER]!))?.id, RIVER);
    assert.equal(api.findClubByInvite(db, 'the-final-table-205')?.id, FINAL);
    assert.equal(api.findClubByInvite(db, 'https://example.com/nope'), undefined);
  });

  it('rejecting, suspending and reinstating follow the rules', () => {
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!;
    api.rejectMember(db, OWNER, MIDNIGHT, pending.userId);
    assert.equal(pending.status, 'rejected');
    const victim = botMembers(MIDNIGHT, 1)[0]!;
    api.suspendMember(db, OWNER, MIDNIGHT, victim);
    assert.equal(membershipOf(db, victim, MIDNIGHT)!.status, 'suspended');
    domain('suspended', () => api.requestJoin(db, victim, MIDNIGHT, 'link'));
    domain('self', () => api.suspendMember(db, OWNER, MIDNIGHT, OWNER));
    api.reinstateMember(db, OWNER, MIDNIGHT, victim);
    assert.equal(membershipOf(db, victim, MIDNIGHT)!.status, 'active');
    domain('owner_cannot_leave', () => api.leaveClub(db, OWNER, MIDNIGHT));
  });

  it('suspending a member releases their upcoming registrations and refunds the points', () => {
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft());
    api.publishTournament(db, OWNER, t.id);
    api.registerForTournament(db, PLAYER, t.id);
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.demoPoints, 9_800);
    api.suspendMember(db, OWNER, MIDNIGHT, PLAYER);
    assert.equal(api.registrationOf(db.tournaments[t.id]!, PLAYER), undefined);
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.demoPoints, 10_000);
  });

  it('respects the plan\'s member and administrator-seat limits', () => {
    api.setTenantLimits(db, ADMIN, MIDNIGHT, { members: api.clubUsage(db, MIDNIGHT).members });
    const pending = db.memberships.find((m) => m.clubId === MIDNIGHT && m.status === 'pending')!;
    domain('club_full', () => api.approveMember(db, OWNER, MIDNIGHT, pending.userId));
    api.setTenantLimits(db, ADMIN, MIDNIGHT, { adminSeats: api.clubUsage(db, MIDNIGHT).adminSeats });
    domain('admin_seats', () => api.setMemberRole(db, OWNER, MIDNIGHT, botMembers(MIDNIGHT, 1)[0]!, 'support_agent'));
  });
});

describe('tournament lifecycle', () => {
  it('the state machine allows only the documented transitions', () => {
    const all = Object.keys(TRANSITIONS) as TournamentStatus[];
    assert.equal(all.length, 9);
    const allowed: [TournamentStatus, TournamentStatus][] = [
      ['DRAFT', 'SCHEDULED'],
      ['DRAFT', 'REGISTRATION_OPEN'],
      ['SCHEDULED', 'REGISTRATION_OPEN'],
      ['SCHEDULED', 'DRAFT'],
      ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'],
      ['REGISTRATION_CLOSED', 'REGISTRATION_OPEN'],
      ['REGISTRATION_OPEN', 'SEATING'],
      ['REGISTRATION_CLOSED', 'SEATING'],
      ['SEATING', 'RUNNING'],
      ['RUNNING', 'PAUSED'],
      ['PAUSED', 'RUNNING'],
      ['RUNNING', 'COMPLETED'],
    ];
    for (const from of all) {
      for (const to of all) {
        const expected =
          allowed.some(([a, b]) => a === from && b === to) || (to === 'CANCELLED' && from !== 'COMPLETED' && from !== 'CANCELLED');
        assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
      }
    }
    for (const to of all) {
      assert.equal(canTransition('COMPLETED', to), false, 'a completed tournament cannot be restarted');
      assert.equal(canTransition('CANCELLED', to), false);
    }
  });

  it('create → publish → register → seat → run → complete, with illegal jumps rejected', () => {
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ minPlayers: 3 }));
    assert.equal(t.status, 'DRAFT');
    domain('registration_closed', () => api.registerForTournament(db, PLAYER, t.id));
    domain('bad_transition', () => api.beginSeating(db, OWNER, t.id));
    domain('bad_transition', () => api.setPaused(db, OWNER, t.id, true));

    api.publishTournament(db, OWNER, t.id, { announce: true });
    assert.equal(t.status, 'REGISTRATION_OPEN');
    assert.ok(db.announcements.some((a) => a.clubId === MIDNIGHT && a.title === 'Test Turbo'));
    assert.ok(db.notifications.some((n) => n.userId === PLAYER && n.key === 'notif.tournament_published'));
    domain('not_editable', () => api.updateTournament(db, OWNER, t.id, draft({ name: 'Renamed' })));

    api.registerForTournament(db, PLAYER, t.id);
    domain('already_registered', () => api.registerForTournament(db, PLAYER, t.id));
    domain('not_enough_players', () => api.beginSeating(db, OWNER, t.id));
    for (const id of botMembers(MIDNIGHT, 4)) api.registerForTournament(db, id, t.id);
    assert.equal(api.registeredCount(t), 5);

    api.closeRegistration(db, OWNER, t.id);
    domain('registration_closed', () => api.registerForTournament(db, botMembers(MIDNIGHT, 1, 10)[0]!, t.id));
    api.beginSeating(db, OWNER, t.id);
    assert.equal(t.status, 'SEATING');
    domain('too_late', () => api.unregisterFromTournament(db, PLAYER, t.id));
    api.markRunning(db, t.id);
    api.setPaused(db, OWNER, t.id, true);
    assert.equal(t.status, 'PAUSED');
    domain('bad_transition', () => api.setPaused(db, OWNER, t.id, true));
    api.setPaused(db, OWNER, t.id, false);
    api.completeTournament(db, t.id, {
      tournamentId: t.id,
      clubId: MIDNIGHT,
      name: t.name,
      format: 'mtt',
      startedAt: NOW,
      completedAt: NOW + 60 * MIN,
      durationMin: 60,
      entrants: 5,
      hands: 80,
      totalChips: 25_000,
      levelReached: 9,
      places: [{ place: 1, userId: PLAYER, name: 'Alex Morgan', isBot: false, points: 22, bustedBy: null, bustLevel: null }],
      seeded: false,
    });
    assert.equal(t.status, 'COMPLETED');
    domain('already_finished', () => api.cancelTournament(db, OWNER, t.id, 'oops'));
    domain('bad_transition', () => api.beginSeating(db, OWNER, t.id));
    domain('bad_transition', () => api.markRunning(db, t.id));
    assert.ok(db.notifications.some((n) => n.userId === PLAYER && n.key === 'notif.result'));
  });

  it('validates configuration before saving or publishing', () => {
    assert.deepEqual(api.validateDraft(draft()), []);
    assert.ok(api.validateDraft(draft({ name: ' ' })).includes('name_required'));
    assert.ok(api.validateDraft(draft({ minPlayers: 30, maxPlayers: 20 })).includes('min_above_max'));
    assert.ok(api.validateDraft(draft({ startAt: NOW - MIN })).includes('start_in_past'));
    assert.ok(api.validateDraft(draft({ registrationOpensAt: NOW + 60 * MIN })).includes('registration_after_start'));
    assert.ok(api.validateDraft(draft({ entryPoints: -5 })).includes('bad_entry'));
    const broken = presetStructure('turbo');
    broken.entries = [];
    assert.ok(api.validateDraft(draft({ structure: broken })).includes('structure.no_levels'));
    domain('invalid', () => api.createTournament(db, OWNER, MIDNIGHT, draft({ name: '' })));
    // A draft may be saved with a past start but cannot be published.
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ startAt: NOW - MIN, registrationOpensAt: NOW - 2 * MIN }));
    domain('invalid', () => api.publishTournament(db, OWNER, t.id));
  });

  it('a future registration window publishes as SCHEDULED; duplicates start as drafts', () => {
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ registrationOpensAt: NOW + 10 * MIN }));
    api.publishTournament(db, OWNER, t.id);
    assert.equal(t.status, 'SCHEDULED');
    domain('registration_closed', () => api.registerForTournament(db, PLAYER, t.id));
    api.updateTournament(db, OWNER, t.id, draft({ name: 'Renamed While Scheduled', registrationOpensAt: NOW + 10 * MIN }));
    assert.equal(t.name, 'Renamed While Scheduled');
    api.unpublishTournament(db, OWNER, t.id);
    assert.equal(t.status, 'DRAFT');
    const copy = api.duplicateTournament(db, OWNER, t.id);
    assert.equal(copy.status, 'DRAFT');
    assert.equal(copy.registrations.length, 0);
    assert.notEqual(copy.structure, t.structure, 'the structure is copied, not shared');
    api.deleteDraft(db, OWNER, copy.id);
    assert.equal(db.tournaments[copy.id], undefined);
  });
});

describe('registration and demo points', () => {
  it('charges and refunds demo points, and enforces capacity and balance', () => {
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ maxPlayers: 3, minPlayers: 2, entryPoints: 400 }));
    api.publishTournament(db, OWNER, t.id);
    const m = membershipOf(db, PLAYER, MIDNIGHT)!;
    api.registerForTournament(db, PLAYER, t.id);
    assert.equal(m.demoPoints, 9_600);
    api.unregisterFromTournament(db, PLAYER, t.id);
    assert.equal(m.demoPoints, 10_000);
    domain('not_registered', () => api.unregisterFromTournament(db, PLAYER, t.id));

    const [a, b, c] = botMembers(MIDNIGHT, 3);
    api.registerForTournament(db, a!, t.id);
    api.registerForTournament(db, b!, t.id);
    api.registerForTournament(db, PLAYER, t.id);
    assert.equal(api.registerForTournament(db, c!, t.id).status, 'waitlisted', 'a full tournament puts the next member on the waiting list');
    assert.equal(api.registeredCount(t), 3, 'capacity is never exceeded');

    m.demoPoints = 100;
    api.unregisterFromTournament(db, PLAYER, t.id);
    assert.equal(api.registrationOf(t, c!)!.status, 'registered', 'the freed seat goes to the waiting list');
    m.demoPoints = 100;
    domain('insufficient_points', () => api.registerForTournament(db, PLAYER, t.id));
  });

  it('cancelling refunds everyone and notifies them', () => {
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ entryPoints: 250 }));
    api.publishTournament(db, OWNER, t.id);
    api.registerForTournament(db, PLAYER, t.id);
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.demoPoints, 9_750);
    api.cancelTournament(db, OWNER, t.id, 'Venue double-booked');
    assert.equal(t.status, 'CANCELLED');
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.demoPoints, 10_000);
    assert.ok(db.notifications.some((n) => n.userId === PLAYER && n.key === 'notif.cancelled'));
  });

  it('approval-required tournaments keep a request without a seat until staff decide', () => {
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ access: 'approval', entryPoints: 300 }));
    api.publishTournament(db, OWNER, t.id);
    assert.equal(api.registerForTournament(db, PLAYER, t.id).status, 'requested');
    assert.equal(api.registeredCount(t), 0);
    assert.equal(api.requestedCount(t), 1);
    api.rejectRegistration(db, OWNER, t.id, PLAYER);
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.demoPoints, 10_000, 'rejected requests are refunded');
    assert.equal(api.registerForTournament(db, PLAYER, t.id).status, 'requested', 'a rejected player may ask again');
    api.approveRegistration(db, OWNER, t.id, PLAYER);
    assert.equal(api.registrationOf(t, PLAYER)!.status, 'registered');
    domain('not_pending', () => api.approveRegistration(db, OWNER, t.id, PLAYER));
  });
});

describe('branding, announcements, support and subscriptions', () => {
  it('uploading images is gated by the plan', () => {
    const image = { ...db.clubs[FINAL]!.branding, logo: { kind: 'image' as const, dataUrl: 'data:image/png;base64,AAAA' } };
    const finalOwner = db.clubs[FINAL]!.ownerId;
    domain('plan_feature', () => api.updateBranding(db, finalOwner, FINAL, image)); // Starter
    api.updateBranding(db, OWNER, MIDNIGHT, { ...db.clubs[MIDNIGHT]!.branding, logo: image.logo }); // Professional
    assert.equal(db.clubs[MIDNIGHT]!.branding.logo.kind, 'image');
    domain('bad_color', () => api.updateBranding(db, OWNER, MIDNIGHT, { ...db.clubs[MIDNIGHT]!.branding, accent: 'teal' }));
  });

  it('announcements reach the club\'s members only', () => {
    const before = db.notifications.length;
    api.publishAnnouncement(db, OWNER, MIDNIGHT, { kind: 'news', title: 'New season', body: 'Starts Monday.' });
    const created = db.notifications.slice(before);
    assert.ok(created.some((n) => n.userId === PLAYER));
    assert.ok(!created.some((n) => n.userId === TM), 'River Kings staff are not notified about Midnight news');
  });

  it('support tickets flow between a club and the platform', () => {
    const ticket = api.createTicket(db, OWNER, MIDNIGHT, { category: 'gameplay_bug', priority: 'high', subject: 'Pot looked wrong', body: 'Hand 41 at table 3 showed two side pots.' });
    assert.equal(ticket.status, 'open');
    api.replyToTicket(db, ADMIN, ticket.id, 'Looking at the hand history now.');
    assert.equal(ticket.status, 'in_progress');
    assert.equal(ticket.messages.at(-1)!.staff, true);
    api.setTicketStatus(db, ADMIN, ticket.id, 'waiting');
    api.replyToTicket(db, OWNER, ticket.id, 'Thanks — it was the uncalled bet being returned.');
    assert.equal(ticket.status, 'open', 'a customer reply reopens the ticket');
    domain('forbidden_status', () => api.setTicketStatus(db, OWNER, ticket.id, 'in_progress'));
    api.setTicketStatus(db, OWNER, ticket.id, 'resolved');
    assert.equal(ticket.status, 'resolved');
  });

  it('creates tenants, edits plans and previews invoices from usage', () => {
    const club = api.createTenant(db, ADMIN, { clubName: 'Harbor Cardroom', ownerName: 'Noa Ben-Ami', planId: 'starter', joinPolicy: 'open', accent: '#3B82F6' });
    assert.equal(membershipOf(db, club.ownerId, club.id)!.role, 'owner');
    assert.equal(club.code.length, 6);
    assert.equal(Object.values(db.clubs).filter((c) => c.code === club.code).length, 1);
    domain('duplicate', () => api.createTenant(db, ADMIN, { clubName: 'harbor cardroom', ownerName: 'X Y', planId: 'starter', joinPolicy: 'open', accent: '#3B82F6' }));
    assert.equal(can(db, OWNER, 'console.access', club.id), false);

    const preview = api.invoicePreview(db, MIDNIGHT); // professional: hybrid
    const plan = db.plans.professional;
    assert.equal(preview.base, plan.baseFee);
    assert.equal(preview.usage, Math.max(0, preview.activePlayers - plan.includedActive) * plan.perActiveFee);
    api.updatePlan(db, ADMIN, 'professional', { baseFee: 450, limits: { ...plan.limits, adminSeats: 12 } });
    assert.equal(api.invoicePreview(db, MIDNIGHT).base, 450);
    assert.equal(api.effectiveLimits(db, db.clubs[MIDNIGHT]!).adminSeats, 12);
    domain('bad_price', () => api.updatePlan(db, ADMIN, 'professional', { baseFee: -1 }));
    assert.equal(api.invoicePreview(db, FINAL).usage, 0, 'fixed plans have no usage component');
  });

  it('every sensitive action leaves an audit entry', () => {
    const before = db.audit.length;
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft());
    api.publishTournament(db, OWNER, t.id);
    api.cancelTournament(db, OWNER, t.id, 'test');
    api.suspendTenant(db, ADMIN, FINAL, 'test');
    const actions = db.audit.slice(before).map((a) => a.action);
    assert.deepEqual(actions, ['tournament.created', 'tournament.published', 'tournament.cancelled', 'tenant.suspended']);
    assert.equal(db.audit.at(-1)!.clubId, null, 'platform actions are not attributed to a club log');
  });
});

describe('notification preferences', () => {
  it('a member who switched announcements off is not notified of them, others still are', () => {
    const count = (userId: string) => db.notifications.filter((n) => n.userId === userId && n.key === 'notif.announcement').length;
    const before = count(PLAYER);
    api.updateSettings(db, PLAYER, { notifications: { ...db.settings[PLAYER]!.notifications, announcements: false } });
    api.publishAnnouncement(db, OWNER, MIDNIGHT, { kind: 'news', title: 'Quiet update', body: 'Nothing to see.', pinned: false });
    assert.equal(count(PLAYER), before);
    api.updateSettings(db, PLAYER, { notifications: { ...db.settings[PLAYER]!.notifications, announcements: true } });
    api.publishAnnouncement(db, OWNER, MIDNIGHT, { kind: 'news', title: 'Loud update', body: 'Now you see it.', pinned: false });
    assert.equal(count(PLAYER), before + 1);
  });

  it('switching registration notifications off also silences results, but not membership changes', () => {
    api.updateSettings(db, PLAYER, { notifications: { ...db.settings[PLAYER]!.notifications, registrations: false } });
    const before = db.notifications.filter((n) => n.userId === PLAYER).length;
    api.notify(db, PLAYER, 'tournament', 'notif.registered', { name: 'X' });
    api.notify(db, PLAYER, 'result', 'notif.result', { name: 'X', place: 1, entrants: 2 });
    assert.equal(db.notifications.filter((n) => n.userId === PLAYER).length, before);
    api.notify(db, PLAYER, 'membership', 'notif.joined', { club: 'X' });
    assert.equal(db.notifications.filter((n) => n.userId === PLAYER).length, before + 1);
  });
});

describe('tournament runtime (scheduler, simulated activity, live play)', () => {
  const makeRuntime = () => {
    const store = new Store({ now: NOW });
    db = store.db;
    const runtime = new Runtime(store, { rng: seededRng(5), botRng: seededRng(6) });
    return { store, runtime };
  };
  /** Advance wall-clock time in ticks. */
  const run = (runtime: Runtime, ms: number, step = 1_000) => {
    for (let t = 0; t < ms; t += step) {
      time += step;
      runtime.tick();
    }
  };

  it('brings a seeded running tournament to life and keeps its chips consistent', () => {
    const { runtime } = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!;
    const live = runtime.getLive(running.id)!;
    assert.ok(live, 'live state exists for the running tournament');
    assert.ok(live.handsPlayed > 10, 'it was caught up to the present');
    assert.equal(chipsInPlay(live), live.totalChips);
    const hands = live.handsPlayed;
    run(runtime, 5 * MIN);
    assert.ok(live.handsPlayed > hands, 'it keeps playing on the tick');
    assert.equal(chipsInPlay(live), live.totalChips);
  });

  it('opens registration, fills with simulated members, seats, runs and completes a scheduled tournament', () => {
    const { runtime } = makeRuntime();
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ startAt: NOW + 3 * MIN, registrationOpensAt: NOW + MIN, simulateRegistrations: true, simulatedFill: 0.6, maxPlayers: 30, demoSpeed: 240 }));
    api.publishTournament(db, OWNER, t.id);
    assert.equal(t.status, 'SCHEDULED');
    run(runtime, MIN + 2_000);
    assert.equal(t.status, 'REGISTRATION_OPEN');
    run(runtime, 2 * MIN);
    assert.ok(api.registeredCount(t) >= 12, `simulated members registered (${api.registeredCount(t)})`);
    assert.ok(t.registrations.every((r) => db.users[r.userId]!.isBot), 'all of them are flagged as simulated');
    run(runtime, 4_000);
    assert.ok(t.status === 'SEATING' || t.status === 'RUNNING');
    run(runtime, 8_000);
    assert.equal(t.status, 'RUNNING');
    const live = runtime.getLive(t.id)!;
    assert.equal(live.entrants, api.registeredCount(t));
    run(runtime, 4 * MIN); // 240x demo clock: about 16 hours of tournament time
    assert.equal(t.status, 'COMPLETED');
    const result = db.results[t.id]!;
    assert.equal(result.places.length, result.entrants);
    assert.equal(result.places[0]!.place, 1);
    assert.equal(result.seeded, false);
    assert.equal(runtime.getLive(t.id), undefined);
  });

  it('cancels automatically when the minimum is not reached, refunding entries', () => {
    const { runtime } = makeRuntime();
    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ startAt: NOW + MIN, minPlayers: 6 }));
    api.publishTournament(db, OWNER, t.id);
    api.registerForTournament(db, PLAYER, t.id);
    run(runtime, MIN + 2_000);
    assert.equal(t.status, 'CANCELLED');
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.demoPoints, 10_000);
  });

  it('a sit & go fills with simulated players once a real person registers, then starts', () => {
    const { runtime } = makeRuntime();
    const sng = Object.values(db.tournaments).find((t) => t.clubId === MIDNIGHT && t.format === 'sng' && t.status === 'REGISTRATION_OPEN')!;
    const waiting = api.registeredCount(sng);
    run(runtime, 20_000);
    assert.equal(api.registeredCount(sng), waiting, 'nothing happens until someone real sits down');
    runtime.register(PLAYER, sng.id);
    run(runtime, 10_000);
    assert.ok(sng.status === 'SEATING' || sng.status === 'RUNNING', `status ${sng.status}`);
    run(runtime, 7_000);
    assert.equal(sng.status, 'RUNNING');
    const live = runtime.getLive(sng.id)!;
    assert.equal(live.entrants, 6);
    assert.equal(live.players[PLAYER]!.status, 'active');
  });

  it('late registration seats a player in a running tournament', () => {
    const { runtime } = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!;
    assert.equal(runtime.lateRegistrationOpen(running.id), true);
    const live = runtime.getLive(running.id)!;
    const before = live.entrants;
    const { tableNo } = runtime.register(PLAYER, running.id);
    assert.ok(tableNo !== null);
    assert.equal(live.entrants, before + 1);
    assert.equal(live.players[PLAYER]!.tableNo, tableNo);
    assert.equal(membershipOf(db, PLAYER, RIVER)!.demoPoints, 10_000 - running.entryPoints);
    assert.equal(chipsInPlay(live), live.totalChips);
  });

  it('staff can pause, resume, change demo speed and cancel; other clubs\' staff cannot', () => {
    const { runtime } = makeRuntime();
    const running = Object.values(db.tournaments).find((t) => t.status === 'RUNNING')!; // River Kings
    forbidden(() => runtime.setPaused(OWNER, running.id, true));
    assert.throws(() => runtime.setSpeed(OWNER, running.id, 60), DomainError);
    runtime.setPaused(TM, running.id, true);
    const live = runtime.getLive(running.id)!;
    const hands = live.handsPlayed;
    const clockMs = live.clockMs;
    run(runtime, 2 * MIN);
    assert.equal(live.handsPlayed, hands, 'no hands while paused');
    assert.equal(live.clockMs, clockMs, 'the blind clock is frozen while paused');
    runtime.setPaused(TM, running.id, false);
    runtime.setSpeed(TM, running.id, 60);
    run(runtime, 30_000);
    assert.ok(live.clockMs - clockMs >= 29 * MIN, 'the demo clock runs 60x');
    runtime.cancel(TM, running.id, 'Demo cancel');
    assert.equal(running.status, 'CANCELLED');
    assert.equal(runtime.getLive(running.id), undefined);
  });

  it('a watched table is paced action by action, shows only the viewer\'s cards, and applies the viewer\'s actions once', async () => {
    const { runtime } = makeRuntime();
    const sng = Object.values(db.tournaments).find((t) => t.clubId === MIDNIGHT && t.format === 'sng' && t.status === 'REGISTRATION_OPEN')!;
    runtime.register(PLAYER, sng.id);
    run(runtime, 20_000);
    assert.equal(sng.status, 'RUNNING');
    const live = runtime.getLive(sng.id)!;
    // Use the real clock for the driver's timers.
    api.clock.now = realNow;
    const driver = runtime.attach(PLAYER, sng.id, live.players[PLAYER]!.tableNo!, true, { turnSeconds: 30, pace: 0.01 });
    assert.equal(live.tables[0]!.driven, true);
    assert.equal(live.players[PLAYER]!.away, false);

    const deadline = Date.now() + 15_000;
    let acted = 0;
    let sawOwnCards = false;
    const saved = () => db.hands.some((h) => h.tournamentId === sng.id);
    while (Date.now() < deadline && (acted < 4 || !saved()) && live.players[PLAYER]!.status === 'active') {
      await new Promise((r) => setTimeout(r, 10));
      const seat = driver.viewerSeat();
      for (const s of driver.view.seats) {
        if (!s || !s.cards) continue;
        if (s.seat === seat) sawOwnCards = true;
        else {
          // An opponent's cards may only be on screen if the engine tabled them in this hand.
          const hand = live.tables.find((t) => t.no === driver.tableNo)!.state.hand;
          if (hand && hand.handNo === driver.view.handNo) {
            assert.ok(hand.events.some((e) => e.t === 'show' && e.seat === s.seat), 'opponent cards only appear when tabled');
          }
        }
      }
      if (driver.legal) {
        const l = driver.legal;
        const first = driver.act(l.canCheck ? { type: 'check' } : { type: 'call' });
        assert.equal(first.ok, true);
        const again = driver.act({ type: 'fold' });
        assert.equal(again.ok, false, 'a second action in the same turn is rejected');
        acted++;
      }
    }
    assert.ok(acted >= 2, `the viewer got to act (${acted})`);
    assert.ok(sawOwnCards);
    assert.equal(chipsInPlay(live), live.totalChips);

    runtime.detach();
    assert.equal(live.tables[0]!.driven, false);
    if (live.players[PLAYER]!.status === 'active') assert.equal(live.players[PLAYER]!.away, true, 'leaving the table sits the player out');
    assert.equal(chipsInPlay(live), live.totalChips);
    assert.ok(db.hands.some((h) => h.tournamentId === sng.id), 'played hands are saved to hand history');
    const record = db.hands.find((h) => h.tournamentId === sng.id)!;
    for (const e of record.events) {
      if (e.t === 'hole' && e.seat !== record.heroSeat) assert.equal(e.cards, null, 'history never stores cards that were not shown');
    }
  });

  it('simulated club staff approve a join request after a short delay (clubs flagged for it only)', () => {
    const { runtime } = makeRuntime();
    api.requestJoin(db, PLAYER, FINAL, 'club_id');
    run(runtime, 5_000);
    assert.equal(membershipOf(db, PLAYER, FINAL)!.status, 'pending');
    run(runtime, 6_000);
    assert.equal(membershipOf(db, PLAYER, FINAL)!.status, 'active');
    api.leaveClub(db, PLAYER, MIDNIGHT);
    api.requestJoin(db, PLAYER, MIDNIGHT, 'link');
    run(runtime, 30_000);
    assert.equal(membershipOf(db, PLAYER, MIDNIGHT)!.status, 'pending', 'Midnight waits for its real owner');
  });
});
