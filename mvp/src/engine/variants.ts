/**
 * Poker variant registry.
 *
 * A variant is a typed rule set: how many hole cards, which deck, how hole and board
 * cards may combine, how betting is limited, how hands are ranked and whether the pot
 * is split high/low. Tournament formats (freezeout, bounty, …) and optional modifiers
 * (run it twice, bomb pots) are *not* variants and live elsewhere; this file only knows
 * how a hand of poker is dealt, bet and scored.
 *
 * Only entries with `implemented: true` can be dealt. The rest are catalogued so the
 * product can show them as planned without pretending they play.
 */

export type VariantFamily = 'holdem' | 'omaha' | 'stud' | 'draw' | 'chinese' | 'mixed';
export type BettingStructure = 'no_limit' | 'pot_limit' | 'fixed_limit';
export type DeckKind = 'standard52' | 'short36';
/** `any`: best five of hole + board. `exactly2`: exactly two hole cards and three board cards (Omaha). */
export type HoleUse = 'any' | 'exactly2';
export type RankingKind = 'standard' | 'short_deck';

export type VariantId =
  // Hold'em
  | 'nlhe'
  | 'plhe'
  | 'flhe'
  | 'short_deck'
  | 'pineapple'
  | 'crazy_pineapple'
  // Omaha
  | 'plo4'
  | 'plo5'
  | 'plo6'
  | 'plo8'
  | 'flo'
  | 'flo8'
  // Stud
  | 'stud7'
  | 'stud8'
  | 'razz'
  | 'stud5'
  // Draw
  | 'draw5'
  | 'triple_draw_27'
  | 'single_draw_27'
  | 'badugi'
  // Chinese
  | 'ofc'
  | 'ofc_pineapple'
  // Mixed
  | 'horse'
  | 'eight_game'
  | 'custom_mix';

export interface VariantRules {
  id: VariantId;
  family: VariantFamily;
  /** English display name; the UI translates through `variant.<id>` keys. */
  name: string;
  /** Short english summary of the rules, also translated in the UI. */
  summary: string;
  holeCards: number;
  holeUse: HoleUse;
  deck: DeckKind;
  betting: BettingStructure;
  /** Community-card games deal a five-card board in three streets. */
  board: 'community5' | 'none';
  ranking: RankingKind;
  /** High/low split, eight-or-better low. */
  hiLo: boolean;
  minPlayers: number;
  /** Largest table that can be dealt from the deck with a full board. */
  maxPlayers: number;
  implemented: boolean;
}

const V = (r: VariantRules): VariantRules => r;

export const VARIANTS: Record<VariantId, VariantRules> = {
  nlhe: V({ id: 'nlhe', family: 'holdem', name: "No-Limit Texas Hold'em", summary: 'Two hole cards, any five of seven, bet any amount up to your stack.', holeCards: 2, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  plhe: V({ id: 'plhe', family: 'holdem', name: "Pot-Limit Texas Hold'em", summary: 'Hold’em where a bet or raise may not exceed the size of the pot.', holeCards: 2, holeUse: 'any', deck: 'standard52', betting: 'pot_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  flhe: V({ id: 'flhe', family: 'holdem', name: "Fixed-Limit Texas Hold'em", summary: 'Hold’em with fixed bet sizes: the small bet before and on the flop, the big bet on the turn and river, four bets per street.', holeCards: 2, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  short_deck: V({ id: 'short_deck', family: 'holdem', name: 'Short Deck (6+) Hold’em', summary: 'Hold’em with the twos to fives removed. A flush beats a full house and A-6-7-8-9 is the lowest straight.', holeCards: 2, holeUse: 'any', deck: 'short36', betting: 'no_limit', board: 'community5', ranking: 'short_deck', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  pineapple: V({ id: 'pineapple', family: 'holdem', name: 'Pineapple', summary: 'Three hole cards, one discarded before the flop.', holeCards: 3, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: false }),
  crazy_pineapple: V({ id: 'crazy_pineapple', family: 'holdem', name: 'Crazy Pineapple', summary: 'Three hole cards, one discarded after the flop.', holeCards: 3, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: false }),

  plo4: V({ id: 'plo4', family: 'omaha', name: 'Pot-Limit Omaha', summary: 'Four hole cards; a hand uses exactly two of them with three from the board. Pot-limit betting.', holeCards: 4, holeUse: 'exactly2', deck: 'standard52', betting: 'pot_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  plo5: V({ id: 'plo5', family: 'omaha', name: 'Pot-Limit Omaha 5', summary: 'Five hole cards, exactly two of them count. Pot-limit betting.', holeCards: 5, holeUse: 'exactly2', deck: 'standard52', betting: 'pot_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  plo6: V({ id: 'plo6', family: 'omaha', name: 'Pot-Limit Omaha 6', summary: 'Six hole cards, exactly two of them count. Pot-limit betting; seven players at most.', holeCards: 6, holeUse: 'exactly2', deck: 'standard52', betting: 'pot_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 7, implemented: true }),
  plo8: V({ id: 'plo8', family: 'omaha', name: 'Omaha Hi/Lo (8 or better)', summary: 'Pot-Limit Omaha where the pot is split between the best high hand and the best qualifying low (eight or better).', holeCards: 4, holeUse: 'exactly2', deck: 'standard52', betting: 'pot_limit', board: 'community5', ranking: 'standard', hiLo: true, minPlayers: 2, maxPlayers: 9, implemented: true }),
  flo: V({ id: 'flo', family: 'omaha', name: 'Fixed-Limit Omaha', summary: 'Omaha with fixed bet sizes.', holeCards: 4, holeUse: 'exactly2', deck: 'standard52', betting: 'fixed_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: true }),
  flo8: V({ id: 'flo8', family: 'omaha', name: 'Fixed-Limit Omaha Hi/Lo', summary: 'Omaha Hi/Lo with fixed bet sizes.', holeCards: 4, holeUse: 'exactly2', deck: 'standard52', betting: 'fixed_limit', board: 'community5', ranking: 'standard', hiLo: true, minPlayers: 2, maxPlayers: 9, implemented: true }),

  stud7: V({ id: 'stud7', family: 'stud', name: 'Seven-Card Stud', summary: 'No community cards; seven cards each, three face down. Fixed-limit.', holeCards: 7, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 8, implemented: false }),
  stud8: V({ id: 'stud8', family: 'stud', name: 'Seven-Card Stud Hi/Lo', summary: 'Seven-Card Stud with a split pot, eight or better.', holeCards: 7, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'none', ranking: 'standard', hiLo: true, minPlayers: 2, maxPlayers: 8, implemented: false }),
  razz: V({ id: 'razz', family: 'stud', name: 'Razz', summary: 'Seven-Card Stud for the lowest hand.', holeCards: 7, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 8, implemented: false }),
  stud5: V({ id: 'stud5', family: 'stud', name: 'Five-Card Stud', summary: 'Five cards each, one face down.', holeCards: 5, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 10, implemented: false }),

  draw5: V({ id: 'draw5', family: 'draw', name: 'Five-Card Draw', summary: 'Five cards, one draw.', holeCards: 5, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 6, implemented: false }),
  triple_draw_27: V({ id: 'triple_draw_27', family: 'draw', name: '2-7 Triple Draw', summary: 'Three draws for the lowest hand, aces high, straights and flushes count against you.', holeCards: 5, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 6, implemented: false }),
  single_draw_27: V({ id: 'single_draw_27', family: 'draw', name: '2-7 Single Draw', summary: 'One draw for the lowest hand. No-limit.', holeCards: 5, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 6, implemented: false }),
  badugi: V({ id: 'badugi', family: 'draw', name: 'Badugi', summary: 'Four cards, three draws, lowest four-card hand of different suits and ranks.', holeCards: 4, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 6, implemented: false }),

  ofc: V({ id: 'ofc', family: 'chinese', name: 'Open Face Chinese Poker', summary: 'Thirteen cards set into three rows, scored by row against each opponent.', holeCards: 13, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 4, implemented: false }),
  ofc_pineapple: V({ id: 'ofc_pineapple', family: 'chinese', name: 'OFC Pineapple', summary: 'Open Face Chinese with three cards dealt per turn, one discarded.', holeCards: 13, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'none', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 3, implemented: false }),

  horse: V({ id: 'horse', family: 'mixed', name: 'H.O.R.S.E.', summary: 'Rotates Hold’em, Omaha Hi/Lo, Razz, Stud and Stud Hi/Lo, all fixed-limit.', holeCards: 2, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 8, implemented: false }),
  eight_game: V({ id: 'eight_game', family: 'mixed', name: '8-Game Mix', summary: 'Eight games in rotation, including no-limit and pot-limit rounds.', holeCards: 2, holeUse: 'any', deck: 'standard52', betting: 'fixed_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 6, implemented: false }),
  custom_mix: V({ id: 'custom_mix', family: 'mixed', name: 'Custom rotation', summary: 'A club-defined rotation of implemented games.', holeCards: 2, holeUse: 'any', deck: 'standard52', betting: 'no_limit', board: 'community5', ranking: 'standard', hiLo: false, minPlayers: 2, maxPlayers: 9, implemented: false }),
};

export const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[];
export const FAMILIES: readonly VariantFamily[] = ['holdem', 'omaha', 'stud', 'draw', 'chinese', 'mixed'];

/**
 * Optional rule modifiers a club may switch on for a tournament. They are catalogued
 * here so the wizard can list them honestly; none is implemented in the engine yet.
 */
export type RuleModifier = 'all_in_or_fold' | 'double_board' | 'bomb_pot' | 'double_board_bomb_pot' | 'run_it_twice';
export const RULE_MODIFIERS: Record<RuleModifier, { name: string; implemented: boolean }> = {
  all_in_or_fold: { name: 'All-In or Fold', implemented: false },
  double_board: { name: 'Double Board', implemented: false },
  bomb_pot: { name: 'Bomb Pot', implemented: false },
  double_board_bomb_pot: { name: 'Double Board Bomb Pot', implemented: false },
  run_it_twice: { name: 'Run It Twice', implemented: false },
};

export const DEFAULT_VARIANT: VariantId = 'nlhe';

export function variantOf(id: VariantId | undefined | null): VariantRules {
  return VARIANTS[id ?? DEFAULT_VARIANT] ?? VARIANTS.nlhe;
}

export const isPlayable = (id: VariantId | undefined | null): boolean => variantOf(id).implemented;

/** Cards needed to deal a full hand at a table of `players`. */
export function cardsNeeded(rules: VariantRules, players: number): number {
  return rules.holeCards * players + (rules.board === 'community5' ? 5 : 0);
}

export const deckSize = (deck: DeckKind): number => (deck === 'short36' ? 36 : 52);

/** The largest table the deck allows for this variant (never more than nine seats). */
export function maxTableSize(rules: VariantRules): number {
  let n = rules.maxPlayers;
  while (n > 2 && cardsNeeded(rules, n) > deckSize(rules.deck)) n--;
  return Math.min(9, n);
}
