/**
 * Tournament runtime.
 *
 * This is the piece that would be a server process in production. It owns the
 * live state of every running tournament and advances it on a timer:
 *
 *  - lifecycle transitions that happen by time (registration opens, start,
 *    seating → running, automatic cancellation below the minimum);
 *  - clearly labelled *simulated* activity (demo members registering);
 *  - the blind clock and all tables nobody is watching (whole hands at a time);
 *  - a `TableDriver` for the one table being watched or played, which paces the
 *    same engine action by action for a human.
 *
 * In the prototype it runs in the browser tab, so tournaments only progress
 * while the tab is open. Nothing here is a production real-time platform.
 */
import { applyAutoAction, handInProgress, legalActions, occupiedSeats, type HandEvent, type LegalActions, type PlayerAction } from '../engine/holdem.ts';
import { cryptoRng, mathRng, shuffleInPlace, type Rng } from '../engine/rng.ts';
import { newActionId, submitCommand, type CommandResult } from '../engine/session.ts';
import { DEFAULT_VARIANT } from '../engine/variants.ts';
import { entryAt } from '../engine/structure.ts';
import {
  activeTables,
  addLateEntrant,
  advanceClock,
  canDeal,
  createLive,
  currentLevelNumber,
  dealHand,
  lateRegistrationOpen,
  needsSettling,
  pause as pauseLive,
  playHandInstant,
  results as liveResults,
  resume as resumeLive,
  settleHand,
  stepAutomaticAction,
  type Entrant,
  type TournamentLive,
  type TTable,
} from '../engine/tournament.ts';
import { applyEvent, baseView, cloneView, redactEvent, viewOf, viewOfAll, type TableView } from '../engine/view.ts';
import * as api from './api.ts';
import { clock, SYSTEM } from './api.ts';
import * as automation from './automation.ts';
import { can } from './permissions.ts';
import { readStorage, removeStorage, writeStorage, type Store } from './store.ts';
import { DomainError, ForbiddenError, type DB, type HandRecord, type Registration, type Tournament, type TournamentResult } from './types.ts';

const LIVE_KEY = 'pcos.live.v5';
/** How often the slower housekeeping runs: scheduled announcements, automations, simulated reading. */
const HOUSEKEEPING_MS = 1_000;
const TICK_MS = 250;
/** Spectator feed limits: keep ten minutes of snapshots, never more than 1,200 per table. */
const FEED_KEEP_MS = 10 * 60_000;
const FEED_MAX = 1200;
export const SPECTATE_MIN_DELAY_MS = 30_000;
export const STREAM_MIN_DELAY_MS = 60_000;
export const SPECTATE_DELAYS = [30_000, 120_000, 300_000] as const;

export interface FeedSnapshot {
  at: number;
  handNo: number;
  events: number;
  publicView: TableView;
  fullView: TableView;
  clockMs: number;
  level: number;
}

export interface SpectatorFrame {
  view: TableView | null;
  at: number;
  delayMs: number;
  mode: 'public' | 'streamer';
  handNo: number;
  clockMs: number;
  level: number;
  /** True while the feed is younger than the delay (nothing old enough to show yet). */
  waiting: boolean;
}
const MAX_DT_MS = 2_000;

type Listener = () => void;

export type DriverNotice =
  | { type: 'moved'; from: number; to: number }
  | { type: 'eliminated'; place: number; entrants: number }
  | { type: 'winner'; playerId: string }
  | { type: 'final_table' }
  | null;

export interface TurnInfo {
  seat: number;
  startedAt: number;
  durationMs: number;
  /** True when the timer is the viewer's own decision clock (bots just "think"). */
  own: boolean;
}

export interface DriverOptions {
  turnSeconds: number;
  /** 1 = normal pacing, smaller = quicker (reduced motion). */
  pace: number;
}

export class Runtime {
  readonly lives = new Map<string, TournamentLive>();
  /**
   * v0.4 delayed spectator feed. Snapshots of each running table, taken whenever its hand
   * advances, kept for FEED_KEEP_MS. A spectator only ever receives the snapshot that is at
   * least `delayMs` old, so nothing a spectator sees can inform a player still in the hand.
   * In the prototype this buffer lives in the same process as the engine; in production it is
   * the server's, and only delayed frames leave it.
   */
  readonly feeds = new Map<string, FeedSnapshot[]>();
  private feedMarks = new Map<string, string>();
  driver: TableDriver | null = null;
  readonly rng: Rng;
  readonly botRng: Rng;
  version = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastSave = 0;
  private lastHousekeeping = 0;
  private dirty = false;
  /** Fractional simulated registrations carried between ticks, per tournament. */
  private regCarry = new Map<string, number>();
  private persist: boolean;

  constructor(
    readonly store: Store,
    options: { persist?: boolean; rng?: Rng; botRng?: Rng } = {},
  ) {
    this.persist = options.persist ?? false;
    this.rng = options.rng ?? cryptoRng();
    this.botRng = options.botRng ?? mathRng();
    if (this.persist && store.restored) {
      const saved = readStorage<[string, TournamentLive][]>(LIVE_KEY);
      if (saved) {
        for (const [id, live] of saved) {
          for (const t of live.tables) t.driven = false;
          for (const pid in live.players) if (!live.players[pid]!.isBot) live.players[pid]!.away = true;
          this.lives.set(id, live);
        }
      }
    }
    this.ensureLives();
  }

  get db(): DB {
    return this.store.db;
  }

  // ----- subscription -----------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  touch(): void {
    this.version += 1;
    this.dirty = true;
    for (const l of this.listeners) l();
  }

  start(): void {
    if (this.timer) return;
    this.lastTick = clock.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.driver?.dispose();
  }

  reset(): void {
    this.driver?.dispose();
    this.lives.clear();
    this.regCarry.clear();
    removeStorage(LIVE_KEY);
    this.ensureLives();
    this.touch();
  }

  // ----- live state ---------------------------------------------------------------

  getLive(id: string): TournamentLive | undefined {
    return this.lives.get(id);
  }

  private entrantsOf(t: Tournament): Entrant[] {
    return t.registrations
      .filter((r) => r.status === 'registered')
      .map((r) => {
        const u = this.db.users[r.userId]!;
        return { id: u.id, name: u.name, isBot: u.isBot, style: u.style };
      });
  }

  /** Make sure every tournament that should have live state does (after a reload, or for seeded running events). */
  private ensureLives(): void {
    const now = clock.now();
    for (const id in this.db.tournaments) {
      const t = this.db.tournaments[id]!;
      const needsLive = t.status === 'SEATING' || t.status === 'RUNNING' || t.status === 'PAUSED';
      if (!needsLive) {
        this.lives.delete(id);
        continue;
      }
      if (this.lives.has(id)) continue;
      const entrants = this.entrantsOf(t);
      if (entrants.length < 2) continue;
      const live = createLive(id, t.structure, entrants, this.rng, t.demoSpeed, t.game ?? DEFAULT_VARIANT);
      for (const pid in live.players) if (!live.players[pid]!.isBot) live.players[pid]!.away = true;
      // Catch up to where the tournament would be by now.
      if (t.status !== 'SEATING' && t.startedAt) {
        const elapsed = Math.min(3 * 3_600_000, Math.max(0, now - t.startedAt)) * t.demoSpeed;
        this.fastForward(live, elapsed, 12);
      }
      if (t.status === 'PAUSED' && live.status === 'RUNNING') pauseLive(live);
      this.lives.set(id, live);
    }
  }

  /** Advance a bots-only tournament by `ms` of tournament time without pacing. Stops before the final table breaks up. */
  fastForward(live: TournamentLive, ms: number, samples = 40): void {
    const step = 5_000;
    const started = performance.now();
    for (let done = 0; done < ms && live.status === 'RUNNING'; done += step) {
      advanceClock(live, step);
      this.playDueHands(live, samples, 50);
    }
    this.db.counters.sessionEngineMs += performance.now() - started;
  }

  private playDueHands(live: TournamentLive, samples: number, maxPerTable: number): boolean {
    let played = false;
    for (const t of live.tables) {
      if (t.closed || t.driven) continue;
      // A table that lost its driver mid-hand is finished off first.
      if (handInProgress(t.state) || needsSettling(t)) {
        this.finishHand(live, t);
        played = true;
      }
      let n = 0;
      while (n < maxPerTable && (live.status as string) === 'RUNNING' && canDeal(live, t) && t.nextHandAt <= live.clockMs) {
        const started = performance.now();
        playHandInstant(live, t, this.rng, this.botRng, samples);
        this.db.counters.sessionHands += 1;
        this.db.counters.handsDealt += 1;
        this.db.counters.sessionEngineMs += performance.now() - started;
        played = true;
        n++;
      }
    }
    return played;
  }

  /** Complete and settle whatever hand is on the table, auto-acting for anyone who is not a bot. */
  finishHand(live: TournamentLive, t: TTable): void {
    let guard = 0;
    while (handInProgress(t.state)) {
      if (!stepAutomaticAction(live, t, this.botRng, 60)) applyAutoAction(t.state);
      if (++guard > 2_000) throw new Error('Hand did not terminate');
    }
    if (needsSettling(t)) {
      settleHand(live, t, this.rng);
      this.db.counters.sessionHands += 1;
      this.db.counters.handsDealt += 1;
    }
  }

  // ----- the tick -----------------------------------------------------------------

  tick(): void {
    const now = clock.now();
    const dt = Math.min(MAX_DT_MS, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const db = this.db;
    let dbChanged = false;
    let liveChanged = false;

    for (const id in db.tournaments) {
      const t = db.tournaments[id]!;
      try {
        switch (t.status) {
          case 'SCHEDULED':
            if (now >= t.registrationOpensAt) {
              api.openRegistration(db, SYSTEM, id);
              dbChanged = true;
            }
            break;
          case 'REGISTRATION_OPEN':
          case 'REGISTRATION_CLOSED': {
            if (t.status === 'REGISTRATION_OPEN' && this.simulateRegistrations(t, dt)) dbChanged = true;
            const count = api.registeredCount(t);
            const due = t.startMode === 'scheduled' ? now >= t.startAt : t.startMode === 'when_full' ? count >= t.maxPlayers : false;
            if (due) {
              if (count >= Math.max(2, t.minPlayers)) this.beginSeating(SYSTEM, id);
              else api.cancelTournament(db, SYSTEM, id, 'Minimum number of players was not reached.');
              dbChanged = true;
            }
            break;
          }
          case 'SEATING':
            if (t.seatingUntil !== null && now >= t.seatingUntil) {
              api.markRunning(db, id);
              dbChanged = true;
              liveChanged = true;
            }
            break;
          default:
            break;
        }
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
      }
    }

    for (const [id, live] of this.lives) {
      const t = db.tournaments[id];
      if (!t) {
        this.lives.delete(id);
        continue;
      }
      if (t.status === 'RUNNING' && live.status === 'RUNNING') {
        advanceClock(live, dt * live.speed);
        this.playDueHands(live, 60, 6);
        liveChanged = true; // the clock moved
      }
      if (live.status === 'COMPLETED' && t.status !== 'COMPLETED' && !this.driverBusyWith(id)) {
        this.finalize(t, live);
        dbChanged = true;
        liveChanged = true;
      }
    }

    this.captureFeeds(now);
    if (this.simulateStaff(now)) dbChanged = true;
    if (now - this.lastHousekeeping >= HOUSEKEEPING_MS) {
      this.lastHousekeeping = now;
      if (api.publishDueAnnouncements(db, now) > 0) dbChanged = true;
      if (automation.tick(db, now)) dbChanged = true;
      if (this.simulateReads(now)) dbChanged = true;
    }

    if (dbChanged) this.store.touch();
    if (liveChanged || dbChanged) this.touch();
    if (this.persist && this.dirty && now - this.lastSave > 3_000) this.save();
  }

  // ----- delayed spectator feed ------------------------------------------------------------

  private captureFeeds(now: number): void {
    for (const [id, live] of this.lives) {
      if (live.status !== 'RUNNING') continue;
      for (const table of live.tables) {
        if (table.closed) continue;
        const key = `${id}:${table.no}`;
        const hand = table.state.hand;
        const mark = `${hand?.handNo ?? 0}:${hand?.events.length ?? 0}:${table.state.seats.filter(Boolean).length}`;
        if (this.feedMarks.get(key) === mark) continue;
        this.feedMarks.set(key, mark);
        let list = this.feeds.get(key);
        if (!list) this.feeds.set(key, (list = []));
        list.push({ at: now, handNo: hand?.handNo ?? 0, events: hand?.events.length ?? 0, publicView: viewOf(table.state, null), fullView: viewOfAll(table.state), clockMs: live.clockMs, level: live.levelIdx + 1 });
        while (list.length > 0 && now - list[0]!.at > FEED_KEEP_MS && list.length > 1) list.shift();
        if (list.length > FEED_MAX) list.splice(0, list.length - FEED_MAX);
      }
    }
    for (const key of this.feeds.keys()) {
      const [id] = key.split(':');
      if (!this.lives.has(id!)) {
        this.feeds.delete(key);
        this.feedMarks.delete(key);
      }
    }
  }

  /**
   * What a spectator may see of a table right now: the newest snapshot at least `delayMs` old.
   * `mode: 'public'` carries no hidden cards. `mode: 'streamer'` carries every hand face up and
   * is only served to the club's tournament staff, with a delay of at least STREAM_MIN_DELAY_MS,
   * which is the whole point: by the time a card is shown, that hand is history.
   */
  spectate(actorId: string | null, tournamentId: string, tableNo: number, delayMs: number, mode: 'public' | 'streamer'): SpectatorFrame | null {
    const t = this.db.tournaments[tournamentId];
    if (!t) throw new DomainError('not_found', 'Tournament not found.');
    if (!api.canWatchTournament(this.db, actorId, t)) throw new ForbiddenError('tournament.watch');
    const delay = Math.max(SPECTATE_MIN_DELAY_MS, delayMs);
    if (mode === 'streamer') {
      if (!actorId || !can(this.db, actorId, 'tournaments.run', t.clubId)) throw new ForbiddenError('tournament.stream');
      if (delay < STREAM_MIN_DELAY_MS) throw new DomainError('stream_delay', 'Streamer mode needs a delay of at least one minute.');
    }
    const list = this.feeds.get(`${tournamentId}:${tableNo}`);
    if (!list || list.length === 0) return null;
    const cutoff = clock.now() - delay;
    let pick: FeedSnapshot | null = null;
    for (const s of list) {
      if (s.at <= cutoff) pick = s;
      else break;
    }
    if (!pick) return { view: null, at: list[0]!.at, delayMs: delay, mode, handNo: 0, clockMs: list[0]!.clockMs, level: list[0]!.level, waiting: true };
    return { view: cloneView(mode === 'streamer' ? pick.fullView : pick.publicView), at: pick.at, delayMs: delay, mode, handNo: pick.handNo, clockMs: pick.clockMs, level: pick.level, waiting: false };
  }

  private driverBusyWith(id: string): boolean {
    return this.driver !== null && this.driver.tournamentId === id && this.driver.presenting();
  }

  save(): void {
    this.lastSave = clock.now();
    this.dirty = false;
    if (this.persist) writeStorage(LIVE_KEY, [...this.lives.entries()]);
  }

  /** Demo activity: simulated members register for open tournaments. Returns true if anything changed. */
  private simulateRegistrations(t: Tournament, dt: number): boolean {
    const db = this.db;
    const club = db.clubs[t.clubId];
    if (!club || club.status !== 'active') return false;
    // Nobody simulated turns up to an invitation-only event, and requests for approval do not pile up without limit.
    if (t.access === 'invite') return false;
    if (t.access === 'approval' && api.requestedCount(t) >= 5) return false;
    const count = api.registeredCount(t) + api.requestedCount(t);
    let rate = 0; // registrations per ms
    if (t.startMode === 'when_full') {
      // A sit & go fills quickly once a real person is waiting.
      const humanWaiting = t.registrations.some((r) => r.status === 'registered' && !db.users[r.userId]?.isBot);
      if (humanWaiting && count < t.maxPlayers) rate = 1 / 1_300;
    } else if (t.simulateRegistrations) {
      const target = Math.min(t.maxPlayers, Math.round(t.maxPlayers * t.simulatedFill));
      // Scheduled events fill up towards the start time; staff-started ones fill within a minute of publishing.
      const deadline = t.startMode === 'scheduled' ? t.startAt - 3_000 : (t.publishedAt ?? clock.now()) + 45_000;
      const timeLeft = Math.max(4_000, deadline - clock.now());
      if (count < target) rate = (target - count) / timeLeft;
    }
    if (rate <= 0) return false;
    let carry = (this.regCarry.get(t.id) ?? 0) + rate * dt;
    let changed = false;
    while (carry >= 1) {
      carry -= 1;
      if (this.addSimulatedRegistration(t)) changed = true;
    }
    this.regCarry.set(t.id, carry);
    return changed;
  }

  /**
   * One simulated member takes a place. They are approved members like anyone
   * else and go through the same checks; they are given the access code, as a
   * member told it by the club would be. With `approve`, a request that needs
   * staff approval is accepted on the spot (staff pressed "add simulated players").
   */
  private addSimulatedRegistration(t: Tournament, approve = false): boolean {
    const db = this.db;
    const taken = new Set(t.registrations.map((r) => r.userId));
    const busy = this.busyPlayers();
    const pool = db.memberships.filter(
      (m) => m.clubId === t.clubId && m.status === 'active' && db.users[m.userId]?.isBot && !taken.has(m.userId) && !busy.has(m.userId),
    );
    if (pool.length === 0) return false;
    const pickOne = pool[this.botRng.int(pool.length)]!;
    pickOne.demoPoints = Math.max(pickOne.demoPoints, t.entryPoints); // simulated members always have their allowance
    try {
      const r = api.registerForTournament(db, pickOne.userId, t.id, { code: t.accessCode ?? undefined });
      if (approve && r.status === 'requested') api.approveRegistration(db, SYSTEM, t.id, pickOne.userId);
      return true;
    } catch (err) {
      if (err instanceof DomainError) return false;
      throw err;
    }
  }

  /** Players currently seated in a running tournament (a simulated member plays one event at a time). */
  private busyPlayers(): Set<string> {
    const busy = new Set<string>();
    for (const live of this.lives.values()) {
      for (const id in live.players) if (live.players[id]!.status === 'active') busy.add(id);
    }
    return busy;
  }

  /** Demo activity: clubs flagged `simulatedStaff` approve a real person's join request after a few seconds. */
  private simulateStaff(now: number): boolean {
    const db = this.db;
    let changed = false;
    for (const m of db.memberships) {
      if (m.status !== 'pending') continue;
      const club = db.clubs[m.clubId];
      if (!club?.simulatedStaff || club.status !== 'active' || db.users[m.userId]?.isBot) continue;
      if (now - m.requestedAt >= 9_000) {
        try {
          api.approveMember(db, SYSTEM, m.clubId, m.userId);
          changed = true;
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
        }
      }
    }
    return changed;
  }

  // ----- commands (called from the UI through the store) --------------------------------

  /** Close registration, draw seats and start. Used by the scheduler and by staff pressing "Start now". */
  beginSeating(actorId: string, id: string): void {
    const db = this.db;
    api.beginSeating(db, actorId, id);
    const t = db.tournaments[id]!;
    const live = createLive(id, t.structure, this.entrantsOf(t), this.rng, t.demoSpeed, t.game ?? DEFAULT_VARIANT);
    for (const pid in live.players) if (!live.players[pid]!.isBot) live.players[pid]!.away = true;
    this.lives.set(id, live);
    this.touch();
  }

  setPaused(actorId: string, id: string, paused: boolean): void {
    api.setPaused(this.db, actorId, id, paused);
    const live = this.lives.get(id);
    if (live) {
      if (paused && live.status === 'RUNNING') pauseLive(live);
      if (!paused && live.status === 'PAUSED') resumeLive(live);
    }
    this.touch();
  }

  cancel(actorId: string, id: string, reason: string): void {
    api.cancelTournament(this.db, actorId, id, reason);
    if (this.driver?.tournamentId === id) this.detach();
    this.lives.delete(id);
    this.touch();
  }

  setSpeed(actorId: string, id: string, speed: number): void {
    const t = this.db.tournaments[id];
    if (!t) throw new DomainError('not_found', 'Tournament not found.');
    if (!can(this.db, actorId, 'tournaments.run', t.clubId)) throw new DomainError('forbidden', 'You cannot control this tournament.');
    if (![1, 10, 60, 240].includes(speed)) throw new DomainError('bad_speed', 'Unsupported demo speed.');
    t.demoSpeed = speed;
    const live = this.lives.get(id);
    if (live) live.speed = speed;
    this.touch();
  }

  /** Demo control for staff: add a batch of simulated registrations right now. */
  addSimulatedPlayers(actorId: string, id: string, count: number): number {
    const t = this.db.tournaments[id];
    if (!t) throw new DomainError('not_found', 'Tournament not found.');
    if (!can(this.db, actorId, 'tournaments.registrations', t.clubId)) throw new DomainError('forbidden', 'You cannot manage registrations here.');
    if (t.status !== 'REGISTRATION_OPEN') throw new DomainError('registration_closed', 'Registration is not open.');
    if (t.access === 'invite') throw new DomainError('invite_only', 'This tournament is by invitation. Invite members individually.');
    let added = 0;
    for (let i = 0; i < count; i++) {
      if (api.registeredCount(t) >= t.maxPlayers) break;
      if (this.addSimulatedRegistration(t, true)) added++;
    }
    return added;
  }

  lateRegistrationOpen(id: string): boolean {
    const t = this.db.tournaments[id];
    const live = this.lives.get(id);
    return !!t && !!live && (t.status === 'RUNNING' || t.status === 'PAUSED') && lateRegistrationOpen(live);
  }

  /**
   * Ask for a place for a person. During late registration, a place that is
   * granted immediately also seats them in the running tournament.
   */
  register(userId: string, id: string, code?: string): { status: Registration['status']; tableNo: number | null } {
    const db = this.db;
    const late = this.lateRegistrationOpen(id);
    const registration = api.registerForTournament(db, userId, id, { lateRegistrationOpen: late, code });
    let tableNo: number | null = null;
    if (late && registration.status === 'registered') {
      const live = this.lives.get(id)!;
      const u = db.users[userId]!;
      tableNo = addLateEntrant(live, { id: u.id, name: u.name, isBot: u.isBot, style: u.style }, this.rng);
      if (!u.isBot) live.players[userId]!.away = true;
      this.touch();
    }
    return { status: registration.status, tableNo };
  }

  /** Demo activity: simulated members gradually open what they were sent. Counted separately from real reads. */
  private simulateReads(now: number): boolean {
    let changed = false;
    for (const batch of this.db.batches) {
      const age = now - batch.at;
      if (age < 4_000 || age > 15 * 60_000) continue;
      const simulated = batch.delivered.filter((id) => this.db.users[id]?.isBot);
      const target = Math.floor(simulated.length * Math.min(0.55, (age / 180_000) * 0.55));
      for (const id of simulated) {
        if (batch.simulatedReadBy.length >= target) break;
        if (!batch.simulatedReadBy.includes(id) && this.botRng.float() < 0.5) {
          batch.simulatedReadBy.push(id);
          changed = true;
        }
      }
    }
    return changed;
  }

  private finalize(t: Tournament, live: TournamentLive): void {
    const rows = liveResults(live);
    const now = clock.now();
    const result: TournamentResult = {
      tournamentId: t.id,
      clubId: t.clubId,
      name: t.name,
      format: t.format,
      startedAt: t.startedAt ?? now,
      completedAt: now,
      durationMin: Math.max(1, Math.round(live.clockMs / 60_000)),
      entrants: live.entrants,
      hands: live.handsPlayed,
      totalChips: live.totalChips,
      levelReached: currentLevelNumber(live),
      places: rows.map((r) => ({
        place: r.place,
        userId: r.playerId,
        name: r.name,
        isBot: r.isBot,
        points: api.rankingPoints(live.entrants, r.place),
        bustedBy: r.bustedBy,
        bustLevel: r.bustLevel,
      })),
      seeded: false,
    };
    api.completeTournament(this.db, t.id, result);
    this.lives.delete(t.id);
  }

  // ----- watching / playing a table ---------------------------------------------------

  /**
   * Attach a driver to a table for `actorId` (null = nobody signed in).
   *
   * Authorisation is checked here, not only by the screen: the table of a
   * private tournament opens for the club's staff, its approved members and
   * the players in it. With `seated`, the actor must hold a seat and is shown
   * their own cards; otherwise they observe and no hole cards are sent.
   */
  attach(actorId: string | null, tournamentId: string, tableNo: number, seated: boolean, options: DriverOptions): TableDriver {
    const t = this.db.tournaments[tournamentId];
    if (!t) throw new DomainError('not_found', 'Tournament not found.');
    if (!api.canWatchTournament(this.db, actorId, t)) throw new ForbiddenError('tournament.watch');
    if (seated && (actorId === null || api.registrationOf(t, actorId)?.status !== 'registered')) throw new ForbiddenError('tournament.seat');
    if (this.driver) this.detach();
    const live = this.lives.get(tournamentId);
    if (!live) throw new DomainError('not_running', 'This tournament is not running.');
    this.driver = new TableDriver(this, tournamentId, tableNo, seated ? actorId : null, options);
    return this.driver;
  }

  detach(): void {
    const d = this.driver;
    if (!d) return;
    this.driver = null;
    d.dispose();
    this.touch();
  }

  recordHand(record: HandRecord): void {
    const hands = this.db.hands;
    hands.push(record);
    const mine = hands.filter((h) => h.userId === record.userId);
    if (mine.length > 60) {
      const drop = new Set(mine.slice(0, mine.length - 60).map((h) => h.id));
      this.db.hands = hands.filter((h) => !drop.has(h.id));
    }
  }
}

// =============================================================================
// Table driver: paces one table for a human viewer
// =============================================================================

const EVENT_DELAY: Record<HandEvent['t'], number> = {
  start: 350,
  post: 140,
  hole: 60,
  turn: 0,
  action: 380,
  refund: 260,
  collect: 420,
  street: 780,
  show: 520,
  showdown: 900,
  award: 1500,
  end: 1500,
};

export class TableDriver {
  view: TableView;
  version = 0;
  /** The most recent event shown, with a counter so the UI can key animations and sounds off it. */
  lastEvent: HandEvent | null = null;
  eventCount = 0;
  /** Legal actions when it is the viewer's turn and the table has caught up, else null. */
  legal: LegalActions | null = null;
  turn: TurnInfo | null = null;
  notice: DriverNotice = null;
  /** Why no hand is being dealt, when the table is waiting. */
  waiting: 'break' | 'paused' | 'players' | 'complete' | null = null;
  /** True while cards are tabled for an all-in and the board is still being run out. */
  allInRunout = false;
  lastError: string | null = null;

  private queue: HandEvent[] = [];
  private cursor = 0;
  private handNo = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private thinking = false;
  private deadline = 0;
  private timeouts = 0;
  private disposed = false;
  private listeners = new Set<Listener>();

  constructor(
    private runtime: Runtime,
    readonly tournamentId: string,
    public tableNo: number,
    readonly viewerId: string | null,
    private options: DriverOptions,
  ) {
    const table = this.table();
    table.driven = true;
    const player = viewerId ? this.live().players[viewerId] : undefined;
    if (player) player.away = false;
    // Join mid-hand: resynchronise from the authoritative state.
    this.view = viewOf(table.state, this.viewerSeat());
    const hand = table.state.hand;
    if (hand) {
      this.handNo = hand.handNo;
      this.cursor = hand.events.length;
      this.allInRunout = false;
    }
    this.schedule(350);
  }

  // ----- accessors -----
  private live(): TournamentLive {
    const live = this.runtime.lives.get(this.tournamentId);
    if (!live) throw new Error('Tournament is no longer live');
    return live;
  }
  private table(): TTable {
    const t = this.live().tables.find((x) => x.no === this.tableNo);
    if (!t) throw new Error('Table not found');
    return t;
  }
  /** Seat index of the viewer at this table, or null when observing. */
  viewerSeat(): number | null {
    if (!this.viewerId) return null;
    const live = this.runtime.lives.get(this.tournamentId);
    const t = live?.tables.find((x) => x.no === this.tableNo);
    const seat = t?.state.seats.find((s) => s?.playerId === this.viewerId);
    return seat ? seat.seat : null;
  }
  isAway(): boolean {
    return this.viewerId ? (this.runtime.lives.get(this.tournamentId)?.players[this.viewerId]?.away ?? false) : false;
  }
  presenting(): boolean {
    return this.queue.length > 0;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;
  private emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  setOptions(options: DriverOptions): void {
    this.options = options;
  }

  // ----- viewer actions -----

  act(action: PlayerAction): CommandResult {
    const seat = this.viewerSeat();
    const live = this.runtime.lives.get(this.tournamentId);
    const table = live?.tables.find((x) => x.no === this.tableNo);
    const hand = table?.state.hand;
    if (!table || !hand || seat === null || !this.legal) {
      return { ok: false, code: 'not_your_turn', message: 'It is not your turn.' };
    }
    const result = submitCommand(table.state, { seat, handNo: hand.handNo, seq: hand.seq, actionId: newActionId(), action });
    if (result.ok) {
      this.legal = null;
      this.turn = null;
      this.timeouts = 0;
      this.lastError = null;
      this.collect();
      this.runtime.touch();
      this.schedule(0);
    } else {
      this.lastError = result.message;
    }
    this.emit();
    return result;
  }

  /** Sit out (auto check/fold) or come back. */
  setAway(away: boolean): void {
    if (!this.viewerId) return;
    const player = this.live().players[this.viewerId];
    if (!player || player.status !== 'active') return;
    player.away = away;
    this.timeouts = 0;
    if (away) {
      this.legal = null;
      this.turn = null;
    }
    this.emit();
    this.schedule(0);
  }

  clearNotice(): void {
    this.notice = null;
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const live = this.runtime.lives.get(this.tournamentId);
    if (!live) return;
    const player = this.viewerId ? live.players[this.viewerId] : undefined;
    if (player && player.status === 'active') player.away = true;
    const table = live.tables.find((x) => x.no === this.tableNo);
    if (table) {
      table.driven = false;
      if (!table.closed && (handInProgress(table.state) || needsSettling(table))) {
        this.recordHistory(table);
        this.runtime.finishHand(live, table);
      }
      table.nextHandAt = live.clockMs + 6_000;
    }
  }

  // ----- the pump -----

  private schedule(ms: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.pump();
      } catch (err) {
        // A driver must never take the app down; surface the problem and retry.
        this.lastError = err instanceof Error ? err.message : String(err);
        this.emit();
        this.schedule(1_000);
      }
    }, Math.max(0, ms));
  }

  /** Pull any new engine events for this hand into the presentation queue (redacted for the viewer). */
  private collect(): void {
    const hand = this.table().state.hand;
    if (!hand) return;
    if (hand.handNo !== this.handNo) {
      this.handNo = hand.handNo;
      this.cursor = 0;
    }
    const seat = this.viewerSeat();
    for (; this.cursor < hand.events.length; this.cursor++) {
      this.queue.push(redactEvent(hand.events[this.cursor]!, seat));
    }
  }

  private present(event: HandEvent): number {
    const state = this.table().state;
    if (event.t === 'start') {
      this.view = baseView(state);
      this.allInRunout = false;
      this.notice = this.notice?.type === 'moved' ? this.notice : null;
    }
    const view = cloneView(this.view);
    applyEvent(view, event);
    this.view = view;
    this.lastEvent = event;
    this.eventCount += 1;
    if (event.t === 'show') this.allInRunout = view.street !== 'river';
    if (event.t === 'showdown' || event.t === 'end') this.allInRunout = false;
    if (event.t === 'turn') {
      // Whose turn it is becomes visible immediately; the timer starts when the queue drains.
      this.turn = null;
    }
    this.emit();

    let delay = EVENT_DELAY[event.t];
    if (event.t === 'street' && this.allInRunout) delay = 1_500;
    if (event.t === 'action' && event.type === 'fold') delay = 260;
    if (event.t === 'post' && event.amount === 0) delay = 0;
    const viewerOut = this.viewerId !== null && this.viewerFolded();
    // When the viewer is not involved the hand moves along a little faster.
    return delay * this.options.pace * (viewerOut && event.t !== 'award' && event.t !== 'end' ? 0.7 : 1);
  }

  private viewerFolded(): boolean {
    const seat = this.viewerSeat();
    if (seat === null) return false;
    const s = this.view.seats[seat];
    return !s || !s.inHand || s.folded;
  }

  private pump(): void {
    if (this.disposed) return;
    const live = this.runtime.lives.get(this.tournamentId);
    if (!live) return;
    let table = live.tables.find((x) => x.no === this.tableNo);
    if (!table) return;

    // 1. Present queued events one at a time.
    const next = this.queue.shift();
    if (next) {
      this.schedule(this.present(next));
      return;
    }

    const state = table.state;
    const hand = state.hand;

    // 2. A finished, fully presented hand: settle it (eliminations, balancing).
    if (hand && needsSettling(table)) {
      this.recordHistory(table);
      const eventsBefore = live.timeline.length;
      settleHand(live, table, this.runtime.rng);
      this.runtime.db.counters.sessionHands += 1;
      this.runtime.db.counters.handsDealt += 1;
      this.afterSettle(live, eventsBefore);
      this.runtime.touch();
      this.emit();
      this.schedule(900 * this.options.pace);
      return;
    }

    // 3. A hand in progress: act for bots, wait for the viewer.
    if (hand && handInProgress(state)) {
      const seat = state.seats[hand.toAct]!;
      const player = live.players[seat.playerId]!;
      const isViewer = this.viewerId !== null && seat.playerId === this.viewerId;
      if (isViewer && !player.away) {
        const now = clock.now();
        if (!this.legal) {
          this.legal = legalActions(state);
          this.deadline = now + this.options.turnSeconds * 1_000;
          this.turn = { seat: seat.seat, startedAt: now, durationMs: this.options.turnSeconds * 1_000, own: true };
          this.emit();
        }
        if (now >= this.deadline) {
          // Out of time: check if free, otherwise fold. Two in a row and the seat sits out.
          applyAutoAction(state);
          this.timeouts += 1;
          if (this.timeouts >= 2) player.away = true;
          this.legal = null;
          this.turn = null;
          this.collect();
          this.runtime.touch();
          this.emit();
          this.schedule(0);
          return;
        }
        this.schedule(Math.min(250, this.deadline - now));
        return;
      }
      if (!this.thinking) {
        this.thinking = true;
        const fast = player.away || !player.isBot;
        const base = fast ? 350 : hand.street === 'preflop' ? 500 + this.runtime.botRng.float() * 700 : 800 + this.runtime.botRng.float() * 1_300;
        const think = base * this.options.pace * (this.viewerFolded() ? 0.5 : 1);
        this.turn = { seat: seat.seat, startedAt: clock.now(), durationMs: think, own: false };
        this.emit();
        this.schedule(think);
        return;
      }
      this.thinking = false;
      this.turn = null;
      if (!stepAutomaticAction(live, table, this.runtime.botRng, 240)) applyAutoAction(state);
      this.collect();
      this.schedule(0);
      return;
    }

    // 4. Between hands: deal when allowed, otherwise say why we are waiting.
    this.thinking = false;
    const running = this.runtime.db.tournaments[this.tournamentId]?.status === 'RUNNING';
    if (running && canDeal(live, table)) {
      dealHand(live, table, this.runtime.rng);
      this.waiting = null;
      this.collect();
      this.schedule(0);
      return;
    }
    const previous = this.waiting;
    if (live.status === 'COMPLETED') this.waiting = 'complete';
    else if (live.status === 'PAUSED') this.waiting = 'paused';
    else if (entryAt(live.structure, live.levelIdx).kind === 'break') this.waiting = 'break';
    else this.waiting = 'players';
    // The table may have been broken up, or the viewer moved, while we waited.
    if (this.follow(live)) table = live.tables.find((x) => x.no === this.tableNo);
    if (previous !== this.waiting) this.emit();
    if (this.waiting !== 'complete') this.schedule(400);
  }

  /** Keep the driver on the right table after balancing. Returns true if it switched. */
  private follow(live: TournamentLive): boolean {
    const current = live.tables.find((x) => x.no === this.tableNo);
    let targetNo: number | null = null;
    const player = this.viewerId ? live.players[this.viewerId] : undefined;
    if (player && player.status === 'active' && player.tableNo !== null && player.tableNo !== this.tableNo) {
      targetNo = player.tableNo;
    } else if (!current || current.closed) {
      // Observers (and eliminated players) follow the action to the busiest remaining table.
      const best = activeTables(live).sort((a, b) => occupiedSeats(b.state).length - occupiedSeats(a.state).length)[0];
      targetNo = best ? best.no : null;
    }
    if (targetNo === null || targetNo === this.tableNo) return false;
    const target = live.tables.find((x) => x.no === targetNo);
    if (!target) return false;
    if (current) current.driven = false;
    // The destination is an unwatched table: let it finish the hand it is on, then take it over.
    if (handInProgress(target.state) || needsSettling(target)) this.runtime.finishHand(live, target);
    target.driven = true;
    const from = this.tableNo;
    this.tableNo = targetNo;
    this.queue = [];
    this.cursor = target.state.hand ? target.state.hand.events.length : 0;
    this.handNo = target.state.hand ? target.state.hand.handNo : -1;
    this.view = baseView(target.state);
    this.legal = null;
    this.turn = null;
    if (player && player.status === 'active') this.notice = { type: 'moved', from, to: targetNo };
    return true;
  }

  private afterSettle(live: TournamentLive, timelineFrom: number): void {
    const player = this.viewerId ? live.players[this.viewerId] : undefined;
    this.legal = null;
    this.turn = null;
    if (live.status === 'COMPLETED') {
      const winner = Object.values(live.players).find((p) => p.place === 1);
      this.waiting = 'complete';
      if (player && player.place !== null && player.place > 1 && this.notice?.type !== 'eliminated') {
        this.notice = { type: 'eliminated', place: player.place, entrants: live.entrants };
      } else if (winner) {
        this.notice = { type: 'winner', playerId: winner.id };
      }
      return;
    }
    if (player && player.status === 'out' && player.place !== null && this.notice?.type !== 'eliminated') {
      const justNow = live.timeline.slice(timelineFrom).some((e) => e.type === 'elimination' && e.playerId === player.id);
      if (justNow) this.notice = { type: 'eliminated', place: player.place, entrants: live.entrants };
    }
    const becameFinal = live.timeline.slice(timelineFrom).some((e) => e.type === 'final_table');
    if (!this.follow(live)) {
      // Same table: refresh who is sitting here (busts and arrivals).
      this.view = baseView(this.table().state);
      if (becameFinal && !this.notice) this.notice = { type: 'final_table' };
    } else if (becameFinal && this.notice?.type !== 'moved') {
      this.notice = { type: 'final_table' };
    }
  }

  /** Save the hand to the viewer's history (only hands they were dealt into). */
  private recordHistory(table: TTable): void {
    const hand = table.state.hand;
    const seat = this.viewerSeat();
    if (!hand || seat === null || !this.viewerId || hand.street !== 'complete' || !hand.result) return;
    const mine = table.state.seats[seat];
    if (!mine || !mine.inHand) return;
    const db = this.runtime.db;
    const id = `h_${this.tournamentId}_${table.no}_${hand.handNo}`;
    if (db.hands.some((h) => h.id === id)) return;
    const t = db.tournaments[this.tournamentId];
    const names: HandRecord['names'] = {};
    for (const s of occupiedSeats(table.state)) {
      if (!s.inHand) continue;
      const u = db.users[s.playerId];
      names[s.seat] = { name: u?.name ?? s.playerId, isBot: u?.isBot ?? true, userId: s.playerId };
    }
    const shown = hand.events.find((e) => e.t === 'showdown');
    const heroShown = shown && shown.t === 'showdown' ? shown.hands.find((h) => h.seat === seat) : undefined;
    this.runtime.recordHand({
      id,
      userId: this.viewerId,
      tournamentId: this.tournamentId,
      tournamentName: t?.name ?? 'Tournament',
      clubId: t?.clubId ?? '',
      tableNo: table.no,
      handNo: hand.handNo,
      at: clock.now(),
      maxSeats: table.state.maxSeats,
      heroSeat: seat,
      blinds: hand.blinds,
      names,
      events: hand.events.map((e) => redactEvent(e, seat)),
      net: hand.result.net[seat] ?? 0,
      heroHand: heroShown ? heroShown.name : null,
    });
    this.runtime.store.touch();
  }
}

/** Shuffle helper re-exported for UI code that needs a random order (seating draw animation). */
export { shuffleInPlace };
