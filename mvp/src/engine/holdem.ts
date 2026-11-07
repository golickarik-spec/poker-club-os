/**
 * Community-card poker rules engine: Texas Hold'em, Short Deck and the Omaha family,
 * with no-limit, pot-limit and fixed-limit betting. Which rules apply comes from the
 * variant registry (`variants.ts`); the default is No-Limit Texas Hold'em, so every
 * existing caller and every stored hand keeps working unchanged.
 *
 * Pure, framework-free and deterministic given a deck: no timers, no DOM, no
 * randomness other than the `Rng` passed to `startHand`. The whole table is a
 * plain JSON object so it can be persisted, replayed and hosted unchanged on an
 * authoritative server.
 *
 * Rule notes (also listed in docs/ARCHITECTURE.md):
 *  - Moving button: the button advances to the next occupied seat every hand.
 *    Dead-button / dead-small-blind handling is not implemented.
 *  - Heads-up: the button posts the small blind and acts first pre-flop.
 *  - Short all-in raises do not reopen the betting for players who have already
 *    acted, unless the amount they face has grown by at least a full raise.
 *  - No burn cards (irrelevant with a secure shuffle).
 *  - All live hands are shown at showdown (no mucking of losing hands).
 *  - Odd chips go to the first winner clockwise from the button.
 */
import { shuffledDeck, type Card } from './cards.ts';
import { describeLow, type HandCategory } from './evaluator.ts';
import { bestHigh, bestLow } from './hands.ts';
import { buildPots, type Pot } from './pots.ts';
import type { Rng } from './rng.ts';
import { DEFAULT_VARIANT, variantOf, type VariantId } from './variants.ts';

export type AnteType = 'none' | 'classic' | 'bb';

export interface Blinds {
  sb: number;
  bb: number;
  ante: number;
  anteType: AnteType;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface PlayerAction {
  type: ActionType;
  /** For bet/raise: the player's total bet for this street after the action ("raise to"). */
  amount?: number;
}

export interface Seat {
  seat: number;
  playerId: string;
  stack: number;
  /** Away / disconnected: the seat still posts blinds but is auto check-folded. */
  sitOut: boolean;
  // --- hand-scoped ---
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  hole: Card[];
  streetBet: number;
  committed: number;
  acted: boolean;
  startStack: number;
}

export interface ShownHand {
  seat: number;
  category: HandCategory;
  name: string;
  best: Card[];
  score: number;
  /** In high/low games: the player's qualifying low, if any. */
  low?: { score: number; name: string; best: Card[] } | null;
}

export type HandEvent =
  | {
      t: 'start';
      handNo: number;
      button: number;
      sbSeat: number;
      bbSeat: number;
      blinds: Blinds;
      seats: { seat: number; playerId: string; stack: number }[];
      /** Absent in hands recorded before v0.4: No-Limit Hold'em. */
      variant?: VariantId;
    }
  | { t: 'post'; seat: number; kind: 'ante' | 'sb' | 'bb'; amount: number; stack: number; allIn: boolean; dead: boolean }
  | { t: 'hole'; seat: number; cards: Card[] | null }
  | { t: 'turn'; seat: number }
  | { t: 'action'; seat: number; type: ActionType; amount: number; to: number; stack: number; allIn: boolean; auto?: boolean }
  | { t: 'refund'; seat: number; amount: number; stack: number }
  | { t: 'collect'; pots: Pot[] }
  | { t: 'street'; street: 'flop' | 'turn' | 'river'; cards: Card[] }
  | { t: 'show'; seat: number; cards: Card[] }
  | { t: 'showdown'; hands: ShownHand[] }
  | { t: 'award'; pot: number; amount: number; winners: { seat: number; amount: number }[]; uncontested: boolean; half?: 'high' | 'low' }
  | { t: 'end'; stacks: { seat: number; stack: number }[]; eliminated: number[] };

export interface HandResult {
  /** Chips won per seat (gross, from pots). */
  won: Record<number, number>;
  /** Net change in stack per seat over the hand. */
  net: Record<number, number>;
  /** Seats that finished the hand with no chips. */
  eliminated: number[];
  /** Seat that won the most chips — used for "knocked out by". */
  topWinner: number;
}

export interface HandState {
  handNo: number;
  /** Absent in states persisted before v0.4: No-Limit Hold'em. */
  variant?: VariantId;
  blinds: Blinds;
  button: number;
  sbSeat: number;
  bbSeat: number;
  street: Street;
  board: Card[];
  deck: Card[];
  deckPos: number;
  currentBet: number;
  /** Size of the last full bet or raise — the minimum legal raise increment. */
  minRaise: number;
  /** Bets and raises made on this street (fixed-limit games cap them). */
  raises?: number;
  /** Seat index whose turn it is, or -1. */
  toAct: number;
  deadMoney: number;
  /** Increments on every applied action. Clients echo it back so stale commands are rejected. */
  seq: number;
  events: HandEvent[];
  /** Client action ids already applied in this hand (duplicate-command protection). */
  applied: Record<string, number>;
  result: HandResult | null;
}

export interface TableState {
  id: string;
  maxSeats: number;
  seats: (Seat | null)[];
  /** Seat index of the button for the current / most recent hand. -1 before the first hand. */
  button: number;
  handNo: number;
  hand: HandState | null;
}

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips required to call (already capped by the player's stack). */
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  /** Smallest legal "to" amount for a bet/raise. An all-in below this is still legal if it equals maxTo. */
  minTo: number;
  /** Largest legal "to" amount: the whole stack in no-limit, the pot in pot-limit, the fixed bet in fixed-limit. */
  maxTo: number;
  /** Fixed-limit: the only legal bet/raise sizes are minTo and maxTo (which are equal unless the stack is short). */
  fixed: boolean;
  /** Everything already in the middle, including bets on this street. */
  pot: number;
  currentBet: number;
  streetBet: number;
  stack: number;
}

export type ActionErrorCode =
  | 'no_hand'
  | 'not_your_turn'
  | 'illegal_action'
  | 'bad_amount'
  | 'below_minimum'
  | 'above_stack';

export class ActionError extends Error {
  constructor(
    public code: ActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

// ---------------------------------------------------------------------------
// Table management
// ---------------------------------------------------------------------------

export function createTable(id: string, maxSeats: number): TableState {
  if (!Number.isInteger(maxSeats) || maxSeats < 2 || maxSeats > 9) throw new RangeError('A table seats 2 to 9 players');
  return { id, maxSeats, seats: new Array(maxSeats).fill(null), button: -1, handNo: 0, hand: null };
}

export function seatPlayer(table: TableState, playerId: string, stack: number, seatIndex?: number): number {
  if (table.seats.some((s) => s?.playerId === playerId)) throw new Error(`${playerId} is already seated`);
  let idx = seatIndex ?? table.seats.findIndex((s) => s === null);
  if (idx < 0 || idx >= table.maxSeats) throw new Error('No free seat');
  if (table.seats[idx]) throw new Error(`Seat ${idx} is taken`);
  if (!Number.isInteger(stack) || stack < 0) throw new RangeError('Stack must be a non-negative integer');
  table.seats[idx] = {
    seat: idx,
    playerId,
    stack,
    sitOut: false,
    inHand: false,
    folded: false,
    allIn: false,
    hole: [],
    streetBet: 0,
    committed: 0,
    acted: false,
    startStack: stack,
  };
  return idx;
}

/** Remove a player. Only legal between hands (or for a seat that is not in the current hand). */
export function unseatPlayer(table: TableState, seatIndex: number): Seat {
  const seat = table.seats[seatIndex];
  if (!seat) throw new Error(`Seat ${seatIndex} is empty`);
  if (handInProgress(table) && seat.inHand) throw new Error('Cannot remove a player during a hand');
  table.seats[seatIndex] = null;
  return seat;
}

export const occupiedSeats = (table: TableState): Seat[] => table.seats.filter((s): s is Seat => s !== null);
export const handInProgress = (table: TableState): boolean => table.hand !== null && table.hand.street !== 'complete';

function nextSeat(table: TableState, from: number, pred: (s: Seat) => boolean): number {
  for (let i = 1; i <= table.maxSeats; i++) {
    const idx = (((from + i) % table.maxSeats) + table.maxSeats) % table.maxSeats;
    const s = table.seats[idx];
    if (s && pred(s)) return idx;
  }
  return -1;
}

const liveSeats = (table: TableState): Seat[] => occupiedSeats(table).filter((s) => s.inHand && !s.folded);

// ---------------------------------------------------------------------------
// Starting a hand
// ---------------------------------------------------------------------------

export interface StartHandOptions {
  /** Force the button seat (tests, final-table redraws). */
  button?: number;
  /** Use a specific deck, first card dealt first (tests and labelled demo fixtures only). */
  deck?: Card[];
  /** The poker variant to deal. Default: No-Limit Texas Hold'em. */
  variant?: VariantId;
}

/** The rules a table's current hand is played under. */
export const rulesOf = (hand: Pick<HandState, 'variant'> | null | undefined) => variantOf(hand?.variant ?? DEFAULT_VARIANT);

/** Fixed-limit bet size for the street: the small bet before and on the flop, the big bet after. */
const fixedBet = (hand: HandState): number => (hand.street === 'preflop' || hand.street === 'flop' ? hand.blinds.bb : hand.blinds.bb * 2);
const FIXED_LIMIT_CAP = 4;

export function startHand(table: TableState, blinds: Blinds, rng: Rng, options: StartHandOptions = {}): HandState {
  if (handInProgress(table)) throw new Error('A hand is already in progress');
  if (blinds.bb <= 0 || blinds.sb < 0 || blinds.sb > blinds.bb) throw new RangeError('Invalid blinds');
  const players = occupiedSeats(table).filter((s) => s.stack > 0);
  if (players.length < 2) throw new Error('Need at least two players with chips');
  const rules = variantOf(options.variant);
  if (!rules.implemented || rules.board !== 'community5') throw new Error(`Variant ${rules.id} cannot be dealt`);
  if (players.length > rules.maxPlayers) throw new Error(`${rules.name} seats at most ${rules.maxPlayers} players`);

  for (const s of occupiedSeats(table)) {
    s.inHand = s.stack > 0;
    s.folded = false;
    s.allIn = false;
    s.hole = [];
    s.streetBet = 0;
    s.committed = 0;
    s.acted = false;
    s.startStack = s.stack;
  }

  const inHand = (s: Seat) => s.inHand;
  let button: number;
  if (options.button !== undefined) {
    if (!table.seats[options.button]?.inHand) throw new Error('Button must be on a player in the hand');
    button = options.button;
  } else if (table.button < 0) {
    button = players[rng.int(players.length)]!.seat;
  } else {
    button = nextSeat(table, table.button, inHand);
  }
  const headsUp = players.length === 2;
  const sbSeat = headsUp ? button : nextSeat(table, button, inHand);
  const bbSeat = nextSeat(table, sbSeat, inHand);

  const deck = options.deck ? [...options.deck] : shuffledDeck(rng, rules.deck);
  table.button = button;
  table.handNo += 1;
  const hand: HandState = {
    handNo: table.handNo,
    variant: rules.id,
    blinds: { ...blinds },
    button,
    sbSeat,
    bbSeat,
    street: 'preflop',
    board: [],
    deck,
    deckPos: 0,
    currentBet: blinds.bb,
    minRaise: blinds.bb,
    // In fixed-limit the big blind counts as the first bet of the pre-flop street.
    raises: rules.betting === 'fixed_limit' ? 1 : 0,
    toAct: -1,
    deadMoney: 0,
    seq: 0,
    events: [],
    applied: {},
    result: null,
  };
  table.hand = hand;

  hand.events.push({
    t: 'start',
    handNo: hand.handNo,
    button,
    sbSeat,
    bbSeat,
    blinds: hand.blinds,
    seats: players.map((s) => ({ seat: s.seat, playerId: s.playerId, stack: s.stack })),
    variant: rules.id,
  });

  // Antes. Classic antes are each player's own live contribution; a big-blind
  // ante is paid by the big blind alone (ante first) and is dead money.
  if (blinds.ante > 0 && blinds.anteType === 'classic') {
    let idx = button;
    for (let i = 0; i < players.length; i++) {
      idx = nextSeat(table, idx, inHand);
      const s = table.seats[idx]!;
      const amount = Math.min(blinds.ante, s.stack);
      s.stack -= amount;
      s.committed += amount;
      if (s.stack === 0) s.allIn = true;
      hand.events.push({ t: 'post', seat: s.seat, kind: 'ante', amount, stack: s.stack, allIn: s.allIn, dead: false });
    }
  } else if (blinds.ante > 0 && blinds.anteType === 'bb') {
    const s = table.seats[bbSeat]!;
    const amount = Math.min(blinds.ante, s.stack);
    s.stack -= amount;
    hand.deadMoney += amount;
    if (s.stack === 0) s.allIn = true;
    hand.events.push({ t: 'post', seat: s.seat, kind: 'ante', amount, stack: s.stack, allIn: s.allIn, dead: true });
  }

  const postBlind = (seatIdx: number, kind: 'sb' | 'bb', size: number) => {
    const s = table.seats[seatIdx]!;
    const amount = Math.min(size, s.stack);
    if (amount > 0) pay(s, amount);
    hand.events.push({ t: 'post', seat: s.seat, kind, amount, stack: s.stack, allIn: s.allIn, dead: false });
  };
  postBlind(sbSeat, 'sb', blinds.sb);
  postBlind(bbSeat, 'bb', blinds.bb);

  // Deal the variant's hole cards one at a time, starting left of the button.
  for (let round = 0; round < rules.holeCards; round++) {
    let idx = button;
    for (let i = 0; i < players.length; i++) {
      idx = nextSeat(table, idx, inHand);
      table.seats[idx]!.hole.push(hand.deck[hand.deckPos++]!);
    }
  }
  {
    let idx = button;
    for (let i = 0; i < players.length; i++) {
      idx = nextSeat(table, idx, inHand);
      const s = table.seats[idx]!;
      hand.events.push({ t: 'hole', seat: s.seat, cards: [...s.hole] });
    }
  }

  advance(table, bbSeat);
  return hand;
}

function pay(seat: Seat, amount: number): void {
  seat.stack -= amount;
  seat.streetBet += amount;
  seat.committed += amount;
  if (seat.stack === 0) seat.allIn = true;
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

function othersCanRespond(table: TableState, me: Seat): boolean {
  return liveSeats(table).some((s) => s !== me && !s.allIn);
}

function callAmountFor(table: TableState, me: Seat): number {
  const hand = table.hand!;
  // Nobody can be asked to match more than the deepest opponent can put in.
  let cap = 0;
  for (const s of liveSeats(table)) {
    if (s !== me) cap = Math.max(cap, s.streetBet + s.stack);
  }
  const target = Math.min(hand.currentBet, cap);
  return Math.max(0, Math.min(me.stack, target - me.streetBet));
}

export function potSize(table: TableState): number {
  const hand = table.hand;
  if (!hand) return 0;
  let total = hand.deadMoney;
  for (const s of occupiedSeats(table)) if (s.inHand) total += s.committed;
  return total;
}

export function legalActions(table: TableState): LegalActions | null {
  const hand = table.hand;
  if (!hand || hand.toAct < 0) return null;
  const rules = rulesOf(hand);
  const me = table.seats[hand.toAct]!;
  const callAmount = callAmountFor(table, me);
  const stackTo = me.streetBet + me.stack;
  const pot = potSize(table);
  const facing = hand.currentBet - me.streetBet;
  let minTo: number;
  let maxTo: number;
  let capped = false;
  if (rules.betting === 'fixed_limit') {
    // One size only; a short stack may still go all in for less.
    const size = hand.currentBet + fixedBet(hand);
    minTo = Math.min(stackTo, size);
    maxTo = minTo;
    const live = liveSeats(table).length;
    capped = (hand.raises ?? 0) >= FIXED_LIMIT_CAP && live > 2;
  } else if (rules.betting === 'pot_limit') {
    // Pot-limit: raise by at most the pot as it stands after the call.
    const potAfterCall = pot + callAmount;
    maxTo = Math.min(stackTo, hand.currentBet + potAfterCall);
    minTo = Math.min(maxTo, hand.currentBet + hand.minRaise);
  } else {
    maxTo = stackTo;
    minTo = Math.min(maxTo, hand.currentBet + hand.minRaise);
  }
  const mayRaise =
    !capped &&
    othersCanRespond(table, me) &&
    me.stack > callAmount &&
    maxTo > hand.currentBet &&
    (!me.acted || facing >= hand.minRaise);
  return {
    seat: me.seat,
    canFold: true,
    canCheck: callAmount === 0,
    canCall: callAmount > 0,
    callAmount,
    canBet: mayRaise && hand.currentBet === 0,
    canRaise: mayRaise && hand.currentBet > 0,
    minTo,
    maxTo,
    fixed: rules.betting === 'fixed_limit',
    pot,
    currentBet: hand.currentBet,
    streetBet: me.streetBet,
    stack: me.stack,
  };
}

// ---------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------

export function applyAction(table: TableState, seatIndex: number, action: PlayerAction, auto = false): void {
  const hand = table.hand;
  if (!hand || hand.street === 'complete') throw new ActionError('no_hand', 'No hand in progress');
  if (hand.toAct !== seatIndex) throw new ActionError('not_your_turn', `It is not seat ${seatIndex}'s turn`);
  const me = table.seats[seatIndex]!;
  const legal = legalActions(table)!;

  switch (action.type) {
    case 'fold': {
      me.folded = true;
      me.acted = true;
      hand.events.push({ t: 'action', seat: me.seat, type: 'fold', amount: 0, to: me.streetBet, stack: me.stack, allIn: false, auto });
      break;
    }
    case 'check': {
      if (!legal.canCheck) throw new ActionError('illegal_action', 'Cannot check: there is a bet to call');
      me.acted = true;
      hand.events.push({ t: 'action', seat: me.seat, type: 'check', amount: 0, to: me.streetBet, stack: me.stack, allIn: false, auto });
      break;
    }
    case 'call': {
      if (!legal.canCall) throw new ActionError('illegal_action', 'Nothing to call');
      pay(me, legal.callAmount);
      me.acted = true;
      hand.events.push({
        t: 'action',
        seat: me.seat,
        type: 'call',
        amount: legal.callAmount,
        to: me.streetBet,
        stack: me.stack,
        allIn: me.allIn,
        auto,
      });
      break;
    }
    case 'bet':
    case 'raise': {
      if (!legal.canBet && !legal.canRaise) throw new ActionError('illegal_action', 'Betting is not open to this player');
      const to = action.amount;
      if (to === undefined || !Number.isInteger(to)) throw new ActionError('bad_amount', 'Bet amount must be a whole number of chips');
      if (to > legal.maxTo) throw new ActionError('above_stack', legal.fixed ? `The bet is fixed at ${legal.maxTo}` : rulesOf(hand).betting === 'pot_limit' ? `Pot-limit: at most ${legal.maxTo}` : 'Bet is larger than the stack');
      if (to <= hand.currentBet) throw new ActionError('bad_amount', 'A raise must exceed the current bet');
      if (to < legal.minTo && to !== legal.maxTo) throw new ActionError('below_minimum', `Minimum is ${legal.minTo}`);
      if (legal.fixed && to !== legal.minTo && to !== legal.maxTo) throw new ActionError('bad_amount', `The bet is fixed at ${legal.maxTo}`);
      const type: ActionType = hand.currentBet === 0 ? 'bet' : 'raise';
      const raiseBy = to - hand.currentBet;
      const added = to - me.streetBet;
      pay(me, added);
      if (raiseBy >= hand.minRaise) {
        // A full bet/raise reopens the action for everyone else.
        if (!legal.fixed) hand.minRaise = raiseBy;
        for (const s of liveSeats(table)) if (s !== me) s.acted = false;
        hand.raises = (hand.raises ?? 0) + 1;
      }
      hand.currentBet = to;
      me.acted = true;
      hand.events.push({ t: 'action', seat: me.seat, type, amount: added, to, stack: me.stack, allIn: me.allIn, auto });
      break;
    }
    default:
      throw new ActionError('illegal_action', `Unknown action`);
  }

  hand.seq += 1;
  advance(table, seatIndex);
}

/** The action taken for an absent or timed-out player: check when free, otherwise fold. */
export function applyAutoAction(table: TableState): void {
  const legal = legalActions(table);
  if (!legal) throw new ActionError('no_hand', 'Nobody to act');
  applyAction(table, legal.seat, { type: legal.canCheck ? 'check' : 'fold' }, true);
}

// ---------------------------------------------------------------------------
// Hand progression
// ---------------------------------------------------------------------------

function nextToAct(table: TableState, from: number): number {
  const hand = table.hand!;
  for (let i = 1; i <= table.maxSeats; i++) {
    const s = table.seats[(from + i) % table.maxSeats];
    if (!s || !s.inHand || s.folded || s.allIn) continue;
    if (s.acted && s.streetBet >= hand.currentBet) continue;
    if (callAmountFor(table, s) > 0) return s.seat;
    // Nothing to call: an option only matters if someone could respond to a bet.
    if (!s.acted && othersCanRespond(table, s)) return s.seat;
  }
  return -1;
}

function advance(table: TableState, from: number): void {
  const hand = table.hand!;
  const live = liveSeats(table);
  if (live.length === 1) {
    finishUncontested(table, live[0]!);
    return;
  }
  const next = nextToAct(table, from);
  if (next >= 0) {
    hand.toAct = next;
    hand.events.push({ t: 'turn', seat: next });
    return;
  }
  hand.toAct = -1;
  closeStreet(table);
  if (hand.street === 'river') {
    showdown(table);
    return;
  }
  if (liveSeats(table).filter((s) => !s.allIn).length <= 1) {
    // No further betting is possible: table the hands and run the board out.
    revealLiveHands(table);
    while ((hand.street as Street) !== 'river') dealStreet(table);
    showdown(table);
    return;
  }
  dealStreet(table);
  advance(table, hand.button);
}

function refundUncalled(table: TableState): void {
  const hand = table.hand!;
  let top: Seat | null = null;
  let topBet = 0;
  let second = 0;
  for (const s of occupiedSeats(table)) {
    if (!s.inHand) continue;
    if (s.streetBet > topBet) {
      second = topBet;
      topBet = s.streetBet;
      top = s;
    } else if (s.streetBet > second) {
      second = s.streetBet;
    }
  }
  if (top && !top.folded && topBet > second) {
    const refund = topBet - second;
    top.stack += refund;
    top.streetBet -= refund;
    top.committed -= refund;
    top.allIn = false;
    hand.events.push({ t: 'refund', seat: top.seat, amount: refund, stack: top.stack });
  }
}

function currentPots(table: TableState): Pot[] {
  const hand = table.hand!;
  return buildPots(
    occupiedSeats(table)
      .filter((s) => s.inHand)
      .map((s) => ({ seat: s.seat, committed: s.committed, folded: s.folded })),
    hand.deadMoney,
  );
}

function closeStreet(table: TableState): void {
  const hand = table.hand!;
  refundUncalled(table);
  for (const s of occupiedSeats(table)) {
    s.streetBet = 0;
    s.acted = false;
  }
  hand.currentBet = 0;
  hand.raises = 0;
  hand.events.push({ t: 'collect', pots: currentPots(table) });
}

function dealStreet(table: TableState): void {
  const hand = table.hand!;
  const next = hand.street === 'preflop' ? 'flop' : hand.street === 'flop' ? 'turn' : 'river';
  const count = next === 'flop' ? 3 : 1;
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) cards.push(hand.deck[hand.deckPos++]!);
  hand.board.push(...cards);
  hand.street = next;
  hand.minRaise = rulesOf(hand).betting === 'fixed_limit' ? fixedBet(hand) : hand.blinds.bb;
  hand.events.push({ t: 'street', street: next, cards });
}

function revealLiveHands(table: TableState): void {
  const hand = table.hand!;
  const shown = new Set(hand.events.filter((e) => e.t === 'show').map((e) => e.seat));
  let idx = hand.button;
  for (let i = 0; i < table.maxSeats; i++) {
    idx = (idx + 1) % table.maxSeats;
    const s = table.seats[idx];
    if (s && s.inHand && !s.folded && !shown.has(s.seat)) {
      hand.events.push({ t: 'show', seat: s.seat, cards: [...s.hole] });
    }
  }
}

/** Seats ordered clockwise starting left of the button. */
function clockwiseFromButton(table: TableState, seats: number[]): number[] {
  const hand = table.hand!;
  const distance = (seat: number) => (seat - hand.button - 1 + table.maxSeats * 2) % table.maxSeats;
  return [...seats].sort((a, b) => distance(a) - distance(b));
}

function showdown(table: TableState): void {
  const hand = table.hand!;
  const rules = rulesOf(hand);
  revealLiveHands(table);
  const live = liveSeats(table);
  const hands: ShownHand[] = live.map((s) => {
    const high = bestHigh(rules, s.hole, hand.board)!;
    const low = rules.hiLo ? bestLow(rules, s.hole, hand.board) : null;
    return {
      seat: s.seat,
      category: high.category,
      name: high.name,
      best: high.best,
      score: high.score,
      ...(rules.hiLo ? { low: low ? { score: low.score, name: describeLow(low.score), best: low.best } : null } : {}),
    };
  });
  hand.events.push({ t: 'showdown', hands });
  const highOf = new Map(hands.map((h) => [h.seat, h.score]));
  const lowOf = new Map(hands.map((h) => [h.seat, h.low?.score ?? -1]));

  const won: Record<number, number> = {};
  const pots = currentPots(table);
  // Share `amount` among `winners` (already clockwise from the button); odd chips go to the first.
  const share = (amount: number, winners: number[]): { seat: number; amount: number }[] => {
    const each = Math.floor(amount / winners.length);
    let odd = amount - each * winners.length;
    return winners.map((seat) => {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      return { seat, amount: each + extra };
    });
  };
  const credit = (payouts: { seat: number; amount: number }[]) => {
    for (const p of payouts) {
      table.seats[p.seat]!.stack += p.amount;
      won[p.seat] = (won[p.seat] ?? 0) + p.amount;
    }
  };
  pots.forEach((pot, index) => {
    let best = -1;
    for (const seat of pot.eligible) best = Math.max(best, highOf.get(seat)!);
    const highWinners = clockwiseFromButton(
      table,
      pot.eligible.filter((seat) => highOf.get(seat) === best),
    );
    const uncontested = pot.eligible.length === 1;
    if (rules.hiLo) {
      // Lowest qualifying low among the eligible seats, if any.
      let bestLowScore = Number.MAX_SAFE_INTEGER;
      for (const seat of pot.eligible) {
        const l = lowOf.get(seat)!;
        if (l >= 0 && l < bestLowScore) bestLowScore = l;
      }
      if (bestLowScore !== Number.MAX_SAFE_INTEGER) {
        const lowWinners = clockwiseFromButton(
          table,
          pot.eligible.filter((seat) => lowOf.get(seat) === bestLowScore),
        );
        // The high half takes the odd chip.
        const lowHalf = Math.floor(pot.amount / 2);
        const highHalf = pot.amount - lowHalf;
        const highPayouts = share(highHalf, highWinners);
        const lowPayouts = share(lowHalf, lowWinners);
        credit(highPayouts);
        credit(lowPayouts);
        hand.events.push({ t: 'award', pot: index, amount: highHalf, winners: highPayouts, uncontested, half: 'high' });
        hand.events.push({ t: 'award', pot: index, amount: lowHalf, winners: lowPayouts, uncontested, half: 'low' });
        return;
      }
    }
    const payouts = share(pot.amount, highWinners);
    credit(payouts);
    hand.events.push({ t: 'award', pot: index, amount: pot.amount, winners: payouts, uncontested });
  });
  finish(table, won);
}

function finishUncontested(table: TableState, winner: Seat): void {
  const hand = table.hand!;
  hand.toAct = -1;
  refundUncalled(table);
  const amount = potSize(table);
  winner.stack += amount;
  hand.events.push({ t: 'award', pot: 0, amount, winners: [{ seat: winner.seat, amount }], uncontested: true });
  finish(table, { [winner.seat]: amount });
}

function finish(table: TableState, won: Record<number, number>): void {
  const hand = table.hand!;
  const net: Record<number, number> = {};
  const eliminated: number[] = [];
  const stacks: { seat: number; stack: number }[] = [];
  let topWinner = -1;
  for (const s of occupiedSeats(table)) {
    if (!s.inHand) continue;
    net[s.seat] = s.stack - s.startStack;
    stacks.push({ seat: s.seat, stack: s.stack });
    if (s.stack === 0) eliminated.push(s.seat);
    if (topWinner < 0 || (won[s.seat] ?? 0) > (won[topWinner] ?? 0)) topWinner = s.seat;
    s.streetBet = 0;
    s.allIn = false;
  }
  hand.street = 'complete';
  hand.toAct = -1;
  hand.result = { won, net, eliminated, topWinner };
  hand.events.push({ t: 'end', stacks, eliminated });
}

/** Total chips on the table (stacks plus anything in the middle). Constant for the life of a table. */
export function chipsOnTable(table: TableState): number {
  let total = 0;
  for (const s of occupiedSeats(table)) total += s.stack;
  if (handInProgress(table)) total += potSize(table);
  return total;
}
