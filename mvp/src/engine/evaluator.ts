import { cardRank, cardSuit, type Card } from './cards.ts';

/**
 * Hand evaluator for 5–7 cards.
 *
 * Returns a single integer; a higher value is a better hand and equal values
 * are an exact tie. Layout: category in bits 20+, then five 4-bit rank slots.
 */
export const enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

const counts = new Uint8Array(13);
const suitMasks = new Int32Array(4);
const suitCounts = new Uint8Array(4);

const pack = (cat: number, a: number, b = 0, c = 0, d = 0, e = 0): number =>
  (cat << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;

/** Highest rank of a straight contained in a 13-bit rank mask, or -1. The wheel (A-5) returns 3. */
function straightHigh(mask: number): number {
  for (let high = 12; high >= 4; high--) {
    if (((mask >> (high - 4)) & 0x1f) === 0x1f) return high;
  }
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

/** Pack the `n` highest set bits of `mask` (excluding bits in `skip`) into rank slots. */
function topRanks(mask: number, n: number, skip = 0): number[] {
  const out: number[] = [];
  const m = mask & ~skip;
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (m & (1 << r)) out.push(r);
  }
  return out;
}

export type RankingKind = 'standard' | 'short_deck';

/**
 * Short Deck (6+) convention used here, the common online one:
 *  - the twos to fives are removed (36 cards);
 *  - a flush beats a full house (flushes are rarer with nine ranks);
 *  - A-6-7-8-9 is the lowest straight (the ace plays low in place of the missing five);
 *  - straights still beat three of a kind.
 * The packed score keeps categories in *rank order*, so comparing scores stays a plain
 * integer comparison; `scoreCategory` maps back to the named category.
 */
const SHORT_DECK_CATEGORY: Record<number, number> = { [HandCategory.Flush]: HandCategory.FullHouse, [HandCategory.FullHouse]: HandCategory.Flush };
const packedCategory = (cat: HandCategory, ranking: RankingKind): number => (ranking === 'short_deck' ? (SHORT_DECK_CATEGORY[cat] ?? cat) : cat);

/** Highest rank of a short-deck straight in a rank mask, or -1. A-6-7-8-9 returns 7 (nine high). */
function shortStraightHigh(mask: number): number {
  for (let high = 12; high >= 8; high--) {
    if (((mask >> (high - 4)) & 0x1f) === 0x1f) return high;
  }
  return (mask & 0x10f0) === 0x10f0 ? 7 : -1;
}

export function evaluate(cards: readonly Card[], ranking: RankingKind = 'standard'): number {
  const n = cards.length;
  if (n < 5 || n > 7) throw new Error(`evaluate() needs 5-7 cards, got ${n}`);
  const straight = ranking === 'short_deck' ? shortStraightHigh : straightHigh;
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const card = cards[i]!;
    const r = cardRank(card);
    const s = cardSuit(card);
    counts[r] = counts[r]! + 1;
    suitMasks[s] = suitMasks[s]! | (1 << r);
    suitCounts[s] = suitCounts[s]! + 1;
    rankMask |= 1 << r;
  }

  let flushMask = 0;
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s]! >= 5) flushMask = suitMasks[s]!;
  }
  if (flushMask) {
    const sf = straight(flushMask);
    if (sf >= 0) return pack(HandCategory.StraightFlush, sf);
  }

  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = counts[r]!;
    if (c === 4) {
      if (quad < 0) quad = r;
    } else if (c === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (c === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    const k = topRanks(rankMask, 1, 1 << quad);
    return pack(HandCategory.Quads, quad, k[0]);
  }
  const fullHouse = trip1 >= 0 && (trip2 >= 0 || pair1 >= 0);
  if (ranking === 'short_deck' && flushMask) {
    const k = topRanks(flushMask, 5);
    return pack(packedCategory(HandCategory.Flush, ranking), k[0]!, k[1], k[2], k[3], k[4]);
  }
  if (fullHouse) {
    return pack(packedCategory(HandCategory.FullHouse, ranking), trip1, Math.max(trip2, pair1));
  }
  if (flushMask) {
    const k = topRanks(flushMask, 5);
    return pack(HandCategory.Flush, k[0]!, k[1], k[2], k[3], k[4]);
  }
  const st = straight(rankMask);
  if (st >= 0) return pack(HandCategory.Straight, st);
  if (trip1 >= 0) {
    const k = topRanks(rankMask, 2, 1 << trip1);
    return pack(HandCategory.Trips, trip1, k[0], k[1]);
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const k = topRanks(rankMask, 1, (1 << pair1) | (1 << pair2));
    return pack(HandCategory.TwoPair, pair1, pair2, k[0]);
  }
  if (pair1 >= 0) {
    const k = topRanks(rankMask, 3, 1 << pair1);
    return pack(HandCategory.Pair, pair1, k[0], k[1], k[2]);
  }
  const k = topRanks(rankMask, 5);
  return pack(HandCategory.HighCard, k[0]!, k[1], k[2], k[3], k[4]);
}

export const scoreCategory = (score: number, ranking: RankingKind = 'standard'): HandCategory => packedCategory((score >> 20) as HandCategory, ranking) as HandCategory;
const slot = (score: number, i: number): number => (score >> (16 - 4 * i)) & 0xf;

export interface HandDescription {
  score: number;
  category: HandCategory;
  /** Up to five ranks that define the hand, most significant first. */
  ranks: number[];
  /** English description, e.g. "Full House, Kings full of Sevens". */
  name: string;
  /** The five cards that make the hand. */
  best: Card[];
}

export function describeScore(score: number, ranking: RankingKind = 'standard'): string {
  const cat = scoreCategory(score, ranking);
  const a = slot(score, 0);
  const b = slot(score, 1);
  switch (cat) {
    case HandCategory.StraightFlush:
      return a === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[a]} high`;
    case HandCategory.Quads:
      return `Four of a Kind, ${RANK_PLURALS[a]}`;
    case HandCategory.FullHouse:
      return `Full House, ${RANK_PLURALS[a]} full of ${RANK_PLURALS[b]}`;
    case HandCategory.Flush:
      return `Flush, ${RANK_NAMES[a]} high`;
    case HandCategory.Straight:
      return `Straight, ${RANK_NAMES[a]} high`;
    case HandCategory.Trips:
      return `Three of a Kind, ${RANK_PLURALS[a]}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${RANK_PLURALS[a]} and ${RANK_PLURALS[b]}`;
    case HandCategory.Pair:
      return `Pair of ${RANK_PLURALS[a]}`;
    default:
      return `${RANK_NAMES[a]} high`;
  }
}

/** Find the five cards (out of 5–7) that produce the hand's score. */
export function bestFive(cards: readonly Card[], ranking: RankingKind = 'standard'): Card[] {
  const n = cards.length;
  if (n === 5) return [...cards];
  const target = evaluate(cards, ranking);
  const five: Card[] = new Array(5);
  for (let mask = 0; mask < 1 << n; mask++) {
    let k = 0;
    for (let i = 0; i < n && k <= 5; i++) {
      if (mask & (1 << i)) {
        if (k < 5) five[k] = cards[i]!;
        k++;
      }
    }
    if (k === 5 && evaluate(five, ranking) === target) return [...five];
  }
  return cards.slice(0, 5);
}

export function describeHand(cards: readonly Card[], ranking: RankingKind = 'standard'): HandDescription {
  const score = evaluate(cards, ranking);
  const ranks: number[] = [];
  for (let i = 0; i < 5; i++) ranks.push(slot(score, i));
  return { score, category: scoreCategory(score, ranking), ranks, name: describeScore(score, ranking), best: bestFive(cards, ranking) };
}

// ----- Low hands (eight or better) ------------------------------------------------------------

/**
 * Score of a five-card low hand for eight-or-better games, or -1 when the five cards do
 * not qualify (a pair, or a card above an eight). Aces play low. Straights and flushes do
 * not count against a low. Lower is better, so callers minimise; the packing puts the
 * highest card in the most significant slot (A-2-3-4-5 is the best low, value 0x43210).
 */
export function evaluateLow8(five: readonly Card[]): number {
  if (five.length !== 5) throw new Error('evaluateLow8() needs exactly five cards');
  let mask = 0;
  for (const c of five) {
    const r = cardRank(c);
    const low = r === 12 ? 0 : r + 1; // ace = 0, two = 1 … eight = 7
    if (low > 7) return -1;
    if (mask & (1 << low)) return -1;
    mask |= 1 << low;
  }
  let score = 0;
  for (let low = 7; low >= 0; low--) if (mask & (1 << low)) score = (score << 4) | low;
  return score;
}

/** "Eight low", "Seven-six low", … for a low score from `evaluateLow8`. */
export function describeLow(score: number): string {
  const names = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  const top = (score >> 16) & 0xf;
  const second = (score >> 12) & 0xf;
  if (top === 4 && second === 3) return 'Wheel (A-2-3-4-5 low)';
  return `${names[top]}-${names[second]!.toLowerCase()} low`;
}
