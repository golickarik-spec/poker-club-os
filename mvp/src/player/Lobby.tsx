import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuArrowDown, LuArrowLeft, LuArrowUp, LuBan, LuCheck, LuCircleAlert, LuEye, LuHourglass, LuListOrdered, LuLock, LuMailCheck, LuMinus, LuPlay, LuTrophy, LuTv, LuUsers } from 'react-icons/lu';
import { act, runtime } from '../app/context.ts';
import { chips, clock, dateLong, durationLabel, ordinal, timeOfDay } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT, type T } from '../app/hooks.ts';
import { estimateDurationMinutes } from '../engine/structure.ts';
import { activeTables, standings, type Standing, type TournamentLive } from '../engine/tournament.ts';
import { occupiedSeats } from '../engine/holdem.ts';
import * as api from '../platform/api.ts';
import { membershipOf } from '../platform/permissions.ts';
import { entrantIds, needsAccessCode, registrationState } from '../platform/selectors.ts';
import type { Club, DB, Tournament, User } from '../platform/types.ts';
import { doRegister, MiniTable, StructureTable, TournamentClock, useLiveSummary, type LiveSummary } from '../shared/tournament.tsx';
import { Badge, BotTag, Button, cx, EmptyState, Fact, Notice, Panel, PanelHeader } from '../ui/core.tsx';
import { accentStyle, Avatar, ClubName } from '../ui/identity.tsx';
import { LobbyHero } from '../app/variants.ts';
import { V3 } from '../app/design.ts';
import { TextInput } from '../ui/forms.tsx';
import { ConfirmDialog, Tabs } from '../ui/overlay.tsx';

type Tab = 'players' | 'standings' | 'tables' | 'structure' | 'details';

export function Lobby({ tournamentId }: { tournamentId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(1000);
  const tournament = db.tournaments[tournamentId];
  const summary = useLiveSummary(tournamentId);
  const [tab, setTab] = useState<Tab | null>(null);
  const [confirmUnregister, setConfirmUnregister] = useState(false);

  if (!tournament) {
    return <EmptyState title={t('lobby.not_found')} action={<Button onClick={() => go('tournaments')}>{t('nav.tournaments')}</Button>} />;
  }
  const club = db.clubs[tournament.clubId]!;
  // The service layer decides who may open this lobby; a direct link does not get around it.
  if (!api.canViewTournament(db, me.id, tournament)) {
    return (
      <div style={accentStyle(club.branding.accent)} data-testid="lobby-private">
        <EmptyState
          icon={<LuLock />}
          title={t('lobby.private.title')}
          body={t('lobby.private.body', { club: club.name })}
          action={
            <Button variant="primary" onClick={() => go('club', { clubId: club.id })}>
              {t('lobby.view_club')}
            </Button>
          }
          className="mx-auto mt-10 max-w-md"
        />
      </div>
    );
  }
  const canWatch = api.canWatchTournament(db, me.id, tournament);
  const live = runtime.getLive(tournamentId);
  const running = (tournament.status === 'RUNNING' || tournament.status === 'PAUSED') && !!live && !!summary;
  const seating = tournament.status === 'SEATING';
  const state = registrationState(db, tournament, me.id, summary?.lateReg ?? false);
  const mePlayer = live?.players[me.id];
  const result = db.results[tournamentId];
  const count = api.registeredCount(tournament);
  const activeTab: Tab = tab ?? (running && canWatch ? 'standings' : 'players');
  const tabs: { value: Tab; label: string; count?: number }[] = [
    ...(running && canWatch ? [{ value: 'standings' as const, label: t('lobby.tab.standings') }, { value: 'tables' as const, label: t('lobby.tab.tables'), count: summary.tables }] : []),
    { value: 'players', label: t('lobby.tab.players'), count: running ? undefined : count },
    { value: 'structure', label: t('lobby.tab.structure') },
    { value: 'details', label: t('lobby.tab.details') },
  ];

  return (
    <div style={accentStyle(club.branding.accent)} data-testid="lobby">
      <button type="button" onClick={() => go('club', { clubId: club.id })} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        <ClubName club={club} />
      </button>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-5">
          <LobbyHero db={db} tournament={tournament} club={club} lateReg={summary?.lateReg} />

          {/* What is happening right now */}
          {running && live ? (
            <TournamentClock live={live} summary={summary} />
          ) : seating ? (
            <SeatingPanel t={t} live={live} me={me} until={tournament.seatingUntil ?? now} now={now} />
          ) : tournament.status === 'COMPLETED' ? (
            <Panel className="flex flex-wrap items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                <LuTrophy className="size-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink-2">{t('lobby.winner')}</p>
                <p className="truncate text-[18px] font-semibold text-ink">{result?.places[0]?.name ?? '—'}</p>
              </div>
              <Button variant="primary" onClick={() => go('results', { id: tournamentId })} data-testid="lobby-results">
                {t('lobby.view_results')}
              </Button>
            </Panel>
          ) : tournament.status === 'CANCELLED' ? (
            <Notice tone="danger" icon={<LuCircleAlert />}>
              <p className="font-medium">{t('lobby.cancelled')}</p>
              {tournament.cancelReason && <p className="mt-0.5 text-ink-2">{tournament.cancelReason}</p>}
              <p className="mt-0.5 text-ink-2">{t('lobby.cancelled_refund')}</p>
            </Notice>
          ) : (
            <StartPanel t={t} tournament={tournament} now={now} count={count} />
          )}

          {running && canWatch && (
            <div className="flex flex-wrap items-center gap-2 rounded-inner border border-line bg-surface px-3 py-2 text-[13px] text-ink-2" data-testid="lobby-spectate">
              <LuTv className="size-4 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1">{t('spectate.lobby_hint')}</span>
              <Button size="sm" onClick={() => go('spectate', { id: tournament.id })} data-testid="lobby-spectate-open">
                {t('spectate.open')}
              </Button>
            </div>
          )}

          {/* Tabs */}
          <div>
            <Tabs value={activeTab} onChange={setTab} label={tournament.name} tabs={tabs} />
            <div className="pt-4">
              {activeTab === 'standings' && running && live && canWatch && <StandingsTable t={t} live={live} summary={summary} meId={me.id} />}
              {activeTab === 'tables' && running && live && canWatch && <TablesGrid t={t} live={live} meId={me.id} tournamentId={tournamentId} canObserve={canWatch} />}
              {activeTab === 'players' &&
                (canWatch ? (
                  <PlayersList t={t} db={db} tournament={tournament} live={live} meId={me.id} />
                ) : (
                  <Notice tone="neutral" icon={<LuLock />}>
                    {t('lobby.players_members_only')}
                  </Notice>
                ))}
              {activeTab === 'structure' && (
                <Panel>
                  <StructureTable structure={tournament.structure} currentIndex={running && live ? live.levelIdx : undefined} />
                </Panel>
              )}
              {activeTab === 'details' && <DetailsPanel t={t} tournament={tournament} club={club} />}
            </div>
          </div>
        </div>

        {/* Action column */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
          <Panel data-testid="lobby-action">
            <ActionPanel
              t={t}
              db={db}
              tournament={tournament}
              club={club}
              me={me}
              state={state}
              summary={summary}
              seated={mePlayer?.status === 'active'}
              place={mePlayer?.status === 'out' ? mePlayer.place : null}
              tableNo={mePlayer?.tableNo ?? null}
              canWatch={canWatch}
              onUnregister={() => setConfirmUnregister(true)}
            />
          </Panel>
          <Panel>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Fact label={t('lobby.fact.start')}>
                {tournament.startMode === 'when_full' ? t('tour.when_full') : tournament.startMode === 'manual' ? t('lobby.start_manual') : `${timeOfDay(tournament.startAt, t.lang)}`}
              </Fact>
              <Fact label={t('lobby.fact.players')}>
                <span dir="ltr">{count} / {tournament.maxPlayers}</span>
              </Fact>
              <Fact label={t('lobby.starting_stack')}>{chips(tournament.structure.startingStack)}</Fact>
              <Fact label={t('lobby.fact.table_size')}>{t('lobby.seats_n', { n: tournament.structure.tableSize })}</Fact>
              <Fact label={t('lobby.fact.levels')}>{t('structure.minutes', { n: tournament.structure.entries[0]?.minutes ?? 0 })}</Fact>
              <Fact label={t('lobby.fact.late_reg')}>{tournament.structure.lateRegLevels > 0 ? t('lobby.late_reg_n', { n: tournament.structure.lateRegLevels }) : t('lobby.late_reg_none')}</Fact>
              <Fact label={t('lobby.fact.min_players')}>{tournament.minPlayers}</Fact>
              <Fact label={t('lobby.fact.duration')}>
                {(() => {
                  const m = estimateDurationMinutes(tournament.structure, Math.max(count, tournament.minPlayers));
                  return m ? `~${durationLabel(m, t.lang)}` : '—';
                })()}
              </Fact>
            </dl>
            {tournament.startMode === 'scheduled' && <p className="mt-3.5 border-t border-line pt-3 text-[12.5px] text-ink-3">{dateLong(tournament.startAt, t.lang)} · {tournament.timezone}</p>}
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmUnregister}
        onClose={() => setConfirmUnregister(false)}
        onConfirm={() => act(() => api.unregisterFromTournament(db, me.id, tournamentId), { key: 'lobby.unregistered' })}
        title={t('lobby.unregister_title')}
        body={tournament.entryPoints > 0 ? t('lobby.unregister_body', { points: chips(tournament.entryPoints) }) : t('lobby.unregister_body_free')}
        confirmLabel={t('lobby.unregister')}
      />
    </div>
  );
}

function StartPanel({ t, tournament, now, count }: { t: T; tournament: Tournament; now: number; count: number }) {
  if (tournament.startMode === 'when_full') {
    const seats = Array.from({ length: tournament.maxPlayers }, (_, i) => i < count);
    return (
      <Panel>
        <p className="text-[13px] text-ink-2">{t('lobby.sng_title')}</p>
        <p className="mt-1 text-[22px] font-semibold text-ink tabular-nums">{t('lobby.sng_count', { count, max: tournament.maxPlayers })}</p>
        <div className="mt-3 flex flex-wrap gap-2" aria-hidden>
          {seats.map((filled, i) => (
            <span key={i} className={cx('flex size-9 items-center justify-center rounded-full border text-[12px] transition-colors duration-300', filled ? 'border-accent bg-accent/15 text-accent' : 'border-dashed border-line-strong text-ink-3')}>
              {filled ? <LuCheck className="size-4" /> : i + 1}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-ink-3">{t('lobby.sng_note')}</p>
      </Panel>
    );
  }
  const until = tournament.startAt - now;
  const opensIn = tournament.registrationOpensAt - now;
  // The v3 hero already carries the clock on its table cameo; the panel then keeps only the facts.
  return (
    <Panel className={cx('flex flex-wrap items-end justify-between gap-4', V3 && 'py-3 sm:py-3')}>
      <div>
        <p className="text-[13px] text-ink-2">{until > 0 ? t('lobby.starts_in') : t('lobby.starting')}</p>
        <p className={cx('clock-digits leading-none font-bold text-ink', V3 ? 'text-[24px]' : 'text-[56px] sm:text-[64px]')} dir="ltr" data-testid="lobby-countdown">
          {until > 86_400_000 ? `${Math.floor(until / 86_400_000)}d ${Math.floor((until % 86_400_000) / 3_600_000)}h` : clock(Math.max(0, until))}
        </p>
      </div>
      <div className="text-end text-[13px] text-ink-2">
        {tournament.status === 'SCHEDULED' && opensIn > 0 && <p>{t('lobby.reg_opens_in', { time: clock(opensIn) })}</p>}
        {tournament.status === 'REGISTRATION_CLOSED' && <p>{t('status.REGISTRATION_CLOSED')}</p>}
        <p className="tabular-nums">{t('lobby.min_to_start', { n: Math.max(2, tournament.minPlayers), count })}</p>
      </div>
    </Panel>
  );
}

function SeatingPanel({ t, live, me, until, now }: { t: T; live: TournamentLive | undefined; me: User; until: number; now: number }) {
  const mine = live?.players[me.id];
  const table = mine && mine.tableNo ? live?.tables.find((x) => x.no === mine.tableNo) : undefined;
  const seat = table?.state.seats.find((s) => s?.playerId === me.id);
  return (
    <Panel className="flex flex-wrap items-center gap-4" data-testid="seating-panel">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
        <LuHourglass className="size-6 animate-pulse" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold text-ink">{t('lobby.seating_title')}</p>
        <p className="mt-0.5 text-[13.5px] text-ink-2">
          {live ? t.n('lobby.seating_body', live.tables.length, { players: live.entrants }) : t('lobby.seating_wait')} · {clock(Math.max(0, until - now))}
        </p>
        {mine && seat && (
          <p className="mt-1.5 text-[14px] font-medium text-accent" data-testid="seat-assignment">
            {t('lobby.your_seat', { table: mine.tableNo ?? 0, seat: seat.seat + 1 })}
          </p>
        )}
      </div>
    </Panel>
  );
}

function ActionPanel({
  t,
  db,
  tournament,
  club,
  me,
  state,
  summary,
  seated,
  place,
  tableNo,
  canWatch,
  onUnregister,
}: {
  t: T;
  db: DB;
  tournament: Tournament;
  club: Club;
  me: User;
  state: ReturnType<typeof registrationState>;
  summary: LiveSummary | null;
  seated: boolean;
  place: number | null;
  tableNo: number | null;
  canWatch: boolean;
  onUnregister: () => void;
}) {
  const [code, setCode] = useState('');
  const membership = membershipOf(db, me.id, club.id);
  const balance = membership?.status === 'active' ? membership.demoPoints : 0;
  const cost = tournament.entryPoints;
  const running = tournament.status === 'RUNNING' || tournament.status === 'PAUSED';
  const entry = (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-ink-2">{t('lobby.entry')}</span>
      <span className="font-semibold text-ink tabular-nums">{cost > 0 ? t('common.points_n', { n: chips(cost) }) : t('common.free')}</span>
    </div>
  );
  const balanceRow = membership?.status === 'active' && (
    <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-ink-2">{t('lobby.balance')}</span>
      <span className="text-ink tabular-nums" data-testid="points-balance">
        {chips(balance)}
      </span>
    </div>
  );
  const note = <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('common.points_note')}</p>;
  let action: ReactNode;

  if (running && seated) {
    action = (
      <>
        <Notice tone="success" icon={<LuCheck />}>
          {t('lobby.you_are_seated', { table: tableNo ?? 0 })}
        </Notice>
        <Button variant="primary" size="lg" full className="mt-3" icon={<LuPlay className="size-4" aria-hidden />} onClick={() => go('table', { id: tournament.id })} data-testid="go-to-table">
          {t('lobby.go_to_table')}
        </Button>
      </>
    );
  } else if (place !== null) {
    action = (
      <>
        <Notice tone="neutral">{t('lobby.you_finished', { place: ordinal(place, t.lang), entrants: summary?.entrants ?? 0 })}</Notice>
        {running && (
          <Button full className="mt-3" icon={<LuEye className="size-4" aria-hidden />} onClick={() => go('table', { id: tournament.id })}>
            {t('lobby.observe')}
          </Button>
        )}
      </>
    );
  } else {
    const wantsCode = needsAccessCode(tournament, me.id);
    const codeField = wantsCode && (
      <div className="mt-3">
        <label htmlFor="access-code" className="mb-1.5 block text-[13px] font-medium text-ink">
          {t('lobby.code.label')}
        </label>
        <TextInput id="access-code" value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, 12))} placeholder="••••••" autoComplete="off" dir="ltr" className="font-medium tracking-[0.12em] tabular-nums" data-testid="access-code" />
        <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{t('lobby.code.hint')}</p>
      </div>
    );
    const submit = () => doRegister(tournament, me.id, wantsCode ? code : undefined);
    const blocked = wantsCode && code.trim().length < 4;
    switch (state) {
      case 'can_register':
      case 'can_late_register':
      case 'can_waitlist':
        action = (
          <>
            {entry}
            {balanceRow}
            {state === 'can_waitlist' && (
              <Notice tone="neutral" className="mt-3">
                {t('lobby.full_waitlist')}
              </Notice>
            )}
            {codeField}
            <Button variant={state === 'can_waitlist' ? 'secondary' : 'primary'} size="lg" full className="mt-4" onClick={submit} disabled={blocked} data-testid="register">
              {state === 'can_late_register' ? t('lobby.late_register') : state === 'can_waitlist' ? t('tour.join_waitlist') : t('tour.register')}
            </Button>
            {state === 'can_late_register' && <p className="mt-2 text-[12.5px] text-ink-2">{t('lobby.late_register_note')}</p>}
            {balance < cost && <p className="mt-2 text-[12.5px] text-danger">{t('lobby.not_enough_points')}</p>}
          </>
        );
        break;
      case 'can_request':
      case 'can_late_request':
        action = (
          <>
            {entry}
            {balanceRow}
            {codeField}
            <Button variant="primary" size="lg" full className="mt-4" onClick={submit} disabled={blocked} data-testid="register">
              {t('lobby.request_seat')}
            </Button>
            <p className="mt-2 text-[12.5px] text-ink-2">{t('lobby.approval_note')}</p>
            {balance < cost && <p className="mt-2 text-[12.5px] text-danger">{t('lobby.not_enough_points')}</p>}
          </>
        );
        break;
      case 'invited':
        action = (
          <>
            <Notice tone="accent" icon={<LuMailCheck />}>
              <span data-testid="invited-notice">{t('lobby.invited')}</span>
            </Notice>
            <div className="mt-3">
              {entry}
              {balanceRow}
            </div>
            <Button variant="primary" size="lg" full className="mt-4" onClick={submit} data-testid="register">
              {t('tour.take_seat')}
            </Button>
          </>
        );
        break;
      case 'invited_waiting':
        action = (
          <Notice tone="accent" icon={<LuMailCheck />}>
            {t('lobby.invited_waiting', { time: timeOfDay(tournament.registrationOpensAt, t.lang) })}
          </Notice>
        );
        break;
      case 'invite_only':
        action = (
          <Notice tone="neutral" icon={<LuLock />}>
            <span data-testid="invite-only-notice">{t('lobby.invite_only')}</span>
          </Notice>
        );
        break;
      case 'revoked':
        action = (
          <Notice tone="danger" icon={<LuBan />}>
            <span data-testid="revoked-notice">{t('lobby.revoked')}</span>
          </Notice>
        );
        break;
      case 'registered':
        action = (
          <>
            <Notice tone="success" icon={<LuCheck />}>
              <span data-testid="registered-notice">{tournament.status === 'SEATING' ? t('lobby.registered_seating') : t('lobby.registered')}</span>
            </Notice>
            {(tournament.status === 'REGISTRATION_OPEN' || tournament.status === 'REGISTRATION_CLOSED') && (
              <Button variant="ghost" full className="mt-2" onClick={onUnregister} data-testid="unregister">
                {t('lobby.unregister')}
              </Button>
            )}
            <div className="mt-3 border-t border-line pt-3">
              {entry}
              {balanceRow}
            </div>
          </>
        );
        break;
      case 'requested':
        action = (
          <>
            <Notice tone="warning" icon={<LuHourglass />}>
              <span data-testid="requested-notice">{t('lobby.pending')}</span>
            </Notice>
            {(tournament.status === 'REGISTRATION_OPEN' || tournament.status === 'REGISTRATION_CLOSED') && (
              <Button variant="ghost" full className="mt-2" onClick={onUnregister}>
                {t('lobby.withdraw_request')}
              </Button>
            )}
          </>
        );
        break;
      case 'waitlisted': {
        const ahead = tournament.registrations.filter((r) => r.status === 'waitlisted').sort((a, b) => a.at - b.at).findIndex((r) => r.userId === me.id);
        action = (
          <>
            <Notice tone="info" icon={<LuListOrdered />}>
              <span data-testid="waitlisted-notice">{t('lobby.waitlisted', { n: ahead + 1 })}</span>
            </Notice>
            {(tournament.status === 'REGISTRATION_OPEN' || tournament.status === 'REGISTRATION_CLOSED') && (
              <Button variant="ghost" full className="mt-2" onClick={onUnregister}>
                {t('lobby.leave_waitlist')}
              </Button>
            )}
          </>
        );
        break;
      }
      case 'not_member':
        action = (
          <>
            <p className="text-[13.5px] leading-relaxed text-ink-2">{t('lobby.members_only', { club: club.name })}</p>
            <Button variant="primary" full className="mt-3" onClick={() => go('club', { clubId: club.id })}>
              {t('lobby.view_club')}
            </Button>
          </>
        );
        break;
      case 'club_suspended':
        action = <Notice tone="danger">{t('club.suspended')}</Notice>;
        break;
      case 'full':
        action = (
          <>
            {entry}
            <Notice tone="neutral" className="mt-3">
              {t('lobby.full')}
            </Notice>
          </>
        );
        break;
      case 'not_open_yet':
        action = (
          <>
            {entry}
            {balanceRow}
            <Notice tone="info" className="mt-3">
              {t('lobby.not_open_yet', { time: timeOfDay(tournament.registrationOpensAt, t.lang) })}
            </Notice>
          </>
        );
        break;
      case 'finished':
        action =
          tournament.status === 'COMPLETED' ? (
            <Button variant="primary" full onClick={() => go('results', { id: tournament.id })}>
              {t('lobby.view_results')}
            </Button>
          ) : (
            <p className="text-[13.5px] text-ink-2">{t('lobby.cancelled')}</p>
          );
        break;
      default:
        action = (
          <>
            <Notice tone="neutral">{t('lobby.closed')}</Notice>
            {running && canWatch && (
              <Button full className="mt-3" icon={<LuEye className="size-4" aria-hidden />} onClick={() => go('table', { id: tournament.id })} data-testid="observe">
                {t('lobby.observe')}
              </Button>
            )}
          </>
        );
    }
  }
  return (
    <>
      {action}
      {cost > 0 && note}
    </>
  );
}

function Movement({ delta }: { delta: number }) {
  if (delta > 0) return <LuArrowUp className="size-3.5 text-success" aria-label={`+${delta}`} />;
  if (delta < 0) return <LuArrowDown className="size-3.5 text-danger" aria-label={`${delta}`} />;
  return <LuMinus className="size-3.5 text-ink-3/60" aria-hidden />;
}

export function StandingsTable({ t, live, summary, meId, limit }: { t: T; live: TournamentLive; summary: LiveSummary; meId: string | null; limit?: number }) {
  const rows = standings(live);
  // Compare against a snapshot taken a little while ago to show who is climbing.
  const baseline = useRef<{ ranks: Map<string, number>; at: number }>({ ranks: new Map(), at: 0 });
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const l = runtime.getLive(live.id);
      if (!l) return;
      baseline.current = { ranks: new Map(standings(l).filter((r) => r.status === 'active').map((r) => [r.playerId, r.rank])), at: Date.now() };
      bump((n) => n + 1);
    }, 12_000);
    return () => clearInterval(id);
  }, [live.id]);
  const active = rows.filter((r) => r.status === 'active');
  const out = rows.filter((r) => r.status === 'out').sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const shown = limit ? active.slice(0, limit) : active;
  return (
    <Panel pad={false} data-testid="standings">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[420px] text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-3">
              <th className="w-12 py-2 ps-4 text-start font-medium">#</th>
              <th className="py-2 text-start font-medium">{t('standings.player')}</th>
              <th className="py-2 pe-3 text-end font-medium">{t('standings.chips')}</th>
              <th className="py-2 pe-3 text-end font-medium">BB</th>
              <th className="py-2 pe-3 text-end font-medium">{t('standings.table')}</th>
              <th className="w-10 py-2 pe-4 text-end font-medium">
                <span className="sr-only">{t('standings.movement')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <StandingRow key={r.playerId} t={t} r={r} me={r.playerId === meId} previous={baseline.current.ranks.get(r.playerId)} />
            ))}
            {!limit &&
              out.map((r) => (
                <tr key={r.playerId} className={cx('border-t border-line text-ink-3', r.playerId === meId && 'bg-accent/8')}>
                  <td className="py-2 ps-4 tabular-nums">{r.place}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span className="truncate">{r.name}</span>
                      {r.isBot && <BotTag label={t('common.bot')} />}
                    </span>
                  </td>
                  <td className="py-2 pe-3 text-end" colSpan={4}>
                    <span className="pe-1 text-[12.5px]">{t('standings.out')}</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3 tabular-nums">
        {t('standings.footer', { hands: chips(summary.hands), chips: chips(live.totalChips) })}
      </p>
    </Panel>
  );
}

function StandingRow({ t, r, me, previous }: { t: T; r: Standing; me: boolean; previous: number | undefined }) {
  return (
    <tr className={cx('border-t border-line first:border-0', me && 'bg-accent/10')}>
      <td className="py-2 ps-4 text-ink-2 tabular-nums">{r.rank}</td>
      <td className="py-2">
        <span className="flex items-center gap-2">
          <span className={cx('truncate', me ? 'font-semibold text-ink' : 'text-ink')}>{r.name}</span>
          {r.isBot && <BotTag label={t('common.bot')} />}
          {me && <Badge tone="accent">{t('table.you')}</Badge>}
        </span>
      </td>
      <td className="py-2 pe-3 text-end font-medium text-ink tabular-nums">{chips(r.stack)}</td>
      <td className="py-2 pe-3 text-end text-ink-2 tabular-nums">{Math.round(r.bigBlinds)}</td>
      <td className="py-2 pe-3 text-end text-ink-2 tabular-nums">{r.tableNo ?? '—'}</td>
      <td className="py-2 pe-4">
        <span className="flex justify-end">
          <Movement delta={previous === undefined ? 0 : previous - r.rank} />
        </span>
      </td>
    </tr>
  );
}

export function TablesGrid({ t, live, meId, tournamentId, canObserve, onPick, activeNo }: { t: T; live: TournamentLive; meId: string | null; tournamentId: string; canObserve: boolean; onPick?: (no: number) => void; activeNo?: number }) {
  const tables = activeTables(live);
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {tables.map((table) => {
          const seats = occupiedSeats(table.state);
          const mine = meId ? seats.some((s) => s.playerId === meId) : false;
          const click = onPick ? () => onPick(table.no) : canObserve ? () => go('table', mine ? { id: tournamentId } : { id: tournamentId, table: String(table.no) }) : undefined;
          return (
            <MiniTable
              key={table.no}
              table={table}
              highlightId={meId}
              onClick={click}
              active={activeNo === table.no || mine}
              label={mine ? t('lobby.your_table') : t('table.table_n', { n: table.no })}
              sub={t('lobby.table_players', { n: seats.length, max: table.state.maxSeats })}
            />
          );
        })}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">{canObserve ? t('lobby.tables_hint') : t('lobby.tables_hint_locked')}</p>
    </>
  );
}

function PlayersList({ t, db, tournament, live, meId }: { t: T; db: DB; tournament: Tournament; live: TournamentLive | undefined; meId: string }) {
  // Seated players, or the final field once the tournament is over. A request or a waiting-list place is the person's own business.
  const ids = entrantIds(db, tournament);
  const mine = api.registrationOf(tournament, meId);
  if (ids.length === 0 && !mine) {
    return <EmptyState icon={<LuUsers />} title={t('lobby.no_players.title')} body={t('lobby.no_players.body')} />;
  }
  const waiting = mine && (mine.status === 'requested' || mine.status === 'waitlisted' || mine.status === 'approved') ? mine : null;
  const sorted = [...(waiting ? [meId] : []), ...[...ids].sort((a, b) => Number(b === meId) - Number(a === meId))];
  return (
    <Panel pad={false}>
      <ul className="grid divide-line sm:grid-cols-2 sm:gap-x-px">
        {sorted.map((userId) => {
          const u = db.users[userId];
          if (!u) return null;
          const p = live?.players[userId];
          const pending = waiting !== null && userId === meId;
          return (
            <li key={userId} className={cx('flex items-center gap-2.5 border-b border-line px-4 py-2', userId === meId && 'bg-accent/8')}>
              <Avatar user={u} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{u.name}</span>
              {u.isBot && <BotTag label={t('common.bot')} />}
              {pending ? (
                <Badge tone={waiting.status === 'requested' ? 'warning' : waiting.status === 'waitlisted' ? 'info' : 'accent'}>{t(waiting.status === 'requested' ? 'tour.pending' : waiting.status === 'waitlisted' ? 'tour.waitlisted' : 'tour.invited')}</Badge>
              ) : p ? (
                <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{p.status === 'out' ? t('lobby.finished_n', { place: p.place ?? 0 }) : t('table.table_n', { n: p.tableNo ?? 0 })}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-2.5 text-[12px] text-ink-3">{t('lobby.bots_note')}</p>
    </Panel>
  );
}

function DetailsPanel({ t, tournament, club }: { t: T; tournament: Tournament; club: Club }) {
  const s = tournament.structure;
  return (
    <Panel>
      <PanelHeader title={t('lobby.rules_title')} />
      <ul className="max-w-[72ch] list-disc space-y-2 ps-5 text-[14px] leading-relaxed text-ink-2 marker:text-ink-3">
        <li>{t('lobby.rule.game')}</li>
        <li>{t('lobby.rule.stack', { stack: chips(s.startingStack), seats: s.tableSize })}</li>
        <li>{s.anteType === 'bb' ? t('lobby.rule.ante_bb') : s.anteType === 'classic' ? t('lobby.rule.ante_classic') : t('lobby.rule.ante_none')}</li>
        <li>{s.lateRegLevels > 0 ? t('lobby.rule.late', { n: s.lateRegLevels }) : t('lobby.rule.no_late')}</li>
        <li>{t('lobby.rule.reentry')}</li>
        <li>{t('lobby.rule.balance')}</li>
        <li>{t('lobby.rule.timeout')}</li>
        <li>{t('lobby.rule.points')}</li>
      </ul>
      <p className="mt-4 text-[12.5px] text-ink-3">{t('lobby.rule.club', { club: club.name })}</p>
    </Panel>
  );
}
