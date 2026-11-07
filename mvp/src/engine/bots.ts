/**
 * Demonstration opponents.
 *
 * Bots are computer-controlled and must always be labelled as such in the UI.
 * They decide from exactly the information a human in that seat would have:
 * their own two cards, the board, the pot, stack sizes and the legal actions.
 * They never read the deck or another player's hole cards — `botContext` is the
 * only way a bot sees the table and it copies only public fields.
 *
 * The strategy is deliberately simple (a pre-flop hand chart based on the Chen
 * formula and Monte-Carlo equity after the flop). It is meant to make a demo
 * table feel alive, not to be a strong player.
 */
import { cardRank, cardSuit, deckFor, type Card } from './cards.ts';
import { highScore } from './hands.ts';
import { legalActions, occupiedSeats, rulesOf, type LegalActions, type PlayerAction, type Street, type TableState } from './holdem.ts';
import type { Rng } from './rng.ts';
import { VARIANTS, type VariantRules } from './variants.ts';

export type BotStyle = 'tight' | 'aggressive' | 'passive' | 'balanced' | 'beginner';
export const BOT_STYLES: readonly BotStyle[] = ['tight', 'aggressive', 'passive', 'balanced', 'beginner'];

export interface BotContext {
  rules: VariantRules;
  hole: Card[];
  board: Card[];
  street: Street;
  legal: LegalActions;
  bb: number;
  /** Opponents still holding cards. */
  opponents: number;
  /** 0 = first to act after the blinds … 1 = button. Blinds are flagged separately. */
  positionScore: number;
  inBlinds: boolean;
  /** True if someone has raised beyond the big blind on this street (pre-flop) or bet (post-flop). */
  facingAggression: boolean;
}

/** Collect what the bot in `seatIndex` is allowed to know. */
export function botContext(table: TableState, seatIndex: number): BotContext {
  const hand = table.hand;
  const legal = legalActions(table);
  const me = table.seats[seatIndex];
  if (!hand || !legal || !me || legal.seat !== seatIndex) throw new Error('It is not this bot\'s turn');
  const inHand = occupiedSeats(table).filter((s) => s.inHand);
  const opponents = inHand.filter((s) => !s.folded && s.seat !== seatIndex).length;
  // Distance clockwise from the button: button = n-1 (last to act post-flop).
  const order: number[] = [];
  for (let i = 1; i <= table.maxSeats; i++) {
    const s = table.seats[(hand.button + i) % table.maxSeats];
    if (s?.inHand) order.push(s.seat);
  }
  const idx = order.indexOf(seatIndex);
  const n = order.length;
  const inBlinds = seatIndex === hand.sbSeat || seatIndex === hand.bbSeat;
  const positionScore = n <= 2 ? 1 : Math.max(0, (idx - 2) / Math.max(1, n - 3));
  return {
    rules: rulesOf(hand),
    hole: [...me.hole],
    board: [...hand.board],
    street: hand.street,
    legal,
    bb: hand.blinds.bb,
    opponents,
    positionScore: inBlinds && n > 2 ? 0.3 : positionScore,
    inBlinds,
    facingAggression: hand.street === 'preflop' ? hand.currentBet > hand.blinds.bb : hand.currentBet > 0,
  };
}

interface StyleParams {
  /** Added to pre-flop thresholds (positive = plays fewer hands). */
  tightness: number;
  /** Probability of betting/raising when the hand merits it. */
  aggression: number;
  /** Probability of betting with nothing. */
  bluff: number;
  /** Extra equity required beyond pot odds to call (negative = calls too much). */
  callMargin: number;
  /** Random error added to the bot's equity estimate. */
  noise: number;
  /** Tendency to limp pre-flop instead of raising. */
  limp: number;
}

const STYLES: Record<BotStyle, StyleParams> = {
  tight: { tightness: 1.2, aggression: 0.7, bluff: 0.04, callMargin: 0.08, noise: 0.02, limp: 0.05 },
  aggressive: { tightness: -1.5, aggression: 0.92, bluff: 0.26, callMargin: 0.01, noise: 0.03, limp: 0.02 },
  passive: { tightness: -0.5, aggression: 0.35, bluff: 0.02, callMargin: -0.05, noise: 0.03, limp: 0.6 },
  balanced: { tightness: 0, aggression: 0.78, bluff: 0.12, callMargin: 0.04, noise: 0.02, limp: 0.08 },
  beginner: { tightness: -2.2, aggression: 0.45, bluff: 0.08, callMargin: -0.09, noise: 0.12, limp: 0.55 },
};

/** Chen formula score for two hole cards (about -1 … 20). */
export function chenScore(hole: readonly Card[]): number {
  const r1 = Math.max(cardRank(hole[0]!), cardRank(hole[1]!));
  const r2 = Math.min(cardRank(hole[0]!), cardRank(hole[1]!));
  const points = (r: number): number => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = points(r1);
  if (r1 === r2) return Math.max(5, score * 2);
  if (cardSuit(hole[0]!) === cardSuit(hole[1]!)) score += 2;
  const gap = r1 - r2 - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && r1 < 10) score += 1;
  return Math.ceil(score);
}

/**
 * Pre-flop strength on the Chen scale (about -1 … 20) for any number of hole cards.
 * Two cards use the Chen formula. Omaha hands score pairs, suitedness and connectedness
 * in a way that keeps the same thresholds usable: double-suited rundowns and big pairs
 * with help score high, danglers and trips score low.
 */
export function preflopScore(hole: readonly Card[], rules: VariantRules): number {
  if (hole.length === 2) return chenScore(hole);
  const ranks = hole.map(cardRank).sort((a, b) => b - a);
  const suits = hole.map(cardSuit);
  let score = 0;
  // High cards.
  score += ranks.slice(0, 2).reduce((n, r) => n + (r === 12 ? 4 : r >= 10 ? 3 : r >= 8 ? 2 : r >= 5 ? 1 : 0), 0);
  // Pairs: good; trips/quads of a rank: bad (dead cards).
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const [r, c] of counts) {
    if (c === 2) score += r >= 11 ? 6 : r >= 8 ? 3.5 : 2;
    if (c >= 3) score -= 4;
  }
  // Suitedness: each suited pair of cards helps, two suits (double-suited) most.
  const suitCounts = new Map<number, number>();
  for (const su of suits) suitCounts.set(su, (suitCounts.get(su) ?? 0) + 1);
  let suited = 0;
  for (const c of suitCounts.values()) if (c >= 2) suited++;
  score += suited === 2 ? 4 : suited === 1 ? 2 : 0;
  for (const c of suitCounts.values()) if (c >= 4) score -= 1.5;
  // Connectedness: adjacent distinct ranks (rundowns).
  const distinct = [...new Set(ranks)];
  let links = 0;
  for (let i = 1; i < distinct.length; i++) if (distinct[i - 1]! - distinct[i]! <= 2) links++;
  score += links * 1.5;
  // Danglers: a card far from everything else.
  if (distinct.length >= 3 && distinct[0]! - distinct[1]! > 4) score -= 1.5;
  if (distinct.length >= 3 && distinct[distinct.length - 2]! - distinct[distinct.length - 1]! > 4) score -= 1.5;
  // More hole cards means more combinations; damp a little so five- and six-card hands do not all look premium.
  score -= (hole.length - 4) * 1.5;
  return Math.ceil(score);
}

const scratchDeck = new Int8Array(52);

/** Monte-Carlo win probability against `opponents` random hands under the variant's rules. Ties count fractionally. */
export function estimateEquity(hole: readonly Card[], board: readonly Card[], opponents: number, samples: number, rng: Rng, rules: VariantRules = VARIANTS.nlhe): number {
  const used = new Uint8Array(52);
  for (const c of hole) used[c] = 1;
  for (const c of board) used[c] = 1;
  let n = 0;
  for (const c of deckFor(rules.deck)) if (!used[c]) scratchDeck[n++] = c;
  const need = (5 - board.length) + opponents * rules.holeCards;
  if (need > n) return 0.5;
  const fullBoard: Card[] = [...board];
  const theirs: Card[] = new Array(rules.holeCards).fill(0);
  let total = 0;
  for (let s = 0; s < samples; s++) {
    // Partial Fisher–Yates: draw `need` distinct cards to the front.
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(n - i);
      const tmp = scratchDeck[i]!;
      scratchDeck[i] = scratchDeck[j]!;
      scratchDeck[j] = tmp;
    }
    let k = 0;
    fullBoard.length = board.length;
    while (fullBoard.length < 5) fullBoard.push(scratchDeck[k++]!);
    const myScore = highScore(rules, hole, fullBoard);
    let better = false;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      for (let i = 0; i < rules.holeCards; i++) theirs[i] = scratchDeck[k++]!;
      const score = highScore(rules, theirs, fullBoard);
      if (score > myScore) {
        better = true;
        break;
      }
      if (score === myScore) ties++;
    }
    if (!better) total += 1 / (ties + 1);
  }
  return total / samples;
}

function chipStep(bb: number): number {
  if (bb >= 4000) return 1000;
  if (bb >= 2000) return 500;
  if (bb >= 400) return 100;
  if (bb >= 100) return 25;
  if (bb >= 20) return 5;
  return 1;
}

/** Turn a desired "raise to" amount into a legal one. */
function sizeTo(target: number, ctx: BotContext): PlayerAction {
  const { legal } = ctx;
  const step = chipStep(ctx.bb);
  let to = Math.round(target / step) * step;
  to = Math.max(legal.minTo, Math.min(legal.maxTo, to));
  // Do not leave a tiny stack behind: commit instead.
  if (to >= legal.maxTo * 0.8) to = legal.maxTo;
  return { type: legal.currentBet === 0 ? 'bet' : 'raise', amount: to };
}

const canAggress = (legal: LegalActions): boolean => legal.canBet || legal.canRaise;
const passive = (legal: LegalActions): PlayerAction => (legal.canCheck ? { type: 'check' } : { type: 'fold' });
const callOrCheck = (legal: LegalActions): PlayerAction => (legal.canCheck ? { type: 'check' } : { type: 'call' });

function preflop(ctx: BotContext, p: StyleParams, rng: Rng): PlayerAction {
  const { legal, bb } = ctx;
  const score = preflopScore(ctx.hole, ctx.rules) + (rng.float() - 0.5) * p.noise * 20;
  const stackBB = (legal.stack + legal.streetBet) / bb;
  const positionBonus = ctx.positionScore * 2.5; // later position = looser
  const openAt = 9 - positionBonus + p.tightness;
  const callBB = legal.callAmount / bb;
  const commitment = legal.callAmount / Math.max(1, legal.stack);

  // Short stack: push or fold.
  if (stackBB <= 10 && canAggress(legal) && !ctx.facingAggression) {
    const pushAt = openAt - (10 - stackBB) * 0.45 - 0.5;
    if (score >= pushAt) return { type: 'raise', amount: legal.maxTo };
    return passive(legal);
  }

  if (!ctx.facingAggression) {
    // Unraised pot (limpers possible).
    if (score >= openAt && canAggress(legal)) {
      if (rng.float() < p.limp && score < 11) return callOrCheck(legal);
      const limpers = Math.max(0, Math.round((legal.pot - bb * 1.5) / bb));
      const size = (2.2 + rng.float() * 0.8 + limpers) * bb;
      return sizeTo(size, ctx);
    }
    if (legal.canCheck) return { type: 'check' };
    // Limp / complete with playable hands when it is cheap.
    if (score >= openAt - 2.5 && callBB <= 1 && rng.float() < 0.35 + p.limp * 0.6) return { type: 'call' };
    return { type: 'fold' };
  }

  // Facing a raise.
  const premium = score >= 12 + Math.max(0, p.tightness * 0.5);
  const reraiseBluff = rng.float() < p.bluff * 0.25 && callBB <= 4;
  if ((premium || reraiseBluff) && canAggress(legal) && rng.float() < p.aggression + 0.1) {
    const target = legal.currentBet * 3 + (legal.pot - legal.currentBet) * 0.2;
    return sizeTo(target, ctx);
  }
  let callAt = openAt + 1.5 + (callBB > 10 ? 3 : callBB > 4 ? 1.2 : 0) + p.callMargin * 10;
  if (commitment >= 0.4) callAt = Math.max(callAt, 10.5 + p.tightness * 0.8 + p.callMargin * 10);
  if (legal.canCall && score >= callAt) return { type: 'call' };
  return passive(legal);
}

function postflop(ctx: BotContext, p: StyleParams, rng: Rng, samples: number): PlayerAction {
  const { legal } = ctx;
  const opponents = Math.max(1, Math.min(4, ctx.opponents));
  let equity = estimateEquity(ctx.hole, ctx.board, opponents, samples, rng, ctx.rules);
  equity += (rng.float() - 0.5) * 2 * p.noise;
  const pot = Math.max(1, legal.pot);

  if (legal.canCheck) {
    if (!canAggress(legal)) return { type: 'check' };
    const strong = 0.62 + 0.05 * (opponents - 1);
    const medium = 0.48 + 0.04 * (opponents - 1);
    if (equity >= strong && rng.float() < p.aggression) {
      return sizeTo(legal.streetBet + pot * (0.55 + rng.float() * 0.3), ctx);
    }
    if (equity >= medium && rng.float() < p.aggression * 0.5) {
      return sizeTo(legal.streetBet + pot * (0.33 + rng.float() * 0.2), ctx);
    }
    if (opponents <= 2 && rng.float() < p.bluff) {
      return sizeTo(legal.streetBet + pot * (0.5 + rng.float() * 0.25), ctx);
    }
    return { type: 'check' };
  }

  // Facing a bet. A bet narrows the opponent's range, so discount raw equity a little.
  const betFraction = Math.min(1.5, legal.callAmount / pot);
  equity -= 0.06 + 0.08 * betFraction;
  const potOdds = legal.callAmount / (pot + legal.callAmount);
  const commitment = legal.callAmount / Math.max(1, legal.stack);

  if (canAggress(legal) && equity >= 0.74 && rng.float() < p.aggression) {
    return sizeTo(legal.currentBet * (2.4 + rng.float() * 0.8) + pot * 0.15, ctx);
  }
  if (canAggress(legal) && opponents === 1 && rng.float() < p.bluff * 0.2) {
    return sizeTo(legal.currentBet * 2.6, ctx);
  }
  let need = potOdds + p.callMargin;
  if (commitment >= 0.5) need = Math.max(need, 0.42 + p.callMargin);
  if (legal.canCall && equity >= need) return { type: 'call' };
  return { type: 'fold' };
}

/**
 * Choose an action for a bot. The result is always legal for `ctx.legal`.
 * `samples` trades strength for speed (fewer samples for fast background tables).
 */
export function chooseBotAction(ctx: BotContext, style: BotStyle, rng: Rng, samples = 160): PlayerAction {
  const params = STYLES[style];
  const action = ctx.street === 'preflop' ? preflop(ctx, params, rng) : postflop(ctx, params, rng, samples);
  return legalize(action, ctx.legal);
}

/** Final safety net: coerce any action into a legal one. */
export function legalize(action: PlayerAction, legal: LegalActions): PlayerAction {
  switch (action.type) {
    case 'check':
      return legal.canCheck ? action : { type: 'fold' };
    case 'call':
      return legal.canCall ? action : legal.canCheck ? { type: 'check' } : { type: 'fold' };
    case 'bet':
    case 'raise': {
      if (!legal.canBet && !legal.canRaise) return legal.canCall ? { type: 'call' } : passive(legal);
      let to = Math.round(action.amount ?? legal.minTo);
      to = Math.max(legal.minTo, Math.min(legal.maxTo, to));
      if (to <= legal.currentBet) return legal.canCall ? { type: 'call' } : passive(legal);
      return { type: legal.currentBet === 0 ? 'bet' : 'raise', amount: to };
    }
    default:
      return legal.canCheck ? { type: 'check' } : { type: 'fold' };
  }
}
