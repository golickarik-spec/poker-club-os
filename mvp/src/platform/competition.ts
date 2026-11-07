/**
 * Competition (v0.4): the performance-scoring model, player statistics, global and club
 * leaderboards, player tiers, leagues with seasons, and the achievement rules engine.
 *
 * Everything is computed from `db.results` — the same records the club page and the
 * results screen show — so club and global figures never disagree. Rules worth knowing:
 *
 *  - Demo bots never appear in a leaderboard (they do count as opponents in a field).
 *  - Results of cancelled tournaments do not exist; results staff invalidated are skipped.
 *  - Seeded demo history is included only when the caller asks (`includeDemo`), and the UI
 *    labels it. In production the flag is false and only played tournaments count.
 *  - Raw statistics (played, wins, final tables, average finish) are kept apart from the
 *    weighted performance score, which is what rankings sort by.
 *
 * Performance score of one result (documented so clubs can explain it):
 *    base        = 100 × (1 − (place − 1) / field)          winner 100 … last ≈ 0
 *    bonus       = 25 for a win, else 10 for a final table
 *    fieldFactor = min(2, 0.5 + log10(field))               2 players 0.8, 10 → 1.5, 32+ → 2
 *    format      = 0.8 for a single-table sit & go, else 1
 *    score       = round((base + bonus) × fieldFactor × format)
 * `field` is the number of entrants in the prototype (FIELD_BASIS); production counts
 * genuine human participants and ignores anything a player paid.
 */
import type { VariantId } from '../engine/variants.ts';
import { newId } from './core.ts';
import { membershipOf, requirePermission } from './permissions.ts';
import {
  DomainError,
  type AchievementAward,
  type AchievementKey,
  type DB,
  type League,
  type LeagueScoring,
  type LeagueScoringPreset,
  type LeagueStandingRow,
  type PlayerTier,
  type TournamentResult,
} from './types.ts';

export const FIELD_BASIS: 'entrants' | 'humans' = 'entrants';

// ----- Scoring ------------------------------------------------------------------------------

export function fieldOf(r: TournamentResult): number {
  if (FIELD_BASIS === 'humans') return Math.max(2, r.places.filter((p) => !p.isBot).length);
  return Math.max(2, r.entrants);
}

/** Final-table size: nine for a multi-table event, the whole table for a sit & go (then it is "cashing"). */
export const finalTableSize = (r: Pick<TournamentResult, 'format' | 'entrants'>): number => (r.format === 'sng' ? Math.min(3, r.entrants) : Math.min(9, r.entrants));

export function performanceScore(place: number, field: number, format: 'mtt' | 'sng'): number {
  const f = Math.max(2, field);
  const base = 100 * (1 - (place - 1) / f);
  const finalTable = place <= (format === 'sng' ? Math.min(3, f) : Math.min(9, f));
  const bonus = place === 1 ? 25 : finalTable ? 10 : 0;
  const fieldFactor = Math.min(2, 0.5 + Math.log10(f));
  const formatFactor = format === 'sng' ? 0.8 : 1;
  return Math.round((base + bonus) * fieldFactor * formatFactor);
}

export const isValidResult = (r: TournamentResult): boolean => !r.invalidated && r.entrants >= 2 && r.places.length > 0;

export interface ResultFilter {
  since?: number;
  until?: number;
  game?: VariantId | 'all';
  clubIds?: string[] | null;
  includeDemo?: boolean;
}

export function eligibleResults(db: DB, f: ResultFilter = {}): TournamentResult[] {
  const out: TournamentResult[] = [];
  for (const r of Object.values(db.results)) {
    if (!isValidResult(r)) continue;
    if (r.seeded && !f.includeDemo) continue;
    if (f.since !== undefined && r.completedAt < f.since) continue;
    if (f.until !== undefined && r.completedAt > f.until) continue;
    if (f.game && f.game !== 'all' && (r.game ?? 'nlhe') !== f.game) continue;
    if (f.clubIds && !f.clubIds.includes(r.clubId)) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.completedAt - b.completedAt);
}

// ----- Player statistics --------------------------------------------------------------------

export interface PlayerStats {
  userId: string;
  played: number;
  wins: number;
  finalTables: number;
  /** Mean finishing place (1 = first). */
  avgFinish: number;
  /** Mean of (place − 1) / (field − 1): 0 = always first, 1 = always last. */
  avgPercentile: number;
  winRate: number;
  mostPlayed: VariantId | null;
  byGame: Record<string, number>;
  score: number;
  /** Results that counted, newest first. */
  history: { tournamentId: string; name: string; clubId: string; place: number; field: number; score: number; completedAt: number; game: VariantId; demo: boolean }[];
  includesDemo: boolean;
}

export function playerStats(db: DB, userId: string, f: ResultFilter = {}): PlayerStats {
  const results = eligibleResults(db, f);
  const history: PlayerStats['history'] = [];
  const byGame: Record<string, number> = {};
  let wins = 0;
  let finalTables = 0;
  let finishSum = 0;
  let pctSum = 0;
  let score = 0;
  let includesDemo = false;
  for (const r of results) {
    const p = r.places.find((x) => x.userId === userId);
    if (!p) continue;
    const field = fieldOf(r);
    const s = performanceScore(p.place, field, r.format);
    const game = r.game ?? 'nlhe';
    byGame[game] = (byGame[game] ?? 0) + 1;
    if (p.place === 1) wins++;
    if (p.place <= finalTableSize(r)) finalTables++;
    finishSum += p.place;
    pctSum += field > 1 ? (p.place - 1) / (field - 1) : 0;
    score += s;
    if (r.seeded) includesDemo = true;
    history.push({ tournamentId: r.tournamentId, name: r.name, clubId: r.clubId, place: p.place, field, score: s, completedAt: r.completedAt, game, demo: r.seeded });
  }
  const played = history.length;
  let mostPlayed: VariantId | null = null;
  for (const [g, n] of Object.entries(byGame)) if (!mostPlayed || n > byGame[mostPlayed]!) mostPlayed = g as VariantId;
  return {
    userId,
    played,
    wins,
    finalTables,
    avgFinish: played ? finishSum / played : 0,
    avgPercentile: played ? pctSum / played : 0,
    winRate: played ? wins / played : 0,
    mostPlayed,
    byGame,
    score,
    history: history.reverse(),
    includesDemo,
  };
}

// ----- Tiers --------------------------------------------------------------------------------

export const TIERS: readonly PlayerTier[] = ['rookie', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'legend'];

/**
 * Tier thresholds on the all-time performance score, with minimum activity so a single
 * lucky result cannot jump tiers. Documented in docs/COMPETITION.md.
 */
export const TIER_RULES: { tier: PlayerTier; score: number; played: number; wins: number }[] = [
  { tier: 'legend', score: 20000, played: 100, wins: 10 },
  { tier: 'master', score: 12000, played: 60, wins: 5 },
  { tier: 'diamond', score: 7000, played: 35, wins: 2 },
  { tier: 'platinum', score: 3500, played: 20, wins: 1 },
  { tier: 'gold', score: 1500, played: 10, wins: 0 },
  { tier: 'silver', score: 500, played: 5, wins: 0 },
  { tier: 'bronze', score: 1, played: 1, wins: 0 },
  { tier: 'rookie', score: 0, played: 0, wins: 0 },
];

export function tierOf(stats: Pick<PlayerStats, 'score' | 'played' | 'wins'>): PlayerTier {
  for (const r of TIER_RULES) if (stats.score >= r.score && stats.played >= r.played && stats.wins >= r.wins) return r.tier;
  return 'rookie';
}

/** The next tier and what is still missing for it (null at the top). */
export function nextTier(stats: Pick<PlayerStats, 'score' | 'played' | 'wins'>): { tier: PlayerTier; score: number; played: number; wins: number } | null {
  const current = tierOf(stats);
  const idx = TIERS.indexOf(current);
  if (idx >= TIERS.length - 1) return null;
  const rule = TIER_RULES.find((r) => r.tier === TIERS[idx + 1])!;
  return { tier: rule.tier, score: Math.max(0, rule.score - stats.score), played: Math.max(0, rule.played - stats.played), wins: Math.max(0, rule.wins - stats.wins) };
}

// ----- Leaderboards -------------------------------------------------------------------------

export type LeaderboardCategory = 'score' | 'wins' | 'monthly' | 'season' | 'final_tables' | 'avg_finish';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  hue: number;
  tier: PlayerTier;
  value: number;
  played: number;
  wins: number;
  finalTables: number;
  score: number;
  avgPercentile: number;
  mostPlayed: VariantId | null;
  includesDemo: boolean;
}

export const MIN_PLAYED: Record<LeaderboardCategory, number> = { score: 1, wins: 1, monthly: 1, season: 1, final_tables: 1, avg_finish: 5 };

/** Season boundaries: a season is a calendar quarter. */
export function seasonBounds(now: number): { since: number; until: number; label: string } {
  const d = new Date(now);
  const q = Math.floor(d.getMonth() / 3);
  const since = new Date(d.getFullYear(), q * 3, 1).getTime();
  const until = new Date(d.getFullYear(), q * 3 + 3, 1).getTime() - 1;
  return { since, until, label: `Q${q + 1} ${d.getFullYear()}` };
}

export function monthBounds(now: number): { since: number; until: number } {
  const d = new Date(now);
  return { since: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), until: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1 };
}

/**
 * The global leaderboard. Only people (never bots), only players whose profile is public,
 * only valid results; demo history when asked. `clubIds` limits to participating clubs.
 */
export function globalLeaderboard(db: DB, category: LeaderboardCategory, f: ResultFilter & { now?: number; limit?: number } = {}): LeaderboardRow[] {
  const now = f.now ?? Date.now();
  let filter: ResultFilter = { ...f };
  if (category === 'monthly') filter = { ...filter, ...monthBounds(now) };
  if (category === 'season') filter = { ...filter, ...seasonBounds(now) };
  const results = eligibleResults(db, filter);
  const ids = new Set<string>();
  for (const r of results) for (const p of r.places) if (!p.isBot) ids.add(p.userId);
  const rows: LeaderboardRow[] = [];
  for (const userId of ids) {
    const user = db.users[userId];
    if (!user || user.isBot) continue;
    if (db.settings[userId] && db.settings[userId]!.privacy.showProfile === false) continue;
    const stats = statsFrom(results, userId);
    if (stats.played < MIN_PLAYED[category]) continue;
    const tier = tierOf(playerStats(db, userId, { includeDemo: f.includeDemo }));
    const value =
      category === 'wins' ? stats.wins : category === 'final_tables' ? stats.finalTables : category === 'avg_finish' ? Math.round((1 - stats.avgPercentile) * 1000) / 10 : stats.score;
    rows.push({ rank: 0, userId, name: user.name, hue: user.hue, tier, value, played: stats.played, wins: stats.wins, finalTables: stats.finalTables, score: stats.score, avgPercentile: stats.avgPercentile, mostPlayed: stats.mostPlayed, includesDemo: stats.includesDemo });
  }
  rows.sort((a, b) => b.value - a.value || b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i + 1));
  return f.limit ? rows.slice(0, f.limit) : rows;
}

/** Stats over an already-filtered set of results (shared by leaderboards and leagues). */
function statsFrom(results: TournamentResult[], userId: string): PlayerStats {
  const fake: DB = { results: Object.fromEntries(results.map((r) => [r.tournamentId, r])) } as unknown as DB;
  return playerStats(fake, userId, { includeDemo: true });
}

/** Club leaderboard, reusing the same scoring; the club page's own `clubRanking` stays as the "club points" view. */
export function clubLeaderboard(db: DB, clubId: string, category: LeaderboardCategory, f: ResultFilter & { now?: number } = {}): LeaderboardRow[] {
  return globalLeaderboard(db, category, { ...f, clubIds: [clubId] });
}

// ----- Leagues --------------------------------------------------------------------------------

export const SCORING_PRESETS: Record<LeagueScoringPreset, { name: string; describe: string }> = {
  position: { name: 'Finishing position', describe: '100 for a win, 70 second, 50 third, 30 for places 4–6, 20 for 7–9, 10 for every other finish.' },
  performance: { name: 'Performance score', describe: 'The platform performance score: finish relative to the field, with a bonus for wins and final tables, scaled by field size.' },
  wins_and_tables: { name: 'Wins and final tables', describe: '50 for a win, 20 for any other final table, 5 for taking part.' },
};

export const defaultScoring = (preset: LeagueScoringPreset = 'position'): LeagueScoring => ({ preset, bestN: 0, participation: 0, participationCap: 0, fieldAdjusted: false, version: 1 });

export function leaguePointsFor(scoring: LeagueScoring, place: number, field: number, format: 'mtt' | 'sng'): number {
  let pts: number;
  if (scoring.preset === 'performance') pts = performanceScore(place, field, format);
  else if (scoring.preset === 'wins_and_tables') pts = place === 1 ? 50 : place <= Math.min(9, field) ? 20 : 5;
  else pts = place === 1 ? 100 : place === 2 ? 70 : place === 3 ? 50 : place <= 6 ? 30 : place <= 9 ? 20 : 10;
  if (scoring.fieldAdjusted && scoring.preset !== 'performance') pts = Math.round(pts * Math.min(2, 0.5 + Math.log10(Math.max(2, field))));
  return pts;
}

export function leagueOf(db: DB, id: string): League {
  const l = db.leagues.find((x) => x.id === id);
  if (!l) throw new DomainError('not_found', 'League not found.');
  return l;
}

/** The results a league counts: assigned tournaments, plus every completed club tournament in the window when `includeAll`. */
export function leagueResults(db: DB, league: League): TournamentResult[] {
  const ids = new Set(league.tournamentIds);
  const out: TournamentResult[] = [];
  for (const r of Object.values(db.results)) {
    if (r.clubId !== league.clubId || !isValidResult(r)) continue;
    const inWindow = r.completedAt >= league.startAt && r.completedAt <= league.endAt;
    if (ids.has(r.tournamentId) || (league.includeAll && inWindow)) out.push(r);
  }
  return out.sort((a, b) => a.completedAt - b.completedAt);
}

function standingsFrom(db: DB, league: League, results: TournamentResult[]): LeagueStandingRow[] {
  const rows = new Map<string, LeagueStandingRow & { pointsList: number[]; participations: number }>();
  // Club leagues rank everyone who played in the club's tournaments; in the prototype that includes
  // the labelled demo bots (they are the club's members). Global boards never list them.
  const eligible = (userId: string) => {
    const u = db.users[userId];
    if (!u) return false;
    if (league.eligibility === 'selected') return league.memberIds.includes(userId);
    return true;
  };
  for (const r of results) {
    const field = fieldOf(r);
    for (const p of r.places) {
      if (!eligible(p.userId)) continue;
      let row = rows.get(p.userId);
      if (!row) {
        const u = db.users[p.userId]!;
        row = { userId: p.userId, name: u.name, isBot: u.isBot, hue: u.hue, points: 0, played: 0, wins: 0, finalTables: 0, counted: 0, rank: 0, previousRank: null, pointsList: [], participations: 0 };
        rows.set(p.userId, row);
      }
      row.played++;
      if (p.place === 1) row.wins++;
      if (p.place <= finalTableSize(r)) row.finalTables++;
      row.pointsList.push(leaguePointsFor(league.scoring, p.place, field, r.format));
      row.participations++;
    }
  }
  const out: LeagueStandingRow[] = [];
  for (const row of rows.values()) {
    const sorted = [...row.pointsList].sort((a, b) => b - a);
    const counted = league.scoring.bestN > 0 ? sorted.slice(0, league.scoring.bestN) : sorted;
    const participation = league.scoring.participation * (league.scoring.participationCap > 0 ? Math.min(row.participations, league.scoring.participationCap) : row.participations);
    const { pointsList: _p, participations: _q, ...rest } = row;
    out.push({ ...rest, points: counted.reduce((n, x) => n + x, 0) + participation, counted: counted.length });
  }
  out.sort((a, b) => b.points - a.points || b.wins - a.wins || b.finalTables - a.finalTables || a.name.localeCompare(b.name));
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

/** Live standings, with each player's rank before the most recent tournament for the movement column. Frozen standings are returned as stored. */
export function leagueStandings(db: DB, league: League): LeagueStandingRow[] {
  if (league.finalStandings) return league.finalStandings;
  const results = leagueResults(db, league);
  const now = standingsFrom(db, league, results);
  if (results.length > 1) {
    const before = standingsFrom(db, league, results.slice(0, -1));
    const prev = new Map(before.map((r) => [r.userId, r.rank]));
    for (const r of now) r.previousRank = prev.get(r.userId) ?? null;
  }
  return now;
}

export interface LeagueDraft {
  name: string;
  description: string;
  type: League['type'];
  startAt: number;
  endAt: number;
  scoring: LeagueScoring;
  includeAll: boolean;
  tournamentIds: string[];
  eligibility: League['eligibility'];
  memberIds: string[];
  visibility: League['visibility'];
  cover: League['cover'];
}

export const LEAGUE_TYPE_DAYS: Record<League['type'], number | null> = { weekly: 7, monthly: 30, quarterly: 91, annual: 365, custom: null, series: null };

export function validateLeague(d: LeagueDraft): string[] {
  const problems: string[] = [];
  if (d.name.trim().length < 3) problems.push('name');
  if (d.name.trim().length > 60) problems.push('name');
  if (!(d.endAt > d.startAt)) problems.push('dates');
  if (!d.includeAll && d.tournamentIds.length === 0 && d.type === 'series') problems.push('tournaments');
  if (d.eligibility === 'selected' && d.memberIds.length === 0) problems.push('members');
  if (d.scoring.bestN < 0 || d.scoring.participation < 0 || d.scoring.participationCap < 0) problems.push('scoring');
  return problems;
}

export function createLeague(db: DB, actorId: string, clubId: string, draft: LeagueDraft): League {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const problems = validateLeague(draft);
  if (problems.length) throw new DomainError('invalid', `The league has problems: ${problems.join(', ')}.`);
  const league: League = {
    id: newId(db, 'lg'),
    clubId,
    name: draft.name.trim(),
    description: draft.description.trim().slice(0, 500),
    cover: draft.cover,
    type: draft.type,
    startAt: draft.startAt,
    endAt: draft.endAt,
    scoring: { ...draft.scoring, version: 1 },
    tournamentIds: [...new Set(draft.tournamentIds)],
    includeAll: draft.includeAll,
    eligibility: draft.eligibility,
    memberIds: [...new Set(draft.memberIds)],
    visibility: draft.visibility,
    status: 'active',
    createdBy: actorId,
    createdAt: Date.now(),
    finalStandings: null,
    championId: null,
    completedAt: null,
  };
  db.leagues.push(league);
  return league;
}

export function updateLeague(db: DB, actorId: string, id: string, draft: Partial<LeagueDraft>): League {
  const league = leagueOf(db, id);
  requirePermission(db, actorId, 'tournaments.edit', league.clubId);
  if (league.status === 'completed' || league.status === 'archived') throw new DomainError('not_editable', 'A completed season is frozen; start a new league instead.');
  const next: LeagueDraft = { name: league.name, description: league.description, type: league.type, startAt: league.startAt, endAt: league.endAt, scoring: league.scoring, includeAll: league.includeAll, tournamentIds: league.tournamentIds, eligibility: league.eligibility, memberIds: league.memberIds, visibility: league.visibility, cover: league.cover, ...draft };
  const problems = validateLeague(next);
  if (problems.length) throw new DomainError('invalid', `The league has problems: ${problems.join(', ')}.`);
  const scoringChanged = JSON.stringify({ ...next.scoring, version: 0 }) !== JSON.stringify({ ...league.scoring, version: 0 });
  Object.assign(league, {
    name: next.name.trim(),
    description: next.description.trim().slice(0, 500),
    type: next.type,
    startAt: next.startAt,
    endAt: next.endAt,
    // A scoring edit is a new rule version; standings of an active league follow the latest, completed ones never change.
    scoring: scoringChanged ? { ...next.scoring, version: league.scoring.version + 1 } : league.scoring,
    includeAll: next.includeAll,
    tournamentIds: [...new Set(next.tournamentIds)],
    eligibility: next.eligibility,
    memberIds: [...new Set(next.memberIds)],
    visibility: next.visibility,
    cover: next.cover,
  });
  return league;
}

export function assignTournament(db: DB, actorId: string, leagueId: string, tournamentId: string, on: boolean): void {
  const league = leagueOf(db, leagueId);
  requirePermission(db, actorId, 'tournaments.edit', league.clubId);
  if (league.status !== 'active' && league.status !== 'draft') throw new DomainError('not_editable', 'A completed season is frozen.');
  const t = db.tournaments[tournamentId];
  if (!t || t.clubId !== league.clubId) throw new DomainError('not_found', 'Tournament not found in this club.');
  const set = new Set(league.tournamentIds);
  if (on) set.add(tournamentId);
  else set.delete(tournamentId);
  league.tournamentIds = [...set];
}

/** Close the season: freeze the standings, name the champion, award achievements. Never recalculated afterwards. */
export function completeLeague(db: DB, actorId: string, id: string, now = Date.now()): League {
  const league = leagueOf(db, id);
  requirePermission(db, actorId, 'tournaments.edit', league.clubId);
  if (league.status === 'completed' || league.status === 'archived') throw new DomainError('not_editable', 'The season is already complete.');
  const standings = leagueStandings(db, league);
  league.finalStandings = standings.map((r) => ({ ...r }));
  league.championId = standings[0]?.userId ?? null;
  league.status = 'completed';
  league.completedAt = now;
  for (const row of standings) {
    if (row.isBot) continue;
    if (row.rank === 1) award(db, row.userId, 'season_champion', { leagueId: league.id, clubId: league.clubId }, now);
    if (row.rank <= 10) award(db, row.userId, 'league_top10', { leagueId: league.id, clubId: league.clubId }, now);
  }
  return league;
}

export function archiveLeague(db: DB, actorId: string, id: string): void {
  const league = leagueOf(db, id);
  requirePermission(db, actorId, 'tournaments.edit', league.clubId);
  if (league.status !== 'completed') throw new DomainError('not_editable', 'Only a completed season can be archived.');
  league.status = 'archived';
}

/** Leagues a person may see in a club: members see member leagues, anyone sees public ones. */
export function visibleLeagues(db: DB, userId: string | null, clubId: string): League[] {
  const member = userId ? membershipOf(db, userId, clubId)?.status === 'active' : false;
  return db.leagues.filter((l) => l.clubId === clubId && (l.visibility === 'public' || member)).sort((a, b) => b.startAt - a.startAt);
}

// ----- Achievements ----------------------------------------------------------------------------

export interface AchievementRule {
  key: AchievementKey;
  /** Once per player, or once per club (keyed on source.clubId). */
  scope: 'player' | 'club';
  /** Returns the source when earned, null otherwise. Evaluated on the player's current statistics. */
  check: (db: DB, userId: string, stats: PlayerStats) => AchievementAward['source'] | null;
}

const weekOf = (ts: number): number => Math.floor(ts / (7 * 86_400_000));

export const ACHIEVEMENTS: AchievementRule[] = [
  { key: 'first_tournament', scope: 'player', check: (_db, _u, s) => (s.played >= 1 ? { tournamentId: s.history[s.history.length - 1]!.tournamentId } : null) },
  { key: 'first_final_table', scope: 'player', check: (db, _u, s) => firstWhere(db, s, (h, r) => h.place <= finalTableSize(r)) },
  { key: 'first_win', scope: 'player', check: (db, _u, s) => firstWhere(db, s, (h) => h.place === 1) },
  { key: 'five_wins', scope: 'player', check: (db, _u, s) => (s.wins >= 5 ? nthWhere(db, s, (h) => h.place === 1, 5) : null) },
  { key: 'ten_final_tables', scope: 'player', check: (db, _u, s) => (s.finalTables >= 10 ? nthWhere(db, s, (h, r) => h.place <= finalTableSize(r), 10) : null) },
  { key: 'multi_variant', scope: 'player', check: (_db, _u, s) => (Object.keys(s.byGame).length >= 3 ? {} : null) },
  { key: 'returning', scope: 'player', check: (_db, _u, s) => (new Set(s.history.map((h) => weekOf(h.completedAt))).size >= 4 ? {} : null) },
  // season_champion, league_top10 and the referral milestones are awarded by their own events.
];

function firstWhere(db: DB, s: PlayerStats, pred: (h: PlayerStats['history'][number], r: TournamentResult) => boolean): AchievementAward['source'] | null {
  return nthWhere(db, s, pred, 1);
}
function nthWhere(db: DB, s: PlayerStats, pred: (h: PlayerStats['history'][number], r: TournamentResult) => boolean, n: number): AchievementAward['source'] | null {
  let count = 0;
  for (let i = s.history.length - 1; i >= 0; i--) {
    const h = s.history[i]!;
    const r = db.results[h.tournamentId];
    if (r && pred(h, r) && ++count === n) return { tournamentId: h.tournamentId };
  }
  return null;
}

export function hasAward(db: DB, userId: string, key: AchievementKey, clubId?: string): boolean {
  return db.achievements.some((a) => a.userId === userId && a.key === key && (clubId === undefined || a.source.clubId === clubId || (key !== 'club_champion' && key !== 'season_champion' && key !== 'league_top10')));
}

export function award(db: DB, userId: string, key: AchievementKey, source: AchievementAward['source'], at = Date.now()): AchievementAward | null {
  const perClub = key === 'season_champion' || key === 'league_top10' || key === 'club_champion';
  const dup = db.achievements.some((a) => a.userId === userId && a.key === key && (!perClub || a.source.leagueId === source.leagueId));
  if (dup) return null;
  const a: AchievementAward = { id: newId(db, 'ach'), userId, key, awardedAt: at, source };
  db.achievements.push(a);
  return a;
}

/**
 * Evaluate the statistics-based achievements for one player and award whatever is newly
 * earned. Idempotent; the runtime calls it after every result and the profile calls it on
 * open so nothing is missed. Only non-demo results earn achievements.
 */
export function evaluateAchievements(db: DB, userId: string, now = Date.now()): AchievementAward[] {
  const user = db.users[userId];
  if (!user || user.isBot) return [];
  const stats = playerStats(db, userId, { includeDemo: false });
  const earned: AchievementAward[] = [];
  for (const rule of ACHIEVEMENTS) {
    if (db.achievements.some((a) => a.userId === userId && a.key === rule.key)) continue;
    const source = rule.check(db, userId, stats);
    if (source) {
      const a = award(db, userId, rule.key, source, now);
      if (a) earned.push(a);
    }
  }
  return earned;
}

export const awardsFor = (db: DB, userId: string): AchievementAward[] => db.achievements.filter((a) => a.userId === userId).sort((a, b) => b.awardedAt - a.awardedAt);

/** Marks a result as not counting, after a review. Audited by the caller. */
export function invalidateResult(db: DB, actorId: string, tournamentId: string, reason: string): void {
  const r = db.results[tournamentId];
  if (!r) throw new DomainError('not_found', 'No result for this tournament.');
  requirePermission(db, actorId, 'tournaments.edit', r.clubId);
  r.invalidated = { at: Date.now(), by: actorId, reason: reason.trim().slice(0, 200) };
}
