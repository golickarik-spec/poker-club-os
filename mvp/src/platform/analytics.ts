/**
 * Club analytics, computed from stored records every time they are asked for.
 *
 * Sources of truth:
 *  - tournament participation: tournament results, plus the registered players
 *    of tournaments that are running right now. Registration alone is never a
 *    participation.
 *  - relationship milestones (followed, requested membership, approved): the
 *    CRM event log, which carries the timestamp of each.
 *
 * Nothing in this file stores a figure. A number shown in a report and the
 * list of people behind it come from the same function, so they cannot differ.
 *
 * Every exported report function takes the actor and checks `analytics.view`
 * in the target club (or platform rights). The `compute` object holds the
 * unguarded calculations for use by other service modules and by tests.
 *
 * Days are UTC days.
 */
import type { PresetId } from '../engine/structure.ts';
import type { VariantId } from '../engine/variants.ts';
import { clock, crmSettings, DAY } from './core.ts';
import { membershipOf, requirePermission, requirePlatform } from './permissions.ts';
import type { AcquisitionSource, DB, LifecycleStage } from './types.ts';
import { ACQUISITION_SOURCES } from './types.ts';

// ---------------------------------------------------------------------------
// Participation index
// ---------------------------------------------------------------------------

export interface Participation {
  userId: string;
  clubId: string;
  tournamentId: string;
  name: string;
  /** When play started. */
  at: number;
  /** Null while the tournament is still running. */
  completedAt: number | null;
  place: number | null;
  entrants: number;
  format: 'mtt' | 'sng';
  preset: PresetId;
  /** Poker variant played (v0.4); Hold'em when the record predates variants. */
  game: VariantId;
  /** Generated demo history rather than a tournament played in this session. */
  seeded: boolean;
}

interface Index {
  stamp: string;
  byClub: Map<string, Participation[]>;
  byPlayer: Map<string, Participation[]>;
}

interface MilestoneCache {
  stamp: string;
  byClub: Map<string, Map<string, Milestones>>;
}

const cache = new WeakMap<DB, Index>();
const milestoneCache = new WeakMap<DB, MilestoneCache>();

/** Changes whenever the set of participations can have changed: a result was stored, or a running tournament's field changed. */
function stampOf(db: DB): string {
  let live = 0;
  let running = '';
  for (const id in db.tournaments) {
    const t = db.tournaments[id]!;
    if (t.status === 'RUNNING' || t.status === 'PAUSED') {
      live += t.registrations.length;
      running += id;
    }
  }
  return `${Object.keys(db.results).length}:${live}:${running}`;
}

function indexOf(db: DB): Index {
  const stamp = stampOf(db);
  const cached = cache.get(db);
  if (cached && cached.stamp === stamp) return cached;
  const byClub = new Map<string, Participation[]>();
  const push = (p: Participation) => {
    let list = byClub.get(p.clubId);
    if (!list) byClub.set(p.clubId, (list = []));
    list.push(p);
  };
  for (const id in db.results) {
    const r = db.results[id]!;
    const preset = db.tournaments[r.tournamentId]?.preset ?? 'custom';
    for (const place of r.places) {
      push({ userId: place.userId, clubId: r.clubId, tournamentId: r.tournamentId, name: r.name, at: r.startedAt, completedAt: r.completedAt, place: place.place, entrants: r.entrants, format: r.format, preset, game: r.game ?? db.tournaments[r.tournamentId]?.game ?? 'nlhe', seeded: r.seeded });
    }
  }
  for (const id in db.tournaments) {
    const t = db.tournaments[id]!;
    if (t.status !== 'RUNNING' && t.status !== 'PAUSED') continue;
    const seated = t.registrations.filter((r) => r.status === 'registered');
    for (const r of seated) {
      push({ userId: r.userId, clubId: t.clubId, tournamentId: t.id, name: t.name, at: t.startedAt ?? r.at, completedAt: null, place: null, entrants: seated.length, format: t.format, preset: t.preset, game: t.game ?? 'nlhe', seeded: false });
    }
  }
  const byPlayer = new Map<string, Participation[]>();
  for (const [clubId, list] of byClub) {
    list.sort((a, b) => a.at - b.at);
    for (const p of list) {
      const key = `${clubId}:${p.userId}`;
      let mine = byPlayer.get(key);
      if (!mine) byPlayer.set(key, (mine = []));
      mine.push(p);
    }
  }
  const index: Index = { stamp, byClub, byPlayer };
  cache.set(db, index);
  return index;
}

/** Everyone who was dealt in at this club, oldest first. */
function participations(db: DB, clubId: string): Participation[] {
  return indexOf(db).byClub.get(clubId) ?? [];
}

function playerParticipations(db: DB, clubId: string, userId: string): Participation[] {
  return indexOf(db).byPlayer.get(`${clubId}:${userId}`) ?? [];
}

// ---------------------------------------------------------------------------
// Milestones and lifecycle
// ---------------------------------------------------------------------------

/** First time each thing happened for one person at one club (null = never). */
export interface Milestones {
  followedAt: number | null;
  requestedAt: number | null;
  approvedAt: number | null;
  firstPlayedAt: number | null;
  secondPlayedAt: number | null;
}

function milestones(db: DB, clubId: string): Map<string, Milestones> {
  const index = indexOf(db);
  const events = db.crm.events;
  // The log only grows (or is trimmed from the front), so its length and last id identify its state.
  const stamp = `${index.stamp}|${events.length}:${events[events.length - 1]?.id ?? ''}:${events[0]?.id ?? ''}`;
  let store = milestoneCache.get(db);
  if (!store || store.stamp !== stamp) milestoneCache.set(db, (store = { stamp, byClub: new Map() }));
  const cached = store.byClub.get(clubId);
  if (cached) return cached;
  const map = new Map<string, Milestones>();
  const of = (userId: string): Milestones => {
    let m = map.get(userId);
    if (!m) map.set(userId, (m = { followedAt: null, requestedAt: null, approvedAt: null, firstPlayedAt: null, secondPlayedAt: null }));
    return m;
  };
  const first = (current: number | null, at: number): number => (current === null || at < current ? at : current);
  for (const e of events) {
    if (e.clubId !== clubId) continue;
    if (e.type === 'followed') of(e.userId).followedAt = first(of(e.userId).followedAt, e.at);
    else if (e.type === 'membership_requested') of(e.userId).requestedAt = first(of(e.userId).requestedAt, e.at);
    else if (e.type === 'membership_approved') of(e.userId).approvedAt = first(of(e.userId).approvedAt, e.at);
  }
  for (const [key, list] of index.byPlayer) {
    if (!key.startsWith(`${clubId}:`)) continue;
    const m = of(key.slice(clubId.length + 1));
    m.firstPlayedAt = list[0]?.at ?? null;
    m.secondPlayedAt = list[1]?.at ?? null;
  }
  store.byClub.set(clubId, map);
  return map;
}

export interface Lifecycle {
  /** Where the person is in their relationship with the club. Null when there is none. */
  stage: LifecycleStage | null;
  /** Played within the club's "active" period. Independent of the stage and of membership status. */
  active: boolean;
  tournaments: number;
  lastPlayedAt: number | null;
}

/**
 * Lifecycle is about what a person has done, not what they are allowed to do:
 * a returning participant can have a suspended membership.
 *
 *   inactive      played before, but not within the inactive period
 *   returning     played two or more tournaments
 *   first_time    played exactly one
 *   approved      approved member who has not played yet
 *   interested    asked for membership
 *   new_follower  follows the club
 */
function lifecycleOf(db: DB, clubId: string, userId: string, now: number = clock.now()): Lifecycle {
  const played = playerParticipations(db, clubId, userId);
  const settings = crmSettings(db, clubId);
  if (played.length > 0) {
    const last = played[played.length - 1]!.at;
    const stage: LifecycleStage = now - last > settings.inactiveDays * DAY ? 'inactive' : played.length >= 2 ? 'returning' : 'first_time';
    return { stage, active: now - last <= settings.activeDays * DAY, tournaments: played.length, lastPlayedAt: last };
  }
  const membership = membershipOf(db, userId, clubId);
  const m = milestones(db, clubId).get(userId);
  let stage: LifecycleStage | null = null;
  if (membership?.status === 'active' || (membership?.status === 'suspended' && m?.approvedAt)) stage = 'approved';
  else if (membership || m?.requestedAt) stage = 'interested';
  else if (db.follows.some((f) => f.clubId === clubId && f.userId === userId) || m?.followedAt) stage = 'new_follower';
  return { stage, active: false, tournaments: 0, lastPlayedAt: null };
}

export interface PlayerTournamentStats {
  tournaments: number;
  completed: number;
  wins: number;
  finalTables: number;
  averageFinish: number | null;
  best: { place: number; entrants: number; name: string } | null;
  lastPlayedAt: number | null;
}

function playerStats(db: DB, clubId: string, userId: string): PlayerTournamentStats {
  const list = playerParticipations(db, clubId, userId);
  const stats: PlayerTournamentStats = { tournaments: list.length, completed: 0, wins: 0, finalTables: 0, averageFinish: null, best: null, lastPlayedAt: list[list.length - 1]?.at ?? null };
  let sum = 0;
  for (const p of list) {
    if (p.place === null) continue;
    stats.completed++;
    sum += p.place;
    if (p.place === 1) stats.wins++;
    // A final table only means something when there was more than one table to begin with.
    if (p.entrants > 9 && p.place <= 9) stats.finalTables++;
    if (!stats.best || p.place / p.entrants < stats.best.place / stats.best.entrants) stats.best = { place: p.place, entrants: p.entrants, name: p.name };
  }
  if (stats.completed > 0) stats.averageFinish = sum / stats.completed;
  return stats;
}

/**
 * Approved members with no tournament inside the club's inactive period: either they
 * played before and stopped, or they have been a member for the whole period without playing.
 * The overview figure, the "Inactive" tag and the list behind both come from here.
 */
function inactiveMemberIds(db: DB, clubId: string, now: number = clock.now()): string[] {
  const period = crmSettings(db, clubId).inactiveDays * DAY;
  const out: string[] = [];
  for (const m of db.memberships) {
    if (m.clubId !== clubId || m.status !== 'active') continue;
    const life = lifecycleOf(db, clubId, m.userId, now);
    const neverPlayedLong = life.tournaments === 0 && m.joinedAt !== null && now - m.joinedAt > period;
    if (life.stage === 'inactive' || neverPlayedLong) out.push(m.userId);
  }
  return out;
}

/** People who played at least once in the last `days` days. */
function activePlayerIds(db: DB, clubId: string, days: number, now: number = clock.now()): Set<string> {
  const since = now - days * DAY;
  const ids = new Set<string>();
  for (const p of participations(db, clubId)) if (p.at >= since && p.at <= now) ids.add(p.userId);
  return ids;
}

// ---------------------------------------------------------------------------
// Conversion funnel
// ---------------------------------------------------------------------------

export type FunnelKind = 'followers' | 'acquisition';
export type FunnelStageKey = 'followers' | 'requested' | 'approved' | 'first' | 'returning';

export interface FunnelQuery {
  kind: FunnelKind;
  /** Cohort: people who entered the funnel (followed / requested) between `from` and `to`. */
  from: number;
  to: number;
  /**
   * Observation window in days, measured from each person's own entry. Only
   * people whose window has fully elapsed are counted, so a recent follower is
   * never scored as a failed conversion. Null observes everyone up to now.
   */
  windowDays: number | null;
  now?: number;
}

export interface FunnelStage {
  key: FunnelStageKey;
  userIds: string[];
  count: number;
  /** Share of the starting cohort (0–1). */
  ofCohort: number;
  /** Share of the previous stage (0–1). Null for the first stage. */
  ofPrevious: number | null;
  /** People lost since the previous stage, and that loss as a share of the previous stage. */
  dropOff: number | null;
  dropOffRate: number | null;
}

export interface FunnelResult {
  query: Required<FunnelQuery>;
  stages: FunnelStage[];
  /** People counted in the first stage. */
  cohort: number;
  /** In the date range, but their observation window has not elapsed yet. Not counted anywhere. */
  tooRecent: number;
  /** Followers funnel only: followed after already asking for membership, so they belong to the acquisition view. */
  alreadyInPipeline: number;
}

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

function funnel(db: DB, clubId: string, q: FunnelQuery): FunnelResult {
  const now = q.now ?? clock.now();
  const window = q.windowDays === null ? null : q.windowDays * DAY;
  const keys: FunnelStageKey[] = q.kind === 'followers' ? ['followers', 'requested', 'approved', 'first', 'returning'] : ['requested', 'approved', 'first', 'returning'];
  const sets: Record<FunnelStageKey, string[]> = { followers: [], requested: [], approved: [], first: [], returning: [] };
  let tooRecent = 0;
  let alreadyInPipeline = 0;
  for (const [userId, m] of milestones(db, clubId)) {
    const start = q.kind === 'followers' ? m.followedAt : m.requestedAt;
    if (start === null || start < q.from || start > q.to) continue;
    if (q.kind === 'followers' && m.requestedAt !== null && m.requestedAt < start) {
      alreadyInPipeline++;
      continue;
    }
    if (window !== null && start + window > now) {
      tooRecent++;
      continue;
    }
    const deadline = window === null ? now : start + window;
    const reached = (at: number | null): boolean => at !== null && at <= deadline;
    if (q.kind === 'followers') sets.followers.push(userId);
    if (!reached(m.requestedAt)) continue;
    sets.requested.push(userId);
    if (!reached(m.approvedAt)) continue;
    sets.approved.push(userId);
    if (!reached(m.firstPlayedAt)) continue;
    sets.first.push(userId);
    if (!reached(m.secondPlayedAt)) continue;
    sets.returning.push(userId);
  }
  const cohort = sets[keys[0]!].length;
  const stages: FunnelStage[] = keys.map((key, i) => {
    const count = sets[key].length;
    const previous = i === 0 ? null : sets[keys[i - 1]!].length;
    return {
      key,
      userIds: sets[key],
      count,
      ofCohort: share(count, cohort),
      ofPrevious: previous === null ? null : share(count, previous),
      dropOff: previous === null ? null : previous - count,
      dropOffRate: previous === null ? null : share(previous - count, previous),
    };
  });
  return { query: { ...q, now }, stages, cohort, tooRecent, alreadyInPipeline };
}

// ---------------------------------------------------------------------------
// Conversion KPIs
// ---------------------------------------------------------------------------

export interface Kpi {
  /** 0–1 for rates; a plain number for the average. Null when the denominator is zero. */
  value: number | null;
  numerator: number;
  denominator: number;
  previous: number | null;
  /** Relative change against the previous period (null when it cannot be computed). */
  change: number | null;
  /** The same figure for consecutive earlier periods of equal length, oldest first, ending with the current one. */
  trend: (number | null)[];
}

export interface ConversionKpis {
  followerToMember: Kpi;
  memberToPlayer: Kpi;
  repeatRate: Kpi;
  tournamentsPerActive: Kpi;
}

interface Ratio {
  numerator: number;
  denominator: number;
}

const TREND_POINTS = 6;

function kpiFrom(calc: (from: number, to: number) => Ratio, from: number, to: number): Kpi {
  // Ranges include both ends, so each earlier period ends one millisecond before the next begins.
  const step = to - from + 1;
  const value = (r: Ratio): number | null => (r.denominator > 0 ? r.numerator / r.denominator : null);
  const current = calc(from, to);
  const trend: (number | null)[] = [];
  for (let i = TREND_POINTS - 1; i >= 0; i--) trend.push(i === 0 ? value(current) : value(calc(from - i * step, to - i * step)));
  const previous = trend[trend.length - 2] ?? null;
  const now = value(current);
  return {
    value: now,
    numerator: current.numerator,
    denominator: current.denominator,
    previous,
    change: now !== null && previous !== null && previous !== 0 ? now / previous - 1 : null,
    trend,
  };
}

function conversionKpis(db: DB, clubId: string, from: number, to: number, windowDays: number | null, now: number = clock.now()): ConversionKpis {
  const all = milestones(db, clubId);
  const window = windowDays === null ? null : windowDays * DAY;
  const mature = (start: number): boolean => window === null || start + window <= now;
  const within = (start: number, at: number | null): boolean => at !== null && at >= start && at <= (window === null ? now : start + window);
  const parts = participations(db, clubId);
  return {
    // Followers who became approved members, out of the followers of the period.
    followerToMember: kpiFrom(
      (a, b) => {
        const f = funnel(db, clubId, { kind: 'followers', from: a, to: b, windowDays, now });
        return { numerator: f.stages[2]!.count, denominator: f.cohort };
      },
      from,
      to,
    ),
    // Members approved in the period who went on to play, out of the members approved in the period.
    memberToPlayer: kpiFrom(
      (a, b) => {
        let numerator = 0;
        let denominator = 0;
        for (const m of all.values()) {
          if (m.approvedAt === null || m.approvedAt < a || m.approvedAt > b || !mature(m.approvedAt)) continue;
          denominator++;
          if (within(m.approvedAt, m.firstPlayedAt) || (m.firstPlayedAt !== null && m.firstPlayedAt < m.approvedAt)) numerator++;
        }
        return { numerator, denominator };
      },
      from,
      to,
    ),
    // First-time participants of the period who played again, out of the first-time participants of the period.
    repeatRate: kpiFrom(
      (a, b) => {
        let numerator = 0;
        let denominator = 0;
        for (const m of all.values()) {
          if (m.firstPlayedAt === null || m.firstPlayedAt < a || m.firstPlayedAt > b || !mature(m.firstPlayedAt)) continue;
          denominator++;
          if (within(m.firstPlayedAt, m.secondPlayedAt)) numerator++;
        }
        return { numerator, denominator };
      },
      from,
      to,
    ),
    // Completed participations in the period divided by the unique people who made them.
    tournamentsPerActive: kpiFrom(
      (a, b) => {
        const people = new Set<string>();
        let numerator = 0;
        for (const p of parts) {
          if (p.completedAt === null || p.at < a || p.at > b) continue;
          numerator++;
          people.add(p.userId);
        }
        return { numerator, denominator: people.size };
      },
      from,
      to,
    ),
  };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionCohort {
  /** YYYY-MM of first participation. */
  month: string;
  size: number;
  /** For each window: people whose window has elapsed, and how many of them played again inside it. */
  windows: { days: number; measured: number; returned: number; rate: number | null }[];
  /** Played a second tournament at any time so far. */
  returnedEver: number;
}

export interface RetentionReport {
  newParticipants: number;
  playedTwice: number;
  playedThreePlus: number;
  tournamentsPerActive: number | null;
  /** Mean days between one participation and the next, over players with at least two in the period. */
  averageGapDays: number | null;
  repeat: { days: number; measured: number; returned: number; rate: number | null }[];
  cohorts: RetentionCohort[];
}

const REPEAT_WINDOWS = [7, 30, 90];
const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

function retention(db: DB, clubId: string, from: number, to: number, now: number = clock.now()): RetentionReport {
  const index = indexOf(db);
  const players: Participation[][] = [];
  for (const [key, list] of index.byPlayer) if (key.startsWith(`${clubId}:`)) players.push(list);

  const repeatFor = (firsts: Participation[][]): RetentionReport['repeat'] =>
    REPEAT_WINDOWS.map((days) => {
      let measured = 0;
      let returned = 0;
      for (const list of firsts) {
        const first = list[0]!.at;
        if (first + days * DAY > now) continue;
        measured++;
        if (list[1] && list[1].at <= first + days * DAY) returned++;
      }
      return { days, measured, returned, rate: measured > 0 ? returned / measured : null };
    });

  let newParticipants = 0;
  let playedTwice = 0;
  let playedThreePlus = 0;
  let entries = 0;
  let activePeople = 0;
  let gapSum = 0;
  let gapCount = 0;
  const firstsInRange: Participation[][] = [];
  const byMonth = new Map<string, Participation[][]>();
  for (const list of players) {
    const first = list[0]!;
    if (first.at >= from && first.at <= to) {
      newParticipants++;
      firstsInRange.push(list);
    }
    const inRange = list.filter((p) => p.at >= from && p.at <= to);
    if (inRange.length > 0) {
      activePeople++;
      entries += inRange.filter((p) => p.completedAt !== null).length;
      if (inRange.length >= 2) playedTwice++;
      if (inRange.length >= 3) playedThreePlus++;
      for (let i = 1; i < inRange.length; i++) {
        gapSum += inRange[i]!.at - inRange[i - 1]!.at;
        gapCount++;
      }
    }
    const month = monthKey(first.at);
    let cohort = byMonth.get(month);
    if (!cohort) byMonth.set(month, (cohort = []));
    cohort.push(list);
  }
  const cohorts: RetentionCohort[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, lists]) => ({ month, size: lists.length, windows: repeatFor(lists), returnedEver: lists.filter((l) => l.length >= 2).length }));
  return {
    newParticipants,
    playedTwice,
    playedThreePlus,
    tournamentsPerActive: activePeople > 0 ? entries / activePeople : null,
    averageGapDays: gapCount > 0 ? gapSum / gapCount / DAY : null,
    repeat: repeatFor(firstsInRange),
    cohorts,
  };
}

// ---------------------------------------------------------------------------
// Acquisition sources
// ---------------------------------------------------------------------------

export interface AcquisitionRow {
  source: AcquisitionSource;
  /** Invitation links with this label that exist for the club. */
  links: number;
  opens: number;
  registrations: number;
  follows: number;
  requests: number;
  approvals: number;
  firstPlayed: number;
  returning: number;
}

/** Unique people per source whose milestone fell inside the period. A person with no recorded source is `unknown`. */
function acquisition(db: DB, clubId: string, from: number, to: number): AcquisitionRow[] {
  const rows = new Map<AcquisitionSource, AcquisitionRow>();
  for (const source of ACQUISITION_SOURCES) rows.set(source, { source, links: 0, opens: 0, registrations: 0, follows: 0, requests: 0, approvals: 0, firstPlayed: 0, returning: 0 });
  const inRange = (at: number | null): boolean => at !== null && at >= from && at <= to;
  const linkSource = new Map<string, AcquisitionSource>();
  for (const link of db.crm.links) {
    if (link.clubId !== clubId || link.kind !== 'club') continue;
    linkSource.set(link.id, link.source);
    rows.get(link.source)!.links++;
  }
  const opened = new Set<string>();
  for (const e of db.crm.events) {
    if (e.clubId !== clubId || e.type !== 'link_opened' || !inRange(e.at)) continue;
    const source = linkSource.get(String(e.params.linkId ?? '')) ?? 'direct';
    const key = `${source}:${e.userId}`;
    if (!opened.has(key)) {
      opened.add(key);
      rows.get(source)!.opens++;
    }
  }
  for (const id in db.users) {
    const u = db.users[id]!;
    if (u.signupLinkId && linkSource.has(u.signupLinkId) && inRange(u.joinedAt)) rows.get(linkSource.get(u.signupLinkId)!)!.registrations++;
  }
  for (const [userId, m] of milestones(db, clubId)) {
    const row = rows.get(db.crm.profiles[`${clubId}:${userId}`]?.source ?? 'unknown')!;
    if (inRange(m.followedAt)) row.follows++;
    if (inRange(m.requestedAt)) row.requests++;
    if (inRange(m.approvedAt)) row.approvals++;
    if (inRange(m.firstPlayedAt)) row.firstPlayed++;
    if (inRange(m.secondPlayedAt)) row.returning++;
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Engagement, tournament and membership reports
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  /** Start of the bucket (UTC midnight). */
  day: number;
  value: number;
}

const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;

/** Events a person causes themselves; these count as activity alongside playing. */
const OWN_ACTIONS = new Set(['followed', 'membership_requested', 'tournament_requested', 'tournament_registered', 'message_sent', 'link_opened']);

function activeByDay(db: DB, clubId: string, from: number, to: number): Map<number, Set<string>> {
  const days = new Map<number, Set<string>>();
  const add = (at: number, userId: string) => {
    if (at < from || at > to) return;
    const day = dayStart(at);
    let set = days.get(day);
    if (!set) days.set(day, (set = new Set()));
    set.add(userId);
  };
  for (const p of participations(db, clubId)) add(p.at, p.userId);
  for (const e of db.crm.events) if (e.clubId === clubId && OWN_ACTIONS.has(e.type)) add(e.at, e.userId);
  return days;
}

function eachDay(from: number, to: number): number[] {
  const days: number[] = [];
  for (let d = dayStart(from); d <= to; d += DAY) days.push(d);
  return days;
}

/** How an event changes the number of approved members: +1, -1 or 0. A ban only counts when the person was a member. */
function memberDelta(e: { type: string; params: Record<string, string | number> }): number {
  if (e.type === 'membership_approved' || e.type === 'membership_reinstated') return 1;
  if (e.type === 'membership_left' || e.type === 'membership_suspended') return -1;
  if (e.type === 'membership_banned') return e.params.wasMember === 1 ? -1 : 0;
  return 0;
}

export interface OverviewReport {
  // Snapshot figures (as of now)
  totalMembers: number;
  approvedMembers: number;
  pendingRequests: number;
  followers: number;
  inactiveMembers: number;
  /** The people counted in `inactiveMembers`, so the figure can be opened as a list. */
  inactiveMemberIds: string[];
  unreadMessages: number;
  // Figures for the selected period
  newMembers: number;
  activePlayers: number;
  returningPlayers: number;
  tournamentsPlayed: number;
  // Series over the selected period
  growth: SeriesPoint[];
  participation: SeriesPoint[];
  returning: SeriesPoint[];
  engagement: SeriesPoint[];
  approvals: SeriesPoint[];
  /** True when any participation in the period comes from seeded demo history. */
  includesDemoHistory: boolean;
}

function overview(db: DB, clubId: string, from: number, to: number, now: number = clock.now()): OverviewReport {
  let approved = 0;
  let suspended = 0;
  let pending = 0;
  for (const m of db.memberships) {
    if (m.clubId !== clubId) continue;
    if (m.status === 'pending') pending++;
    else if (m.status === 'suspended') suspended++;
    else if (m.status === 'active') approved++;
  }
  const inactiveIds = inactiveMemberIds(db, clubId, now);
  const parts = participations(db, clubId);
  const firstEver = new Map<string, number>();
  for (const p of parts) if (!firstEver.has(p.userId)) firstEver.set(p.userId, p.at);
  const active = new Set<string>();
  const returningIds = new Set<string>();
  const tournaments = new Set<string>();
  const entriesByDay = new Map<number, number>();
  const returningByDay = new Map<number, Set<string>>();
  let includesDemoHistory = false;
  for (const p of parts) {
    if (p.at < from || p.at > to) continue;
    active.add(p.userId);
    if (p.seeded) includesDemoHistory = true;
    if (p.completedAt !== null) tournaments.add(p.tournamentId);
    const day = dayStart(p.at);
    entriesByDay.set(day, (entriesByDay.get(day) ?? 0) + 1);
    if (firstEver.get(p.userId)! < p.at) {
      returningIds.add(p.userId);
      let set = returningByDay.get(day);
      if (!set) returningByDay.set(day, (set = new Set()));
      set.add(p.userId);
    }
  }
  // Member growth: start from the approvals before the period and add each day's net change.
  let members = 0;
  const net = new Map<number, number>();
  const approvalsByDay = new Map<number, number>();
  let newMembers = 0;
  for (const e of db.crm.events) {
    if (e.clubId !== clubId) continue;
    const delta = memberDelta(e);
    if (delta === 0) continue;
    if (e.at < from) members += delta;
    else if (e.at <= to) net.set(dayStart(e.at), (net.get(dayStart(e.at)) ?? 0) + delta);
    if (e.type === 'membership_approved' && e.at >= from && e.at <= to) {
      newMembers++;
      approvalsByDay.set(dayStart(e.at), (approvalsByDay.get(dayStart(e.at)) ?? 0) + 1);
    }
  }
  const activity = activeByDay(db, clubId, from, to);
  const days = eachDay(from, Math.min(to, now));
  const growth: SeriesPoint[] = [];
  for (const day of days) {
    members += net.get(day) ?? 0;
    growth.push({ day, value: members });
  }
  // The log is the history; today's count is the truth. Shift the curve so it ends on the real figure.
  const shift = growth.length > 0 && to >= now - DAY ? approved - growth[growth.length - 1]!.value : 0;
  let unread = 0;
  for (const c of db.conversations) if (c.clubId === clubId) unread += c.unreadClub;
  return {
    totalMembers: approved + suspended,
    approvedMembers: approved,
    pendingRequests: pending,
    followers: db.follows.filter((f) => f.clubId === clubId).length,
    inactiveMembers: inactiveIds.length,
    inactiveMemberIds: inactiveIds,
    unreadMessages: unread,
    newMembers,
    activePlayers: active.size,
    returningPlayers: returningIds.size,
    tournamentsPlayed: tournaments.size,
    growth: growth.map((p) => ({ day: p.day, value: Math.max(0, p.value + shift) })),
    participation: days.map((day) => ({ day, value: entriesByDay.get(day) ?? 0 })),
    returning: days.map((day) => ({ day, value: returningByDay.get(day)?.size ?? 0 })),
    engagement: days.map((day) => ({ day, value: activity.get(day)?.size ?? 0 })),
    approvals: days.map((day) => ({ day, value: approvalsByDay.get(day) ?? 0 })),
    includesDemoHistory,
  };
}

export interface EngagementReport {
  dau: SeriesPoint[];
  averageDau: number;
  wau: number;
  mau: number;
  activeParticipants: number;
  /** Seats currently held in tournaments that have not started. Not participation. */
  openRegistrations: number;
  /** Completed participations in the period. */
  completedParticipations: number;
  followers: SeriesPoint[];
  followersNow: number;
  messages: number;
  announcements: number;
  // Tournaments
  tournamentsCreated: number;
  tournamentsCompleted: number;
  averageEntrants: number | null;
  entriesByWeek: SeriesPoint[];
  formats: { preset: PresetId; tournaments: number; entries: number; returning: number }[];
  /** 7 rows (Monday first) × 24 hours: entries that started in that hour, as a share of the busiest hour. */
  peak: number[][];
  // Membership
  requests: number;
  approvalRate: number | null;
  averageApprovalHours: number | null;
  memberGrowth: SeriesPoint[];
  inactiveMembers: number;
}

function engagement(db: DB, clubId: string, from: number, to: number, now: number = clock.now()): EngagementReport {
  const activity = activeByDay(db, clubId, Math.min(from, now - 30 * DAY), to);
  const days = eachDay(from, Math.min(to, now));
  const dau = days.map((day) => ({ day, value: activity.get(day)?.size ?? 0 }));
  const uniqueSince = (since: number): number => {
    const people = new Set<string>();
    for (const [day, set] of activity) if (day >= dayStart(since) && day <= now) for (const id of set) people.add(id);
    return people.size;
  };
  const parts = participations(db, clubId).filter((p) => p.at >= from && p.at <= to);
  const participants = new Set(parts.map((p) => p.userId));
  const completed = parts.filter((p) => p.completedAt !== null);
  const tournamentIds = new Set(completed.map((p) => p.tournamentId));
  const byFormat = new Map<PresetId, { tournaments: Set<string>; entries: number; perPlayer: Map<string, number> }>();
  const peakCounts: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const byWeek = new Map<number, number>();
  for (const p of parts) {
    let f = byFormat.get(p.preset);
    if (!f) byFormat.set(p.preset, (f = { tournaments: new Set(), entries: 0, perPlayer: new Map() }));
    f.tournaments.add(p.tournamentId);
    f.entries++;
    f.perPlayer.set(p.userId, (f.perPlayer.get(p.userId) ?? 0) + 1);
    const d = new Date(p.at);
    peakCounts[(d.getUTCDay() + 6) % 7]![d.getUTCHours()]! += 1;
    const week = dayStart(p.at) - ((new Date(p.at).getUTCDay() + 6) % 7) * DAY;
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  const busiest = Math.max(1, ...peakCounts.flat());
  let created = 0;
  let openRegistrations = 0;
  for (const id in db.tournaments) {
    const t = db.tournaments[id]!;
    if (t.clubId !== clubId) continue;
    if (t.status !== 'DRAFT' && t.createdAt >= from && t.createdAt <= to) created++;
    if (t.status === 'REGISTRATION_OPEN' || t.status === 'REGISTRATION_CLOSED' || t.status === 'SCHEDULED') openRegistrations += t.registrations.filter((r) => r.status === 'registered').length;
  }
  // Followers over time, rebuilt from follow / unfollow events and anchored on today's real count.
  const followersNow = db.follows.filter((f) => f.clubId === clubId).length;
  let followers = 0;
  let members = 0;
  const followNet = new Map<number, number>();
  const memberNet = new Map<number, number>();
  let requests = 0;
  let decided = 0;
  let approvedCount = 0;
  let approvalMs = 0;
  let approvalTimed = 0;
  let messages = 0;
  const requestedAt = new Map<string, number>();
  for (const e of db.crm.events) {
    if (e.clubId !== clubId) continue;
    const inRange = e.at >= from && e.at <= to;
    const bump = (map: Map<number, number>, delta: number, before: () => void) => {
      if (e.at < from) before();
      else if (e.at <= to) map.set(dayStart(e.at), (map.get(dayStart(e.at)) ?? 0) + delta);
    };
    if (e.type === 'followed') bump(followNet, 1, () => followers++);
    else if (e.type === 'unfollowed') bump(followNet, -1, () => followers--);
    else if (memberDelta(e) === 1) bump(memberNet, 1, () => members++);
    else if (memberDelta(e) === -1) bump(memberNet, -1, () => members--);
    if (e.type === 'membership_requested') {
      requestedAt.set(e.userId, e.at);
      if (inRange) requests++;
    }
    if ((e.type === 'membership_approved' || e.type === 'membership_rejected') && inRange) {
      decided++;
      if (e.type === 'membership_approved') {
        approvedCount++;
        const asked = requestedAt.get(e.userId);
        if (asked !== undefined && e.at >= asked) {
          approvalMs += e.at - asked;
          approvalTimed++;
        }
      }
    }
    if (e.type === 'message_sent' && inRange) messages++;
  }
  const series = (start: number, net: Map<number, number>, anchor: number | null): SeriesPoint[] => {
    let value = start;
    const out = days.map((day) => ({ day, value: (value += net.get(day) ?? 0) }));
    const shift = anchor !== null && out.length > 0 && to >= now - DAY ? anchor - out[out.length - 1]!.value : 0;
    return out.map((p) => ({ day: p.day, value: Math.max(0, p.value + shift) }));
  };
  const o = overview(db, clubId, from, to, now);
  return {
    dau,
    averageDau: dau.length > 0 ? dau.reduce((n, p) => n + p.value, 0) / dau.length : 0,
    wau: uniqueSince(now - 7 * DAY),
    mau: uniqueSince(now - 30 * DAY),
    activeParticipants: participants.size,
    openRegistrations,
    completedParticipations: completed.length,
    followers: series(followers, followNet, followersNow),
    followersNow,
    messages,
    announcements: db.announcements.filter((a) => a.clubId === clubId && a.status === 'published' && a.at >= from && a.at <= to).length,
    tournamentsCreated: created,
    tournamentsCompleted: tournamentIds.size,
    averageEntrants: tournamentIds.size > 0 ? completed.length / tournamentIds.size : null,
    entriesByWeek: [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([day, value]) => ({ day, value })),
    formats: [...byFormat.entries()]
      .map(([preset, f]) => ({ preset, tournaments: f.tournaments.size, entries: f.entries, returning: [...f.perPlayer.values()].filter((n) => n >= 2).length }))
      .sort((a, b) => b.entries - a.entries),
    peak: peakCounts.map((row) => row.map((n) => n / busiest)),
    requests,
    approvalRate: decided > 0 ? approvedCount / decided : null,
    averageApprovalHours: approvalTimed > 0 ? approvalMs / approvalTimed / 3_600_000 : null,
    memberGrowth: series(members, memberNet, o.approvedMembers),
    inactiveMembers: o.inactiveMembers,
  };
}

/** Unique participants per calendar month, for the platform overview. */
function monthlyActive(db: DB, clubId: string, months: number, now: number = clock.now()): { month: string; players: number }[] {
  const sets = new Map<string, Set<string>>();
  for (const p of participations(db, clubId)) {
    const key = monthKey(p.at);
    let set = sets.get(key);
    if (!set) sets.set(key, (set = new Set()));
    set.add(p.userId);
  }
  const out: { month: string; players: number }[] = [];
  const d = new Date(now);
  d.setUTCDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const key = m.toISOString().slice(0, 7);
    out.push({ month: key, players: sets.get(key)?.size ?? 0 });
  }
  return out;
}

/** Unguarded calculations, for other service modules and for tests that build their own data. */
export const compute = {
  participations,
  playerParticipations,
  milestones,
  lifecycleOf,
  playerStats,
  activePlayerIds,
  inactiveMemberIds,
  funnel,
  conversionKpis,
  retention,
  acquisition,
  overview,
  engagement,
  monthlyActive,
};

// ---------------------------------------------------------------------------
// Guarded reports (what the console calls)
// ---------------------------------------------------------------------------

const guard = (db: DB, actorId: string, clubId: string): void => requirePermission(db, actorId, 'analytics.view', clubId);

export function overviewReport(db: DB, actorId: string, clubId: string, from: number, to: number): OverviewReport {
  // The CRM overview is the landing page for everyone who can see players.
  requirePermission(db, actorId, 'members.view', clubId);
  return overview(db, clubId, from, to);
}

export function funnelReport(db: DB, actorId: string, clubId: string, q: FunnelQuery): { current: FunnelResult; previous: FunnelResult } {
  guard(db, actorId, clubId);
  // The previous period has the same length and ends just before this one starts.
  const length = q.to - q.from;
  return { current: funnel(db, clubId, q), previous: funnel(db, clubId, { ...q, from: q.from - length - 1, to: q.from - 1 }) };
}

export function kpiReport(db: DB, actorId: string, clubId: string, from: number, to: number, windowDays: number | null): ConversionKpis {
  guard(db, actorId, clubId);
  return conversionKpis(db, clubId, from, to, windowDays);
}

export function retentionReport(db: DB, actorId: string, clubId: string, from: number, to: number): RetentionReport {
  guard(db, actorId, clubId);
  return retention(db, clubId, from, to);
}

export function acquisitionReport(db: DB, actorId: string, clubId: string, from: number, to: number): AcquisitionRow[] {
  guard(db, actorId, clubId);
  return acquisition(db, clubId, from, to);
}

export function engagementReport(db: DB, actorId: string, clubId: string, from: number, to: number): EngagementReport {
  guard(db, actorId, clubId);
  return engagement(db, clubId, from, to);
}

export function platformMonthlyActive(db: DB, actorId: string, months = 5): Record<string, { month: string; players: number }[]> {
  requirePlatform(db, actorId);
  const out: Record<string, { month: string; players: number }[]> = {};
  for (const clubId in db.clubs) out[clubId] = monthlyActive(db, clubId, months);
  return out;
}
