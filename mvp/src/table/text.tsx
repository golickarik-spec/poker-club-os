import type { ReactNode } from 'react';
import { chips } from '../app/format.ts';
import type { T } from '../app/hooks.ts';
import { RANK_CHARS } from '../engine/cards.ts';
import { describeScore, scoreCategory, type RankingKind } from '../engine/evaluator.ts';
import type { HandEvent } from '../engine/holdem.ts';
import type { SeatLabel } from '../engine/view.ts';
import { CardText } from './Card.tsx';
import type { StageLabels } from './TableStage.tsx';

const rankChar = (r: number): string => (RANK_CHARS[r] === 'T' ? '10' : RANK_CHARS[r]!);
const slot = (score: number, i: number): number => (score >> (16 - 4 * i)) & 0xf;

/** A hand's name in the reader's language. English uses full wording; other languages use the category plus the key ranks. */
export function handName(t: T, score: number, ranking: RankingKind = 'standard'): string {
  if (t.lang === 'en') return describeScore(score, ranking);
  const category = scoreCategory(score, ranking);
  const a = rankChar(slot(score, 0));
  const b = rankChar(slot(score, 1));
  const name = t(`hand.cat.${category}`);
  if (category === 2 || category === 6) return `${name} ${a}/${b}`;
  return `${name} ${a}`;
}

export function actionLabel(t: T, label: SeatLabel, compact = false): string {
  const amount = chips(label.to, compact);
  if (label.allIn && (label.type === 'call' || label.type === 'bet' || label.type === 'raise')) return `${t('table.act.allin')} ${chips(label.to, compact)}`;
  switch (label.type) {
    case 'fold':
      return t('table.act.fold');
    case 'check':
      return t('table.act.check');
    case 'call':
      return `${t('table.act.call')} ${chips(label.amount, compact)}`;
    case 'bet':
      return `${t('table.act.bet')} ${amount}`;
    case 'raise':
      return `${t('table.act.raise_to')} ${amount}`;
    case 'sb':
      return `${t('table.act.sb')} ${chips(label.amount, compact)}`;
    case 'bb':
      return `${t('table.act.bb')} ${chips(label.amount, compact)}`;
    case 'ante':
      return `${t('table.act.ante')} ${chips(label.amount, compact)}`;
  }
}

export function stageLabels(t: T, tableName: string, compact: boolean): StageLabels {
  return {
    bot: t('common.bot'),
    pot: t('table.pot'),
    mainPot: t('table.main_pot'),
    sidePot: t('table.side_pot'),
    openSeat: t('table.open_seat'),
    you: t('table.you'),
    away: t('table.sitting_out'),
    allIn: t('table.act.allin'),
    action: (label) => actionLabel(t, label, compact),
    tableName,
  };
}

export interface LogLine {
  id: number;
  kind: 'hand' | 'street' | 'action' | 'result' | 'info';
  node: ReactNode;
}

/** Turn an engine event into a line for the hand log. Returns null for events that are not worth a line. */
export function logLine(t: T, e: HandEvent, nameOf: (seat: number) => string, isYou: (seat: number) => boolean = () => false): Omit<LogLine, 'id'> | null {
  // "You call" but "Dana calls": the viewer's own lines use their own verb forms.
  const verb = (seat: number, key: string): string => t(isYou(seat) ? `table.log.you.${key}` : `table.log.${key}`);
  switch (e.t) {
    case 'start':
      return {
        kind: 'hand',
        node: (
          <>
            {t('table.log.hand', { n: e.handNo })} · <span dir="ltr">{chips(e.blinds.sb, true)}/{chips(e.blinds.bb, true)}</span>
          </>
        ),
      };
    case 'action': {
      const who = <strong className="font-medium text-ink">{nameOf(e.seat)}</strong>;
      const auto = e.auto ? ` (${t('table.log.auto')})` : '';
      if (e.type === 'fold') return { kind: 'action', node: <>{who} {verb(e.seat, 'folds')}{auto}</> };
      if (e.type === 'check') return { kind: 'action', node: <>{who} {verb(e.seat, 'checks')}{auto}</> };
      if (e.type === 'call') return { kind: 'action', node: <>{who} {verb(e.seat, 'calls')} {chips(e.amount)}{e.allIn ? ` · ${t('table.act.allin')}` : ''}</> };
      if (e.type === 'bet') return { kind: 'action', node: <>{who} {verb(e.seat, 'bets')} {chips(e.to)}{e.allIn ? ` · ${t('table.act.allin')}` : ''}</> };
      return { kind: 'action', node: <>{who} {verb(e.seat, 'raises_to')} {chips(e.to)}{e.allIn ? ` · ${t('table.act.allin')}` : ''}</> };
    }
    case 'street':
      return {
        kind: 'street',
        node: (
          <>
            {t(`table.street.${e.street}`)}{' '}
            <span className="inline-flex gap-1.5" dir="ltr">
              {e.cards.map((c) => (
                <CardText key={c} card={c} />
              ))}
            </span>
          </>
        ),
      };
    case 'show':
      return {
        kind: 'info',
        node: (
          <>
            <strong className="font-medium text-ink">{nameOf(e.seat)}</strong> {verb(e.seat, 'shows')}{' '}
            <span className="inline-flex gap-1.5" dir="ltr">
              {e.cards.map((c) => (
                <CardText key={c} card={c} />
              ))}
            </span>
          </>
        ),
      };
    case 'refund':
      return { kind: 'info', node: <>{isYou(e.seat) ? t('table.log.refund_you', { amount: chips(e.amount) }) : t('table.log.refund', { amount: chips(e.amount), name: nameOf(e.seat) })}</> };
    case 'award':
      return {
        kind: 'result',
        node: (
          <>
            {e.winners.map((w, i) => (
              <span key={w.seat}>
                {i > 0 && ', '}
                <strong className="font-medium text-gold">{nameOf(w.seat)}</strong> {verb(w.seat, 'wins')} {chips(w.amount)}
              </span>
            ))}
          </>
        ),
      };
    default:
      return null;
  }
}

export function betStep(bb: number): number {
  if (bb >= 8000) return 1000;
  if (bb >= 2000) return 500;
  if (bb >= 400) return 100;
  if (bb >= 100) return 25;
  if (bb >= 20) return 5;
  return 1;
}
