/**
 * Client-side table view.
 *
 * The engine emits a stream of hand events. `redactEvent` removes everything a
 * given viewer is not entitled to see (other players' hole cards); the reducer
 * `applyEvent` folds the redacted stream into a `TableView` that the UI renders.
 * The same reducer drives live play, spectating and the hand replayer.
 *
 * In a networked deployment `redactEvent` runs on the server, so a client never
 * receives hidden cards at all.
 */
import type { Card } from './cards.ts';
import { DEFAULT_VARIANT, variantOf, type VariantId } from './variants.ts';
import type { ActionType, Blinds, HandEvent, ShownHand, Street, TableState } from './holdem.ts';
import type { Pot } from './pots.ts';

export type SeatLabel = { type: ActionType | 'sb' | 'bb' | 'ante'; amount: number; to: number; allIn: boolean };

export interface SeatView {
  seat: number;
  playerId: string;
  stack: number;
  /** Chips in front of the player on the current street. */
  bet: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** True while the player holds cards (face up or face down). */
  hasCards: boolean;
  /** The cards if this viewer may see them, otherwise null. */
  cards: Card[] | null;
  lastAction: SeatLabel | null;
  won: number;
  shown: ShownHand | null;
}

export interface TableView {
  tableId: string;
  maxSeats: number;
  /** The variant of the current hand (No-Limit Hold'em for hands recorded before v0.4). */
  variant: VariantId;
  /** Hole cards per player in this variant, so hidden hands are drawn with the right number of backs. */
  holeCards: number;
  handNo: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  blinds: Blinds | null;
  street: Street | 'idle';
  board: Card[];
  /** Pots collected on previous streets. */
  pots: Pot[];
  /** All chips in the middle, including bets on this street. */
  potTotal: number;
  seats: (SeatView | null)[];
  toAct: number;
  showdown: boolean;
  /** Seats holding the winning cards of the last award (for highlighting). */
  winners: number[];
}

/** Viewer is a seat index, or null for an observer who owns no cards. */
export type Viewer = number | null;

export function redactEvent(event: HandEvent, viewer: Viewer): HandEvent {
  if (event.t === 'hole' && event.seat !== viewer) return { t: 'hole', seat: event.seat, cards: null };
  return event;
}

export function redactedEvents(table: TableState, viewer: Viewer, fromIndex = 0): HandEvent[] {
  const events = table.hand?.events ?? [];
  const out: HandEvent[] = [];
  for (let i = fromIndex; i < events.length; i++) out.push(redactEvent(events[i]!, viewer));
  return out;
}

/** The table between hands: who sits where and with how many chips. Public information only. */
export function baseView(table: TableState): TableView {
  return {
    tableId: table.id,
    maxSeats: table.maxSeats,
    variant: table.hand?.variant ?? DEFAULT_VARIANT,
    holeCards: variantOf(table.hand?.variant).holeCards,
    handNo: table.handNo,
    button: table.button,
    sbSeat: -1,
    bbSeat: -1,
    blinds: null,
    street: 'idle',
    board: [],
    pots: [],
    potTotal: 0,
    seats: table.seats.map((s) =>
      s
        ? {
            seat: s.seat,
            playerId: s.playerId,
            stack: s.stack,
            bet: 0,
            inHand: false,
            folded: false,
            allIn: false,
            hasCards: false,
            cards: null,
            lastAction: null,
            won: 0,
            shown: null,
          }
        : null,
    ),
    toAct: -1,
    showdown: false,
    winners: [],
  };
}

/** An empty table, for replaying a stored hand from its first event. */
export function blankView(tableId: string, maxSeats: number): TableView {
  return {
    tableId,
    maxSeats,
    variant: DEFAULT_VARIANT,
    holeCards: 2,
    handNo: 0,
    button: -1,
    sbSeat: -1,
    bbSeat: -1,
    blinds: null,
    street: 'idle',
    board: [],
    pots: [],
    potTotal: 0,
    seats: new Array(maxSeats).fill(null),
    toAct: -1,
    showdown: false,
    winners: [],
  };
}

/** Fold one (already redacted) event into the view. Mutates `view`. */
export function applyEvent(view: TableView, event: HandEvent): void {
  const seatOf = (seat: number): SeatView => {
    const s = view.seats[seat];
    if (!s) throw new Error(`Event references empty seat ${seat}`);
    return s;
  };
  switch (event.t) {
    case 'start': {
      view.handNo = event.handNo;
      view.variant = event.variant ?? DEFAULT_VARIANT;
      view.holeCards = variantOf(view.variant).holeCards;
      view.button = event.button;
      view.sbSeat = event.sbSeat;
      view.bbSeat = event.bbSeat;
      view.blinds = event.blinds;
      view.street = 'preflop';
      view.board = [];
      view.pots = [];
      view.potTotal = 0;
      view.toAct = -1;
      view.showdown = false;
      view.winners = [];
      for (const s of view.seats) {
        if (!s) continue;
        s.bet = 0;
        s.inHand = false;
        s.folded = false;
        s.allIn = false;
        s.hasCards = false;
        s.cards = null;
        s.lastAction = null;
        s.won = 0;
        s.shown = null;
      }
      for (const p of event.seats) {
        let s = view.seats[p.seat];
        if (!s || s.playerId !== p.playerId) {
          s = {
            seat: p.seat,
            playerId: p.playerId,
            stack: p.stack,
            bet: 0,
            inHand: true,
            folded: false,
            allIn: false,
            hasCards: false,
            cards: null,
            lastAction: null,
            won: 0,
            shown: null,
          };
          view.seats[p.seat] = s;
        }
        s.stack = p.stack;
        s.inHand = true;
      }
      break;
    }
    case 'post': {
      const s = seatOf(event.seat);
      s.stack = event.stack;
      s.allIn = event.allIn;
      view.potTotal += event.amount;
      // Classic antes and dead antes go straight to the middle; blinds sit in front of the player.
      if (event.kind !== 'ante') s.bet += event.amount;
      if (event.amount > 0) s.lastAction = { type: event.kind, amount: event.amount, to: s.bet, allIn: event.allIn };
      break;
    }
    case 'hole': {
      const s = seatOf(event.seat);
      s.hasCards = true;
      s.cards = event.cards;
      break;
    }
    case 'turn': {
      view.toAct = event.seat;
      break;
    }
    case 'action': {
      const s = seatOf(event.seat);
      view.toAct = -1;
      s.stack = event.stack;
      s.bet = event.to;
      s.allIn = event.allIn;
      view.potTotal += event.amount;
      s.lastAction = { type: event.type, amount: event.amount, to: event.to, allIn: event.allIn };
      if (event.type === 'fold') {
        s.folded = true;
        s.hasCards = false;
      }
      break;
    }
    case 'refund': {
      const s = seatOf(event.seat);
      s.stack = event.stack;
      s.bet = Math.max(0, s.bet - event.amount);
      s.allIn = false;
      view.potTotal -= event.amount;
      break;
    }
    case 'collect': {
      view.pots = event.pots.map((p) => ({ amount: p.amount, eligible: [...p.eligible] }));
      for (const s of view.seats) {
        if (!s) continue;
        s.bet = 0;
        if (s.lastAction && !s.folded && !s.allIn) s.lastAction = null;
      }
      break;
    }
    case 'street': {
      view.street = event.street;
      view.board = [...view.board, ...event.cards];
      break;
    }
    case 'show': {
      const s = seatOf(event.seat);
      s.cards = event.cards;
      s.hasCards = true;
      break;
    }
    case 'showdown': {
      view.showdown = true;
      for (const h of event.hands) seatOf(h.seat).shown = h;
      break;
    }
    case 'award': {
      view.toAct = -1;
      for (const s of view.seats) if (s) s.bet = 0;
      for (const w of event.winners) {
        const s = seatOf(w.seat);
        s.stack += w.amount;
        s.won += w.amount;
      }
      view.winners = [...new Set([...view.winners, ...event.winners.map((w) => w.seat)])];
      view.potTotal -= event.amount;
      if (view.pots[event.pot]) view.pots[event.pot]!.amount = 0;
      break;
    }
    case 'end': {
      view.street = 'complete';
      view.toAct = -1;
      view.potTotal = 0;
      view.pots = [];
      for (const st of event.stacks) seatOf(st.seat).stack = st.stack;
      break;
    }
  }
}

/** Build the current view for a viewer by replaying the hand's (redacted) events. Used for (re)synchronisation. */
export function viewOf(table: TableState, viewer: Viewer): TableView {
  const view = baseView(table);
  const hand = table.hand;
  if (!hand) return view;
  // Stacks in the base view are current; events re-derive them from the start of the hand.
  for (const e of hand.events) applyEvent(view, redactEvent(e, viewer));
  return view;
}

/**
 * The unredacted view: every live hand face up. Only ever produced server-side for the delayed
 * streamer feed; it must never be sent to a client while the hand is in progress.
 */
export function viewOfAll(table: TableState): TableView {
  const view = baseView(table);
  const hand = table.hand;
  if (!hand) return view;
  for (const e of hand.events) applyEvent(view, e);
  return view;
}

export function cloneView(view: TableView): TableView {
  return {
    ...view,
    board: [...view.board],
    pots: view.pots.map((p) => ({ amount: p.amount, eligible: [...p.eligible] })),
    seats: view.seats.map((s) => (s ? { ...s, cards: s.cards ? [...s.cards] : null } : null)),
    winners: [...view.winners],
  };
}
