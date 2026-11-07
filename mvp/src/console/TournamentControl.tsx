import { useState, type ReactNode, useEffect } from 'react';
import { LuArrowLeft, LuArrowUp, LuBan, LuCheck, LuCheckCheck, LuCopy, LuExternalLink, LuEye, LuFastForward, LuKeyRound, LuLink, LuLock, LuLockOpen, LuMailPlus, LuPause, LuPencil, LuPlay, LuSend, LuTv, LuUndo2, LuUserPlus, LuUsers, LuX } from 'react-icons/lu';
import { act, runtime, toasts } from '../app/context.ts';
import { chips, clock, dateTime, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT, type T } from '../app/hooks.ts';
import type { TimelineEvent, TournamentLive } from '../engine/tournament.ts';
import * as api from '../platform/api.ts';
import * as crm from '../platform/crm.ts';
import { isTerminal, isUpcoming } from '../platform/lifecycle.ts';
import { can } from '../platform/permissions.ts';
import type { Club, DB, Registration, Tournament } from '../platform/types.ts';
import { StandingsTable, TablesGrid } from '../player/Lobby.tsx';
import { Results } from '../player/Results.tsx';
import { presetLabel, registeredText, StatusPill, StructureTable, structureSummary, TournamentClock, useLiveSummary } from '../shared/tournament.tsx';
import { Badge, BotTag, Button, cx, EmptyState, Fact, IconButton, Meter, Notice, Panel, PanelHeader } from '../ui/core.tsx';
import { Segmented, TextArea, TextInput } from '../ui/forms.tsx';
import { Avatar } from '../ui/identity.tsx';
import { ConfirmDialog, Dialog, Tabs } from '../ui/overlay.tsx';
import { auditText } from './shared.tsx';

type Tab = 'live' | 'registrations' | 'structure' | 'log' | 'results';

export function TournamentControl({ club, tournamentId }: { club: Club; tournamentId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(1000);
  const tournament = db.tournaments[tournamentId];
  const summary = useLiveSummary(tournamentId);
  const [tab, setTab] = useState<Tab | null>(null);
  const [confirm, setConfirm] = useState<'start' | 'pause' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  // When the tournament moves on (seating, running, finished) show the tab that matters for that phase.
  const phase = !tournament ? 'none' : tournament.status === 'COMPLETED' ? 'done' : tournament.status === 'SEATING' || tournament.status === 'RUNNING' || tournament.status === 'PAUSED' ? 'live' : 'before';
  useEffect(() => setTab(null), [phase]);

  if (!tournament || tournament.clubId !== club.id) {
    return <EmptyState title={t('lobby.not_found')} action={<Button onClick={() => go('console.tournaments', { clubId: club.id })}>{t('console.nav.tournaments')}</Button>} />;
  }
  const live = runtime.getLive(tournamentId);
  const status = tournament.status;
  const running = (status === 'RUNNING' || status === 'PAUSED') && !!live && !!summary;
  const allow = (p: Parameters<typeof can>[2]) => can(db, me.id, p, club.id);
  const registered = api.registeredCount(tournament);
  const pending = api.requestedCount(tournament);
  const needed = Math.max(2, tournament.minPlayers);
  const canStart = (status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED') && allow('tournaments.run');
  const activeTab: Tab = tab ?? (status === 'COMPLETED' ? 'results' : running || status === 'SEATING' ? 'live' : 'registrations');
  const audit = db.audit.filter((a) => a.clubId === club.id && a.params.name === tournament.name).reverse();

  const tabs: { value: Tab; label: string; count?: number }[] = [
    ...(status === 'COMPLETED' ? [{ value: 'results' as const, label: t('console.control.tab.results') }] : []),
    ...(running || status === 'SEATING' ? [{ value: 'live' as const, label: t('console.control.tab.live') }] : []),
    { value: 'registrations', label: t('console.control.tab.registrations'), count: pending },
    { value: 'structure', label: t('lobby.tab.structure') },
    { value: 'log', label: t('console.control.tab.log') },
  ];

  return (
    <div data-testid="tournament-control">
      <button type="button" onClick={() => go('console.tournaments', { clubId: club.id })} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        {t('console.nav.tournaments')}
      </button>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink sm:text-[26px]" data-testid="control-title">
                {tournament.name}
              </h1>
              <StatusPill status={status} lateReg={summary?.lateReg} />
            </div>
            <p className="mt-1 text-[13px] text-ink-2">
              {presetLabel(t, tournament)} · {structureSummary(t, tournament.structure)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === 'DRAFT' && allow('tournaments.create') && (
              <Button variant="primary" icon={<LuSend className="size-4 flip-rtl" aria-hidden />} onClick={() => act(() => api.publishTournament(db, me.id, tournament.id, { announce: true }), { key: 'wizard.published' })} data-testid="control-publish">
                {t('wizard.publish.action')}
              </Button>
            )}
            {(status === 'DRAFT' || status === 'SCHEDULED') && allow('tournaments.edit') && (
              <Button icon={<LuPencil className="size-4" aria-hidden />} onClick={() => go('console.wizard', { clubId: club.id, id: tournament.id })}>
                {t('common.edit')}
              </Button>
            )}
            {status === 'REGISTRATION_OPEN' && allow('tournaments.registrations') && (
              <Button icon={<LuLock className="size-4" aria-hidden />} onClick={() => act(() => api.closeRegistration(db, me.id, tournament.id), { key: 'console.control.reg_closed' })}>
                {t('console.control.close_reg')}
              </Button>
            )}
            {status === 'REGISTRATION_CLOSED' && allow('tournaments.registrations') && (
              <Button icon={<LuLockOpen className="size-4" aria-hidden />} onClick={() => act(() => api.openRegistration(db, me.id, tournament.id), { key: 'console.control.reg_opened' })}>
                {t('console.control.open_reg')}
              </Button>
            )}
            {canStart && (
              <Button variant="primary" icon={<LuPlay className="size-4" aria-hidden />} onClick={() => setConfirm('start')} disabled={registered < needed} title={registered < needed ? t('console.control.need_players', { n: needed }) : undefined} data-testid="control-start">
                {t('console.control.start_now')}
              </Button>
            )}
            {status === 'RUNNING' && allow('tournaments.run') && (
              <Button icon={<LuPause className="size-4" aria-hidden />} onClick={() => setConfirm('pause')} data-testid="control-pause">
                {t('console.control.pause')}
              </Button>
            )}
            {status === 'PAUSED' && allow('tournaments.run') && (
              <Button variant="primary" icon={<LuPlay className="size-4" aria-hidden />} onClick={() => act(() => runtime.setPaused(me.id, tournament.id, false), { key: 'console.control.resumed' })} data-testid="control-resume">
                {t('console.control.resume')}
              </Button>
            )}
            {status !== 'DRAFT' && (
              <Button variant="ghost" icon={<LuExternalLink className="size-4" aria-hidden />} onClick={() => go('tournament', { id: tournament.id })}>
                {t('console.control.player_view')}
              </Button>
            )}
            {(status === 'RUNNING' || status === 'PAUSED') && allow('tournaments.run') && (
              <Button variant="ghost" icon={<LuTv className="size-4" aria-hidden />} onClick={() => go('spectate', { id: tournament.id, mode: 'streamer', delay: '60000' })} data-testid="control-stream">
                {t('console.control.streamer_view')}
              </Button>
            )}
            {allow('tournaments.create') && (
              <IconButton
                label={t('console.tournaments.duplicate')}
                onClick={() => {
                  const copy = act(() => api.duplicateTournament(db, me.id, tournament.id), { key: 'console.tournaments.duplicated' });
                  if (copy) go('console.wizard', { clubId: club.id, id: copy.id });
                }}
              >
                <LuCopy className="size-4" aria-hidden />
              </IconButton>
            )}
            {!isTerminal(status) && status !== 'DRAFT' && allow('tournaments.cancel') && (
              <IconButton label={t('console.control.cancel')} onClick={() => setConfirm('cancel')} data-testid="control-cancel">
                <LuBan className="size-4 text-danger" aria-hidden />
              </IconButton>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4 lg:grid-cols-6">
          <Fact label={t('lobby.fact.start')}>
            {tournament.startMode === 'when_full' ? t('tour.when_full') : tournament.startMode === 'manual' ? t('lobby.start_manual') : dateTime(tournament.startAt, t.lang)}
          </Fact>
          <Fact label={t('lobby.fact.players')} wrap>{registeredText(t, tournament)}</Fact>
          <Fact label={t('lobby.entry')}>{tournament.entryPoints > 0 ? t('common.points_n', { n: chips(tournament.entryPoints) }) : t('common.free')}</Fact>
          <Fact label={t('wizard.visibility')} wrap>{t(`wizard.visibility.${tournament.visibility}`)}</Fact>
          <Fact label={t('wizard.access')} wrap>{t(`wizard.access.${tournament.access}`)}</Fact>
          <Fact label={t('console.control.created_by')}>{db.users[tournament.createdBy]?.name ?? '—'}</Fact>
        </dl>
      </Panel>

      {status === 'DRAFT' && (
        <Notice tone="info" className="mt-4">
          {t('console.control.draft_note')}
        </Notice>
      )}
      {status === 'SCHEDULED' && (
        <Notice tone="info" className="mt-4">
          {t('console.control.scheduled_note', { time: dateTime(tournament.registrationOpensAt, t.lang) })}
        </Notice>
      )}
      {canStart && tournament.startMode === 'scheduled' && (
        <Notice tone="neutral" className="mt-4">
          <span className="tabular-nums">
            {t('console.control.auto_start', { time: clock(Math.max(0, tournament.startAt - now)), n: needed, count: registered })}
          </span>
        </Notice>
      )}
      {status === 'CANCELLED' && (
        <Notice tone="danger" className="mt-4">
          {t('lobby.cancelled')} {tournament.cancelReason}
        </Notice>
      )}

      <Tabs value={activeTab} onChange={setTab} label={tournament.name} tabs={tabs} className="mt-5" />
      <div className="pt-4">
        {activeTab === 'live' &&
          (running && live ? (
            <LiveMonitor t={t} db={db} live={live} tournament={tournament} canRun={allow('tournaments.run')} meId={me.id} />
          ) : (
            <Notice tone="warning">{t('lobby.seating_title')}</Notice>
          ))}
        {activeTab === 'registrations' && <Registrations t={t} db={db} tournament={tournament} live={live} meId={me.id} canManage={allow('tournaments.registrations')} now={now} />}
        {activeTab === 'structure' && (
          <Panel>
            <StructureTable structure={tournament.structure} currentIndex={running && live ? live.levelIdx : undefined} />
          </Panel>
        )}
        {activeTab === 'log' && (
          <Panel>
            <PanelHeader title={t('console.control.tab.log')} hint={t('console.control.log_hint')} />
            {audit.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('audit.empty')}</p>
            ) : (
              <ol className="space-y-2.5 text-[13.5px]">
                {audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-ink">{auditText(t, a)}</span>
                    <span className="text-[12px] text-ink-3">
                      {a.actorId === api.SYSTEM ? t('audit.system') : (db.users[a.actorId]?.name ?? '—')} · {dateTime(a.at, t.lang)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}
        {activeTab === 'results' && <Results tournamentId={tournament.id} staffView />}
      </div>

      <ConfirmDialog
        open={confirm === 'start'}
        onClose={() => setConfirm(null)}
        onConfirm={() => act(() => runtime.beginSeating(me.id, tournament.id), { key: 'console.control.started' })}
        title={t('console.control.start_title')}
        body={t('console.control.start_body', { count: registered, pending })}
        confirmLabel={t('console.control.start_now')}
      />
      <ConfirmDialog
        open={confirm === 'pause'}
        onClose={() => setConfirm(null)}
        onConfirm={() => act(() => runtime.setPaused(me.id, tournament.id, true), { key: 'console.control.paused' })}
        title={t('console.control.pause_title')}
        body={t('console.control.pause_body')}
        confirmLabel={t('console.control.pause')}
      />
      <Dialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title={t('console.control.cancel_title')}
        description={t('console.control.cancel_body')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-cancel"
              onClick={() => {
                act(() => runtime.cancel(me.id, tournament.id, reason), { key: 'console.control.cancelled' });
                setConfirm(null);
              }}
            >
              {t('console.control.cancel')}
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="cancel-reason">
          {t('console.control.cancel_reason')}
        </label>
        <TextArea id="cancel-reason" value={reason} onChange={setReason} placeholder={t('console.control.cancel_reason_placeholder')} rows={2} />
      </Dialog>
    </div>
  );
}

function timelineText(t: T, db: DB, e: TimelineEvent): { text: string; tone: 'neutral' | 'accent' | 'warning' | 'gold' } | null {
  const name = (id: string | null) => (id ? (db.users[id]?.name ?? '—') : '—');
  switch (e.type) {
    case 'start':
      return { text: t('timeline.start', { players: e.players, tables: e.tables }), tone: 'accent' };
    case 'level':
      return { text: t('timeline.level', { level: e.level, sb: chips(e.sb, true), bb: chips(e.bb, true) }), tone: 'neutral' };
    case 'break':
      return { text: t('timeline.break', { minutes: e.minutes }), tone: 'warning' };
    case 'late_reg_closed':
      return { text: t('timeline.late_reg_closed'), tone: 'neutral' };
    case 'late_entry':
      return { text: t('timeline.late_entry', { name: name(e.playerId), table: e.tableNo }), tone: 'neutral' };
    case 'elimination':
      return { text: e.by ? t('timeline.elimination_by', { name: name(e.playerId), place: e.place, by: name(e.by) }) : t('timeline.elimination', { name: name(e.playerId), place: e.place }), tone: 'neutral' };
    case 'move':
      return { text: t(e.reason === 'balance' ? 'timeline.move_balance' : 'timeline.move_break', { name: name(e.playerId), from: e.from, to: e.to }), tone: 'neutral' };
    case 'table_closed':
      return { text: t('timeline.table_closed', { table: e.tableNo }), tone: 'accent' };
    case 'final_table':
      return { text: t('timeline.final_table', { players: e.players }), tone: 'gold' };
    case 'heads_up':
      return { text: t('timeline.heads_up'), tone: 'gold' };
    case 'paused':
      return { text: t('timeline.paused'), tone: 'warning' };
    case 'resumed':
      return { text: t('timeline.resumed'), tone: 'accent' };
    case 'complete':
      return { text: t('timeline.complete', { name: name(e.winnerId) }), tone: 'gold' };
    default:
      return null;
  }
}

function LiveMonitor({ t, db, live, tournament, canRun, meId }: { t: T; db: DB; live: TournamentLive; tournament: Tournament; canRun: boolean; meId: string }) {
  const summary = useLiveSummary(tournament.id)!;
  const [filter, setFilter] = useState<'all' | 'key'>('key');
  const events = live.timeline
    .filter((e) => (filter === 'all' ? true : e.type !== 'move' && e.type !== 'late_entry'))
    .slice(-60)
    .reverse();
  const dot: Record<string, string> = { neutral: 'bg-ink-3', accent: 'bg-accent', warning: 'bg-warning', gold: 'bg-gold' };
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <TournamentClock live={live} summary={summary} />

        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="warning">{t('demo.badge')}</Badge>
              <p className="text-[13.5px] font-medium text-ink">{t('console.control.speed')}</p>
            </div>
            <Segmented
              value={String(summary.speed)}
              onChange={(v) => act(() => runtime.setSpeed(meId, tournament.id, Number(v)))}
              label={t('console.control.speed')}
              options={[1, 10, 60, 240].map((n) => ({ value: String(n), label: n === 1 ? t('wizard.speed.real') : `×${n}` }))}
            />
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
            {canRun ? t('console.control.speed_hint') : t('console.control.speed_locked')} <LuFastForward className="inline size-3.5 -translate-y-px" aria-hidden /> {t('console.control.elapsed', { time: clock(live.clockMs) })}
          </p>
        </Panel>

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">{t('console.control.tables')}</h2>
            <span className="text-[12.5px] text-ink-3">
              <LuEye className="me-1 inline size-3.5 -translate-y-px" aria-hidden />
              {t('console.control.tables_hint')}
            </span>
          </div>
          <TablesGrid t={t} live={live} meId={null} tournamentId={tournament.id} canObserve />
        </section>

        <section>
          <h2 className="mb-2.5 text-[15px] font-semibold text-ink">{t('lobby.tab.standings')}</h2>
          <StandingsTable t={t} live={live} summary={summary} meId={null} limit={15} />
        </section>
      </div>

      <Panel className="self-start xl:sticky xl:top-0">
        <PanelHeader
          title={t('console.control.timeline')}
          action={
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              label={t('console.control.timeline')}
              options={[
                { value: 'key', label: t('console.control.timeline.key') },
                { value: 'all', label: t('common.all') },
              ]}
            />
          }
        />
        <ol className="max-h-[640px] space-y-2.5 overflow-y-auto pe-1 text-[13px]" data-testid="timeline">
          {events.map((e, i) => {
            const line = timelineText(t, db, e);
            if (!line) return null;
            return (
              <li key={`${e.type}-${e.clockMs}-${i}`} className="flex gap-2.5">
                <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', dot[line.tone])} aria-hidden />
                <span className="min-w-0 flex-1 leading-snug text-ink">{line.text}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums" dir="ltr">
                  {clock(e.clockMs)}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}

function Registrations({ t, db, tournament, live, meId, canManage, now }: { t: T; db: DB; tournament: Tournament; live: TournamentLive | undefined; meId: string; canManage: boolean; now: number }) {
  const [inviting, setInviting] = useState(false);
  const [search, setSearch] = useState('');
  const of = (status: Registration['status']) => tournament.registrations.filter((r) => r.status === status);
  const requests = of('requested').sort((a, b) => a.at - b.at);
  const invited = of('approved');
  const waiting = of('waitlisted').sort((a, b) => a.at - b.at);
  const registered = of('registered').sort((a, b) => b.at - a.at);
  const closed = tournament.registrations.filter((r) => r.status === 'rejected' || r.status === 'cancelled');
  const open = tournament.status === 'REGISTRATION_OPEN';
  const before = isUpcoming(tournament.status);
  const finished = isTerminal(tournament.status);
  const full = registered.length >= tournament.maxPlayers;
  // Invitation links made for this tournament.
  const links = crm.listLinks(db, meId, tournament.clubId).filter((l) => l.kind === 'tournament' && l.tournamentId === tournament.id);
  const q = search.trim().toLowerCase();
  const candidates =
    inviting && q.length >= 2
      ? api
          .listApprovedMembers(db, meId, tournament.clubId)
          .filter((m) => (m.user.name.toLowerCase().includes(q) || m.user.handle.toLowerCase().includes(q)) && !['registered', 'approved', 'waitlisted'].includes(api.registrationOf(tournament, m.user.id)?.status ?? ''))
          .slice(0, 6)
      : [];
  const copy = (text: string, doneKey: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toasts.push('success', t(doneKey)),
      () => toasts.push('info', text),
    );
  };
  const row = (userId: string, right: ReactNode, testId?: string) => {
    const u = db.users[userId];
    if (!u) return null;
    return (
      <li key={userId} className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2 last:border-0 sm:px-5" data-testid={testId}>
        <Avatar user={u} size={28} />
        <button type="button" className="min-w-0 flex-1 truncate text-start text-[13.5px] text-ink hover:underline" onClick={() => go('console.crm.player', { clubId: tournament.clubId, userId })}>
          {u.name}
        </button>
        {u.isBot && <BotTag label={t('common.bot')} />}
        {right}
      </li>
    );
  };
  const section = (title: ReactNode, hint: string | undefined, body: ReactNode, action?: ReactNode) => (
    <Panel pad={false}>
      <div className="px-4 pt-4 sm:px-5">
        <PanelHeader title={title} hint={hint} action={action} />
      </div>
      {body}
    </Panel>
  );

  return (
    <div className="space-y-5">
      <Panel data-testid="access-panel">
        <PanelHeader
          title={t('console.access.title')}
          hint={t(`wizard.access.${tournament.access}_hint`)}
          action={
            canManage && !finished && tournament.status !== 'DRAFT' ? (
              <>
                <Button size="sm" icon={<LuMailPlus className="size-4" aria-hidden />} onClick={() => setInviting(true)} data-testid="invite-member">
                  {t('console.access.invite_member')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LuLink className="size-4" aria-hidden />}
                  data-testid="invite-link"
                  onClick={() => act(() => crm.createLink(db, meId, tournament.clubId, { kind: 'tournament', tournamentId: tournament.id, source: 'other', label: tournament.name.slice(0, 40), expiresInDays: 7, maxUses: null }), { key: 'crm.toast.link_created' })}
                >
                  {t('console.access.new_link')}
                </Button>
              </>
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tournament.visibility === 'public' ? 'info' : 'neutral'}>{t(`tour.visibility.${tournament.visibility}`)}</Badge>
          <Badge tone="accent">{t(`wizard.access.${tournament.access}`)}</Badge>
          {tournament.accessCode !== null && (
            <button type="button" onClick={() => copy(tournament.accessCode ?? '', 'console.access.code_copied')} className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-raised-2/70 px-2 text-[11.5px] font-medium text-ink" title={t('console.access.copy_code')} data-testid="access-code-value">
              <LuKeyRound className="size-3" aria-hidden />
              <span dir="ltr" className="tracking-[0.1em]">
                {tournament.accessCode}
              </span>
              <LuCopy className="size-3 text-ink-3" aria-hidden />
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="flex items-baseline justify-between text-[12.5px] text-ink-2 tabular-nums">
              <span>{t('console.access.capacity')}</span>
              <span dir="ltr" data-testid="capacity">
                <span className="font-semibold text-ink">{registered.length}</span> / {tournament.maxPlayers}
              </span>
            </p>
            <Meter value={registered.length} max={tournament.maxPlayers} tone={full ? 'warning' : 'accent'} className="mt-1.5" label={t('console.access.capacity')} />
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2 tabular-nums">
            <div>
              <dt className="inline text-ink-3">{t('console.access.requests')} </dt>
              <dd className="inline font-medium text-ink">{requests.length}</dd>
            </div>
            <div>
              <dt className="inline text-ink-3">{t('console.access.invited')} </dt>
              <dd className="inline font-medium text-ink">{invited.length}</dd>
            </div>
            <div>
              <dt className="inline text-ink-3">{t('console.access.waiting')} </dt>
              <dd className="inline font-medium text-ink">{waiting.length}</dd>
            </div>
          </dl>
        </div>
        {links.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3" data-testid="tournament-links">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <LuLink className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink-2" dir="ltr">
                  {crm.linkUrl(link.token)}
                </span>
                <span className="text-ink-3 tabular-nums">{t('console.access.link_uses', { n: link.uses })}</span>
                <Badge tone={link.problem === null ? 'success' : 'neutral'}>{t(`crm.links.state.${link.problem ?? 'active'}`)}</Badge>
                <button type="button" aria-label={t('crm.links.copy')} title={t('crm.links.copy')} className="inline-flex size-7 items-center justify-center rounded-chip text-ink-3 hover:bg-raised hover:text-ink" onClick={() => copy(crm.linkUrl(link.token), 'crm.links.copied')}>
                  <LuCopy className="size-3.5" aria-hidden />
                </button>
                {canManage && link.revokedAt === null && (
                  <button type="button" aria-label={t('crm.links.revoke')} title={t('crm.links.revoke')} className="inline-flex size-7 items-center justify-center rounded-chip text-ink-3 hover:bg-raised hover:text-danger" onClick={() => act(() => crm.revokeLink(db, meId, tournament.clubId, link.id), { key: 'crm.toast.link_revoked' })}>
                    <LuX className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] leading-snug text-ink-3">{t('wizard.access_note')}</p>
      </Panel>

      {open && canManage && tournament.format !== 'sng' && tournament.access !== 'invite' && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 border-dashed border-warning/40">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
              <Badge tone="warning">{t('demo.badge')}</Badge>
              {t('console.control.simulated_title')}
            </p>
            <p className="mt-1 text-[12.5px] text-ink-3">{tournament.simulateRegistrations ? t('console.control.simulated_on') : t('console.control.simulated_off')}</p>
          </div>
          <Button
            icon={<LuUserPlus className="size-4" aria-hidden />}
            data-testid="add-simulated"
            onClick={() => {
              const added = act(() => runtime.addSimulatedPlayers(meId, tournament.id, 9));
              if (added !== undefined) toasts.push('info', t('console.control.simulated_added', { n: added }));
            }}
          >
            {t('console.control.add_simulated')}
          </Button>
        </Panel>
      )}

      {(requests.length > 0 || tournament.access === 'approval') &&
        section(
          <>
            {t('console.control.requests')}
            {requests.length > 0 && <Badge tone="warning">{requests.length}</Badge>}
          </>,
          t('console.control.requests_hint'),
          requests.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-ink-3 sm:px-5">{t('console.control.no_requests')}</p>
          ) : (
            <ul className="border-t border-line" data-testid="reg-requests">
              {requests.map((r) =>
                row(
                  r.userId,
                  <>
                    <span className="hidden shrink-0 text-[12px] text-ink-3 sm:inline">{relativeTime(r.at, now, t.lang)}</span>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" icon={<LuX className="size-3.5 text-danger" aria-hidden />} onClick={() => act(() => api.rejectRegistration(db, meId, tournament.id, r.userId))} data-testid={`reject-reg-${r.userId}`}>
                          {t('members.reject')}
                        </Button>
                        <Button size="sm" variant="primary" icon={<LuCheck className="size-3.5" aria-hidden />} data-testid="approve-reg" onClick={() => act(() => api.approveRegistration(db, meId, tournament.id, r.userId), full ? { key: 'console.access.approved_waitlist' } : undefined)}>
                          {t('members.approve')}
                        </Button>
                      </>
                    )}
                  </>,
                  `reg-request-${r.userId}`,
                ),
              )}
            </ul>
          ),
          canManage && requests.length > 1 ? (
            <Button
              size="sm"
              icon={<LuCheckCheck className="size-4" aria-hidden />}
              data-testid="approve-all-regs"
              onClick={() =>
                act(() => {
                  for (const r of requests) api.approveRegistration(db, meId, tournament.id, r.userId);
                })
              }
            >
              {t('console.access.approve_all')}
            </Button>
          ) : undefined,
        )}

      {invited.length > 0 &&
        section(
          t('console.access.invited_title', { n: invited.length }),
          t('console.access.invited_hint'),
          <ul className="border-t border-line" data-testid="reg-invited">
            {invited.map((r) =>
              row(
                r.userId,
                <>
                  {r.viaLinkId && <Badge>{t('console.access.via_link')}</Badge>}
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => act(() => api.revokeRegistration(db, meId, tournament.id, r.userId), { key: 'console.access.revoked' })}>
                      {t('console.access.revoke')}
                    </Button>
                  )}
                </>,
              ),
            )}
          </ul>,
        )}

      {waiting.length > 0 &&
        section(
          t('console.access.waiting_title', { n: waiting.length }),
          t('console.access.waiting_hint'),
          <ol className="border-t border-line" data-testid="reg-waiting">
            {waiting.map((r, i) =>
              row(
                r.userId,
                <>
                  <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">#{i + 1}</span>
                  {canManage && before && (
                    <>
                      <Button size="sm" icon={<LuArrowUp className="size-3.5" aria-hidden />} disabled={full} onClick={() => act(() => api.promoteWaitlisted(db, meId, tournament.id, r.userId))}>
                        {t('console.access.seat')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act(() => api.revokeRegistration(db, meId, tournament.id, r.userId), { key: 'console.access.revoked' })}>
                        {t('console.access.remove')}
                      </Button>
                    </>
                  )}
                </>,
              ),
            )}
          </ol>,
        )}

      {section(
        t('console.control.registered', { n: registered.length, max: tournament.maxPlayers }),
        undefined,
        registered.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState icon={<LuUsers />} title={t('lobby.no_players.title')} body={t('console.control.no_players_body')} />
          </div>
        ) : (
          <ul className="max-h-[480px] overflow-y-auto border-t border-line" data-testid="reg-confirmed">
            {registered.map((r) => {
              const p = live?.players[r.userId];
              return row(
                r.userId,
                <>
                  <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{p ? (p.status === 'out' ? t('lobby.finished_n', { place: p.place ?? 0 }) : t('table.table_n', { n: p.tableNo ?? 0 })) : relativeTime(r.at, now, t.lang)}</span>
                  {canManage && before && (
                    <Button size="sm" variant="ghost" onClick={() => act(() => api.revokeRegistration(db, meId, tournament.id, r.userId), { key: 'console.access.revoked' })} data-testid={`revoke-${r.userId}`}>
                      {t('console.access.revoke')}
                    </Button>
                  )}
                </>,
                `reg-confirmed-${r.userId}`,
              );
            })}
          </ul>
        ),
      )}

      {closed.length > 0 &&
        section(
          t('console.access.closed_title', { n: closed.length }),
          t('console.access.closed_hint'),
          <ul className="border-t border-line" data-testid="reg-closed">
            {closed.map((r) =>
              row(
                r.userId,
                <>
                  <Badge tone={r.cancelledBy === 'staff' ? 'danger' : 'neutral'}>{t(r.status === 'rejected' ? 'console.access.state.rejected' : r.cancelledBy === 'staff' ? 'console.access.state.revoked' : 'console.access.state.released')}</Badge>
                  {canManage && !finished && (
                    <Button size="sm" variant="ghost" icon={<LuUndo2 className="size-3.5" aria-hidden />} onClick={() => act(() => api.authorizePlayer(db, meId, tournament.id, r.userId), { key: 'console.access.restored' })}>
                      {t('console.access.restore')}
                    </Button>
                  )}
                </>,
              ),
            )}
          </ul>,
        )}

      <Dialog open={inviting} onClose={() => setInviting(false)} title={t('console.access.invite_member')} description={t('console.access.invite_hint')}>
        <TextInput type="search" value={search} onChange={setSearch} placeholder={t('members.search')} data-autofocus aria-label={t('members.search')} data-testid="invite-search" />
        {q.length >= 2 && candidates.length === 0 && <p className="mt-3 text-[13px] text-ink-3">{t('console.access.no_candidates')}</p>}
        {candidates.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-inner border border-line">
            {candidates.map(({ user }) => (
              <li key={user.id} className="flex items-center gap-2.5 px-3 py-2">
                <Avatar user={user} size={28} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{user.name}</span>
                {user.isBot && <BotTag label={t('common.bot')} />}
                <Button size="sm" variant="primary" onClick={() => act(() => api.authorizePlayer(db, meId, tournament.id, user.id), { key: 'crm.toast.invited', params: { name: user.name } })} data-testid={`invite-pick-${user.id}`}>
                  {t('crm.invite.send')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] leading-snug text-ink-3">{t('console.access.invite_note')}</p>
      </Dialog>
    </div>
  );
}
