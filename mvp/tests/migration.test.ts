/** Milestone F: self-service club creation and the CSV migration assistant (no accounts are ever invented). */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import * as mig from '../src/platform/migration.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { DomainError, type DB } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
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

describe('club creation', () => {
  it('any signed-in person can open a club and becomes its owner, on the Starter plan, with CRM scaffolding', () => {
    const before = Object.keys(db.clubs).length;
    const club = api.createClub(db, PLAYER, { name: 'Harbour Poker Club', tagline: 'Sea air and deep stacks', location: 'Haifa', timezone: 'Europe/Athens', joinPolicy: 'approval', accent: '#14B8A6', logo: { kind: 'glyph', glyph: 'wave' } });
    assert.equal(Object.keys(db.clubs).length, before + 1);
    assert.equal(club.ownerId, PLAYER);
    assert.equal(club.planId, 'starter');
    assert.equal(club.timezone, 'Europe/Athens');
    assert.equal(club.branding.logo.kind, 'glyph');
    assert.ok(db.memberships.some((m) => m.clubId === club.id && m.userId === PLAYER && m.role === 'owner' && m.status === 'active'));
    assert.ok(db.crm.segments.some((s) => s.clubId === club.id && s.system === 'new_members'), 'system segments exist');
    assert.ok(db.crm.rules.some((r) => r.clubId === club.id), 'automation rules exist');
    assert.equal(db.users[PLAYER]!.isBot, false, 'no placeholder account was made');
    // The owner can publish a first tournament straight away.
    const t = api.createTournament(db, PLAYER, club.id, { ...api.draftOf(Object.values(db.tournaments)[0]!), name: 'Opening Night', startAt: NOW + 86_400_000, registrationOpensAt: NOW, simulateRegistrations: false });
    api.publishTournament(db, PLAYER, t.id, { announce: false });
    assert.equal(db.tournaments[t.id]!.status, 'REGISTRATION_OPEN');
  });

  it('rejects bad names, duplicates, bad colours and more than three clubs per owner', () => {
    const base = { joinPolicy: 'open' as const, accent: '#14B8A6' };
    assert.throws(() => api.createClub(db, PLAYER, { ...base, name: 'AB' }), (e: unknown) => e instanceof DomainError && e.code === 'bad_name');
    assert.throws(() => api.createClub(db, PLAYER, { ...base, name: 'Midnight Poker Club' }), (e: unknown) => e instanceof DomainError && e.code === 'duplicate');
    assert.throws(() => api.createClub(db, PLAYER, { ...base, name: 'Fine Name', accent: 'teal' }), (e: unknown) => e instanceof DomainError && e.code === 'bad_color');
    assert.throws(() => api.createClub(db, PLAYER, { ...base, name: 'Fine Name', timezone: 'Mars/Olympus' }), (e: unknown) => e instanceof DomainError && e.code === 'bad_timezone');
    for (const n of ['One Club', 'Two Club', 'Three Club']) api.createClub(db, PLAYER, { ...base, name: n });
    assert.throws(() => api.createClub(db, PLAYER, { ...base, name: 'Four Club' }), (e: unknown) => e instanceof DomainError && e.code === 'club_limit');
  });
});

describe('migration assistant', () => {
  const csv = ['Name,E-mail,Member No,Joined,Tags,Notes', 'Dana Cohen,dana.cohen@example.com,901,2024-03-15,"VIP Member;Regular Player",Prefers evenings', 'Yossi Levi,yossi@example.com,902,15/08/2024,Weekend Player,', 'No Email,,903,,,', 'Bad Email,not-an-email,904,,,', 'Dana Cohen,dana.cohen@example.com,905,,,duplicate line', `Alex Morgan,${'alex@example.com'},906,,,already a member?`].join('\n');

  it('parses CSV with quoted fields, guesses the mapping and flags problems without inventing anything', () => {
    const p = mig.previewImport(db, OWNER, MIDNIGHT, csv);
    assert.deepEqual(p.mapping, ['name', 'email', 'memberNo', 'joinedAt', 'tags', 'note']);
    assert.equal(p.rows.length, 6);
    assert.deepEqual(p.rows[0]!.tags, ['VIP Member', 'Regular Player']);
    assert.equal(p.rows[1]!.joinedAt, Date.UTC(2024, 7, 15), 'd/m/y dates');
    assert.deepEqual(p.rows[2]!.problems, [], 'an email is optional');
    assert.deepEqual(p.rows[3]!.problems, ['bad_email']);
    assert.deepEqual(p.rows[4]!.problems, ['duplicate_in_file']);
    const alexEmail = db.users[PLAYER]!.email;
    const p2 = mig.previewImport(db, OWNER, MIDNIGHT, csv.replace('alex@example.com', alexEmail));
    assert.ok(p2.rows[5]!.problems.includes('already_member'));
    assert.throws(() => mig.previewImport(db, PLAYER, MIDNIGHT, csv), /permission/);
    assert.throws(() => mig.previewImport(db, OWNER, MIDNIGHT, 'foo,bar\n1,2'), (e: unknown) => e instanceof DomainError && e.code === 'no_name_column');
  });

  it('commits clean rows as records (no users, no memberships) and attaches one when the person is approved', () => {
    const users = Object.keys(db.users).length;
    const memberships = db.memberships.length;
    const p = mig.previewImport(db, OWNER, MIDNIGHT, csv);
    const { imported } = mig.commitImport(db, OWNER, MIDNIGHT, p, 'members.csv');
    assert.equal(imported, p.importable);
    assert.equal(Object.keys(db.users).length, users);
    assert.equal(db.memberships.length, memberships);
    assert.equal(mig.listImports(db, OWNER, MIDNIGHT).filter((r) => r.status === 'unclaimed').length, imported);
    // The real Dana signs up later with the same email and asks to join.
    db.users[NEWCOMER]!.email = 'Dana.Cohen@example.com';
    api.requestJoin(db, NEWCOMER, MIDNIGHT, 'profile');
    api.approveMember(db, OWNER, MIDNIGHT, NEWCOMER);
    const record = db.crm.imports.find((r) => r.email === 'dana.cohen@example.com')!;
    assert.equal(record.status, 'claimed');
    assert.equal(record.claimedBy, NEWCOMER);
    const profile = db.crm.profiles[`${MIDNIGHT}:${NEWCOMER}`]!;
    assert.equal(profile.memberNo, 901, 'the old member number is kept');
    const tagNames = profile.tagIds.map((id) => db.crm.tags.find((t) => t.id === id)!.name);
    assert.ok(tagNames.includes('VIP Member') && tagNames.includes('Regular Player'));
    assert.ok(db.crm.notes.some((n) => n.clubId === MIDNIGHT && n.userId === NEWCOMER && n.body.includes('2024-03-15')));
    assert.throws(() => mig.deleteImport(db, OWNER, MIDNIGHT, record.id), (e: unknown) => e instanceof DomainError && e.code === 'already_claimed');
    // Re-importing the same file flags the now-known people.
    const again = mig.previewImport(db, OWNER, MIDNIGHT, csv);
    assert.ok(again.rows[1]!.problems.includes('already_imported'));
    assert.ok(again.rows[0]!.problems.includes('already_member'));
    // A wrong batch can be undone while unclaimed.
    const left = mig.deleteBatch(db, OWNER, MIDNIGHT, record.batchId);
    assert.equal(left, imported - 1);
  });
});
