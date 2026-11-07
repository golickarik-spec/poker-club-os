import type { CSSProperties } from 'react';
import { cardRank, cardSuit, RANK_CHARS, SUIT_SYMBOLS, type Card } from '../engine/cards.ts';
import { cx } from '../ui/core.tsx';
import { GLYPH_PATHS } from '../ui/identity.tsx';

const SUIT_CLASS = ['suit-c', 'suit-d', 'suit-h', 'suit-s'] as const;
const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

export const rankText = (card: Card): string => {
  const r = RANK_CHARS[cardRank(card)]!;
  return r === 'T' ? '10' : r;
};
export const cardLabel = (card: Card): string => `${RANK_NAMES[cardRank(card)]} of ${SUIT_NAMES[cardSuit(card)]}`;
export const cardText = (card: Card): string => `${rankText(card)}${SUIT_SYMBOLS[cardSuit(card)]}`;

function Suit({ suit, className }: { suit: number; className?: string }) {
  if (suit === 0) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <circle cx="12" cy="7.300" r="4.400" />
        <circle cx="6.800" cy="13.700" r="4.400" />
        <circle cx="17.200" cy="13.700" r="4.400" />
        <path d="M11 12.500c0 5-.9 7.600-2.700 9.500h7.400c-1.800-1.900-2.700-4.500-2.700-9.500Z" />
      </svg>
    );
  }
  const path = suit === 1 ? GLYPH_PATHS.diamond : suit === 2 ? GLYPH_PATHS.heart : GLYPH_PATHS.spade;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  );
}

export interface CardProps {
  card: Card;
  /** Width in px; height follows the 5:7 ratio. */
  width: number;
  dim?: boolean;
  highlight?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PlayingCard({ card, width, dim, highlight, className, style }: CardProps) {
  const suit = cardSuit(card);
  const rank = rankText(card);
  return (
    <div
      className={cx('pc-card shrink-0 transition-[transform,filter,opacity] duration-300', SUIT_CLASS[suit], dim && 'opacity-45 saturate-50', highlight && '-translate-y-[10%] ring-2 ring-gold', className)}
      style={{ width, ...style }}
      role="img"
      aria-label={cardLabel(card)}
    >
      <span className="pc-card-rank" style={rank === '10' ? { fontSize: '38cqw', letterSpacing: '-0.09em', left: '6cqw' } : undefined}>
        {rank}
      </span>
      <Suit suit={suit} className="pc-card-suit-small" />
      <Suit suit={suit} className="pc-card-suit-big" />
    </div>
  );
}

export function CardBack({ width, className, style }: { width: number; className?: string; style?: CSSProperties }) {
  return <div className={cx('pc-card pc-card-back shrink-0', className)} style={{ width, ...style }} aria-hidden />;
}

export function CardSlot({ width, className }: { width: number; className?: string }) {
  return <div className={cx('shrink-0 rounded-[9%/6.500%] border border-white/8 bg-black/12', className)} style={{ width, aspectRatio: '5 / 7' }} aria-hidden />;
}

/** Inline card text with suit colour, for logs: "K♠". */
export function CardText({ card }: { card: Card }) {
  const suit = cardSuit(card);
  const colour = suit === 1 ? 'text-[#6aa5ff]' : suit === 2 ? 'text-[#ff7a8a]' : suit === 0 ? 'text-[#5fd08a]' : 'text-ink';
  return (
    <span className={cx('font-semibold tabular-nums', colour)} dir="ltr">
      {cardText(card)}
    </span>
  );
}
