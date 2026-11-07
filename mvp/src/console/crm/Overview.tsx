import { useState } from 'react';
import { LuChevronRight, LuMessagesSquare, LuMoonStar, LuUserPlus } from 'react-icons/lu';
import { RetentionAlerts } from './RetentionAlerts.tsx';
import { num } from '../../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import { overviewReport } from '../../platform/analytics.ts';
import { can } from '../../platform/permissions.ts';
import type { Club } from '../../platform/types.ts';
import { BarChart, LineChart, StatTile } from '../../ui/charts.tsx';
import { DemoTag, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { dayLabels, defaultRange, RangePicker, rangeOf, useReport } from './shared.tsx';

export function CrmOverview({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [range, setRange] = useState(() => defaultRange('30', now));
  const { from, to, days } = rangeOf(range, now, club);
  const o = useReport(() => overviewReport(db, me.id, club.id, from, to), [club.id, me.id, Math.round(from / 60_000), Math.round(to / 60_000)]);
  const period = range.preset === 'custom' ? t('crm.range.custom_period') : range.preset === 'all' ? t('crm.range.all') : t('crm.range.last_days', { n: days });
  const labels = dayLabels(o.growth, t);
  const demo = o.includesDemoHistory ? <DemoTag label={t('common.demo_history')} /> : undefined;
  const attention = [
    { key: 'requests', count: o.pendingRequests, icon: <LuUserPlus />, open: () => go('console.crm.requests', { clubId: club.id }), show: true },
    { key: 'messages', count: o.unreadMessages, icon: <LuMessagesSquare />, open: () => go('console.crm.inbox', { clubId: club.id }), show: can(db, me.id, 'crm.messages', club.id) },
    // Opens exactly the people the figure counts.
    { key: 'inactive', count: o.inactiveMembers, icon: <LuMoonStar />, open: () => go('console.crm.players', { clubId: club.id, ids: o.inactiveMemberIds.join(',') }), show: o.inactiveMembers > 0 },
  ].filter((x) => x.show);

  return (
    <div data-testid="crm-overview">
      <PageHeader title={t('crm.overview.title')} subtitle={t('crm.overview.subtitle')} actions={<RangePicker value={range} onChange={setRange} presets={['7', '30', '90', 'custom']} t={t} />} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('crm.kpi.total_members')} value={<span data-testid="kpi-total-members">{num(o.totalMembers)}</span>} hint={t('crm.kpi.total_members_hint', { approved: num(o.approvedMembers) })} />
        <StatTile label={t('crm.kpi.followers')} value={<span data-testid="kpi-followers">{num(o.followers)}</span>} hint={t('crm.kpi.followers_hint')} />
        <StatTile label={t('crm.kpi.pending')} value={<span data-testid="kpi-pending">{num(o.pendingRequests)}</span>} hint={t('crm.kpi.pending_hint')} />
        <StatTile label={t('crm.kpi.inactive')} value={num(o.inactiveMembers)} hint={t('crm.kpi.inactive_hint')} />
      </div>
      <p className="mt-5 mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-2">
        {period}
        {demo}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('crm.kpi.new_members')} value={num(o.newMembers)} trend={o.approvals.map((p) => p.value)} />
        <StatTile label={t('crm.kpi.active_players')} value={<span data-testid="kpi-active-players">{num(o.activePlayers)}</span>} hint={t('crm.kpi.active_players_hint')} trend={o.engagement.map((p) => p.value)} />
        <StatTile label={t('crm.kpi.returning')} value={num(o.returningPlayers)} hint={t('crm.kpi.returning_hint')} trend={o.returning.map((p) => p.value)} />
        <StatTile label={t('crm.kpi.tournaments')} value={num(o.tournamentsPlayed)} hint={t('crm.kpi.tournaments_hint')} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHeader title={t('crm.chart.growth')} hint={t('crm.chart.growth_hint')} />
          <LineChart title={t('crm.chart.growth')} labels={labels} series={[{ name: t('crm.kpi.approved_members'), values: o.growth.map((p) => p.value) }]} />
        </Panel>
        <Panel>
          <PanelHeader title={t('crm.attention.title')} />
          <ul className="space-y-1.5">
            {attention.map((item) => (
              <li key={item.key}>
                <button type="button" onClick={item.open} className="flex w-full items-center gap-3 rounded-inner border border-line px-3 py-2.5 text-start hover:border-line-strong hover:bg-raised/60" data-testid={`attention-${item.key}`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink-2 [&>svg]:size-4">{item.icon}</span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-ink">{t.n(`crm.attention.${item.key}`, item.count)}</span>
                  <LuChevronRight className="size-4 shrink-0 text-ink-3 flip-rtl" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('crm.overview.source_note')}</p>
        </Panel>
      </div>

      <RetentionAlerts club={club} className="mt-4" />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t('crm.chart.participation')} hint={t('crm.chart.participation_hint')} action={demo} />
          <BarChart title={t('crm.chart.participation')} data={o.participation.map((p, i) => ({ label: labels[i]!, value: p.value }))} />
        </Panel>
        <Panel>
          <PanelHeader title={t('crm.chart.engagement')} hint={t('crm.chart.engagement_hint')} action={demo} />
          <LineChart title={t('crm.chart.engagement')} labels={labels} series={[{ name: t('crm.chart.engagement'), values: o.engagement.map((p) => p.value) }]} />
        </Panel>
        <Panel>
          <PanelHeader title={t('crm.chart.returning')} hint={t('crm.chart.returning_hint')} action={demo} />
          <LineChart title={t('crm.chart.returning')} labels={labels} series={[{ name: t('crm.chart.returning'), values: o.returning.map((p) => p.value) }]} area={false} />
        </Panel>
        <Panel>
          <PanelHeader title={t('crm.chart.approvals')} hint={t('crm.chart.approvals_hint')} />
          <BarChart title={t('crm.chart.approvals')} data={o.approvals.map((p, i) => ({ label: labels[i]!, value: p.value }))} />
        </Panel>
      </div>
    </div>
  );
}
