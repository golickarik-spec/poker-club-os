import { LuArrowRight, LuCalendarPlus, LuCheck, LuUserCheck, LuX } from 'react-icons/lu';
import { act, runtime } from '../app/context.ts';
import { num, percent, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useRuntime, useT } from '../app/hooks.ts';
import { overviewReport } from '../platform/analytics.ts';
import * as api from '../platform/api.ts';
import * as crm from '../platform/crm.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { can } from '../platform/permissions.ts';
import { clubTournaments, resultsFor, scheduleOrder } from '../platform/selectors.ts';
import type { Club } from '../platform/types.ts';
import { dayLabel, StatusPill, useLiveBrief } from '../shared/tournament.tsx';
import { BarChart, KpiStrip, LineChart, StatTile } from '../ui/charts.tsx';
import { V3 } from '../app/design.ts';
import { inboxUnread } from '../platform/messaging.ts';
import { Badge, BotTag, Button, DemoTag, EmptyState, IconButton, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Avatar } from '../ui/identity.tsx';
import { dayLabels, useReport } from './crm/shared.tsx';
import { auditText } from './shared.tsx';

export function Dashboard({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  // Everything on this page is counted from records: memberships, tournament results and the club's event log.
  const day = Math.floor(now / 86_400_000);
  const data = useReport(() => ({ o: overviewReport(db, me.id, club.id, now - 30 * 86_400_000, now), pending: crm.queryPlayers(db, me.id, club.id, { statuses: ['pending'] }).rows.sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0)) }), [club.id, me.id, day]);
  const { o, pending } = data;
  const tournaments = clubTournaments(db, club.id).sort(scheduleOrder);
  const live = tournaments.filter((x) => isLive(x.status));
  const upcoming = tournaments.filter((x) => isUpcoming(x.status));
  const results = resultsFor(db, { clubId: club.id });
  const completed30 = results.filter((r) => r.completedAt > now - 30 * 86_400_000).length;
  const labels = dayLabels(o.engagement, t);
  const week = o.engagement.slice(-7).reduce((n, p) => n + p.value, 0);
  const prevWeek = o.engagement.slice(-14, -7).reduce((n, p) => n + p.value, 0);
  const delta = prevWeek > 0 ? week / prevWeek - 1 : undefined;
  const seated = useRuntime(() => {
    let n = 0;
    for (const x of live) {
      const l = runtime.getLive(x.id);
      if (l) for (const id in l.players) if (l.players[id]!.status === 'active') n++;
    }
    return n;
  });
  const canApprove = can(db, me.id, 'members.approve', club.id);
  const canCreate = can(db, me.id, 'tournaments.create', club.id);
  const recentAudit = db.audit.filter((a) => a.clubId === club.id).slice(-6).reverse();
  const demo = o.includesDemoHistory ? <DemoTag label={t('common.demo_history')} /> : undefined;
  const unread = can(db, me.id, 'crm.messages', club.id) ? inboxUnread(db, me.id, club.id) : 0;
  const newMembers7 = db.memberships.filter((m) => m.clubId === club.id && m.status === 'active' && (m.joinedAt ?? 0) > now - 7 * 86_400_000).length;

  return (
    <>
      <PageHeader
        title={t('console.home.title')}
        subtitle={t('console.home.subtitle', { club: club.name })}
        actions={
          canCreate ? (
            <Button variant="primary" icon={<LuCalendarPlus className="size-4" aria-hidden />} onClick={() => go('console.wizard', { clubId: club.id })} data-testid="new-tournament">
              {t('console.tournaments.new')}
            </Button>
          ) : undefined
        }
      />

      {V3 ? (
        <KpiStrip
          title={t('console.kpi.today')}
          demo={demo}
          items={[
            { label: t('console.kpi.members'), value: num(o.approvedMembers), hint: t('console.kpi.active_share', { pct: percent(o.activePlayers / Math.max(1, o.approvedMembers)) }), onClick: () => go('console.crm.players', { clubId: club.id }) },
            { label: t('console.kpi.active_30'), value: num(o.activePlayers), hint: t('console.kpi.new_7d') + ': ' + num(newMembers7), onClick: () => go('console.crm.analytics', { clubId: club.id, tab: 'engagement' }) },
            { label: t('console.kpi.running'), value: num(live.length), hint: t('console.kpi.at_tables') + ': ' + num(seated), tone: live.length > 0 ? 'accent' : 'default', onClick: () => go('console.tournaments', { clubId: club.id }) },
            { label: t('console.kpi.upcoming'), value: num(upcoming.length), hint: t('console.kpi.tournaments_hint', { upcoming: upcoming.length, completed: completed30 }), onClick: () => go('console.tournaments', { clubId: club.id }) },
            { label: t('console.kpi.pending'), value: num(pending.length), tone: pending.length > 0 ? 'warning' : 'default', hint: pending.length > 0 ? t.n('console.kpi.pending', pending.length) : t('console.kpi.no_pending'), onClick: canApprove ? () => go('console.crm.requests', { clubId: club.id }) : undefined, testId: 'kpi-pending' },
            { label: t('console.kpi.unread'), value: num(unread), tone: unread > 0 ? 'warning' : 'default', onClick: can(db, me.id, 'crm.messages', club.id) ? () => go('console.crm.inbox', { clubId: club.id }) : undefined },
          ]}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('console.kpi.members')} value={num(o.approvedMembers)} hint={pending.length > 0 ? t.n('console.kpi.pending', pending.length) : t('console.kpi.no_pending')} />
          <StatTile label={t('console.kpi.active_30')} value={num(o.activePlayers)} hint={t('console.kpi.active_share', { pct: percent(o.activePlayers / Math.max(1, o.approvedMembers)) })} demo={demo} trend={o.engagement.map((p) => p.value)} />
          <StatTile label={t('console.kpi.at_tables')} value={num(seated)} hint={t('console.kpi.at_tables_hint')} />
          <StatTile
            label={t('console.kpi.tournaments')}
            value={
              <>
                {live.length} <span className="text-[15px] font-normal text-ink-3">{t('console.kpi.live')}</span>
              </>
            }
            hint={t('console.kpi.tournaments_hint', { upcoming: upcoming.length, completed: completed30 })}
          />
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title={t('console.chart.dau')} hint={delta !== undefined ? t('console.chart.vs_prev', { pct: `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}%` }) : undefined} action={demo} />
              <LineChart title={t('console.chart.dau')} labels={labels} series={[{ name: t('console.chart.dau'), values: o.engagement.map((p) => p.value) }]} height={200} />
            </Panel>
            <Panel>
              <PanelHeader title={t('console.chart.entries')} hint={t('console.chart.entries_hint')} action={demo} />
              <BarChart title={t('console.chart.entries')} data={o.participation.slice(-14).map((p, i, list) => ({ label: labels[labels.length - list.length + i]!, value: p.value }))} height={200} />
            </Panel>
          </div>

          <Panel pad={false}>
            <div className="px-4 pt-4 sm:px-5">
              <PanelHeader
                title={t('console.home.schedule')}
                action={
                  <Button size="sm" variant="ghost" trailing={<LuArrowRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go('console.tournaments', { clubId: club.id })}>
                    {t('console.home.all_tournaments')}
                  </Button>
                }
              />
            </div>
            {live.length + upcoming.length === 0 ? (
              <div className="px-4 pb-4 sm:px-5">
                <EmptyState title={t('console.home.no_schedule')} body={t('console.home.no_schedule_body')} />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {[...live, ...upcoming].slice(0, 6).map((x) => (
                  <ScheduleRow key={x.id} tournamentId={x.id} clubId={club.id} now={now} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader
              title={
                <>
                  {t('console.home.requests')}
                  {pending.length > 0 && <Badge tone="warning">{pending.length}</Badge>}
                </>
              }
              action={
                <Button size="sm" variant="ghost" onClick={() => go('console.crm.requests', { clubId: club.id })}>
                  {t('console.nav.requests')}
                </Button>
              }
            />
            {pending.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-ink-3">
                <LuUserCheck className="size-4" aria-hidden />
                {t('console.home.no_requests')}
              </p>
            ) : (
              <ul className="space-y-2">
                {pending.slice(0, 5).map((r) => (
                  <li key={r.userId} className="flex items-center gap-2.5">
                    <Avatar user={r} size={32} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-ink">
                        <span className="truncate">{r.name}</span>
                        {r.isBot && <BotTag label={t('common.bot')} />}
                      </p>
                      <p className="text-[12px] text-ink-3">{r.requestedAt ? relativeTime(r.requestedAt, now, t.lang) : ''}</p>
                    </div>
                    {canApprove && (
                      <>
                        <IconButton label={t('members.reject')} size="sm" onClick={() => act(() => api.rejectMember(db, me.id, club.id, r.userId), { key: 'members.rejected' })}>
                          <LuX className="size-4 text-danger" aria-hidden />
                        </IconButton>
                        <IconButton label={t('members.approve')} size="sm" className="bg-accent/12 text-accent hover:bg-accent/20" data-testid="dash-approve" onClick={() => act(() => api.approveMember(db, me.id, club.id, r.userId), { key: 'members.approved' })}>
                          <LuCheck className="size-4 text-accent" aria-hidden />
                        </IconButton>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title={t('console.home.activity')}
              action={
                can(db, me.id, 'audit.view', club.id) ? (
                  <Button size="sm" variant="ghost" onClick={() => go('console.audit', { clubId: club.id })}>
                    {t('console.nav.audit')}
                  </Button>
                ) : undefined
              }
            />
            {recentAudit.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('audit.empty')}</p>
            ) : (
              <ol className="space-y-3">
                {recentAudit.map((a) => (
                  <li key={a.id} className="flex gap-2.5 text-[13px]">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                    <div className="min-w-0">
                      <p className="leading-snug text-ink">{auditText(t, a)}</p>
                      <p className="mt-0.5 text-[12px] text-ink-3">
                        {a.actorId === api.SYSTEM ? t('audit.system') : (db.users[a.actorId]?.name ?? '—')} · {relativeTime(a.at, now, t.lang)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function ScheduleRow({ tournamentId, clubId, now }: { tournamentId: string; clubId: string; now: number }) {
  const t = useT();
  const db = useDb();
  const x = db.tournaments[tournamentId]!;
  const brief = useLiveBrief(tournamentId);
  return (
    <li>
      <button type="button" onClick={() => go('console.tournament', { clubId, id: x.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-raised/50 sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{x.name}</span>
          <span className="block truncate text-[12.5px] text-ink-3 tabular-nums">
            {brief ? t('console.row.live', { level: brief.level, left: brief.left, entrants: brief.entrants }) : x.startMode === 'when_full' ? t('tour.when_full') : `${dayLabel(t, x.startAt, now)} · ${relativeTime(x.startAt, now, t.lang)}`}
          </span>
        </span>
        {!brief && (
          <span className="shrink-0 text-[12.5px] text-ink-2 tabular-nums">
            {api.registeredCount(x)}/{x.maxPlayers}
          </span>
        )}
        <StatusPill status={x.status} lateReg={brief?.lateReg} />
      </button>
    </li>
  );
}
