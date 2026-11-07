import { useMemo, type ReactNode } from 'react';
import { LuCheck, LuChevronRight, LuCoffee, LuHourglass, LuPlay, LuUsers } from 'react-icons/lu';
import { act, runtime, session, toasts } from '../app/context.ts';
import { blindsLabel, chips, clock, dayOffset, durationLabel, timeOfDay, weekday, dateShort } from '../app/format.ts';
import { go, useNow, useRuntime, useT, type T } from '../app/hooks.ts';
import { occupiedSeats } from '../engine/holdem.ts';
import { entryAt, estimateDurationMinutes, levelNumberAt, type TournamentStructure } from '../engine/structure.ts';
import { activeTables, averageStack, currentBlinds, currentLevelNumber, lateRegistrationOpen, levelRemainingMs, remainingPlayers, type TournamentLive, type TTable } from '../engine/tournament.ts';
import { translate } from '../i18n/index.ts';
import { registeredCount, requestedCount, waitlistedCount } from '../platform/api.ts';
import { needsAccessCode, registrationState, type RegistrationState } from '../platform/selectors.ts';
import type { Club, DB, Registration, Tournament, TournamentStatus } from '../platform/types.ts';
import { Badge, Button, cx, Meter, type Tone } from '../ui/core.tsx';
import { accentStyle, bannerClass, ClubLogo, ClubName } from '../ui/identity.tsx';
import { seatSlots } from '../table/layout.ts';

// ----- live summary ------------------------------------------------------------------------

export interface LiveSummary {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  onBreak: boolean;
  /** Seconds left in the level or break. */
  remaining: number;
  left: number;
  entrants: number;
  average: number;
  tables: number;
  lateReg: boolean;
  status: TournamentLive['status'];
  finalTable: boolean;
  hands: number;
  speed: number;
  elapsedMin: number;
}

export function summarise(live: TournamentLive): LiveSummary {
  const blinds = currentBlinds(live);
  return {
    level: currentLevelNumber(live),
    sb: blinds.sb,
    bb: blinds.bb,
    ante: blinds.ante,
    onBreak: entryAt(live.structure, live.levelIdx).kind === 'break',
    remaining: Math.ceil(levelRemainingMs(live) / 1000),
    left: remainingPlayers(live),
    entrants: live.entrants,
    average: averageStack(live),
    tables: activeTables(live).length,
    lateReg: lateRegistrationOpen(live),
    status: live.status,
    finalTable: live.finalTable,
    hands: live.handsPlayed,
    speed: live.speed,
    elapsedMin: Math.floor(live.clockMs / 60_000),
  };
}

/** Live figures for a running tournament, or null when it is not running. Updates about once a second. */
export function useLiveSummary(tournamentId: string): LiveSummary | null {
  return useRuntime(() => {
    const live = runtime.getLive(tournamentId);
    return live ? summarise(live) : null;
  });
}

/** Coarser version for lists: only changes when something a card shows changes. */
export function useLiveBrief(tournamentId: string): { level: number; left: number; entrants: number; lateReg: boolean; onBreak: boolean; finalTable: boolean } | null {
  return useRuntime(() => {
    const live = runtime.getLive(tournamentId);
    if (!live) return null;
    return {
      level: currentLevelNumber(live),
      left: remainingPlayers(live),
      entrants: live.entrants,
      lateReg: lateRegistrationOpen(live),
      onBreak: entryAt(live.structure, live.levelIdx).kind === 'break',
      finalTable: live.finalTable,
    };
  });
}

// ----- status ---------------------------------------------------------------------------

const STATUS_TONE: Record<TournamentStatus, Tone> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  REGISTRATION_OPEN: 'success',
  REGISTRATION_CLOSED: 'neutral',
  SEATING: 'warning',
  RUNNING: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

export function StatusPill({ status, lateReg }: { status: TournamentStatus; lateReg?: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center justify-end gap-1">
      <Badge tone={STATUS_TONE[status]} dot={status === 'RUNNING' || status === 'REGISTRATION_OPEN' || status === 'SEATING' || status === 'PAUSED'} pulse={status === 'RUNNING' || status === 'SEATING'}>
        {t(`status.${status}`)}
      </Badge>
      {lateReg && status === 'RUNNING' && <Badge tone="warning">{t('status.late_reg')}</Badge>}
    </span>
  );
}

/** "Turbo", or "Pot-Limit Omaha · Turbo" when the game is not Hold'em (the default everyone assumes). */
export const presetLabel = (t: T, tournament: Pick<Tournament, 'preset' | 'format'> & { game?: Tournament['game'] }): string => {
  const preset = tournament.preset === 'custom' ? t(tournament.format === 'sng' ? 'preset.sng' : 'preset.custom') : t(`preset.${tournament.preset}`);
  return tournament.game && tournament.game !== 'nlhe' ? `${t(`variant.${tournament.game}`)} · ${preset}` : preset;
};

/** Short game label for headers: "NLHE", "PLO", "PLO5", "6+", "O8", … */
export const gameShort = (game: Tournament['game'] | undefined): string =>
  ({ nlhe: 'NLHE', plhe: 'PLHE', flhe: 'FLHE', short_deck: '6+', plo4: 'PLO', plo5: 'PLO5', plo6: 'PLO6', plo8: 'PLO8', flo: 'FLO', flo8: 'FLO8' } as Record<string, string>)[game ?? 'nlhe'] ?? (game ?? 'NLHE').toUpperCase();

export function structureSummary(t: T, s: TournamentStructure): string {
  const first = s.entries.find((e) => e.kind === 'level');
  const minutes = first ? first.minutes : 0;
  return t('tour.summary', { stack: chips(s.startingStack), minutes, seats: s.tableSize });
}

export function estimateLabel(t: T, tournament: Tournament): string | null {
  const players = Math.max(registeredCount(tournament), tournament.format === 'sng' ? tournament.maxPlayers : Math.round(tournament.maxPlayers * 0.5));
  const minutes = estimateDurationMinutes(tournament.structure, players);
  return minutes ? `~${durationLabel(minutes, t.lang)}` : null;
}

/** "Today", "Tomorrow", or a short weekday + date. */
export function dayLabel(t: T, ts: number, now: number): string {
  const offset = dayOffset(ts, now);
  if (offset === 0) return t('time.today');
  if (offset === 1) return t('time.tomorrow');
  if (offset === -1) return t('time.yesterday');
  return `${weekday(ts, t.lang)} ${dateShort(ts, t.lang)}`;
}

// ----- registration actions ----------------------------------------------------------------

/** Ask for a place. Returns what the person got (a seat, a request, a place on the waiting list), or null if it was refused. */
export function doRegister(tournament: Tournament, userId: string, code?: string): Registration['status'] | null {
  const result = act(() => runtime.register(userId, tournament.id, code));
  if (!result) return null;
  if (result.status === 'requested') toasts.push('success', translate(session.state.lang, 'lobby.request_sent'));
  if (result.status === 'waitlisted') toasts.push('info', translate(session.state.lang, 'lobby.waitlist_joined'));
  return result.status;
}

/** One short phrase for how people get into a tournament, or null when any approved member simply registers. */
export function accessLabel(t: T, tournament: Pick<Tournament, 'visibility' | 'access' | 'accessCode'>): string | null {
  const parts: string[] = [];
  if (tournament.visibility === 'public') parts.push(t('tour.access.public'));
  if (tournament.access === 'approval') parts.push(t('tour.access.approval'));
  if (tournament.access === 'invite') parts.push(t('tour.access.invite'));
  if (tournament.accessCode !== null) parts.push(t('tour.access.code'));
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ----- card ---------------------------------------------------------------------------------

function TimeBlock({ tournament, now, brief }: { tournament: Tournament; now: number; brief: ReturnType<typeof useLiveBrief> }) {
  const t = useT();
  const running = tournament.status === 'RUNNING' || tournament.status === 'PAUSED' || tournament.status === 'SEATING';
  let top: ReactNode;
  let bottom: ReactNode;
  if (running) {
    top = (
      <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-white">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-success" aria-hidden />
        {t('time.live')}
      </span>
    );
    bottom = brief ? (brief.onBreak ? t('lobby.on_break') : t('tour.level_n', { n: brief.level })) : t(`status.${tournament.status}`);
  } else if (tournament.startMode === 'when_full' && tournament.status !== 'COMPLETED' && tournament.status !== 'CANCELLED') {
    top = <span className="text-[15px] font-semibold text-white">{t('tour.sng_short')}</span>;
    bottom = t('tour.when_full');
  } else {
    const untilMs = tournament.startAt - now;
    const soon = untilMs > 0 && untilMs < 60 * 60_000 && (tournament.status === 'REGISTRATION_OPEN' || tournament.status === 'REGISTRATION_CLOSED');
    top = (
      <span className="clock-digits text-[26px] leading-none font-semibold text-white" dir="ltr">
        {soon ? clock(untilMs) : timeOfDay(tournament.startAt, t.lang)}
      </span>
    );
    bottom = soon ? t('time.starts_in') : dayLabel(t, tournament.startAt, now);
  }
  return (
    <div className={cx('flex w-[84px] shrink-0 flex-col items-center justify-center gap-1 self-stretch rounded-inner px-1 py-2 text-center', bannerClass(tournament.banner))}>
      {top}
      <span className="text-[11.5px] leading-tight text-white/70">{bottom}</span>
    </div>
  );
}

export function TournamentCard({ db, tournament, userId, showClub = true }: { db: DB; tournament: Tournament; userId: string; showClub?: boolean }) {
  const t = useT();
  const now = useNow(1000);
  const brief = useLiveBrief(tournament.id);
  const club = db.clubs[tournament.clubId]!;
  const state = registrationState(db, tournament, userId, brief?.lateReg ?? false);
  const count = registeredCount(tournament);
  const running = tournament.status === 'RUNNING' || tournament.status === 'PAUSED';
  const live = runtime.getLive(tournament.id);
  const seated = live?.players[userId]?.status === 'active';
  const estimate = estimateLabel(t, tournament);
  const access = accessLabel(t, tournament);
  const open = () => go('tournament', { id: tournament.id });

  return (
    <article
      className="group relative flex min-w-0 gap-3 rounded-panel border border-line bg-surface p-2.5 transition-colors hover:border-line-strong"
      style={accentStyle(club.branding.accent)}
      data-testid={`tournament-card-${tournament.id}`}
    >
      <TimeBlock tournament={tournament} now={now} brief={brief} />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-ink">
              <button type="button" onClick={open} className="text-start after:absolute after:inset-0 after:rounded-panel hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent">
                {tournament.name}
              </button>
            </h3>
            <StatusPill status={tournament.status} lateReg={brief?.lateReg} />
          </div>
          {showClub && (
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <ClubLogo branding={club.branding} name={club.name} size={16} />
              <ClubName club={club} className="truncate" />
            </p>
          )}
          <p className="mt-1 truncate text-[12.5px] text-ink-3">
            {access ? `${access} · ` : ''}
            {presetLabel(t, tournament)} · {structureSummary(t, tournament.structure)}
            {estimate && !running ? ` · ${estimate}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[140px]">
            <div className="flex items-baseline gap-1.5 text-[12.5px] text-ink-2 tabular-nums">
              <LuUsers className="size-3.5 shrink-0 translate-y-[2px] text-ink-3" aria-hidden />
              {running && brief ? (
                <span>
                  <span dir="ltr"><span className="font-medium text-ink">{brief.left}</span> / {brief.entrants}</span> {t('tour.left')}
                </span>
              ) : (
                <span dir="ltr">
                  <span className="font-medium text-ink">{count}</span> / {tournament.maxPlayers}
                </span>
              )}
              <span className="ms-auto shrink-0 text-ink-3">{tournament.entryPoints > 0 ? t('common.points_n', { n: chips(tournament.entryPoints) }) : t('common.free')}</span>
            </div>
            <Meter value={running && brief ? brief.left : count} max={running && brief ? brief.entrants : tournament.maxPlayers} className="mt-1.5" label={t('tour.players')} />
          </div>
          <div className="relative z-10 shrink-0">
            <CardAction t={t} state={state} seated={!!seated} tournament={tournament} userId={userId} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function CardAction({ t, state, seated, tournament, userId }: { t: T; state: RegistrationState; seated: boolean; tournament: Tournament; userId: string }) {
  if (seated && (tournament.status === 'RUNNING' || tournament.status === 'PAUSED')) {
    return (
      <Button size="sm" variant="primary" icon={<LuPlay className="size-3.5" aria-hidden />} onClick={() => go('table', { id: tournament.id })} data-testid="card-open-table">
        {t('tour.open_table')}
      </Button>
    );
  }
  const details = (
    <Button size="sm" variant="ghost" trailing={<LuChevronRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go(state === 'finished' && tournament.status === 'COMPLETED' ? 'results' : 'tournament', { id: tournament.id })}>
      {state === 'finished' && tournament.status === 'COMPLETED' ? t('tour.results') : t('tour.details')}
    </Button>
  );
  // A tournament with an access code is entered from its lobby, where the code is asked for.
  const direct = !needsAccessCode(tournament, userId);
  switch (state) {
    case 'can_register':
    case 'can_late_register':
    case 'invited':
      return direct ? (
        <Button size="sm" variant="primary" onClick={() => doRegister(tournament, userId)} data-testid="card-register">
          {state === 'can_late_register' ? t('tour.late_register') : state === 'invited' ? t('tour.take_seat') : t('tour.register')}
        </Button>
      ) : (
        details
      );
    case 'can_request':
    case 'can_late_request':
      return direct ? (
        <Button size="sm" variant="primary" onClick={() => doRegister(tournament, userId)} data-testid="card-request">
          {t('lobby.request_seat')}
        </Button>
      ) : (
        details
      );
    case 'can_waitlist':
      return direct ? (
        <Button size="sm" onClick={() => doRegister(tournament, userId)} data-testid="card-waitlist">
          {t('tour.join_waitlist')}
        </Button>
      ) : (
        details
      );
    case 'registered':
      return (
        <Badge tone="success">
          <LuCheck className="size-3" aria-hidden />
          {t('tour.registered')}
        </Badge>
      );
    case 'requested':
      return (
        <Badge tone="warning">
          <LuHourglass className="size-3" aria-hidden />
          {t('tour.pending')}
        </Badge>
      );
    case 'waitlisted':
      return <Badge tone="info">{t('tour.waitlisted')}</Badge>;
    case 'invited_waiting':
      return <Badge tone="accent">{t('tour.invited')}</Badge>;
    case 'revoked':
      return <Badge tone="danger">{t('tour.revoked')}</Badge>;
    case 'invite_only':
      return <Badge>{t('tour.access.invite')}</Badge>;
    case 'full':
      return <Badge>{t('tour.full')}</Badge>;
    default:
      return details;
  }
}

// ----- structure table --------------------------------------------------------------------------

export function StructureTable({ structure, currentIndex, max = 60 }: { structure: TournamentStructure; currentIndex?: number; max?: number }) {
  const t = useT();
  let elapsed = 0;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[360px] text-[13px] tabular-nums">
        <thead>
          <tr className="text-start text-[12px] text-ink-3">
            <th className="py-1.5 pe-3 text-start font-medium">{t('structure.level')}</th>
            <th className="py-1.5 pe-3 text-start font-medium">{t('structure.blinds')}</th>
            <th className="py-1.5 pe-3 text-start font-medium">{t('structure.ante')}</th>
            <th className="py-1.5 pe-3 text-end font-medium">{t('structure.duration')}</th>
            <th className="py-1.5 text-end font-medium">{t('structure.starts_at')}</th>
          </tr>
        </thead>
        <tbody>
          {structure.entries.slice(0, max).map((entry, index) => {
            const startsAt = elapsed;
            elapsed += entry.minutes;
            const current = currentIndex === index;
            const past = currentIndex !== undefined && index < currentIndex;
            const startLabel = `${Math.floor(startsAt / 60)}:${String(startsAt % 60).padStart(2, '0')}`;
            if (entry.kind === 'break') {
              return (
                <tr key={index} className={cx('border-t border-line text-warning/90', past && 'opacity-45', current && 'bg-warning/10')}>
                  <td className="py-1.5 pe-3" colSpan={3}>
                    <span className="inline-flex items-center gap-1.5">
                      <LuCoffee className="size-3.5" aria-hidden />
                      {t('structure.break')}
                    </span>
                  </td>
                  <td className="py-1.5 pe-3 text-end">{t('structure.minutes', { n: entry.minutes })}</td>
                  <td className="py-1.5 text-end text-ink-3">{startLabel}</td>
                </tr>
              );
            }
            return (
              <tr key={index} className={cx('border-t border-line', past && 'opacity-45', current && 'bg-accent/10 font-medium text-ink')}>
                <td className="py-1.5 pe-3 text-ink-2">{levelNumberAt(structure, index)}</td>
                <td className="py-1.5 pe-3 text-ink" dir="ltr">
                  {chips(entry.sb)} / {chips(entry.bb)}
                </td>
                <td className="py-1.5 pe-3 text-ink-2">{entry.ante > 0 ? chips(entry.ante) : '—'}</td>
                <td className="py-1.5 pe-3 text-end text-ink-2">{t('structure.minutes', { n: entry.minutes })}</td>
                <td className="py-1.5 text-end text-ink-3">{startLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ----- tournament clock --------------------------------------------------------------------------

/** The board every card room has on the wall: level, time left, blinds, what comes next. */
export function TournamentClock({ live, summary, className }: { live: TournamentLive; summary: LiveSummary; className?: string }) {
  const t = useT();
  const next = entryAt(live.structure, live.levelIdx + 1);
  const paused = summary.status === 'PAUSED';
  return (
    <div className={cx('rounded-panel border border-line bg-[#0d1218]', className)} data-testid="tournament-clock">
      <div className="grid grid-cols-[1fr_auto] items-end gap-x-4 gap-y-1 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-2">
            {summary.onBreak ? t('clock.break') : t('clock.level_n', { n: summary.level })}
            {paused && <span className="ms-2 text-warning">{t('status.PAUSED')}</span>}
          </p>
          <p className={cx('clock-digits text-[64px] leading-[0.95] font-bold sm:text-[76px]', paused ? 'text-warning' : summary.onBreak ? 'text-warning' : 'text-ink')} dir="ltr" data-testid="clock-time">
            {clock(summary.remaining * 1000)}
          </p>
        </div>
        <div className="pb-2 text-end">
          <p className="text-[12px] text-ink-3">{t('clock.blinds')}</p>
          <p className="clock-digits text-[26px] leading-tight font-semibold text-ink sm:text-[30px]" dir="ltr">
            {chips(summary.sb, true)}/{chips(summary.bb, true)}
          </p>
          <p className="text-[12.5px] text-ink-2 tabular-nums">{summary.ante > 0 ? t('clock.ante_n', { n: chips(summary.ante, true) }) : t('clock.no_ante')}</p>
        </div>
      </div>
      <div className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-raised-2 sm:mx-5">
        <div
          className={cx('h-full rounded-full transition-[width] duration-1000 ease-linear', summary.onBreak || paused ? 'bg-warning' : 'bg-accent')}
          style={{ width: `${100 - Math.min(100, (summary.remaining / (entryAt(live.structure, live.levelIdx).minutes * 60)) * 100)}%` }}
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-[13px] sm:grid-cols-4 sm:px-5">
        <ClockFact label={t('clock.next')} value={next.kind === 'break' ? t('lobby.break_n', { n: next.minutes }) : blindsLabel(next)} ltr={next.kind !== 'break'} />
        <ClockFact label={t('clock.players')} value={`${summary.left} / ${summary.entrants}`} />
        <ClockFact label={t('clock.average')} value={`${chips(summary.average, true)} · ${Math.round(summary.average / Math.max(1, summary.bb))} BB`} />
        <ClockFact label={t('clock.tables')} value={summary.finalTable ? t('clock.final_table') : String(summary.tables)} />
      </dl>
    </div>
  );
}

function ClockFact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="truncate font-medium text-ink tabular-nums" dir={ltr ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}

// ----- seat map ------------------------------------------------------------------------------

/** A small top-down map of one table: who sits where, and whose stack is biggest. */
export function MiniTable({ table, highlightId, onClick, label, sub, active }: { table: TTable; highlightId?: string | null; onClick?: () => void; label: string; sub: string; active?: boolean }) {
  const seats = table.state.seats;
  const slots = useMemo(() => seatSlots(table.state.maxSeats, { x: 60, y: 37 }, 50, 27), [table.state.maxSeats]);
  const maxStack = Math.max(1, ...occupiedSeats(table.state).map((s) => s.stack));
  const body = (
    <>
      <svg viewBox="0 0 120 74" className="w-full" aria-hidden>
        <rect x="14" y="14" width="92" height="46" rx="23" fill="#101820" stroke="var(--color-line-strong)" strokeWidth="1.500" />
        <rect x="19" y="19" width="82" height="36" rx="18" fill="color-mix(in oklab, var(--accent) 16%, #0d141b)" />
        {slots.map((p, i) => {
          const s = seats[i];
          if (!s) return <circle key={i} cx={p.x} cy={p.y} r="4" fill="none" stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="2 2" />;
          const mine = s.playerId === highlightId;
          const r = 4 + 3 * Math.sqrt(s.stack / maxStack);
          return <circle key={i} cx={p.x} cy={p.y} r={r} fill={mine ? 'var(--color-gold)' : 'var(--accent)'} fillOpacity={mine ? 1 : 0.85} stroke="#0b0f14" strokeWidth="1.500" />;
        })}
        <text x="60" y="41" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-ink)" fillOpacity="0.9">
          {table.no}
        </text>
      </svg>
      <div className="flex items-baseline justify-between gap-2 px-1 pb-0.5 text-[12px]">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-ink-3 tabular-nums">{sub}</span>
      </div>
    </>
  );
  const className = cx('block w-full rounded-inner border p-1.5 text-start transition-colors', active ? 'border-accent bg-accent/8' : 'border-line bg-surface', onClick && 'hover:border-line-strong');
  return onClick ? (
    <button type="button" className={className} onClick={onClick} data-testid={`mini-table-${table.no}`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Text for the number of people registered, including those awaiting approval and on the waiting list. */
export function registeredText(t: T, tournament: Tournament): string {
  const pending = requestedCount(tournament);
  const waiting = waitlistedCount(tournament);
  let text = `${registeredCount(tournament)} / ${tournament.maxPlayers}`;
  if (pending > 0) text += ` · ${t('tour.pending_n', { n: pending })}`;
  if (waiting > 0) text += ` · ${t('tour.waitlist_n', { n: waiting })}`;
  return text;
}

export function clubOf(db: DB, tournament: Tournament): Club {
  return db.clubs[tournament.clubId]!;
}
