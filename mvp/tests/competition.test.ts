/**
 * Competition (v0.4): scoring, player statistics, leaderboards, tiers, leagues and
 * achievements. Results are written straight into the demo database so each rule can be
 * checked on known numbers; the last test runs a real tournament through the API.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as api from '../src/platform/api.ts';
import * as comp from '../src/platform/competition.ts';
import { CLUB_IDS, createSeedDb, DEMO_USERS } from '../src/platform/seed.ts';
import { DomainError, ForbiddenError, type DB, type TournamentResult } from '../src/platform/types.ts';

const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const DAY = 86_400_000;
const { player: PLAYER, newcomer: NEWCOMER, owner: OWNER, other_owner: OTHER_OWNER } = DEMO_USERS;
const { midnight: MIDNIGHT, river: RIVER } = CLUB_IDS;

let db: DB;
const realNow = api.clock.now;
beforeEach(() => {
  api.clock.now = () => NOW;
  db = createSeedDb(NOW);
});
afterEach(() => {
  api.clock.now = realNow;
});

let seq = 0;
/** A played (non-demo) result with the given finishing order; everyone else in the field is a bot. */
function result(clubId: string, order: string[], entrants: number, at: number, over: Partial<TournamentResult> = {}): TournamentResult {
  const id = `t_x${++seq}`;
  const bots = Object.values(db.users).filter((u) => u.isBot).slice(0, entrants - order.length);
  const places = [...order.map((userId, i) => ({ place: i + 1, userId, name: db.users[userId]!.name, isBot: false, points: 10, bustedBy: null, bustLevel: null })), ...bots.map((b, i) => ({ place: order.length + i + 1, userId: b.id, name: b.name, isBot: true, points: 1, bustedBy: null, bustLevel: null }))];
  const r: TournamentResult = { tournamentId: id, clubId, name: `Test ${seq}`, format: 'mtt', startedAt: at - 3_600_000, completedAt: at, durationMin: 60, entrants, hands: 50, totalChips: 1000, levelReached: 5, places, seeded: false, game: 'nlhe', ...over };
  db.results[id] = r;
  return r;
}

describe('performance score', () => {
  it('rewards finishing position, field size and wins as documented', () => {
    assert.equal(comp.performanceScore(1, 2, 'mtt'), Math.round(125 * (0.5 + Math.log10(2))));
    assert.ok(comp.performanceScore(1, 100, 'mtt') > comp.performanceScore(1, 10, 'mtt'), 'a bigger field is worth more');
    assert.ok(comp.performanceScore(1, 10, 'mtt') > comp.performanceScore(2, 10, 'mtt'));
    assert.ok(comp.performanceScore(9, 50, 'mtt') > comp.performanceScore(10, 50, 'mtt') + 5, 'final-table bonus');
    assert.equal(comp.performanceScore(1, 1000, 'mtt'), Math.round(125 * 2), 'field factor caps at 2');
    assert.ok(comp.performanceScore(1, 6, 'sng') < comp.performanceScore(1, 6, 'mtt'), 'sit & go discount');
    assert.ok(comp.performanceScore(50, 50, 'mtt') >= 0);
  });
});

describe('player statistics and leaderboards', () => {
  it('counts only valid, played results and never lists bots', () => {
    result(MIDNIGHT, [PLAYER], 20, NOW - 5 * DAY);
    result(MIDNIGHT, [NEWCOMER, PLAYER], 30, NOW - 3 * DAY);
    result(RIVER, [PLAYER], 9, NOW - 1 * DAY, { format: 'sng', game: 'plo4' });
    const cancelled = result(RIVER, [NEWCOMER], 40, NOW - 2 * DAY);
    cancelled.invalidated = { at: NOW, by: OWNER, reason: 'duplicate' };

    const s = comp.playerStats(db, PLAYER);
    assert.equal(s.played, 3);
    assert.equal(s.wins, 2);
    assert.equal(s.finalTables, 3);
    assert.equal(s.mostPlayed, 'nlhe');
    assert.deepEqual(s.byGame, { nlhe: 2, plo4: 1 });
    assert.equal(s.includesDemo, false);
    assert.equal(s.score, comp.performanceScore(1, 20, 'mtt') + comp.performanceScore(2, 30, 'mtt') + comp.performanceScore(1, 9, 'sng'));
    assert.ok(s.avgPercentile > 0 && s.avgPercentile < 0.1);

    const board = comp.globalLeaderboard(db, 'score');
    assert.deepEqual(board.map((r) => r.userId), [PLAYER, NEWCOMER], 'ranked by score; the invalidated win does not count');
    assert.ok(board.every((r) => !db.users[r.userId]!.isBot));
    assert.equal(board[0]!.rank, 1);
    const wins = comp.globalLeaderboard(db, 'wins');
    assert.equal(wins[0]!.value, 2);
    assert.deepEqual(comp.globalLeaderboard(db, 'score', { game: 'plo4' }).map((r) => r.userId), [PLAYER], 'game filter');
    assert.deepEqual(comp.globalLeaderboard(db, 'score', { clubIds: [RIVER] }).map((r) => r.userId), [PLAYER], 'club filter ignores the invalidated result');
    assert.equal(comp.globalLeaderboard(db, 'avg_finish').length, 0, 'best average finish needs five results');
  });

  it('demo history is opt-in and labelled; a private profile is left out of global boards', () => {
    assert.ok(Object.values(db.results).some((r) => r.seeded), 'the seed carries demo history');
    const withoutDemo = comp.playerStats(db, PLAYER);
    const withDemo = comp.playerStats(db, PLAYER, { includeDemo: true });
    assert.equal(withoutDemo.played, 0);
    assert.ok(withDemo.played > 0 && withDemo.includesDemo);
    result(MIDNIGHT, [PLAYER, NEWCOMER], 12, NOW - DAY);
    assert.ok(comp.globalLeaderboard(db, 'score').some((r) => r.userId === NEWCOMER));
    db.settings[NEWCOMER]!.privacy.showProfile = false;
    assert.ok(!comp.globalLeaderboard(db, 'score').some((r) => r.userId === NEWCOMER), 'hidden profile');
    assert.ok(comp.globalLeaderboard(db, 'score').some((r) => r.userId === PLAYER));
  });

  it('monthly and season boards use calendar boundaries', () => {
    result(MIDNIGHT, [PLAYER], 20, NOW - DAY);
    result(MIDNIGHT, [NEWCOMER], 20, NOW - 200 * DAY);
    assert.deepEqual(comp.globalLeaderboard(db, 'monthly', { now: NOW }).map((r) => r.userId), [PLAYER]);
    assert.deepEqual(comp.globalLeaderboard(db, 'season', { now: NOW }).map((r) => r.userId), [PLAYER]);
    assert.equal(comp.globalLeaderboard(db, 'score').length, 2);
    assert.equal(comp.seasonBounds(NOW).label, 'Q4 2026');
  });

  it('tiers need both score and activity', () => {
    assert.equal(comp.tierOf({ score: 0, played: 0, wins: 0 }), 'rookie');
    assert.equal(comp.tierOf({ score: 50, played: 1, wins: 0 }), 'bronze');
    assert.equal(comp.tierOf({ score: 9000, played: 3, wins: 3 }), 'bronze', 'three lucky results are not diamond');
    assert.equal(comp.tierOf({ score: 1600, played: 12, wins: 0 }), 'gold');
    assert.equal(comp.tierOf({ score: 25000, played: 120, wins: 12 }), 'legend');
    const next = comp.nextTier({ score: 1600, played: 12, wins: 0 })!;
    assert.equal(next.tier, 'platinum');
    assert.equal(next.wins, 1);
  });
});

describe('leagues and seasons', () => {
  const draft = (over: Partial<comp.LeagueDraft> = {}): comp.LeagueDraft => ({
    name: 'Autumn League',
    description: 'Best five results count.',
    type: 'monthly',
    startAt: NOW - 10 * DAY,
    endAt: NOW + 20 * DAY,
    scoring: { ...comp.defaultScoring('position'), bestN: 2 },
    includeAll: true,
    tournamentIds: [],
    eligibility: 'all_members',
    memberIds: [],
    visibility: 'members',
    cover: { kind: 'pattern', pattern: 'deco' },
    ...over,
  });

  it('only tournament staff create leagues; a validated draft becomes an active league', () => {
    assert.throws(() => comp.createLeague(db, PLAYER, MIDNIGHT, draft()), (e: unknown) => e instanceof ForbiddenError);
    assert.throws(() => comp.createLeague(db, OTHER_OWNER, MIDNIGHT, draft()), (e: unknown) => e instanceof ForbiddenError, 'another club’s owner');
    assert.throws(() => comp.createLeague(db, OWNER, MIDNIGHT, draft({ endAt: NOW - 20 * DAY })), (e: unknown) => e instanceof DomainError && e.code === 'invalid');
    const seededCount = db.leagues.filter((x) => x.clubId === MIDNIGHT).length;
    const l = comp.createLeague(db, OWNER, MIDNIGHT, draft());
    assert.equal(l.status, 'active');
    assert.equal(l.scoring.version, 1);
    assert.equal(comp.visibleLeagues(db, PLAYER, MIDNIGHT).length, seededCount + 1);
    assert.ok(!comp.visibleLeagues(db, NEWCOMER, MIDNIGHT).some((x) => x.id === l.id), 'not a member: members-only league hidden');
    comp.updateLeague(db, OWNER, l.id, { visibility: 'public' });
    assert.ok(comp.visibleLeagues(db, NEWCOMER, MIDNIGHT).some((x) => x.id === l.id));
  });

  const clearDemoHistory = () => {
    for (const r of Object.values(db.results)) if (r.seeded) delete db.results[r.tournamentId];
  };

  it('standings follow the scoring rules: best N, presets, movement, bots excluded', () => {
    clearDemoHistory();
    const l = comp.createLeague(db, OWNER, MIDNIGHT, draft());
    result(MIDNIGHT, [PLAYER, NEWCOMER], 20, NOW - 8 * DAY); // P 100, N 70
    result(MIDNIGHT, [NEWCOMER, PLAYER], 20, NOW - 6 * DAY); // N 100, P 70
    result(MIDNIGHT, [NEWCOMER], 20, NOW - 4 * DAY); // N 100 (P absent)
    result(MIDNIGHT, [PLAYER], 20, NOW - 2 * DAY); // P 100 → best two: P 200, N 200, two wins each → alphabetical
    result(RIVER, [PLAYER], 20, NOW - DAY); // another club: ignored
    result(MIDNIGHT, [PLAYER], 20, NOW - 30 * DAY); // before the window: ignored
    const all = comp.leagueStandings(db, l);
    const rows = all.filter((r) => !r.isBot);
    assert.ok(all.some((r) => r.isBot), 'club leagues rank the (labelled) demo members too');
    assert.deepEqual(rows.map((r) => [r.userId, r.points, r.played, r.counted]), [[PLAYER, 200, 3, 2], [NEWCOMER, 200, 3, 2]]);
    assert.equal(rows[0]!.wins, 2);
    assert.equal(rows[0]!.rank, 1, 'the people lead: bots only finished behind them');
    assert.equal(rows[0]!.previousRank, 2, 'movement is measured against standings before the latest tournament');
    assert.equal(rows[1]!.previousRank, 1);

    comp.updateLeague(db, OWNER, l.id, { scoring: { ...l.scoring, preset: 'wins_and_tables', bestN: 0 } });
    assert.equal(l.scoring.version, 2, 'a scoring edit is a new rule version');
    const rows2 = comp.leagueStandings(db, l);
    assert.equal(rows2.find((r) => r.userId === NEWCOMER)!.points, 50 + 50 + 20, 'two wins and a second place (final table)');
    assert.equal(rows2.find((r) => r.userId === PLAYER)!.points, 50 + 20 + 50);
  });

  it('a selected-members league and explicit tournament assignment', () => {
    const l = comp.createLeague(db, OWNER, MIDNIGHT, draft({ includeAll: false, eligibility: 'selected', memberIds: [PLAYER] }));
    const r1 = result(MIDNIGHT, [NEWCOMER, PLAYER], 10, NOW - DAY);
    assert.equal(comp.leagueStandings(db, l).length, 0, 'nothing assigned yet');
    const t = api.createTournament(db, OWNER, MIDNIGHT, { ...api.draftOf(Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT)!), name: 'League Night', startAt: NOW + DAY });
    db.results[r1.tournamentId]!.tournamentId = t.id;
    db.results[t.id] = db.results[r1.tournamentId]!;
    delete db.results[r1.tournamentId];
    comp.assignTournament(db, OWNER, l.id, t.id, true);
    const rows = comp.leagueStandings(db, l);
    assert.deepEqual(rows.map((r) => r.userId), [PLAYER], 'only selected members are ranked');
    assert.throws(() => comp.assignTournament(db, OWNER, l.id, 'nope', true), (e: unknown) => e instanceof DomainError);
    assert.throws(() => comp.assignTournament(db, OTHER_OWNER, l.id, t.id, true), (e: unknown) => e instanceof ForbiddenError);
  });

  it('completing a season freezes the standings, names the champion and awards; later results never change it', () => {
    clearDemoHistory();
    const l = comp.createLeague(db, OWNER, MIDNIGHT, draft());
    result(MIDNIGHT, [PLAYER, NEWCOMER], 20, NOW - 2 * DAY);
    comp.completeLeague(db, OWNER, l.id, NOW);
    assert.equal(l.status, 'completed');
    assert.equal(l.championId, PLAYER);
    assert.equal(l.finalStandings?.length, 20);
    assert.ok(!db.achievements.some((a) => db.users[a.userId]!.isBot), 'bots earn nothing');
    assert.ok(db.achievements.some((a) => a.userId === PLAYER && a.key === 'season_champion' && a.source.leagueId === l.id));
    assert.ok(db.achievements.some((a) => a.userId === NEWCOMER && a.key === 'league_top10'));
    result(MIDNIGHT, [NEWCOMER, NEWCOMER], 50, NOW - DAY);
    assert.equal(comp.leagueStandings(db, l)[0]!.userId, PLAYER, 'frozen');
    assert.throws(() => comp.updateLeague(db, OWNER, l.id, { name: 'Renamed' }), (e: unknown) => e instanceof DomainError && e.code === 'not_editable');
    assert.throws(() => comp.completeLeague(db, OWNER, l.id), (e: unknown) => e instanceof DomainError);
    comp.archiveLeague(db, OWNER, l.id);
    assert.equal(l.status, 'archived');
    // A second season does not touch the first.
    const l2 = comp.createLeague(db, OWNER, MIDNIGHT, draft({ name: 'Winter League', startAt: NOW - DAY, endAt: NOW + 60 * DAY }));
    assert.equal(comp.leagueStandings(db, l2)[0]!.userId, NEWCOMER);
    assert.equal(comp.leagueStandings(db, l)[0]!.userId, PLAYER);
  });
});

describe('achievements', () => {
  it('are awarded once, from played results only, through the completion hook', () => {
    assert.equal(comp.evaluateAchievements(db, PLAYER).length, 0, 'demo history earns nothing');
    result(MIDNIGHT, [PLAYER], 20, NOW - 3 * DAY);
    const earned = comp.evaluateAchievements(db, PLAYER, NOW);
    assert.deepEqual(earned.map((a) => a.key).sort(), ['first_final_table', 'first_tournament', 'first_win']);
    assert.equal(comp.evaluateAchievements(db, PLAYER, NOW).length, 0, 'no duplicates');
    for (let i = 0; i < 4; i++) result(MIDNIGHT, [PLAYER], 20, NOW - (2 - i * 0.1) * DAY);
    assert.ok(comp.evaluateAchievements(db, PLAYER, NOW).some((a) => a.key === 'five_wins'));
    result(MIDNIGHT, [PLAYER], 20, NOW - DAY, { game: 'plo4' });
    result(MIDNIGHT, [PLAYER], 20, NOW - DAY / 2, { game: 'short_deck' });
    assert.ok(comp.evaluateAchievements(db, PLAYER, NOW).some((a) => a.key === 'multi_variant'));
    assert.equal(comp.awardsFor(db, PLAYER).length, 5);
    const bot = Object.values(db.users).find((u) => u.isBot)!;
    assert.equal(comp.evaluateAchievements(db, bot.id).length, 0, 'bots earn nothing');
  });

  it('completeTournament records the game and awards through the API', () => {
    const t = Object.values(db.tournaments).find((x) => x.clubId === MIDNIGHT && x.status === 'REGISTRATION_OPEN' && x.format === 'mtt')!;
    t.game = 'plo4';
    api.closeRegistration(db, OWNER, t.id);
    api.beginSeating(db, OWNER, t.id);
    api.markRunning(db, t.id);
    api.completeTournament(db, t.id, {
      tournamentId: t.id,
      clubId: MIDNIGHT,
      name: t.name,
      format: 'mtt',
      startedAt: NOW,
      completedAt: NOW + 3_600_000,
      durationMin: 60,
      entrants: 12,
      hands: 80,
      totalChips: 60_000,
      levelReached: 9,
      places: [{ place: 1, userId: PLAYER, name: 'Alex Morgan', isBot: false, points: 22, bustedBy: null, bustLevel: null }],
      seeded: false,
    });
    assert.equal(db.results[t.id]!.game, 'plo4');
    assert.ok(db.achievements.some((a) => a.userId === PLAYER && a.key === 'first_win' && a.source.tournamentId === t.id));
    assert.equal(comp.playerStats(db, PLAYER).mostPlayed, 'plo4');
    assert.equal(comp.globalLeaderboard(db, 'score')[0]!.userId, PLAYER);
  });
});
