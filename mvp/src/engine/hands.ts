/**
 * Variant-aware hand selection: which five cards a player's hand is made of, under the
 * variant's rules for combining hole and board cards, and the matching low hand in
 * split-pot games. The evaluator scores five to seven cards; this module decides which
 * cards it is allowed to see.
 */
import type { Card } from './cards.ts';
import { bestFive, describeScore, evaluate, evaluateLow8, scoreCategory, type HandCategory } from './evaluator.ts';
import type { VariantRules } from './variants.ts';

export interface RankedHand {
  score: number;
  category: HandCategory;
  name: string;
  best: Card[];
}

const PAIRS: number[][][] = [];
const TRIPLES: number[][][] = [];
function choose(n: number, k: number, cache: number[][][]): number[][] {
  if (cache[n]) return cache[n]!;
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < n; i++) {
      acc.push(i);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  cache[n] = out;
  return out;
}

const five: Card[] = [0, 0, 0, 0, 0];

/**
 * The best high hand a player can make. Under `exactly2` rules (Omaha) every pair of hole
 * cards is combined with every triple of board cards; a board with fewer than three cards
 * cannot be scored and returns null.
 */
export function bestHigh(rules: VariantRules, hole: readonly Card[], board: readonly Card[]): RankedHand | null {
  if (rules.holeUse === 'any') {
    const cards = [...hole, ...board];
    if (cards.length < 5) return null;
    const pool = cards.length > 7 ? [...cards].slice(0, 7) : cards;
    const score = evaluate(pool, rules.ranking);
    return { score, category: scoreCategory(score, rules.ranking), name: describeScore(score, rules.ranking), best: bestFive(pool, rules.ranking) };
  }
  if (board.length < 3 || hole.length < 2) return null;
  let bestScore = -1;
  let bestCards: Card[] = [];
  for (const h of choose(hole.length, 2, PAIRS)) {
    for (const b of choose(board.length, 3, TRIPLES)) {
      five[0] = hole[h[0]!]!;
      five[1] = hole[h[1]!]!;
      five[2] = board[b[0]!]!;
      five[3] = board[b[1]!]!;
      five[4] = board[b[2]!]!;
      const score = evaluate(five, rules.ranking);
      if (score > bestScore) {
        bestScore = score;
        bestCards = [...five];
      }
    }
  }
  return { score: bestScore, category: scoreCategory(bestScore, rules.ranking), name: describeScore(bestScore, rules.ranking), best: bestCards };
}

/** Score only, for the hot loops in equity estimation. -1 when the hand cannot be scored yet. */
export function highScore(rules: VariantRules, hole: readonly Card[], board: readonly Card[]): number {
  if (rules.holeUse === 'any') {
    const cards = [...hole, ...board];
    return cards.length < 5 ? -1 : evaluate(cards, rules.ranking);
  }
  if (board.length < 3) return -1;
  let bestScore = -1;
  for (const h of choose(hole.length, 2, PAIRS)) {
    for (const b of choose(board.length, 3, TRIPLES)) {
      five[0] = hole[h[0]!]!;
      five[1] = hole[h[1]!]!;
      five[2] = board[b[0]!]!;
      five[3] = board[b[1]!]!;
      five[4] = board[b[2]!]!;
      const score = evaluate(five, rules.ranking);
      if (score > bestScore) bestScore = score;
    }
  }
  return bestScore;
}

/** The best qualifying low (eight or better) under the variant's rules, or null. Lower score is better. */
export function bestLow(rules: VariantRules, hole: readonly Card[], board: readonly Card[]): { score: number; best: Card[] } | null {
  if (!rules.hiLo) return null;
  let bestScore = Number.MAX_SAFE_INTEGER;
  let bestCards: Card[] | null = null;
  const consider = (cards: readonly Card[]) => {
    const s = evaluateLow8(cards);
    if (s >= 0 && s < bestScore) {
      bestScore = s;
      bestCards = [...cards];
    }
  };
  if (rules.holeUse === 'exactly2') {
    if (board.length < 3) return null;
    for (const h of choose(hole.length, 2, PAIRS)) {
      for (const b of choose(board.length, 3, TRIPLES)) {
        five[0] = hole[h[0]!]!;
        five[1] = hole[h[1]!]!;
        five[2] = board[b[0]!]!;
        five[3] = board[b[1]!]!;
        five[4] = board[b[2]!]!;
        consider(five);
      }
    }
  } else {
    const cards = [...hole, ...board];
    if (cards.length < 5) return null;
    for (const idx of choose(cards.length, 5, [])) consider(idx.map((i) => cards[i]!));
  }
  return bestCards ? { score: bestScore, best: bestCards } : null;
}
