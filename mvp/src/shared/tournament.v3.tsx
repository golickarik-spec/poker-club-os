/**
 * v0.3 tournament presentation: a featured "marquee" for the one event that matters
 * most right now, and compact schedule rows for the rest. Both reuse the v2 data
 * helpers and the registration action, so behaviour is identical to the v2 cards.
 */
import type { ReactNode } from 'react';
import { LuArrowRight, LuPlay, LuUsers } from 'react-icons/lu';
import { runtime } from '../app/context.ts';
import { blindsLabel, chips, clock, timeOfDay } from '../app/format.ts';
import { go, useNow, useT } from '../app/hooks.ts';
import { registeredCount } from '../platform/api.ts';
import { registrationState } from '../platform/selectors.ts';
import type { DB, Tournament } from '../platform/types.ts';
import { Button, cx, Meter } from '../ui/core.tsx';
import { accentStyle, ClubLogo, ClubName } from '../ui/identity.tsx';
import { resolveTableBranding } from '../platform/table-branding.ts';
import { CardAction, dayLabel, estimateLabel, presetLabel, StatusPill, structureSummary, useLiveBrief } from './tournament.tsx';

const isRunning = (x: Tournament) => x.status === 'RUNNING' || x.status === 'PAUSED' || x.status === 'SEATING';

/** First blind level of a structure, for the facts strip. */
function firstBlinds(x: Tournament): string {
  const level = x.structure.entries.find((e) => e.kind === 'level');
  return level && level.kind === 'level' ? blindsLabel(level) : '—';
}

/** Nine seat markers around a rail: filled ones show how much of the field is taken. */
function SeatRing({ filled, total }: { filled: number; total: number }) {
  const seats = 9;
  const lit = total > 0 ? Math.round((seats * Math.min(filled, total)) / total) : 0;
  return (
    <svg viewBox="0 0 240 150" className="absolute inset-0 size-full" aria-hidden>
      {Array.from({ length: seats }, (_, i) => {
        // Seats sit on an ellipse just inside the rail, starting at the bottom centre.
        const a = Math.PI / 2 + (i * 2 * Math.PI) / seats;
        const cx = 120 + Math.cos(a) * 104;
        const cy = 75 + Math.sin(a) * 60;
        return <circle key={i} cx={cx} cy={cy} r={4.5} className={i < lit ? 'fill-accent' : 'fill-white/15'} style={i < lit ? { filter: 'drop-shadow(0 0 4px color-mix(in oklab, var(--accent) 70%, transparent))' } : undefined} />;
      })}
    </svg>
  );
}

/**
 * A small table seen from above: rail, felt, the club mark, and the tournament clock
 * sitting on the cloth. The same felt theme the real table will use.
 */
export function TableCameo({ db, tournament, now, brief }: { db: DB; tournament: Tournament; now: number; brief: ReturnType<typeof useLiveBrief> }) {
  const t = useT();
  const club = db.clubs[tournament.clubId]!;
  const { theme, vars } = resolveTableBranding(tournament, club);
  const running = isRunning(tournament);
  const untilMs = tournament.startAt - now;
  const soon = untilMs > 0 && untilMs < 12 * 60 * 60_000 && tournament.startMode === 'scheduled';
  let big: ReactNode;
  let small: string;
  if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
    big = t(tournament.status === 'COMPLETED' ? 'lobby.hero.finished' : 'status.CANCELLED');
    small = dayLabel(t, tournament.completedAt ?? tournament.startAt, now);
  } else if (running) {
    big = brief ? (brief.onBreak ? t('lobby.on_break') : t('tour.level_n', { n: brief.level })) : t(`status.${tournament.status}`);
    small = brief ? `${t('tour.players')} ${brief.left} / ${brief.entrants}` : '';
  } else if (tournament.startMode === 'when_full') {
    big = `${registeredCount(tournament)} / ${tournament.maxPlayers}`;
    small = t('tour.when_full');
  } else if (soon) {
    big = clock(untilMs);
    small = t('time.starts_in');
  } else {
    big = timeOfDay(tournament.startAt, t.lang);
    small = dayLabel(t, tournament.startAt, now);
  }
  return (
    <div className={cx('relative mx-auto aspect-[240/150] w-full max-w-[250px] lg:max-w-[300px]', `felt-${theme}`)} style={vars} data-testid="table-cameo">
      <div className="pc3-rail absolute inset-0 rounded-[50%]" />
      <div className="pc3-felt absolute inset-[9%] rounded-[50%]">
        <div className="pc3-felt-line absolute inset-[9%] rounded-[50%]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.16]">
            <ClubLogo branding={club.branding} name={club.name} size={64} />
          </div>
          <span className={cx('clock-digits relative text-[36px] leading-none font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]', typeof big === 'string' && big.length > 7 && 'text-[26px]')} dir="ltr">
            {big}
          </span>
          <span className="relative text-[11.5px] font-medium tracking-[0.02em] text-white/75">{small}</span>
        </div>
      </div>
      <SeatRing filled={running && brief ? brief.left : registeredCount(tournament)} total={running && brief ? brief.entrants : tournament.maxPlayers} />
    </div>
  );
}

function Fact({ label, value, ltr }: { label: string; value: ReactNode; ltr?: boolean }) {
  return (
    <div className="min-w-0 py-1.5 sm:px-4 sm:py-2.5 sm:first:ps-0 sm:last:pe-0">
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="display mt-0.5 truncate text-[17px] leading-tight text-ink" dir={ltr ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}

/** The one tournament the player should look at first. */
export function FeaturedTournament({ db, tournament, userId, eyebrow }: { db: DB; tournament: Tournament; userId: string; eyebrow: string }) {
  const t = useT();
  const now = useNow(1000);
  const brief = useLiveBrief(tournament.id);
  const club = db.clubs[tournament.clubId]!;
  const state = registrationState(db, tournament, userId, brief?.lateReg ?? false);
  const live = runtime.getLive(tournament.id);
  const seated = live?.players[userId]?.status === 'active';
  const running = isRunning(tournament);
  const count = registeredCount(tournament);
  const estimate = estimateLabel(t, tournament);
  return (
    <section className="stage relative overflow-hidden" style={accentStyle(club.branding.accent)} aria-labelledby="featured-title" data-testid={`featured-${tournament.id}`}>
      {/* a thin accent seam along the top edge, the only decoration */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" aria-hidden />
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
            <span className="font-medium text-accent">{eyebrow}</span>
            <span className="text-ink-3">·</span>
            <ClubLogo branding={club.branding} name={club.name} size={16} />
            <ClubName club={club} className="truncate" />
            <StatusPill status={tournament.status} lateReg={brief?.lateReg} />
          </p>
          <h2 id="featured-title" className="display mt-2 text-[30px] leading-[1.02] text-ink sm:text-[40px]">
            <button type="button" onClick={() => go('tournament', { id: tournament.id })} className="text-start hover:underline decoration-accent/60 underline-offset-[6px]">
              {tournament.name}
            </button>
          </h2>
          <p className="mt-2 text-[13.5px] text-ink-2">
            {presetLabel(t, tournament)} · {structureSummary(t, tournament.structure)}
            {estimate && !running ? ` · ${estimate}` : ''}
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-y-1 sm:flex sm:divide-x sm:divide-line/70 sm:rtl:divide-x-reverse">
            <Fact label={t('home.buy_in')} value={tournament.entryPoints > 0 ? t('common.points_n', { n: chips(tournament.entryPoints) }) : t('common.free')} />
            <Fact label={t('home.stack')} value={chips(tournament.structure.startingStack)} ltr />
            <Fact label={t('home.blinds')} value={firstBlinds(tournament)} ltr />
            <Fact label={t('home.field')} value={<span dir="ltr">{running && brief ? `${brief.left} / ${brief.entrants}` : `${count} / ${tournament.maxPlayers}`}</span>} />
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {seated && running ? (
              <Button variant="primary" size="lg" icon={<LuPlay className="size-4" aria-hidden />} onClick={() => go('table', { id: tournament.id })} data-testid="featured-open-table">
                {t('home.go_to_table')}
              </Button>
            ) : (
              <span className="[&>button]:h-12 [&>button]:px-5 [&>button]:text-[15px]">
                <CardAction t={t} state={state} seated={!!seated} tournament={tournament} userId={userId} />
              </span>
            )}
            <Button variant="ghost" size="lg" trailing={<LuArrowRight className="size-4 flip-rtl" aria-hidden />} onClick={() => go('tournament', { id: tournament.id })} data-testid="featured-lobby">
              {t('home.view_lobby')}
            </Button>
          </div>
        </div>
        <TableCameo db={db} tournament={tournament} now={now} brief={brief} />
      </div>
    </section>
  );
}

/** One line of the schedule: when, what, who is in, and the single action. */
export function TournamentRow({ db, tournament, userId, showClub = true }: { db: DB; tournament: Tournament; userId: string; showClub?: boolean }) {
  const t = useT();
  const now = useNow(1000);
  const brief = useLiveBrief(tournament.id);
  const club = db.clubs[tournament.clubId]!;
  const state = registrationState(db, tournament, userId, brief?.lateReg ?? false);
  const live = runtime.getLive(tournament.id);
  const seated = live?.players[userId]?.status === 'active';
  const running = isRunning(tournament);
  const count = registeredCount(tournament);
  const untilMs = tournament.startAt - now;
  const soon = untilMs > 0 && untilMs < 60 * 60_000 && tournament.startMode === 'scheduled' && (tournament.status === 'REGISTRATION_OPEN' || tournament.status === 'REGISTRATION_CLOSED');
  const open = () => go('tournament', { id: tournament.id });

  let when: ReactNode;
  let whenSub: string;
  if (running) {
    when = (
      <span className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-success">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-success" aria-hidden />
        {t('time.live')}
      </span>
    );
    whenSub = brief ? (brief.onBreak ? t('lobby.on_break') : t('tour.level_n', { n: brief.level })) : t(`status.${tournament.status}`);
  } else if (tournament.startMode === 'when_full') {
    when = <span className="text-[13px] font-semibold text-ink">{t('tour.sng_short')}</span>;
    whenSub = t('tour.when_full');
  } else {
    when = (
      <span className="clock-digits text-[20px] leading-none font-semibold text-ink" dir="ltr">
        {soon ? clock(untilMs) : timeOfDay(tournament.startAt, t.lang)}
      </span>
    );
    whenSub = soon ? t('time.starts_in') : dayLabel(t, tournament.startAt, now);
  }

  return (
    <article className="group relative grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 transition-colors hover:bg-raised/40 sm:grid-cols-[72px_minmax(0,1fr)_132px_auto] sm:gap-x-4 sm:px-4" style={accentStyle(club.branding.accent)} data-testid={`tournament-card-${tournament.id}`}>
      <div className="flex flex-col items-center justify-center text-center">
        {when}
        <span className="mt-0.5 text-[11px] leading-tight text-ink-3">{whenSub}</span>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-[14.5px] font-semibold text-ink">
            <button type="button" onClick={open} className="text-start after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent">
              {tournament.name}
            </button>
          </h3>
          <span className="hidden shrink-0 sm:inline-flex">
            <StatusPill status={tournament.status} lateReg={brief?.lateReg} />
          </span>
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-ink-3">
          {showClub && (
            <>
              <ClubLogo branding={club.branding} name={club.name} size={14} />
              <ClubName club={club} className="truncate text-ink-2" />
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">
            {presetLabel(t, tournament)} · {structureSummary(t, tournament.structure)}
          </span>
        </p>
      </div>
      <div className="hidden min-w-0 sm:block">
        <div className="flex items-baseline gap-1.5 text-[12.5px] text-ink-2 tabular-nums">
          <LuUsers className="size-3.5 shrink-0 translate-y-[2px] text-ink-3" aria-hidden />
          <span dir="ltr">
            <span className="font-medium text-ink">{running && brief ? brief.left : count}</span> / {running && brief ? brief.entrants : tournament.maxPlayers}
          </span>
          <span className="ms-auto shrink-0 text-ink-3">{tournament.entryPoints > 0 ? t('common.points_n', { n: chips(tournament.entryPoints) }) : t('common.free')}</span>
        </div>
        <Meter value={running && brief ? brief.left : count} max={running && brief ? brief.entrants : tournament.maxPlayers} className="mt-1.5" label={t('tour.players')} />
      </div>
      <div className="relative z-10 shrink-0">
        <CardAction t={t} state={state} seated={!!seated} tournament={tournament} userId={userId} />
      </div>
    </article>
  );
}

/** A bordered list of schedule rows. */
export function TournamentList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('panel rows overflow-hidden', className)}>{children}</div>;
}
