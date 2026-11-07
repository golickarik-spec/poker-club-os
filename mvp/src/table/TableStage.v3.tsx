/**
 * v0.3 table stage. Same geometry, seating, bet spots, chip flights and showdown logic
 * as the v2 stage (kept in TableStage.tsx); what differs is the cloth: a padded rail
 * with stitching, felt grain under a spotlight, dark-glass name plates with a timer
 * ring around the avatar, and a configurable logo behind the board.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bigBlinds, chips } from '../app/format.ts';
import { useElementSize } from '../app/hooks.ts';
import type { Card } from '../engine/cards.ts';
import type { HandEvent } from '../engine/holdem.ts';
import type { SeatLabel, SeatView, TableView } from '../engine/view.ts';
import type { TurnInfo } from '../platform/runtime.ts';
import type { DeckTheme, TableThemeId } from '../platform/types.ts';
import { BotTag, cx } from '../ui/core.tsx';
import { Avatar } from '../ui/identity.tsx';
import { CardBack, CardSlot, PlayingCard } from './Card.tsx';
import { ChipStack } from './Chips.tsx';
import { seatSlots, slotOf, towards, type Pt } from './layout.ts';

export interface Person {
  name: string;
  hue: number;
  isBot: boolean;
}

export interface StageLabels {
  bot: string;
  pot: string;
  mainPot: string;
  sidePot: string;
  openSeat: string;
  you: string;
  away: string;
  allIn: string;
  action: (label: SeatLabel) => string;
  tableName: string;
}

export interface TableStageProps {
  view: TableView;
  /** The viewer's seat (drawn at the bottom, cards face up), or null when observing. */
  heroSeat: number | null;
  person: (playerId: string) => Person;
  turn: TurnInfo | null;
  theme: TableThemeId | 'custom';
  /** Inline colour variables for a custom scheme (see platform/color.ts tableVars). */
  themeVars?: Record<string, string>;
  deck: DeckTheme;
  /** Show stacks in big blinds instead of chips. */
  showBigBlinds: boolean;
  lastEvent: HandEvent | null;
  eventCount: number;
  /** Win probability per seat while hands are tabled before the river. */
  equities?: Record<number, number> | null;
  heroHandName?: string | null;
  heroAway?: boolean;
  watermark?: ReactNode;
  centreNotice?: ReactNode;
  labels: StageLabels;
  motion: boolean;
  /** Presentation-only mode for previews: no viewer emphasis. */
  preview?: boolean;
  /** Opacity of the watermark on the felt (0–1). The caller clamps it to the safe range. */
  logoOpacity?: number;
  /** Size multiplier of the watermark. */
  logoScale?: number;
}

interface Flight {
  id: number;
  from: Pt;
  to: Pt;
  amount: number;
}

let flightSeq = 0;

export function TableStage(props: TableStageProps) {
  const { view, heroSeat, person, turn, labels, motion } = props;
  const [ref, size] = useElementSize<HTMLDivElement>();
  const W = size.width;
  const H = size.height;
  const small = W < 620;
  const portrait = W > 0 && W / H < 0.92;

  const g = useMemo(() => {
    const roomy = !small && W >= 900 && H >= 560;
    const plateW = small ? 82 : roomy ? 158 : 138;
    const plateH = small ? 40 : roomy ? 50 : 46;
    const heroPlateW = small ? 104 : roomy ? 172 : 152;
    const cardW = small ? 25 : roomy ? 38 : 33;
    const heroCardW = props.preview ? cardW : small ? (portrait ? 52 : 44) : roomy ? 76 : 62;
    const boardCardW = small ? Math.min(46, Math.max(34, (W - 150) / 5.6)) : Math.min(roomy ? 80 : 64, Math.max(46, W / 14));
    const padX = plateW / 2 - (small ? 4 : 8);
    // Room above the top seats for cards turned face up at showdown (drawn 1.28× larger).
    const padTop = plateH / 2 + cardW * 1.4 * 1.28 - 4;
    const padBottom = plateH / 2 + (small ? 16 : 20);
    const rail = { x: padX, y: padTop, w: Math.max(40, W - padX * 2), h: Math.max(40, H - padTop - padBottom) };
    const centre: Pt = { x: rail.x + rail.w / 2, y: rail.y + rail.h / 2 };
    const railWidth = small ? 11 : 18;
    const slots = seatSlots(view.maxSeats, centre, rail.w / 2 - 3, rail.h / 2 - 3);
    return { plateW, plateH, heroPlateW, cardW, heroCardW, boardCardW, rail, centre, railWidth, slots, roomy };
  }, [W, H, small, portrait, view.maxSeats, props.preview]);

  const drawSeat = heroSeat ?? 0;
  const posOf = (seat: number): Pt => g.slots[slotOf(seat, drawSeat, view.maxSeats)]!;

  /** Where a seat's bet sits on the felt: inwards from the plate, clear of the cards. */
  const betSpot = (seat: number): Pt => {
    const p = posOf(seat);
    const dx = g.centre.x - p.x;
    const dy = g.centre.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const isHero = heroSeat !== null && seat === heroSeat && !props.preview;
    const cardH = (isHero ? g.heroCardW : g.cardW) * 1.4;
    // Leave the seat's own footprint first: the plate, the cards above it and the action pill below it.
    const ux = dx / len;
    const uy = dy / len;
    const halfW = (isHero ? g.heroPlateW : g.plateW) / 2;
    const above = g.plateH / 2 + cardH * 0.95;
    const below = g.plateH / 2 + (small ? 14 : 18);
    const exitX = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
    const exitY = Math.abs(uy) > 1e-6 ? (uy < 0 ? above : below) / Math.abs(uy) : Infinity;
    const d = Math.min(len * 0.72, Math.min(exitX, exitY) + (small ? 14 : 22) + (isHero ? 6 : 0));
    return { x: p.x + ux * d, y: p.y + uy * d };
  };

  const boardY = g.centre.y - (portrait ? g.boardCardW * 0.5 : g.boardCardW * 0.25);
  const potPos: Pt = { x: g.centre.x, y: boardY - g.boardCardW * 0.7 - (small ? 20 : 26) };

  // ----- chip flights (bets to pot, pot to winner) -----
  const [flights, setFlights] = useState<Flight[]>([]);
  const previous = useRef<TableView>(view);
  const lastCount = useRef(props.eventCount);
  const flightTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = flightTimers.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);
  useEffect(() => {
    const prev = previous.current;
    previous.current = view;
    if (props.eventCount === lastCount.current) return;
    lastCount.current = props.eventCount;
    const e = props.lastEvent;
    if (!e || !motion || W === 0) return;
    const created: Flight[] = [];
    if (e.t === 'collect') {
      for (const s of prev.seats) if (s && s.bet > 0) created.push({ id: ++flightSeq, from: betSpot(s.seat), to: potPos, amount: s.bet });
    } else if (e.t === 'award') {
      for (const s of prev.seats) if (s && s.bet > 0) created.push({ id: ++flightSeq, from: betSpot(s.seat), to: potPos, amount: s.bet });
      for (const w of e.winners) created.push({ id: ++flightSeq, from: potPos, to: posOf(w.seat), amount: w.amount });
    } else if (e.t === 'refund') {
      created.push({ id: ++flightSeq, from: betSpot(e.seat), to: posOf(e.seat), amount: e.amount });
    }
    if (created.length === 0) return;
    setFlights((f) => [...f, ...created]);
    const ids = new Set(created.map((c) => c.id));
    const timer = setTimeout(() => {
      flightTimers.current.delete(timer);
      setFlights((f) => f.filter((x) => !ids.has(x.id)));
    }, 620);
    flightTimers.current.add(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.eventCount]);

  // Cards that make up the winning hand(s), for highlighting at showdown.
  const winningCards = useMemo(() => {
    const set = new Set<Card>();
    if (!view.showdown) return set;
    for (const seat of view.winners) {
      const shown = view.seats[seat]?.shown;
      if (shown) for (const c of shown.best) set.add(c);
    }
    return set;
  }, [view.showdown, view.winners, view.seats]);
  const showdownDone = view.showdown && view.winners.length > 0;

  const bb = view.blinds?.bb ?? 0;
  const stackText = (stack: number): string => (props.showBigBlinds && bb > 0 ? `${bigBlinds(stack, bb)} BB` : chips(stack, small));

  const activePots = view.pots.filter((p) => p.amount > 0);

  return (
    <div ref={ref} className={cx('relative size-full select-none', `felt-${props.theme}`, props.deck === 'four_color' && 'deck-four')} style={props.themeVars} dir="ltr">
      {W > 0 && (
        <>
          {/* Rail and felt */}
          <div className="pc3-rail absolute rounded-[9999px]" style={{ left: g.rail.x, top: g.rail.y, width: g.rail.w, height: g.rail.h }}>
            <div className="pc3-felt absolute rounded-[9999px]" style={{ inset: g.railWidth }}>
              <div className="pc3-felt-line absolute rounded-[9999px]" style={{ inset: small ? '9%' : '11%' }} />
            </div>
          </div>

          {/* Watermark: the club mark in the middle of the felt, under the board */}
          {props.watermark && (
            <div
              className="pointer-events-none absolute z-[1] flex origin-top flex-col items-center gap-1.5 text-white"
              style={{ left: g.centre.x, top: boardY + g.boardCardW * 0.7 + (small ? 8 : 12), opacity: props.logoOpacity ?? 0.16, transform: `translate(-50%, 0) scale(${props.logoScale ?? 1})` }}
              data-testid="table-watermark"
            >
              {props.watermark}
              <span className="text-[10px] font-medium tracking-[0.14em] uppercase">{labels.tableName}</span>
            </div>
          )}

          {/* Pot */}
          {view.potTotal > 0 && (
            <div className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: potPos.x, top: potPos.y }}>
              <div className="pc3-plate flex items-center gap-2 rounded-full py-1 ps-2 pe-3">
                <ChipStack amount={view.potTotal} size={small ? 13 : 15} label={false} />
                <span className="text-[11.5px] text-white/60">{labels.pot}</span>
                <span className={cx('clock-digits font-bold text-white', small ? 'text-[14px]' : 'text-[17px]')} data-testid="pot-total">
                  {chips(view.potTotal)}
                </span>
              </div>
            </div>
          )}

          {/* Board */}
          <div
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center"
            style={{ left: g.centre.x, top: boardY, gap: Math.max(3, g.boardCardW * 0.09) }}
            aria-label="Community cards"
          >
            {[0, 1, 2, 3, 4].map((i) => {
              const card = view.board[i];
              if (card === undefined) return <CardSlot key={`slot-${i}`} width={g.boardCardW} />;
              return (
                <PlayingCard
                  key={`${view.handNo}-${card}`}
                  card={card}
                  width={g.boardCardW}
                  className={motion ? 'anim-card-flip' : undefined}
                  highlight={showdownDone && winningCards.has(card)}
                  dim={showdownDone && winningCards.size > 0 && !winningCards.has(card)}
                />
              );
            })}
          </div>

          {/* Side pots */}
          {activePots.length > 1 && (
            <div
              className="absolute z-10 flex -translate-x-1/2 flex-wrap justify-center gap-1.5"
              style={{ left: g.centre.x, top: boardY + g.boardCardW * 0.7 + 8, maxWidth: g.boardCardW * 6 }}
            >
              {activePots.map((p, i) => (
                <span key={i} className="pc3-plate rounded-full px-2 py-0.5 text-[10.5px] text-white/85 tabular-nums">
                  {i === 0 ? labels.mainPot : `${labels.sidePot} ${i}`} {chips(p.amount, true)}
                </span>
              ))}
            </div>
          )}

          {props.centreNotice && (
            <div className="absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: g.centre.x, top: g.centre.y + (small ? 6 : 0), maxWidth: g.rail.w * 0.78 }}>
              {props.centreNotice}
            </div>
          )}

          {/* Dealer button */}
          {view.button >= 0 && view.seats[view.button] && view.street !== 'idle' && (
            <DealerButton at={betSpot(view.button)} from={posOf(view.button)} centre={g.centre} small={small} clear={heroSeat !== null && view.button === heroSeat && !props.preview ? g.heroCardW * 0.94 + (small ? 14 : 18) : undefined} />
          )}

          {/* Bets */}
          {view.seats.map((s) => {
            if (!s || s.bet <= 0) return null;
            const at = betSpot(s.seat);
            const from = posOf(s.seat);
            return (
              <div
                key={`bet-${s.seat}-${s.bet}`}
                className={cx('absolute z-20 -translate-x-1/2 -translate-y-1/2', motion && 'anim-chip-in')}
                style={{ left: at.x, top: at.y, '--from-x': `${(from.x - at.x) * 0.7}px`, '--from-y': `${(from.y - at.y) * 0.7}px` }}
              >
                <ChipStack amount={s.bet} size={small ? 13 : 16} compact={small} />
              </div>
            );
          })}

          {/* Seats */}
          {view.seats.map((s, seat) => {
            const at = posOf(seat);
            if (!s) {
              return (
                <div
                  key={`empty-${seat}`}
                  className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-[10px] font-medium tracking-[0.04em] text-white/30 ring-1 ring-white/10 ring-inset"
                  style={{ left: at.x, top: at.y, width: small ? 52 : 84, height: small ? 24 : 28 }}
                >
                  {!small && labels.openSeat}
                </div>
              );
            }
            const isHero = heroSeat !== null && seat === heroSeat && !props.preview;
            return (
              <SeatPod
                key={`seat-${seat}-${s.playerId}`}
                seat={s}
                at={at}
                centre={g.centre}
                person={person(s.playerId)}
                isHero={isHero}
                isTurn={view.toAct === seat}
                turn={turn && turn.seat === seat ? turn : null}
                plateW={isHero ? g.heroPlateW : g.plateW}
                plateH={g.plateH}
                cardW={isHero ? g.heroCardW : g.cardW}
                small={small}
                roomy={g.roomy}
                stackText={stackText(s.stack)}
                labels={labels}
                handNo={view.handNo}
                motion={motion}
                winner={view.winners.includes(seat) && s.won > 0}
                showdownDone={showdownDone}
                winningCards={winningCards}
                equity={props.equities ? props.equities[seat] : undefined}
                handName={isHero ? props.heroHandName : undefined}
                holeCards={view.holeCards ?? 2}
                away={isHero && props.heroAway}
                idle={view.street === 'idle'}
              />
            );
          })}

          {/* Chip flights */}
          {flights.map((f) => (
            <div
              key={f.id}
              className="anim-fly pointer-events-none absolute z-40"
              style={{ left: f.from.x, top: f.from.y, '--dx': `${f.to.x - f.from.x}px`, '--dy': `${f.to.y - f.from.y}px` }}
            >
              <ChipStack amount={f.amount} size={small ? 13 : 16} label={false} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function DealerButton({ at, from, centre, small, clear }: { at: Pt; from: Pt; centre: Pt; small: boolean; clear?: number }) {
  // Sit beside the bet spot, offset along the table edge so chips never cover it.
  const dx = centre.x - from.x;
  const dy = centre.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // `clear` widens the offset for the viewer's own seat, whose large cards would otherwise cover the button.
  const off = clear ?? (small ? 30 : 40);
  const p = towards({ x: at.x + (-dy / len) * off, y: at.y + (dx / len) * off }, from, 0.18);
  return (
    <div
      className="display absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fffdf5,#e9e2cf_70%,#cfc5aa)] text-[#1a1d22] shadow-[0_2px_5px_rgb(0_0_0/0.65),0_0_0_1px_rgb(0_0_0/0.35),0_0_0_3px_rgb(255_255_255/0.08)_inset] transition-[left,top] duration-500"
      style={{ left: p.x, top: p.y, width: small ? 18 : 23, height: small ? 18 : 23, fontSize: small ? 10 : 12 }}
      title="Dealer button"
    >
      D
    </div>
  );
}

/** "Chloe Petrov" → "Chloe P." so names fit a seat plate. */
function shortName(name: string): string {
  if (name.length <= 13) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

function actionTone(label: SeatLabel): string {
  if (label.allIn) return 'bg-danger text-white';
  switch (label.type) {
    case 'fold':
      return 'bg-[#1b232c] text-white/55 ring-1 ring-white/10';
    case 'check':
      return 'bg-[#243a50] text-white ring-1 ring-white/10';
    case 'call':
      return 'bg-info/90 text-white';
    case 'bet':
    case 'raise':
      return 'bg-warning text-[#1a0d02]';
    default:
      return 'bg-[#1b232c] text-white/80 ring-1 ring-white/10';
  }
}

function SeatPod({
  seat,
  at,
  centre,
  person,
  isHero,
  isTurn,
  turn,
  plateW,
  plateH,
  cardW,
  small,
  roomy,
  stackText,
  labels,
  handNo,
  motion,
  winner,
  showdownDone,
  winningCards,
  equity,
  handName,
  away,
  holeCards,
  idle,
}: {
  seat: SeatView;
  at: Pt;
  centre: Pt;
  person: Person;
  isHero: boolean;
  isTurn: boolean;
  turn: TurnInfo | null;
  plateW: number;
  plateH: number;
  cardW: number;
  small: boolean;
  roomy: boolean;
  stackText: string;
  labels: StageLabels;
  handNo: number;
  motion: boolean;
  winner: boolean;
  showdownDone: boolean;
  winningCards: Set<Card>;
  equity?: number;
  handName?: string | null;
  away?: boolean;
  /** Cards per hand in this variant (backs drawn for hidden hands). */
  holeCards: number;
  /** No hand in progress: nobody is "out", so nobody is dimmed. */
  idle?: boolean;
}) {
  const n = seat.cards?.length ?? holeCards;
  // More than two cards: draw them smaller and fanned tighter so four-card Omaha hands fit the plate.
  const cardScale = n <= 2 ? 1 : n <= 4 ? 0.82 : 0.7;
  const out = !idle && (seat.folded || !seat.inHand);
  const faceUp = seat.cards !== null && seat.cards.length === 2;
  const showCards = seat.hasCards || (isHero && faceUp);
  const cardH = cardW * cardScale * 1.4;
  const overlap = (isHero ? cardW * (n <= 2 ? 0.12 : 0.42) : cardW * (n <= 2 ? 0.38 : 0.55)) * cardScale;
  const shownW = (!isHero && faceUp ? cardW * 1.28 : cardW) * cardScale;
  const drawW = cardW * cardScale;
  const label = winner ? null : seat.lastAction;

  return (
    <div className="absolute z-20" style={{ left: at.x, top: at.y, width: 0, height: 0 }} data-seat={seat.seat} data-testid={isHero ? 'hero-seat' : undefined}>
      {/* Hole cards, tucked behind the top edge of the name plate */}
      {showCards && (
        <div
          className={cx('absolute flex -translate-x-1/2 items-end transition-opacity duration-300', out && isHero && 'opacity-40', out && !isHero && 'opacity-0')}
          style={{ left: 0, bottom: plateH / 2 - (isHero ? 4 : 7), height: cardH * (shownW / drawW) }}
        >
          {Array.from({ length: n }, (_, i) => {
            const card = seat.cards?.[i];
            const style = {
              marginInlineStart: i > 0 ? -overlap * (shownW / drawW) : 0,
              transform: isHero ? undefined : `rotate(${(i - (n - 1) / 2) * (n <= 2 ? 10 : 6)}deg)`,
              '--from-x': `${(centre.x - at.x) * 0.8}px`,
              '--from-y': `${(centre.y - at.y) * 0.8}px`,
              animationDelay: `${i * 70}ms`,
            };
            if (card === undefined) {
              return <CardBack key={`${handNo}-b${i}`} width={drawW} className={motion ? 'anim-card-deal' : undefined} style={style} />;
            }
            return (
              <PlayingCard
                key={`${handNo}-${card}`}
                card={card}
                width={shownW}
                className={motion ? (isHero ? 'anim-card-deal' : 'anim-card-flip') : undefined}
                style={style}
                highlight={showdownDone && winner && winningCards.has(card)}
                dim={showdownDone && (!winner || !winningCards.has(card)) && winningCards.size > 0}
              />
            );
          })}
        </div>
      )}

      {/* Equity while hands are tabled */}
      {equity !== undefined && faceUp && !out && (
        <div
          className="absolute -translate-x-1/2 rounded-full bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums ring-1 ring-white/15"
          style={{ left: 0, bottom: plateH / 2 + cardH * (shownW / drawW) - 2 }}
        >
          {Math.round(equity * 100)}%
        </div>
      )}

      {/* Name plate */}
      <div
        className={cx(
          'pc3-plate absolute flex -translate-x-1/2 -translate-y-1/2 items-center overflow-hidden rounded-inner transition-[opacity,box-shadow] duration-300',
          isHero && 'pc3-plate-hero',
          small ? 'gap-0 px-1.5' : 'gap-2 px-2',
          isTurn && (motion ? 'anim-turn' : 'shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent)_70%,transparent),var(--shadow-plate)]'),
          winner && 'anim-win',
          out && !winner && 'opacity-50',
        )}
        style={{ left: 0, top: 0, width: plateW, height: plateH }}
      >
        {!small && (
          <span className="relative shrink-0">
            <Avatar user={person} size={roomy ? 34 : 30} />
            {turn && (
              <svg key={turn.startedAt} className="turn-ring pointer-events-none absolute -inset-[3px]" viewBox="0 0 40 40" aria-hidden>
                <circle cx="20" cy="20" r="18.5" fill="none" strokeWidth="2.5" stroke={turn.own ? 'var(--accent)' : 'rgb(255 255 255 / 0.55)'} strokeLinecap="round" pathLength={100} strokeDasharray={100} style={{ '--ring-length': 100, animation: `turn-ring ${turn.durationMs}ms linear both` }} />
              </svg>
            )}
          </span>
        )}
        <div className={cx('min-w-0 flex-1', small && 'text-center')}>
          <div className={cx('flex items-center gap-1', small && 'justify-center')}>
            <span className={cx('truncate font-medium text-white/70', small ? 'text-[10.5px]' : roomy ? 'text-[12.5px]' : 'text-[11.5px]')} title={person.name}>
              {isHero ? labels.you : small ? person.name : shortName(person.name)}
            </span>
            {person.isBot && !small && <BotTag label={labels.bot} />}
          </div>
          <div className={cx('flex items-center gap-1 leading-tight', small && 'justify-center')}>
            <span className={cx('display text-white', small ? 'text-[12.5px]' : roomy ? 'text-[16px]' : 'text-[14px]', seat.stack === 0 && seat.allIn && 'text-danger')} data-testid={isHero ? 'hero-stack' : undefined}>
              {seat.stack === 0 && seat.allIn ? labels.allIn : stackText}
            </span>
            {person.isBot && small && <BotTag label={labels.bot} className="h-3 px-0.5 text-[8px]" />}
          </div>
        </div>
        {/* Turn timer: a bar that drains along the bottom edge */}
        {turn && (
          <span
            key={turn.startedAt}
            className={cx('turn-bar absolute inset-x-0 bottom-0 h-[2px] origin-left', turn.own ? 'turn-bar-own' : 'bg-white/40')}
            style={{ animationDuration: `${turn.durationMs}ms` }}
            aria-hidden
          />
        )}
      </div>

      {/* Action / result label, hanging off the bottom edge of the plate */}
      <div className="absolute flex -translate-x-1/2 justify-center" style={{ left: 0, top: plateH / 2 - 7, width: plateW + 40 }}>
        {winner ? (
          <span className="animate-pop rounded-full bg-[linear-gradient(180deg,#e6c889,#c9a35c)] px-2 py-[3px] text-[11.5px] font-semibold whitespace-nowrap text-[#1c1505] tabular-nums shadow-[0_2px_8px_rgb(0_0_0/0.5),0_0_0_1px_rgb(0_0_0/0.3)]">
            +{chips(seat.won)}
            {seat.shown && !small ? ` · ${seat.shown.name}` : ''}
          </span>
        ) : away ? (
          <span className="rounded-full bg-[#2a333f] px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-white/70">{labels.away}</span>
        ) : label && label.amount + (label.type === 'fold' || label.type === 'check' ? 1 : 0) > 0 ? (
          <span key={`${handNo}-${label.type}-${label.to}`} className={cx('rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap shadow-md', motion && 'animate-pop', actionTone(label))}>
            {labels.action(label)}
          </span>
        ) : null}
      </div>

      {/* The viewer's current hand, in words */}
      {handName && showCards && !out && !winner && (
        <div className="absolute flex -translate-x-1/2 justify-center" style={{ left: 0, bottom: plateH / 2 + cardH + 2, width: plateW + 80 }}>
          <span className="rounded-full bg-black/65 px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-white/90 ring-1 ring-white/10" data-testid="hero-hand-name">
            {handName}
          </span>
        </div>
      )}
    </div>
  );
}
