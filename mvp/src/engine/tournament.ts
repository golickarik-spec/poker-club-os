/**
 * Live tournament engine: seating draw, blind clock, eliminations, table
 * balancing and consolidation to a final table.
 *
 * Like the hand engine this is pure state + functions. Time is injected
 * (`advanceClock`), so a tournament can run in real time, accelerated for a
 * demonstration, or instantly inside a test.
 *
 * A table is either *instant* (a whole hand is played in one call — used for
 * tables nobody is watching) or *driven* (someone is watching or playing, so a
 * driver applies one action at a time with human pacing). Balancing never
 * moves a player out of a hand that is still in progress.
 */
import { applyAction, applyAutoAction, createTable, handInProgress, occupiedSeats, seatPlayer, startHand, unseatPlayer, type Blinds, type TableState } from './holdem.ts';
import { botContext, chooseBotAction, type BotStyle } from './bots.ts';
import { shuffleInPlace, type Rng } from './rng.ts';
import { blindsAt, entryAt, levelNumberAt, type TournamentStructure } from './structure.ts';
import { DEFAULT_VARIANT, type VariantId } from './variants.ts';

export interface Entrant {
  id: string;
  name: string;
  isBot: boolean;
  style: BotStyle;
}

export interface TPlayer extends Entrant {
  status: 'active' | 'out';
  tableNo: number | null;
  /** Finishing position once eliminated (1 = winner). */
  place: number | null;
  bustedBy: string | null;
  bustLevel: number | null;
  bustClockMs: number | null;
  handsPlayed: number;
  /** A human who is not at the table: auto check/fold until they return. */
  away: boolean;
  lateEntry: boolean;
}

export interface TTable {
  no: number;
  state: TableState;
  /** Tournament-clock time at which an instant table deals its next hand. */
  nextHandAt: number;
  /** True while a driver is pacing this table action by action. */
  driven: boolean;
  closed: boolean;
  /** Number of the last hand that went through `settleHand` (guards against settling twice or dealing early). */
  settledHandNo: number;
}

export type TimelineEvent =
  | { type: 'start'; clockMs: number; players: number; tables: number }
  | { type: 'level'; clockMs: number; level: number; sb: number; bb: number; ante: number }
  | { type: 'break'; clockMs: number; minutes: number }
  | { type: 'late_reg_closed'; clockMs: number }
  | { type: 'late_entry'; clockMs: number; playerId: string; tableNo: number }
  | { type: 'elimination'; clockMs: number; playerId: string; place: number; by: string | null; tableNo: number }
  | { type: 'move'; clockMs: number; playerId: string; from: number; to: number; reason: 'balance' | 'table_break' }
  | { type: 'table_closed'; clockMs: number; tableNo: number }
  | { type: 'final_table'; clockMs: number; players: number }
  | { type: 'heads_up'; clockMs: number }
  | { type: 'paused'; clockMs: number }
  | { type: 'resumed'; clockMs: number }
  | { type: 'complete'; clockMs: number; winnerId: string };

export interface Elimination {
  playerId: string;
  place: number;
  by: string | null;
  level: number;
  clockMs: number;
  tableNo: number;
}

export interface TournamentLive {
  id: string;
  /** The poker variant every table deals. Absent in states saved before v0.4: No-Limit Hold'em. */
  variant?: VariantId;
  structure: TournamentStructure;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
  /** Elapsed tournament time in ms (does not advance while paused). */
  clockMs: number;
  levelIdx: number;
  levelElapsedMs: number;
  tables: TTable[];
  players: Record<string, TPlayer>;
  entrants: number;
  totalChips: number;
  eliminations: Elimination[];
  timeline: TimelineEvent[];
  handsPlayed: number;
  finalTable: boolean;
  lateRegClosed: boolean;
  /** Demo clock multiplier (1 = real time). */
  speed: number;
}

const HAND_BASE_MS = 28_000;
const HAND_PER_PLAYER_MS = 6_000;

// ---------------------------------------------------------------------------
// Creation and seating
// ---------------------------------------------------------------------------

export function createLive(id: string, structure: TournamentStructure, entrants: readonly Entrant[], rng: Rng, speed = 1, variant: VariantId = DEFAULT_VARIANT): TournamentLive {
  if (entrants.length < 2) throw new Error('A tournament needs at least two players');
  if (new Set(entrants.map((e) => e.id)).size !== entrants.length) throw new Error('Duplicate entrant');
  const size = structure.tableSize;
  const tableCount = Math.ceil(entrants.length / size);
  const tables: TTable[] = [];
  for (let i = 0; i < tableCount; i++) {
    tables.push({ no: i + 1, state: createTable(`${id}:T${i + 1}`, size), nextHandAt: 0, driven: false, closed: false, settledHandNo: 0 });
  }
  const order = shuffleInPlace([...entrants], rng);
  const players: Record<string, TPlayer> = {};
  const seatOrders = tables.map(() => shuffleInPlace(Array.from({ length: size }, (_, i) => i), rng));
  order.forEach((e, i) => {
    const table = tables[i % tableCount]!;
    const seat = seatOrders[i % tableCount]![Math.floor(i / tableCount)]!;
    seatPlayer(table.state, e.id, structure.startingStack, seat);
    players[e.id] = {
      ...e,
      status: 'active',
      tableNo: table.no,
      place: null,
      bustedBy: null,
      bustLevel: null,
      bustClockMs: null,
      handsPlayed: 0,
      away: false,
      lateEntry: false,
    };
  });
  const live: TournamentLive = {
    id,
    variant,
    structure,
    status: 'RUNNING',
    clockMs: 0,
    levelIdx: 0,
    levelElapsedMs: 0,
    tables,
    players,
    entrants: entrants.length,
    totalChips: entrants.length * structure.startingStack,
    eliminations: [],
    timeline: [],
    handsPlayed: 0,
    finalTable: false,
    lateRegClosed: structure.lateRegLevels <= 0,
    speed,
  };
  // Stagger the first deals a little so tables do not move in lockstep.
  tables.forEach((t, i) => (t.nextHandAt = 2_000 + i * 1_700));
  live.timeline.push({ type: 'start', clockMs: 0, players: entrants.length, tables: tableCount });
  const b = blindsAt(structure, 0);
  live.timeline.push({ type: 'level', clockMs: 0, level: 1, sb: b.sb, bb: b.bb, ante: b.ante });
  if (tableCount === 1) markFinalTable(live);
  return live;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const activeTables = (live: TournamentLive): TTable[] => live.tables.filter((t) => !t.closed);
export const tableByNo = (live: TournamentLive, no: number): TTable => {
  const t = live.tables.find((x) => x.no === no);
  if (!t) throw new Error(`No table ${no}`);
  return t;
};
export const remainingPlayers = (live: TournamentLive): number => {
  let n = 0;
  for (const id in live.players) if (live.players[id]!.status === 'active') n++;
  return n;
};
export const isOnBreak = (live: TournamentLive): boolean => entryAt(live.structure, live.levelIdx).kind === 'break';
export const currentBlinds = (live: TournamentLive): Blinds => blindsAt(live.structure, live.levelIdx);
export const currentLevelNumber = (live: TournamentLive): number => levelNumberAt(live.structure, live.levelIdx);
export const levelRemainingMs = (live: TournamentLive): number =>
  Math.max(0, entryAt(live.structure, live.levelIdx).minutes * 60_000 - live.levelElapsedMs);
export const lateRegistrationOpen = (live: TournamentLive): boolean => live.status !== 'COMPLETED' && !live.lateRegClosed;

/** A player's chips, counting anything they have in the middle of a hand in progress. */
export function stackOf(live: TournamentLive, playerId: string): number {
  const p = live.players[playerId];
  if (!p || p.tableNo === null) return 0;
  const table = tableByNo(live, p.tableNo).state;
  const seat = table.seats.find((s) => s?.playerId === playerId);
  if (!seat) return 0;
  return seat.stack + (handInProgress(table) && seat.inHand ? seat.committed : 0);
}

export interface Standing {
  playerId: string;
  name: string;
  isBot: boolean;
  rank: number;
  stack: number;
  bigBlinds: number;
  tableNo: number | null;
  status: 'active' | 'out';
  place: number | null;
}

/** Leaderboard: players still in by chip count, then eliminated players by finishing place. */
export function standings(live: TournamentLive): Standing[] {
  const bb = currentBlinds(live).bb;
  const active: Standing[] = [];
  const out: Standing[] = [];
  for (const id in live.players) {
    const p = live.players[id]!;
    if (p.status === 'active') {
      const stack = stackOf(live, id);
      active.push({ playerId: id, name: p.name, isBot: p.isBot, rank: 0, stack, bigBlinds: stack / bb, tableNo: p.tableNo, status: 'active', place: null });
    } else {
      out.push({ playerId: id, name: p.name, isBot: p.isBot, rank: p.place ?? 0, stack: 0, bigBlinds: 0, tableNo: null, status: 'out', place: p.place });
    }
  }
  active.sort((a, b) => b.stack - a.stack || a.name.localeCompare(b.name));
  active.forEach((s, i) => (s.rank = i + 1));
  out.sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  return [...active, ...out];
}

export function averageStack(live: TournamentLive): number {
  const n = remainingPlayers(live);
  return n === 0 ? 0 : Math.round(live.totalChips / n);
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export function advanceClock(live: TournamentLive, dtMs: number): void {
  if (live.status !== 'RUNNING' || dtMs <= 0) return;
  live.clockMs += dtMs;
  live.levelElapsedMs += dtMs;
  for (;;) {
    const entry = entryAt(live.structure, live.levelIdx);
    const duration = entry.minutes * 60_000;
    if (live.levelElapsedMs < duration) break;
    live.levelElapsedMs -= duration;
    live.levelIdx += 1;
    const at = live.clockMs - live.levelElapsedMs;
    const next = entryAt(live.structure, live.levelIdx);
    if (next.kind === 'break') {
      live.timeline.push({ type: 'break', clockMs: at, minutes: next.minutes });
    } else {
      const level = levelNumberAt(live.structure, live.levelIdx);
      live.timeline.push({ type: 'level', clockMs: at, level, sb: next.sb, bb: next.bb, ante: next.ante });
      if (!live.lateRegClosed && level > live.structure.lateRegLevels) {
        live.lateRegClosed = true;
        live.timeline.push({ type: 'late_reg_closed', clockMs: at });
      }
    }
  }
}

export function pause(live: TournamentLive): void {
  if (live.status !== 'RUNNING') throw new Error('Only a running tournament can be paused');
  live.status = 'PAUSED';
  live.timeline.push({ type: 'paused', clockMs: live.clockMs });
}

export function resume(live: TournamentLive): void {
  if (live.status !== 'PAUSED') throw new Error('Only a paused tournament can be resumed');
  live.status = 'RUNNING';
  live.timeline.push({ type: 'resumed', clockMs: live.clockMs });
}

// ---------------------------------------------------------------------------
// Dealing and playing hands
// ---------------------------------------------------------------------------

const withChips = (t: TTable): number => occupiedSeats(t.state).filter((s) => s.stack > 0).length;

/** True when this table may start a new hand right now. A paused tournament finishes hands in progress but deals no new ones. */
export function canDeal(live: TournamentLive, t: TTable): boolean {
  return (
    live.status === 'RUNNING' &&
    !t.closed &&
    !isOnBreak(live) &&
    !handInProgress(t.state) &&
    !needsSettling(t) &&
    withChips(t) >= 2
  );
}

/** A hand has finished at this table but `settleHand` has not processed it yet. */
export const needsSettling = (t: TTable): boolean =>
  t.state.hand !== null && t.state.hand.street === 'complete' && t.settledHandNo !== t.state.hand.handNo;

export function dealHand(live: TournamentLive, t: TTable, rng: Rng): void {
  if (!canDeal(live, t)) throw new Error('Table cannot deal now');
  startHand(t.state, currentBlinds(live), rng, { variant: live.variant ?? DEFAULT_VARIANT });
}

/**
 * Apply one action for whoever is to act, if that player is a bot or an absent
 * human. Returns false when the table is waiting for a present human.
 */
export function stepAutomaticAction(live: TournamentLive, t: TTable, rng: Rng, samples: number): boolean {
  const hand = t.state.hand;
  if (!hand || hand.toAct < 0) return false;
  const seat = t.state.seats[hand.toAct]!;
  const player = live.players[seat.playerId]!;
  if (player.isBot) {
    applyAction(t.state, seat.seat, chooseBotAction(botContext(t.state, seat.seat), player.style, rng, samples));
    return true;
  }
  if (player.away || !t.driven) {
    applyAutoAction(t.state);
    return true;
  }
  return false;
}

/** Play a complete hand at an unwatched table and settle it. */
export function playHandInstant(live: TournamentLive, t: TTable, rng: Rng, botRng: Rng, samples = 60): void {
  dealHand(live, t, rng);
  let guard = 0;
  while (handInProgress(t.state)) {
    if (!stepAutomaticAction(live, t, botRng, samples)) applyAutoAction(t.state);
    if (++guard > 2000) throw new Error('Hand did not terminate');
  }
  settleHand(live, t, rng);
}

/**
 * Book-keeping after a hand completes: eliminations, finishing places, table
 * balancing, final table, completion. Must be called exactly once per hand.
 */
export function settleHand(live: TournamentLive, t: TTable, rng: Rng): void {
  const hand = t.state.hand;
  if (!hand || hand.street !== 'complete' || !hand.result) throw new Error('No completed hand to settle');
  if (t.settledHandNo === hand.handNo) throw new Error('Hand already settled');
  t.settledHandNo = hand.handNo;
  live.handsPlayed += 1;
  for (const s of occupiedSeats(t.state)) if (s.inHand) live.players[s.playerId]!.handsPlayed += 1;

  const busted = hand.result.eliminated.map((seat) => t.state.seats[seat]!);
  if (busted.length > 0) {
    const before = remainingPlayers(live);
    // Players eliminated on the same hand rank by the chips they started it with.
    busted.sort((a, b) => a.startStack - b.startStack || b.seat - a.seat);
    const winnerSeat = t.state.seats[hand.result.topWinner];
    busted.forEach((s, i) => {
      const p = live.players[s.playerId]!;
      p.status = 'out';
      p.place = before - i;
      p.tableNo = null;
      p.bustedBy = winnerSeat && winnerSeat.playerId !== s.playerId ? winnerSeat.playerId : null;
      p.bustLevel = currentLevelNumber(live);
      p.bustClockMs = live.clockMs;
      live.eliminations.push({ playerId: p.id, place: p.place, by: p.bustedBy, level: p.bustLevel, clockMs: live.clockMs, tableNo: t.no });
      live.timeline.push({ type: 'elimination', clockMs: live.clockMs, playerId: p.id, place: p.place, by: p.bustedBy, tableNo: t.no });
      unseatPlayer(t.state, s.seat);
    });
  }

  t.nextHandAt = live.clockMs + HAND_BASE_MS + HAND_PER_PLAYER_MS * occupiedSeats(t.state).length;

  const left = remainingPlayers(live);
  if (left <= 1) {
    complete(live);
    return;
  }
  if (left === 2 && busted.length > 0) live.timeline.push({ type: 'heads_up', clockMs: live.clockMs });
  rebalance(live, rng);
}

function complete(live: TournamentLive): void {
  let winner: TPlayer | null = null;
  for (const id in live.players) if (live.players[id]!.status === 'active') winner = live.players[id]!;
  if (!winner) throw new Error('Tournament has no winner');
  winner.place = 1;
  live.status = 'COMPLETED';
  live.lateRegClosed = true;
  live.timeline.push({ type: 'complete', clockMs: live.clockMs, winnerId: winner.id });
}

function markFinalTable(live: TournamentLive): void {
  if (live.finalTable) return;
  live.finalTable = true;
  live.timeline.push({ type: 'final_table', clockMs: live.clockMs, players: remainingPlayers(live) });
}

// ---------------------------------------------------------------------------
// Balancing
// ---------------------------------------------------------------------------

const playersAt = (t: TTable): number => occupiedSeats(t.state).length;
const isIdle = (t: TTable): boolean => !handInProgress(t.state) && !needsSettling(t);

function movePlayer(live: TournamentLive, from: TTable, seatIndex: number, to: TTable, rng: Rng, reason: 'balance' | 'table_break'): void {
  const seat = unseatPlayer(from.state, seatIndex);
  const free: number[] = [];
  to.state.seats.forEach((s, i) => {
    if (!s) free.push(i);
  });
  if (free.length === 0) throw new Error('Destination table is full');
  const target = free[rng.int(free.length)]!;
  seatPlayer(to.state, seat.playerId, seat.stack, target);
  to.state.seats[target]!.sitOut = seat.sitOut;
  live.players[seat.playerId]!.tableNo = to.no;
  live.timeline.push({ type: 'move', clockMs: live.clockMs, playerId: seat.playerId, from: from.no, to: to.no, reason });
}

/** The player who would post the next big blind — the conventional choice to move when balancing. */
function nextBigBlindSeat(t: TTable): number {
  const seats = occupiedSeats(t.state);
  const from = t.state.hand ? t.state.hand.bbSeat : -1;
  for (let i = 1; i <= t.state.maxSeats; i++) {
    const s = t.state.seats[(from + i + t.state.maxSeats) % t.state.maxSeats];
    if (s) return s.seat;
  }
  return seats[0]!.seat;
}

/**
 * Break tables that are no longer needed and keep table sizes within one seat
 * of each other. Players are only taken from tables that are between hands;
 * anything that cannot be done yet is retried after the next hand settles.
 */
export function rebalance(live: TournamentLive, rng: Rng): void {
  const size = live.structure.tableSize;
  for (let guard = 0; guard < 200; guard++) {
    const tables = activeTables(live);
    const total = tables.reduce((n, t) => n + playersAt(t), 0);
    const needed = Math.max(1, Math.ceil(total / size));

    if (tables.length > needed) {
      // Break the smallest idle table.
      const candidates = tables.filter(isIdle).sort((a, b) => playersAt(a) - playersAt(b) || b.no - a.no);
      const victim = candidates[0];
      if (!victim) return;
      for (const s of occupiedSeats(victim.state)) {
        const dest = tables
          .filter((t) => t !== victim && playersAt(t) < size)
          .sort((a, b) => playersAt(a) - playersAt(b) || a.no - b.no)[0];
        if (!dest) throw new Error('No seat available while breaking a table');
        movePlayer(live, victim, s.seat, dest, rng, 'table_break');
      }
      victim.closed = true;
      live.timeline.push({ type: 'table_closed', clockMs: live.clockMs, tableNo: victim.no });
      continue;
    }

    const smallest = [...tables].sort((a, b) => playersAt(a) - playersAt(b) || a.no - b.no)[0]!;
    const donor = tables
      .filter((t) => isIdle(t) && playersAt(t) - playersAt(smallest) >= 2)
      .sort((a, b) => playersAt(b) - playersAt(a) || a.no - b.no)[0];
    if (donor) {
      movePlayer(live, donor, nextBigBlindSeat(donor), smallest, rng, 'balance');
      continue;
    }
    break;
  }
  if (activeTables(live).length === 1) markFinalTable(live);
}

// ---------------------------------------------------------------------------
// Late registration
// ---------------------------------------------------------------------------

export function addLateEntrant(live: TournamentLive, entrant: Entrant, rng: Rng): number {
  if (!lateRegistrationOpen(live)) throw new Error('Late registration is closed');
  if (live.players[entrant.id]) throw new Error('Already entered');
  const size = live.structure.tableSize;
  let table = activeTables(live)
    .filter((t) => playersAt(t) < size)
    .sort((a, b) => playersAt(a) - playersAt(b) || a.no - b.no)[0];
  if (!table) {
    const no = Math.max(...live.tables.map((t) => t.no)) + 1;
    table = { no, state: createTable(`${live.id}:T${no}`, size), nextHandAt: live.clockMs + 5_000, driven: false, closed: false, settledHandNo: 0 };
    live.tables.push(table);
    live.finalTable = false;
  }
  const free: number[] = [];
  table.state.seats.forEach((s, i) => {
    if (!s) free.push(i);
  });
  seatPlayer(table.state, entrant.id, live.structure.startingStack, free[rng.int(free.length)]!);
  live.players[entrant.id] = {
    ...entrant,
    status: 'active',
    tableNo: table.no,
    place: null,
    bustedBy: null,
    bustLevel: null,
    bustClockMs: null,
    handsPlayed: 0,
    away: false,
    lateEntry: true,
  };
  live.entrants += 1;
  live.totalChips += live.structure.startingStack;
  live.timeline.push({ type: 'late_entry', clockMs: live.clockMs, playerId: entrant.id, tableNo: table.no });
  rebalance(live, rng);
  return table.no;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ResultRow {
  place: number;
  playerId: string;
  name: string;
  isBot: boolean;
  bustedBy: string | null;
  bustLevel: number | null;
  handsPlayed: number;
}

export function results(live: TournamentLive): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const id in live.players) {
    const p = live.players[id]!;
    if (p.place !== null) {
      rows.push({ place: p.place, playerId: id, name: p.name, isBot: p.isBot, bustedBy: p.bustedBy, bustLevel: p.bustLevel, handsPlayed: p.handsPlayed });
    }
  }
  return rows.sort((a, b) => a.place - b.place);
}

/** Sum of every stack plus chips in the middle. Must always equal `totalChips`. */
export function chipsInPlay(live: TournamentLive): number {
  let total = 0;
  for (const t of live.tables) {
    for (const s of occupiedSeats(t.state)) total += s.stack;
    const hand = t.state.hand;
    if (hand && hand.street !== 'complete') {
      total += hand.deadMoney;
      for (const s of occupiedSeats(t.state)) if (s.inHand) total += s.committed;
    }
  }
  return total;
}
