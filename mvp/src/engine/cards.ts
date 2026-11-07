import { shuffleInPlace, type Rng } from './rng.ts';

/**
 * A card is an integer 0..51.
 *   rank = card >> 2   (0 = Two … 12 = Ace)
 *   suit = card & 3    (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades)
 */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;

export const cardRank = (card: Card): number => card >> 2;
export const cardSuit = (card: Card): number => card & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function cardToString(card: Card): string {
  return RANK_CHARS[cardRank(card)]! + SUIT_CHARS[cardSuit(card)]!;
}

export function parseCard(text: string): Card {
  const rank = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (text.length !== 2 || rank < 0 || suit < 0) throw new Error(`Invalid card "${text}"`);
  return makeCard(rank, suit);
}

/** Parse "As Kd 7h" into cards. */
export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function freshDeck(): Card[] {
  const deck: Card[] = new Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  return deck;
}

/** The 36-card short deck: sixes to aces (ranks 4..12). */
export function shortDeck(): Card[] {
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (cardRank(c) >= 4) deck.push(c);
  return deck;
}

export function deckFor(kind: 'standard52' | 'short36'): Card[] {
  return kind === 'short36' ? shortDeck() : freshDeck();
}

export function shuffledDeck(rng: Rng, kind: 'standard52' | 'short36' = 'standard52'): Card[] {
  return shuffleInPlace(deckFor(kind), rng);
}
