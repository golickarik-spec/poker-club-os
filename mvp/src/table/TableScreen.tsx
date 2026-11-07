import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  LuArmchair,
  LuArrowLeft,
  LuCoffee,
  LuEllipsisVertical,
  LuEye,
  LuHourglass,
  LuList,
  LuPause,
  LuScrollText,
  LuTrophy,
  LuUsers,
  LuVolume2,
  LuVolumeX, LuLock } from 'react-icons/lu';
import { act, runtime, session } from '../app/context.ts';
import { blindsLabel, chips, clock, ordinal } from '../app/format.ts';
import { go, useDb, useMe, useMediaQuery, useNow, useRuntime, useSettings, useT, type T } from '../app/hooks.ts';
import { bestHigh } from '../engine/hands.ts';
import { gameShort } from '../shared/tournament.tsx';
import { variantOf } from '../engine/variants.ts';
import { tabledEquities } from '../engine/equity.ts';
import { mathRng } from '../engine/rng.ts';
import { entryAt } from '../engine/structure.ts';
import { activeTables, averageStack, currentBlinds, currentLevelNumber, levelRemainingMs, remainingPlayers, standings, type TournamentLive } from '../engine/tournament.ts';
import * as api from '../platform/api.ts';
import type { TableDriver } from '../platform/runtime.ts';
import { canWatchTournament } from '../platform/api.ts';
import { DomainError, type Club, type DB, type Tournament } from '../platform/types.ts';
import { Badge, BotTag, Button, cx, EmptyState, IconButton } from '../ui/core.tsx';
import { accentStyle, ClubMark } from '../ui/identity.tsx';
import { Dialog, Menu, MenuItem, Tabs } from '../ui/overlay.tsx';
import { ActionBar } from './ActionBar.tsx';
import { playSound } from './sound.ts';
import type { Person } from './TableStage.tsx';
import { TableStage } from '../app/variants.ts';
import { V3 } from '../app/design.ts';
import { resolveTableBranding } from '../platform/table-branding.ts';
import { handName, logLine, stageLabels, type LogLine } from './text.tsx';

/** Attach a table driver for the lifetime of the screen. */
function useTableDriver(tournamentId: string, viewerId: string | null, requestedTable: number | null, turnSeconds: number, pace: number): TableDriver | null {
  const [driver, setDriver] = useState<TableDriver | null>(null);
  const liveExists = useRuntime(() => runtime.getLive(tournamentId) !== undefined);
  useEffect(() => {
    const live = runtime.getLive(tournamentId);
    if (!live) {
      setDriver(null);
      return;
    }
    const me = viewerId ? live.players[viewerId] : undefined;
    const seated = me && me.status === 'active' && me.tableNo !== null;
    const tableNo = seated ? me.tableNo! : requestedTable && live.tables.some((x) => x.no === requestedTable && !x.closed) ? requestedTable : (activeTables(live)[0]?.no ?? 1);
    let d: TableDriver;
    try {
      // The runtime checks that this person may watch (or sit at) this table.
      d = runtime.attach(viewerId, tournamentId, tableNo, !!seated, { turnSeconds, pace });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      setDriver(null);
      return;
    }
    setDriver(d);
    return () => {
      if (runtime.driver === d) runtime.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, viewerId, requestedTable, liveExists]);
  useEffect(() => {
    driver?.setOptions({ turnSeconds, pace });
  }, [driver, turnSeconds, pace]);
  useSyncExternalStore(driver ? driver.subscribe : noSubscribe, driver ? driver.getVersion : zero, zero);
  return driver;
}
const noSubscribe = () => () => {};
const zero = () => 0;

function personLookup(db: DB, live: TournamentLive | undefined): (id: string) => Person {
  return (id) => {
    const u = db.users[id];
    if (u) return { name: u.name, hue: u.hue, isBot: u.isBot };
    const p = live?.players[id];
    return { name: p?.name ?? '—', hue: 200, isBot: p?.isBot ?? true };
  };
}

export function TableScreen({ tournamentId, tableNo }: { tournamentId: string; tableNo: number | null }) {
  const t = useT();
  const db = useDb();
  const me = useMe();
  const settings = useSettings();
  // v0.4 responsible play: a gentle reminder every N minutes of sitting at a table.
  const sessionStart = useRef(Date.now());
  const [remindedAt, setRemindedAt] = useState(Date.now());
  const sessionTick = useNow(30_000);
  const reminderEvery = settings.responsible?.sessionReminderMin ?? 0;
  const sessionReminder = reminderEvery > 0 && sessionTick - remindedAt >= reminderEvery * 60_000 ? Math.round((sessionTick - sessionStart.current) / 60_000) : null;
  const tournament = db.tournaments[tournamentId];
  const club = tournament ? db.clubs[tournament.clubId] : undefined;
  const reduced = settings.animations === 'reduced';
  const driver = useTableDriver(tournamentId, me?.id ?? null, tableNo, settings.turnSeconds, reduced ? 0.6 : 1);
  const compact = useMediaQuery('(max-width: 767px)');
  const wide = useMediaQuery('(min-width: 1180px)');
  const [panel, setPanel] = useState<'log' | 'standings' | 'info'>('log');
  const [sheet, setSheet] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const logSeq = useRef(0);
  const lastLogged = useRef(0);

  const live = runtime.getLive(tournamentId);
  const hud = useRuntime(() => {
    const l = runtime.getLive(tournamentId);
    if (!l) return null;
    const blinds = currentBlinds(l);
    const entry = entryAt(l.structure, l.levelIdx);
    return {
      level: currentLevelNumber(l),
      sb: blinds.sb,
      bb: blinds.bb,
      ante: blinds.ante,
      onBreak: entry.kind === 'break',
      remaining: Math.ceil(levelRemainingMs(l) / 1000),
      left: remainingPlayers(l),
      entrants: l.entrants,
      average: averageStack(l),
      status: l.status,
      hands: l.handsPlayed,
      speed: l.speed,
    };
  });
  const person = useMemo(() => personLookup(db, live), [db, live]);

  const view = driver?.view;
  const heroSeat = driver ? driver.viewerSeat() : null;
  const nameOf = (seat: number): string => {
    const s = view?.seats[seat];
    if (!s) return String(seat + 1);
    return heroSeat === seat ? t('table.you') : person(s.playerId).name;
  };
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;

  // Hand log + sounds, driven by the events the driver presents.
  useEffect(() => {
    if (!driver || driver.eventCount === lastLogged.current) return;
    lastLogged.current = driver.eventCount;
    const e = driver.lastEvent;
    if (!e) return;
    if (settings.sound) {
      if (e.t === 'hole' && e.seat === heroSeat) playSound('card');
      else if (e.t === 'action') playSound(e.type === 'fold' ? 'fold' : e.type === 'check' ? 'check' : 'chip');
      else if (e.t === 'street') playSound('card');
      else if (e.t === 'award') playSound('win');
    }
    const line = logLine(t, e, (seat) => nameRef.current(seat), (seat) => seat === heroSeat);
    if (line) setLog((prev) => [...prev.slice(-120), { ...line, id: ++logSeq.current }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.eventCount]);

  const ownTurn = driver?.legal ?? null;
  useEffect(() => {
    if (ownTurn && settings.sound) playSound('turn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownTurn?.seat, ownTurn?.currentBet, ownTurn?.pot]);

  // Equity while hands are tabled before the river.
  const equities = useMemo(() => {
    if (!driver || !view || !driver.allInRunout) return null;
    const tabled = view.seats.filter((s) => s && s.inHand && !s.folded && s.cards && s.cards.length === 2);
    if (tabled.length < 2) return null;
    const eq = tabledEquities(tabled.map((s) => s!.cards!), view.board, mathRng(), 2500, variantOf(view.variant));
    const out: Record<number, number> = {};
    tabled.forEach((s, i) => (out[s!.seat] = eq[i]!));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.allInRunout, view?.board.length, view?.handNo]);

  const heroCards = heroSeat !== null ? view?.seats[heroSeat]?.cards : null;
  const heroHand = useMemo(() => {
    if (!heroCards || heroCards.length < 2 || !view || view.board.length < 3) return null;
    const high = bestHigh(variantOf(view.variant), heroCards, view.board);
    return high ? handName(t, high.score, variantOf(view.variant).ranking) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroCards?.[0], heroCards?.[1], view?.board.length, t]);

  if (!tournament || !club) {
    return <ScreenMessage title={t('table.not_found')} action={<Button onClick={() => go('home')}>{t('nav.home')}</Button>} />;
  }
  if (!canWatchTournament(db, me?.id ?? null, tournament)) {
    return (
      <ScreenMessage
        icon={<LuLock />}
        title={t('lobby.private.title')}
        body={t('lobby.private.tables')}
        action={<Button onClick={() => go('club', { clubId: club.id })}>{t('lobby.view_club')}</Button>}
        style={accentStyle(club.branding.accent)}
      />
    );
  }
  const result = db.results[tournamentId];
  // Staff who opened the table from the control room go back there; everyone else goes to the lobby.
  const backToLobby = () => (session.state.history.at(-1)?.name === 'console.tournament' ? session.back('tournament', { id: tournamentId }) : go('tournament', { id: tournamentId }));

  if (!live || !driver || !view) {
    if (result || tournament.status === 'COMPLETED') {
      return (
        <ScreenMessage
          icon={<LuTrophy />}
          title={t('table.finished_title')}
          body={result ? t('table.finished_body', { name: result.places[0]?.name ?? '' }) : undefined}
          action={
            <Button variant="primary" onClick={() => go('results', { id: tournamentId })}>
              {t('lobby.view_results')}
            </Button>
          }
          style={accentStyle(club.branding.accent)}
        />
      );
    }
    return (
      <ScreenMessage
        icon={<LuHourglass />}
        title={t('table.not_running_title')}
        body={t('table.not_running_body')}
        action={<Button onClick={backToLobby}>{t('table.back_to_lobby')}</Button>}
      />
    );
  }

  const mePlayer = me ? live.players[me.id] : undefined;
  const observing = heroSeat === null;
  // The felt and the mark on it come from the tournament's table branding, falling back to the club.
  const tableBranding = resolveTableBranding(tournament, club);
  // A player's own theme preference still wins; a custom club scheme only applies when they follow the club.
  const theme = settings.tableTheme === 'club' ? tableBranding.theme : settings.tableTheme;
  const themeVars = settings.tableTheme === 'club' ? tableBranding.vars : undefined;
  const labels = stageLabels(t, t('table.table_n', { n: driver.tableNo }), compact);
  const ranked = standings(live);
  const myRank = me ? ranked.find((r) => r.playerId === me.id) : undefined;

  let centreNotice: ReactNode = null;
  if (driver.waiting === 'break' && hud) {
    centreNotice = <FeltNotice icon={<LuCoffee />} title={t('table.break_title')} body={t('table.break_body', { time: clock(hud.remaining * 1000) })} />;
  } else if (driver.waiting === 'paused') {
    centreNotice = <FeltNotice icon={<LuPause />} title={t('table.paused_title')} body={t('table.paused_body')} />;
  } else if (driver.waiting === 'players' && view.street === 'idle') {
    centreNotice = <FeltNotice icon={<LuUsers />} title={tournament.status === 'SEATING' ? t('table.seating_title') : t('table.waiting_title')} body={t('table.waiting_body')} />;
  }

  const sidePanel = (
    <SidePanel
      t={t}
      panel={panel}
      setPanel={setPanel}
      log={log}
      ranked={ranked}
      meId={me?.id ?? null}
      bb={hud?.bb ?? 0}
      tournament={tournament}
      live={live}
      club={club}
      tableNo={driver.tableNo}
    />
  );

  return (
    <div className={cx('flex h-full min-h-0 flex-col', V3 ? 'pc3-floor' : 'bg-[#080b0f]')} style={accentStyle(club.branding.accent)} data-testid="table-screen">
      {/* HUD */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-2 py-1.5 sm:px-4">
        <IconButton label={t('table.back_to_lobby')} onClick={backToLobby} data-testid="table-back">
          <LuArrowLeft className="size-5 flip-rtl" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[14px] font-semibold text-ink sm:text-[15px]">
              {tournament.name}
              {tournament.game && tournament.game !== 'nlhe' && <span className="ms-2 rounded-chip border border-line-strong/70 px-1.5 py-px text-[10.5px] font-semibold tracking-[0.03em] text-ink-2" title={t(`variant.${tournament.game}`)}>{gameShort(tournament.game)}</span>}
            </h1>
            <span className="hidden shrink-0 text-[12.5px] text-ink-3 sm:inline">{t('table.table_n', { n: driver.tableNo })}</span>
            {observing && (
              <Badge tone="info">
                <LuEye className="size-3" aria-hidden />
                {t('table.observing')}
              </Badge>
            )}
          </div>
          {hud && (
            <div className="mt-0.5 flex items-center gap-x-2.5 overflow-hidden text-[12px] whitespace-nowrap text-ink-2 tabular-nums sm:gap-x-3">
              <span>
                <span className="text-ink-3">{compact ? 'L' : t('table.level_short')}</span>
                {compact ? '' : ' '}
                <span className="font-medium text-ink">{hud.level}</span>
              </span>
              <span className="font-medium text-ink" dir="ltr" data-testid="hud-blinds">
                {blindsLabel(hud)}
              </span>
              <span className={cx(hud.onBreak && 'text-warning')}>
                {!compact && <>{hud.onBreak ? t('table.break_short') : t('table.next_short')} </>}
                <span dir="ltr">{clock(hud.remaining * 1000)}</span>
              </span>
              <span className="hidden sm:inline">
                <span className="text-ink-3">{t('table.players_short')}</span> {hud.left}/{hud.entrants}
              </span>
              <span className="hidden md:inline">
                <span className="text-ink-3">{t('table.avg_short')}</span> {chips(hud.average, true)}
              </span>
              {hud.speed > 1 && <span className="hidden text-warning md:inline">{t('table.demo_clock', { n: hud.speed })}</span>}
            </div>
          )}
        </div>
        {myRank && myRank.status === 'active' && hud && (
          <div className="shrink-0 rounded-control bg-raised px-2.5 py-1 text-center leading-tight" title={t('table.your_position')}>
            <div className="text-[10.5px] text-ink-3">{t('table.position')}</div>
            <div className="text-[13.5px] font-semibold text-ink tabular-nums" data-testid="hud-rank">
              {myRank.rank}
              <span className="font-normal text-ink-3">/{hud.left}</span>
            </div>
          </div>
        )}
        {!wide && (
          <IconButton label={t('table.open_panel')} onClick={() => setSheet(true)} data-testid="table-panel-button">
            <LuScrollText className="size-5" aria-hidden />
          </IconButton>
        )}
        <Menu
          trigger={(p) => (
            <IconButton label={t('table.menu')} {...p}>
              <LuEllipsisVertical className="size-5" aria-hidden />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={settings.sound ? <LuVolume2 /> : <LuVolumeX />}
                hint={settings.sound ? t('common.on') : t('common.off')}
                onClick={() => {
                  if (me) act(() => api.updateSettings(db, me.id, { sound: !settings.sound }));
                }}
              >
                {t('settings.sound')}
              </MenuItem>
              <MenuItem
                icon={<LuList />}
                hint={settings.showBigBlinds ? 'BB' : t('table.chips')}
                onClick={() => {
                  if (me) act(() => api.updateSettings(db, me.id, { showBigBlinds: !settings.showBigBlinds }));
                }}
              >
                {t('table.stack_display')}
              </MenuItem>
              {!observing && mePlayer?.status === 'active' && (
                <MenuItem
                  icon={<LuArmchair />}
                  onClick={() => {
                    driver.setAway(!driver.isAway());
                    close();
                  }}
                >
                  {driver.isAway() ? t('table.im_back') : t('table.sit_out')}
                </MenuItem>
              )}
              <MenuItem
                icon={<LuArrowLeft className="flip-rtl" />}
                onClick={() => {
                  close();
                  backToLobby();
                }}
              >
                {t('table.back_to_lobby')}
              </MenuItem>
            </>
          )}
        </Menu>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Banners for things that happened to the viewer */}
          {driver.notice?.type === 'moved' && (
            <TopBanner onClose={() => driver.clearNotice()} tone="info">
              {t('table.moved', { from: driver.notice.from, to: driver.notice.to })}
            </TopBanner>
          )}
          {driver.notice?.type === 'final_table' && (
            <TopBanner onClose={() => driver.clearNotice()} tone="gold">
              {t('table.final_table')}
            </TopBanner>
          )}
          {sessionReminder !== null && (
            <TopBanner onClose={() => setRemindedAt(Date.now())} tone="info">
              {t('table.session_reminder', { minutes: sessionReminder })}
            </TopBanner>
          )}

          <div className="relative min-h-0 flex-1 px-1 pt-1 sm:px-4 sm:pt-3">
            <TableStage
              view={view}
              heroSeat={heroSeat}
              person={person}
              turn={driver.turn}
              theme={theme}
              themeVars={themeVars}
              deck={settings.deck}
              showBigBlinds={settings.showBigBlinds}
              lastEvent={driver.lastEvent}
              eventCount={driver.eventCount}
              equities={equities}
              heroHandName={heroHand}
              heroAway={driver.isAway()}
              watermark={tableBranding.logo ? <ClubMark branding={{ ...club.branding, logo: tableBranding.logo }} size={compact ? 26 : 40} /> : undefined}
              logoOpacity={tableBranding.opacity}
              logoScale={tableBranding.scale}
              centreNotice={centreNotice}
              labels={labels}
              motion={!reduced}
            />
          </div>

          {/* Action area */}
          <div className="shrink-0 border-t border-line bg-surface/80 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-3 sm:pb-3" style={{ minHeight: compact ? 76 : 96 }}>
            {driver.legal && driver.turn ? (
              <ActionBar
                legal={driver.legal}
                bb={view.blinds?.bb ?? hud?.bb ?? 1}
                startedAt={driver.turn.startedAt}
                durationMs={driver.turn.durationMs}
                confirmLarge={settings.confirmLargeBets}
                compact={compact}
                onAct={(action) => {
                  const r = driver.act(action);
                  if (!r.ok) runtime.touch();
                }}
              />
            ) : (
              <IdleBar t={t} driver={driver} observing={observing} out={mePlayer?.status === 'out'} toActName={view.toAct >= 0 ? nameOf(view.toAct) : null} viewerToAct={view.toAct >= 0 && view.toAct === heroSeat} />
            )}
          </div>
        </div>

        {wide && <aside className="flex w-[340px] shrink-0 flex-col border-s border-line bg-surface/60">{sidePanel}</aside>}
      </div>

      {!wide && (
        <Dialog open={sheet} onClose={() => setSheet(false)} title={t('table.table_n', { n: driver.tableNo })} size="md">
          <div className="-mx-5 flex h-[60vh] flex-col">{sidePanel}</div>
        </Dialog>
      )}

      {/* Elimination / winner */}
      <Dialog
        open={driver.notice?.type === 'eliminated'}
        onClose={() => driver.clearNotice()}
        title={driver.notice?.type === 'eliminated' ? t('table.out_title', { place: ordinal(driver.notice.place, t.lang) }) : ''}
        description={driver.notice?.type === 'eliminated' ? t('table.out_body', { entrants: driver.notice.entrants, points: api.rankingPoints(driver.notice.entrants, driver.notice.place) }) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => driver.clearNotice()}>
              {t('table.keep_watching')}
            </Button>
            <Button variant="primary" onClick={() => go(result ? 'results' : 'tournament', { id: tournamentId })} data-testid="out-to-lobby">
              {result ? t('lobby.view_results') : t('table.back_to_lobby')}
            </Button>
          </>
        }
      />
      <Dialog
        open={driver.notice?.type === 'winner'}
        onClose={() => driver.clearNotice()}
        title={driver.notice?.type === 'winner' && driver.notice.playerId === me?.id ? t('table.won_title_you') : t('table.won_title')}
        description={driver.notice?.type === 'winner' ? t('table.won_body', { name: person(driver.notice.playerId).name, tournament: tournament.name }) : undefined}
        size="sm"
        footer={
          <Button variant="primary" onClick={() => go('results', { id: tournamentId })} data-testid="winner-results">
            {t('lobby.view_results')}
          </Button>
        }
      >
        <div className="flex justify-center py-2 text-gold">
          <LuTrophy className="size-12" aria-hidden />
        </div>
      </Dialog>
    </div>
  );
}

function ScreenMessage({ icon, title, body, action, style }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode; style?: Record<string, string> }) {
  return (
    <div className="flex h-full items-center justify-center p-6" style={style}>
      <EmptyState icon={icon} title={title} body={body} action={action} className="w-full max-w-md" />
    </div>
  );
}

function FeltNotice({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex animate-pop flex-col items-center gap-1 rounded-panel bg-black/65 px-5 py-3 text-center ring-1 ring-white/10 backdrop-blur-sm">
      <span className="text-white/80 [&>svg]:size-5">{icon}</span>
      <p className="text-[14px] font-semibold text-white">{title}</p>
      <p className="text-[12.5px] text-white/70 tabular-nums">{body}</p>
    </div>
  );
}

function TopBanner({ children, onClose, tone }: { children: ReactNode; onClose: () => void; tone: 'info' | 'gold' }) {
  useEffect(() => {
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="absolute inset-x-0 top-2 z-40 flex justify-center px-3">
      <button
        type="button"
        onClick={onClose}
        className={cx('animate-rise rounded-full px-4 py-1.5 text-[13px] font-medium shadow-xl', tone === 'gold' ? 'bg-gold text-[#1c1505]' : 'bg-info text-[#06162e]')}
      >
        {children}
      </button>
    </div>
  );
}

function IdleBar({ t, driver, observing, out, toActName, viewerToAct }: { t: T; driver: TableDriver; observing: boolean; out: boolean; toActName: string | null; viewerToAct: boolean }) {
  if (driver.isAway()) {
    return (
      <div className="flex h-full flex-wrap items-center justify-center gap-3 py-1">
        <p className="text-[13px] text-ink-2">{t('table.away_body')}</p>
        <Button variant="primary" onClick={() => driver.setAway(false)} data-testid="im-back">
          {t('table.im_back')}
        </Button>
      </div>
    );
  }
  let text = t('table.idle_waiting');
  if (out) text = t('table.idle_out');
  else if (observing) text = toActName ? t('table.idle_observing_turn', { name: toActName }) : t('table.idle_observing');
  else if (viewerToAct) text = t('table.idle_your_turn_soon');
  else if (toActName) text = t('table.idle_turn', { name: toActName });
  return (
    <div className="flex h-full min-h-[52px] items-center justify-center">
      <p className="text-center text-[13px] text-ink-2">{text}</p>
    </div>
  );
}

function SidePanel({
  t,
  panel,
  setPanel,
  log,
  ranked,
  meId,
  bb,
  tournament,
  live,
  club,
  tableNo,
}: {
  t: T;
  panel: 'log' | 'standings' | 'info';
  setPanel: (p: 'log' | 'standings' | 'info') => void;
  log: LogLine[];
  ranked: ReturnType<typeof standings>;
  meId: string | null;
  bb: number;
  tournament: Tournament;
  live: TournamentLive;
  club: Club;
  tableNo: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el && panel === 'log') el.scrollTop = el.scrollHeight;
  }, [log.length, panel]);
  const next = entryAt(live.structure, live.levelIdx + 1);
  return (
    <>
      <Tabs
        value={panel}
        onChange={setPanel}
        label={t('table.panel')}
        className="shrink-0 px-2"
        tabs={[
          { value: 'log', label: t('table.tab.log') },
          { value: 'standings', label: t('table.tab.standings') },
          { value: 'info', label: t('table.tab.info') },
        ]}
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {panel === 'log' &&
          (log.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-3">{t('table.log.empty')}</p>
          ) : (
            <ol className="space-y-1 text-[12.5px] leading-snug text-ink-2" aria-live="off">
              {log.map((line) => (
                <li
                  key={line.id}
                  className={cx(
                    line.kind === 'hand' && 'mt-3 border-t border-line pt-2 text-[11.5px] font-medium text-ink-3 first:mt-0 first:border-0 first:pt-0',
                    line.kind === 'street' && 'text-ink',
                    line.kind === 'result' && 'text-ink',
                  )}
                >
                  {line.node}
                </li>
              ))}
            </ol>
          ))}
        {panel === 'standings' && (
          <ol className="text-[13px]">
            {ranked
              .filter((r) => r.status === 'active')
              .map((r) => (
                <li key={r.playerId} className={cx('flex items-center gap-2 rounded-chip px-1.5 py-1.5', r.playerId === meId && 'bg-accent/10')}>
                  <span className="w-6 shrink-0 text-end text-ink-3 tabular-nums">{r.rank}</span>
                  <span className={cx('min-w-0 flex-1 truncate', r.playerId === meId ? 'font-medium text-ink' : 'text-ink-2')}>{r.name}</span>
                  {r.isBot && <BotTag label={t('common.bot')} />}
                  <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums">T{r.tableNo}</span>
                  <span className="w-[68px] shrink-0 text-end font-medium text-ink tabular-nums">{chips(r.stack, true)}</span>
                  <span className="hidden w-12 shrink-0 text-end text-[11.5px] text-ink-3 tabular-nums sm:inline">{bb > 0 ? `${Math.round(r.stack / bb)} BB` : ''}</span>
                </li>
              ))}
          </ol>
        )}
        {panel === 'info' && (
          <dl className="space-y-3 text-[13px]">
            <InfoRow label={t('common.club')} value={club.name} />
            <InfoRow label={t('table.tab.info_table')} value={t('table.table_n', { n: tableNo })} />
            <InfoRow label={t('lobby.starting_stack')} value={chips(live.structure.startingStack)} />
            <InfoRow label={t('lobby.chips_in_play')} value={chips(live.totalChips)} />
            <InfoRow label={t('lobby.hands_played')} value={chips(live.handsPlayed)} />
            <InfoRow
              label={t('lobby.next_level')}
              value={next.kind === 'break' ? t('lobby.break_n', { n: next.minutes }) : blindsLabel(next)}
            />
            <InfoRow label={t('lobby.entry')} value={tournament.entryPoints > 0 ? t('common.points_n', { n: chips(tournament.entryPoints) }) : t('common.free')} />
            <p className="rounded-control bg-raised px-3 py-2 text-[12px] leading-relaxed text-ink-3">{t('table.info_note')}</p>
          </dl>
        )}
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-end font-medium text-ink tabular-nums" dir="auto">
        {value}
      </dd>
    </div>
  );
}
