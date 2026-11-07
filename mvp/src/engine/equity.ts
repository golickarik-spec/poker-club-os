/**
 * Win probabilities between hands that are face up (an all-in before the river).
 * Uses only cards that are public at that point.
 */
import { deckFor, type Card } from './cards.ts';
import { highScore } from './hands.ts';
import type { Rng } from './rng.ts';
import { VARIANTS, type VariantRules } from './variants.ts';

/** Equity per hand, in the same order as `hands`. Exact when at most two board cards are missing, sampled otherwise. */
export function tabledEquities(hands: readonly (readonly Card[])[], board: readonly Card[], rng: Rng, samples = 3000, rules: VariantRules = VARIANTS.nlhe): number[] {
  const used = new Uint8Array(52);
  for (const h of hands) for (const c of h) used[c] = 1;
  for (const c of board) used[c] = 1;
  const deck: Card[] = [];
  for (const c of deckFor(rules.deck)) if (!used[c]) deck.push(c);
  const missing = 5 - board.length;
  const wins = new Array<number>(hands.length).fill(0);
  let total = 0;
  const full: Card[] = [...board, 0, 0, 0, 0, 0].slice(0, 5);
  const scores = new Array<number>(hands.length).fill(0);

  const tally = (): void => {
    let best = -1;
    let count = 0;
    for (let i = 0; i < hands.length; i++) {
      const s = highScore(rules, hands[i]!, full);
      scores[i] = s;
      if (s > best) {
        best = s;
        count = 1;
      } else if (s === best) count++;
    }
    for (let i = 0; i < hands.length; i++) if (scores[i] === best) wins[i] = wins[i]! + 1 / count;
    total++;
  };

  if (missing === 0) {
    tally();
  } else if (missing === 1) {
    for (const a of deck) {
      full[4] = a;
      tally();
    }
  } else if (missing === 2) {
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        full[3] = deck[i]!;
        full[4] = deck[j]!;
        tally();
      }
    }
  } else {
    for (let s = 0; s < samples; s++) {
      for (let k = 0; k < missing; k++) {
        const j = k + rng.int(deck.length - k);
        const tmp = deck[k]!;
        deck[k] = deck[j]!;
        deck[j] = tmp;
        full[board.length + k] = deck[k]!;
      }
      tally();
    }
  }
  return wins.map((w) => w / total);
}
