/**
 * Table branding (v0.3): what the felt shows for a tournament. The rules live in
 * platform/table-branding.ts and the draft validation in platform/api.ts; the wizard
 * preview, the home cameo and the live table all call the same resolver.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { presetStructure } from '../src/engine/structure.ts';
import * as api from '../src/platform/api.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { normaliseTableBranding, resolveTableBranding, THEME_COLORS } from '../src/platform/table-branding.ts';
import { tableVars } from '../src/platform/color.ts';
import { DomainError, ForbiddenError } from '../src/platform/types.ts';
import { DEFAULT_TABLE_BRANDING, TABLE_LOGO_LIMITS, type DB, type TableBranding } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const MIN = 60_000;
const { owner: OWNER, tournament_manager: TM, player: PLAYER } = DEMO_USERS;
const { midnight: MIDNIGHT } = CLUB_IDS;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let db: DB;
const realNow = api.clock.now;
beforeEach(() => {
  api.clock.now = () => NOW;
  db = createSeedDb(NOW);
});
afterEach(() => {
  api.clock.now = realNow;
});

const draft = (over: Partial<api.TournamentDraft> = {}): api.TournamentDraft => ({
  name: 'Branded Turbo',
  description: '',
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
  entryPoints: 0,
  simulateRegistrations: false,
  simulatedFill: 0,
  demoSpeed: 1,
  ...over,
});

describe('table branding', () => {
  it('a tournament without a setting shows the club logo on the club felt', () => {
    const club = db.clubs[MIDNIGHT]!;
    const t = Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT)!;
    assert.equal(t.tableBranding, undefined, 'seeded tournaments carry no setting');
    const r = resolveTableBranding(t, club);
    assert.equal(r.theme, club.branding.tableTheme);
    assert.deepEqual(r.logo, club.branding.logo);
    assert.equal(r.opacity, TABLE_LOGO_LIMITS.opacity.default);
    assert.equal(r.scale, 1);
  });

  it('hidden shows no logo; custom shows the uploaded image; custom without an upload falls back to the club', () => {
    const club = db.clubs[MIDNIGHT]!;
    assert.equal(resolveTableBranding({ tableBranding: { ...DEFAULT_TABLE_BRANDING, source: 'hidden' } }, club).logo, null);
    const custom = resolveTableBranding({ tableBranding: { ...DEFAULT_TABLE_BRANDING, source: 'custom', logoDataUrl: PNG } }, club);
    assert.deepEqual(custom.logo, { kind: 'image', dataUrl: PNG });
    assert.deepEqual(resolveTableBranding({ tableBranding: { ...DEFAULT_TABLE_BRANDING, source: 'custom', logoDataUrl: null } }, club).logo, club.branding.logo);
  });

  it('a tournament theme overrides the club theme; "club" follows the club', () => {
    const club = db.clubs[MIDNIGHT]!;
    assert.equal(resolveTableBranding({ tableBranding: { ...DEFAULT_TABLE_BRANDING, theme: 'burgundy' } }, club).theme, 'burgundy');
    assert.equal(resolveTableBranding({ tableBranding: { ...DEFAULT_TABLE_BRANDING, theme: 'club' } }, club).theme, club.branding.tableTheme);
  });

  it('opacity and scale are clamped to the safe limits, and junk is normalised', () => {
    const n = normaliseTableBranding({ source: 'custom', logoDataUrl: 'javascript:alert(1)', opacity: 0.9, scale: 9, theme: 'neon' as never });
    assert.equal(n.opacity, TABLE_LOGO_LIMITS.opacity.max);
    assert.equal(n.scale, TABLE_LOGO_LIMITS.scale.max);
    assert.equal(n.logoDataUrl, null, 'only data:image/ URLs are kept');
    assert.equal(n.theme, 'club');
    const low = normaliseTableBranding({ opacity: -1, scale: 0 });
    assert.equal(low.opacity, TABLE_LOGO_LIMITS.opacity.min);
    assert.equal(low.scale, TABLE_LOGO_LIMITS.scale.min);
  });

  it('the wizard draft validates branding and stores it on the tournament', () => {
    const bad: TableBranding = { ...DEFAULT_TABLE_BRANDING, source: 'custom', logoDataUrl: 'data:image/png;base64,' + 'A'.repeat(TABLE_LOGO_LIMITS.maxBytes * 2), opacity: 0.2, scale: 1 };
    assert.ok(api.validateDraft(draft({ tableBranding: bad }), NOW).includes('bad_table_logo'));
    assert.ok(api.validateDraft(draft({ tableBranding: { ...DEFAULT_TABLE_BRANDING, opacity: 0.8 } }), NOW).includes('bad_table_logo'));
    assert.ok(!api.validateDraft(draft({ tableBranding: { ...DEFAULT_TABLE_BRANDING, source: 'custom', logoDataUrl: PNG, opacity: 0.3, scale: 1.2, theme: 'emerald' } }), NOW).includes('bad_table_logo'));

    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ tableBranding: { ...DEFAULT_TABLE_BRANDING, source: 'custom', logoDataUrl: PNG, opacity: 0.3, scale: 1.2, theme: 'emerald' } }));
    assert.equal(t.tableBranding?.source, 'custom');
    assert.equal(t.tableBranding?.logoDataUrl, PNG);
    const r = resolveTableBranding(t, db.clubs[MIDNIGHT]!);
    assert.equal(r.theme, 'emerald');
    assert.deepEqual(r.logo, { kind: 'image', dataUrl: PNG });
    assert.equal(r.opacity, 0.3);
    assert.equal(r.scale, 1.2);

    // Switching back to the club logo drops the stored image, and the draft of an old tournament gets defaults.
    api.updateTournament(db, OWNER, t.id, { ...api.draftOf(t), tableBranding: { ...t.tableBranding!, source: 'club' } });
    assert.equal(db.tournaments[t.id]!.tableBranding?.logoDataUrl, null);
    const seeded = Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT && x.seeded)!;
    assert.deepEqual(api.draftOf(seeded).tableBranding, DEFAULT_TABLE_BRANDING);
  });

  it('custom colours derive the felt and rail shades; invalid colours fall back to the club', () => {
    const club = db.clubs[MIDNIGHT]!;
    const r = resolveTableBranding({ tableBranding: { ...DEFAULT_TABLE_BRANDING, theme: 'custom', colors: { felt: '#5a1e2e', rail: '#2a1a10' } } }, club);
    assert.equal(r.theme, 'custom');
    assert.deepEqual(r.vars, tableVars('#5a1e2e', '#2a1a10'));
    assert.equal(r.vars!['--felt-b'], '#5a1e2e');
    assert.notEqual(r.vars!['--felt-a'], r.vars!['--felt-c'], 'lighter and darker shades differ');
    const bad = normaliseTableBranding({ theme: 'custom', colors: { felt: 'red', rail: '#2a1a10' } });
    assert.equal(bad.theme, 'club');
    assert.ok(api.validateDraft(draft({ tableBranding: { ...DEFAULT_TABLE_BRANDING, theme: 'custom', colors: { felt: 'red', rail: '#2a1a10' } } }), NOW).includes('bad_table_colors'));
    assert.deepEqual(THEME_COLORS.emerald.felt, '#14664e');
  });

  it('club schemes: saved by branding staff, offered as preset:<id>, and a deleted scheme falls back to the club default', () => {
    const club = db.clubs[MIDNIGHT]!;
    assert.throws(() => api.saveTablePreset(db, PLAYER, MIDNIGHT, { name: 'X', colors: { felt: '#111111', rail: '#222222' } }), (e: unknown) => e instanceof ForbiddenError);
    assert.throws(() => api.saveTablePreset(db, TM, MIDNIGHT, { name: 'X', colors: { felt: '#111111', rail: '#222222' } }), (e: unknown) => e instanceof ForbiddenError, 'a tournament manager has no branding permission');
    assert.throws(() => api.saveTablePreset(db, OWNER, MIDNIGHT, { name: '  ', colors: { felt: '#111111', rail: '#222222' } }), (e: unknown) => e instanceof DomainError);
    const p = api.saveTablePreset(db, OWNER, MIDNIGHT, { name: 'Friday Gold', colors: { felt: '#5a1e2e', rail: '#2a1a10' } });
    assert.equal(club.branding.tablePresets?.length, 1);
    // Same name updates in place rather than duplicating.
    api.saveTablePreset(db, OWNER, MIDNIGHT, { name: 'friday gold', colors: { felt: '#6a2e3e', rail: '#2a1a10' } });
    assert.equal(club.branding.tablePresets?.length, 1);
    assert.equal(club.branding.tablePresets?.[0]?.colors.felt, '#6a2e3e');

    const t = api.createTournament(db, OWNER, MIDNIGHT, draft({ tableBranding: { ...DEFAULT_TABLE_BRANDING, theme: `preset:${p.id}` } }));
    let r = resolveTableBranding(t, club);
    assert.equal(r.theme, 'custom');
    assert.equal(r.vars!['--felt-b'], '#6a2e3e');
    api.deleteTablePreset(db, OWNER, MIDNIGHT, p.id);
    r = resolveTableBranding(t, club);
    assert.equal(r.theme, club.branding.tableTheme, 'a removed scheme falls back to the club default felt');
    assert.equal(r.vars, undefined);
  });
});
