/**
 * Retention engine (v0.4): inactivity alerts that land on an exact segment, derived player
 * preferences, the club's activity heatmap with scheduling recommendations, and the weekly
 * report. Everything is computed from tournament history and CRM events; nothing is a
 * delivery statistic. Pure reads, except the staff alert in `runInactivityAlerts`.
 */
import type { PresetId } from '../engine/structure.ts';
import { type VariantFamily, variantOf } from '../engine/variants.ts';
import { compute, type Participation } from './analytics.ts';
import { leagueStandings } from './competition.ts';
import { clock, DAY, notify } from './core.ts';
import { referrerFor } from './crm.ts';
import { can, requirePermission } from './permissions.ts';
import type { DB } from './types.ts';

// ----- Inactivity alerts ----------------------------------------------------------------------

export type AlertBucket = 7 | 14 | 30;
export const ALERT_BUCKETS: readonly AlertBucket[] = [7, 14, 30];
const SEGMENT_FOR: Record<AlertBucket, string> = { 7: 'at_risk_7', 14: 'at_risk_14', 30: 'inactive_30' };

export interface InactivityAlert {
  days: AlertBucket;
  /** Built-in segment holding exactly these people. */
  segmentId: string | null;
  userIds: string[];
  /** People who crossed into this bucket in the last 24 hours. */
  crossedToday: string[];
}

function daysSincePlay(db: DB, clubId: string, userId: string, now: number): number | null {
  const plays = compute.playerParticipations(db, clubId, userId);
  if (plays.length === 0) return null;
  return Math.floor((now - plays[plays.length - 1]!.at) / DAY);
}

export function inactivityAlerts(db: DB, actorId: string, clubId: string, now: number = clock.now()): InactivityAlert[] {
  requirePermission(db, actorId, 'members.view', clubId);
  return computeAlerts(db, clubId, now);
}

function computeAlerts(db: DB, clubId: string, now: number): InactivityAlert[] {
  const alerts: InactivityAlert[] = ALERT_BUCKETS.map((days) => ({ days, segmentId: db.crm.segments.find((s) => s.clubId === clubId && s.system === SEGMENT_FOR[days])?.id ?? null, userIds: [], crossedToday: [] }));
  for (const m of db.memberships) {
    if (m.clubId !== clubId || m.status !== 'active' || !db.users[m.userId]) continue;
    const d = daysSincePlay(db, clubId, m.userId, now);
    if (d === null || d < 7) continue;
    const alert = d >= 30 ? alerts[2]! : d >= 14 ? alerts[1]! : alerts[0]!;
    alert.userIds.push(m.userId);
    if (d === alert.days) alert.crossedToday.push(m.userId);
  }
  return alerts;
}

/** Once a day per club, tells staff who can see members how many people crossed 7, 14 or 30 days away. */
export function runInactivityAlerts(db: DB, now: number = clock.now()): boolean {
  let changed = false;
  const dayKey = Math.floor(now / DAY);
  for (const clubId in db.clubs) {
    const club = db.clubs[clubId]!;
    if (club.status !== 'active') continue;
    const crossed = computeAlerts(db, clubId, now).filter((a) => a.crossedToday.length > 0);
    if (crossed.length === 0) continue;
    const params = { club: club.name, n7: crossed.find((a) => a.days === 7)?.crossedToday.length ?? 0, n14: crossed.find((a) => a.days === 14)?.crossedToday.length ?? 0, n30: crossed.find((a) => a.days === 30)?.crossedToday.length ?? 0 };
    for (const m of db.memberships) {
      if (m.clubId !== clubId || m.status !== 'active' || m.role === 'player' || !can(db, m.userId, 'members.view', clubId)) continue;
      const out = notify(db, m.userId, 'system', 'notif.inactivity_alert', params, { name: 'console.crm', params: { clubId } }, { clubId, dedupeKey: `inact:${clubId}:${dayKey}:${m.userId}` });
      if (out === 'delivered') changed = true;
    }
  }
  return changed;
}

// ----- Multi-club staff overview --------------------------------------------------------------

export interface ClubPulse {
  active30: number;
  weekEntries: number;
  weekTournaments: number;
  atRisk: number;
}

/** One club's pulse for the staff overview. Needs members.view in that club. */
export function clubPulse(db: DB, actorId: string, clubId: string, now: number = clock.now()): ClubPulse {
  requirePermission(db, actorId, 'members.view', clubId);
  const week = compute.participations(db, clubId).filter((p) => p.at >= now - 7 * DAY && p.at <= now);
  return {
    active30: compute.activePlayerIds(db, clubId, 30, now).size,
    weekEntries: week.length,
    weekTournaments: new Set(week.map((p) => p.tournamentId)).size,
    atRisk: computeAlerts(db, clubId, now).reduce((n, a) => n + a.userIds.length, 0),
  };
}

// ----- Derived player preferences -------------------------------------------------------------

export interface PlayerPreferences {
  tournaments: number;
  family: VariantFamily | null;
  familyShare: number;
  preset: PresetId | null;
  format: 'mtt' | 'sng' | null;
  /** Club-local weekday (0 = Sunday) and hour the person most often plays. */
  weekday: number | null;
  hour: number | null;
  avgEntryPoints: number | null;
  inLeague: boolean;
  referredBy: { id: string; name: string } | null;
}

function localParts(at: number, timezone: string): { weekday: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, weekday: 'short', hour: '2-digit' }).formatToParts(at);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Sun');
    return { weekday: Math.max(0, wd), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24 };
  } catch {
    const d = new Date(at);
    return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
  }
}

const mode = <K,>(items: K[]): { key: K; share: number } | null => {
  if (items.length === 0) return null;
  const counts = new Map<K, number>();
  for (const k of items) counts.set(k, (counts.get(k) ?? 0) + 1);
  const [key, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { key, share: n / items.length };
};

export function playerPreferences(db: DB, actorId: string, clubId: string, userId: string): PlayerPreferences {
  requirePermission(db, actorId, 'members.view', clubId);
  const club = db.clubs[clubId]!;
  const plays = compute.playerParticipations(db, clubId, userId);
  const fam = mode(plays.map((p) => variantOf(p.game).family));
  const parts = plays.map((p) => localParts(p.at, club.timezone));
  const entries = plays.map((p) => db.tournaments[p.tournamentId]?.entryPoints).filter((x): x is number => typeof x === 'number');
  return {
    tournaments: plays.length,
    family: fam?.key ?? null,
    familyShare: fam?.share ?? 0,
    preset: mode(plays.map((p) => p.preset))?.key ?? null,
    format: mode(plays.map((p) => p.format))?.key ?? null,
    weekday: mode(parts.map((p) => p.weekday))?.key ?? null,
    hour: mode(parts.map((p) => p.hour))?.key ?? null,
    avgEntryPoints: entries.length ? Math.round(entries.reduce((a, b) => a + b, 0) / entries.length) : null,
    inLeague: db.leagues.some((l) => l.clubId === clubId && l.status === 'active' && leagueStandings(db, l).some((s) => s.userId === userId)),
    referredBy: referrerFor(db, clubId, userId),
  };
}

// ----- Activity heatmap and scheduling recommendations ----------------------------------------

export interface HeatmapReport {
  /** 7 × 24 grid, Sunday first, in the club's timezone: average entrants of tournaments that started in that slot. */
  avgEntrants: number[][];
  /** Same grid: how many tournaments started in that slot. */
  tournaments: number[][];
  /** 7 × 24 grid: unique players who were dealt in at that slot (any tournament). */
  players: number[][];
  recommendations: SlotRecommendation[];
  windowDays: number;
  sample: number;
}

export interface SlotRecommendation {
  weekday: number;
  hour: number;
  tournaments: number;
  avgEntrants: number;
  /** The next time this slot comes round, in the club's timezone. */
  nextAt: number;
  /** 0–1: how the slot compares with the club's best. */
  score: number;
}

const grid = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

/** The next moment that is `weekday` at `hour`:00 in the club's timezone, strictly after `from`. */
export function nextSlot(from: number, weekday: number, hour: number, timezone: string): number {
  const HOUR = 3_600_000;
  const base = Math.ceil(from / HOUR) * HOUR;
  for (let i = 0; i < 24 * 8; i++) {
    const ts = base + i * HOUR;
    const p = localParts(ts, timezone);
    if (p.weekday === weekday && p.hour === hour && ts > from) return ts;
  }
  return base + 7 * DAY;
}

export function activityHeatmap(db: DB, actorId: string, clubId: string, windowDays = 120, now: number = clock.now()): HeatmapReport {
  requirePermission(db, actorId, 'analytics.view', clubId);
  const club = db.clubs[clubId]!;
  const since = now - windowDays * DAY;
  const parts = compute.participations(db, clubId).filter((p) => p.at >= since && p.at <= now && p.completedAt !== null);
  const byTournament = new Map<string, Participation[]>();
  for (const p of parts) byTournament.set(p.tournamentId, [...(byTournament.get(p.tournamentId) ?? []), p]);
  const sumEntrants = grid();
  const tournaments = grid();
  const playerSets: Set<string>[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Set<string>()));
  for (const [, list] of byTournament) {
    const first = list[0]!;
    const { weekday, hour } = localParts(first.at, club.timezone);
    tournaments[weekday]![hour]! += 1;
    sumEntrants[weekday]![hour]! += first.entrants;
    for (const p of list) playerSets[weekday]![hour]!.add(p.userId);
  }
  const avgEntrants = sumEntrants.map((row, d) => row.map((n, h) => (tournaments[d]![h]! > 0 ? n / tournaments[d]![h]! : 0)));
  const players = playerSets.map((row) => row.map((s) => s.size));
  const candidates: SlotRecommendation[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const n = tournaments[d]![h]!;
      if (n < 2) continue; // one tournament is an anecdote, not a pattern
      const avg = avgEntrants[d]![h]!;
      candidates.push({ weekday: d, hour: h, tournaments: n, avgEntrants: Math.round(avg * 10) / 10, nextAt: nextSlot(now, d, h, club.timezone), score: 0 });
    }
  }
  candidates.sort((a, b) => b.avgEntrants - a.avgEntrants || b.tournaments - a.tournaments || a.nextAt - b.nextAt);
  const best = Math.max(1, candidates[0]?.avgEntrants ?? 1);
  for (const c of candidates) c.score = Math.round((c.avgEntrants / best) * 100) / 100;
  return { avgEntrants, tournaments, players, recommendations: candidates.slice(0, 3), windowDays, sample: byTournament.size };
}

// ----- Weekly report --------------------------------------------------------------------------

export interface WeeklyReport {
  from: number;
  to: number;
  tournaments: number;
  entries: number;
  uniquePlayers: number;
  newMembers: number;
  requestsPending: number;
  firstTimers: number;
  returning: number;
  referralsApproved: number;
  inactive: { days: AlertBucket; count: number }[];
  topPlayers: { userId: string; name: string; tournaments: number; wins: number }[];
  busiest: { name: string; tournamentId: string; entrants: number } | null;
  previous: { tournaments: number; entries: number; uniquePlayers: number; newMembers: number };
}

/** The week starting at `weekStart` (any time within it is fine). Weeks run Monday to Sunday in UTC-days. */
export function weeklyReport(db: DB, actorId: string, clubId: string, weekStart: number = clock.now() - 7 * DAY): WeeklyReport {
  requirePermission(db, actorId, 'analytics.view', clubId);
  const from = startOfWeek(weekStart);
  const to = from + 7 * DAY;
  const window = (a: number, b: number) => {
    const parts = compute.participations(db, clubId).filter((p) => p.at >= a && p.at < b);
    const ids = new Set(parts.map((p) => p.tournamentId));
    const players = new Set(parts.map((p) => p.userId));
    const newMembers = db.memberships.filter((m) => m.clubId === clubId && m.joinedAt !== null && m.joinedAt >= a && m.joinedAt < b).length;
    return { parts, tournaments: ids.size, entries: parts.length, uniquePlayers: players.size, newMembers };
  };
  const cur = window(from, to);
  const prev = window(from - 7 * DAY, from);
  const ms = compute.milestones(db, clubId);
  let firstTimers = 0;
  for (const id of new Set(cur.parts.map((p) => p.userId))) {
    const first = ms.get(id)?.firstPlayedAt ?? null;
    if (first !== null && first >= from && first < to) firstTimers++;
  }
  const returning = cur.uniquePlayers - firstTimers;
  const perPlayer = new Map<string, { tournaments: number; wins: number }>();
  for (const p of cur.parts) {
    const row = perPlayer.get(p.userId) ?? { tournaments: 0, wins: 0 };
    row.tournaments++;
    if (p.place === 1) row.wins++;
    perPlayer.set(p.userId, row);
  }
  const topPlayers = [...perPlayer.entries()]
    .filter(([id]) => db.users[id] && !db.users[id]!.isBot)
    .map(([userId, r]) => ({ userId, name: db.users[userId]!.name, ...r }))
    .sort((a, b) => b.wins - a.wins || b.tournaments - a.tournaments || a.name.localeCompare(b.name))
    .slice(0, 5);
  const byT = new Map<string, Participation>();
  for (const p of cur.parts) if (!byT.has(p.tournamentId) || p.entrants > byT.get(p.tournamentId)!.entrants) byT.set(p.tournamentId, p);
  const busiestP = [...byT.values()].sort((a, b) => b.entrants - a.entrants)[0];
  const referralsApproved = db.crm.events.filter((e) => e.clubId === clubId && e.type === 'membership_approved' && e.at >= from && e.at < to && referrerFor(db, clubId, e.userId) !== null).length;
  return {
    from,
    to,
    tournaments: cur.tournaments,
    entries: cur.entries,
    uniquePlayers: cur.uniquePlayers,
    newMembers: cur.newMembers,
    requestsPending: db.memberships.filter((m) => m.clubId === clubId && m.status === 'pending').length,
    firstTimers,
    returning,
    referralsApproved,
    inactive: computeAlerts(db, clubId, to).map((a) => ({ days: a.days, count: a.userIds.length })),
    topPlayers,
    busiest: busiestP ? { name: busiestP.name, tournamentId: busiestP.tournamentId, entrants: busiestP.entrants } : null,
    previous: { tournaments: prev.tournaments, entries: prev.entries, uniquePlayers: prev.uniquePlayers, newMembers: prev.newMembers },
  };
}

export function startOfWeek(ts: number): number {
  const day = Math.floor(ts / DAY) * DAY;
  const back = (new Date(day).getUTCDay() + 6) % 7;
  return day - back * DAY;
}
