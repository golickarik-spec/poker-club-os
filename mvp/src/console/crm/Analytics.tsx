import { useState } from 'react';
import { LuArrowDown, LuArrowRight, LuArrowUp, LuInfo, LuMinus, LuUsers } from 'react-icons/lu';
import { monthLabel, num } from '../../app/format.ts';
import { go, useDb, useMe, useNow, useT, type T } from '../../app/hooks.ts';
import * as analytics from '../../platform/analytics.ts';
import type { FunnelKind, FunnelResult, FunnelStageKey, Kpi } from '../../platform/analytics.ts';
import * as crm from '../../platform/crm.ts';
import { can } from '../../platform/permissions.ts';
import type { Club } from '../../platform/types.ts';
import { presetLabel } from '../../shared/tournament.tsx';
import { BarChart, Heatmap, LineChart, RankBars, Sparkline, StatTile } from '../../ui/charts.tsx';
import { Button, cx, DemoTag, EmptyState, Notice, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Segmented, Select } from '../../ui/forms.tsx';
import { Tabs } from '../../ui/overlay.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { BulkActions } from './Players.tsx';
import { SchedulingTab, WeeklyTab } from './Scheduling.tsx';
import { dayLabels, defaultRange, LifecycleBadge, pct, PlayerCell, RangePicker, rangeOf, StatusBadge, TagList, useReport, type RangeState } from './shared.tsx';

type Tab = 'funnel' | 'retention' | 'acquisition' | 'engagement' | 'scheduling' | 'weekly';
type WindowChoice = '7' | '14' | '30' | '60' | '90' | 'none';

// =============================================================================
// Conversion funnel
// =============================================================================

function Change({ kpi, t }: { kpi: Kpi; t: T }) {
  if (kpi.change === null) return <span className="text-ink-3">{t('crm.kpi.no_previous')}</span>;
  const up = kpi.change > 0.0005;
  const down = kpi.change < -0.0005;
  const Icon = up ? LuArrowUp : down ? LuArrowDown : LuMinus;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={cx('size-3.5', up ? 'text-success' : down ? 'text-danger' : 'text-ink-3')} aria-hidden />
      <span className={cx('font-medium tabular-nums', up ? 'text-success' : down ? 'text-danger' : 'text-ink-2')} dir="ltr">
        {up ? '+' : ''}
        {(kpi.change * 100).toFixed(1)}%
      </span>
      <span className="text-ink-3">{t('crm.kpi.vs_previous')}</span>
    </span>
  );
}

function KpiCard({ id, kpi, rate, t, unit }: { id: string; kpi: Kpi; rate: boolean; t: T; unit: string }) {
  const show = (v: number | null): string => (v === null ? '—' : rate ? pct(v, 1) : v.toFixed(2));
  const trend = kpi.trend.filter((v): v is number => v !== null);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-surface p-4" data-testid={`kpi-${id}`}>
      <p className="text-[12.5px] text-ink-2">{t(`crm.kpi.${id}`)}</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[28px] leading-none font-semibold text-ink tabular-nums" dir="ltr" data-testid={`kpi-${id}-value`}>
          {show(kpi.value)}
        </p>
        {trend.length >= 2 && <Sparkline values={trend} className="shrink-0" />}
      </div>
      <p className="text-[12px] tabular-nums">
        <Change kpi={kpi} t={t} />
      </p>
      <p className="text-[12px] text-ink-3 tabular-nums">
        {t(rate ? 'crm.kpi.fraction' : 'crm.kpi.entries_by', { n: num(kpi.numerator), d: num(kpi.denominator), unit })} · {t('crm.kpi.previous', { value: show(kpi.previous) })}
      </p>
      <p className="mt-auto flex gap-1.5 border-t border-line pt-2 text-[12px] leading-snug text-ink-3">
        <LuInfo className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t(`crm.kpi.${id}_definition`)}
      </p>
    </div>
  );
}

/**
 * Horizontal funnel. Every bar starts at zero and its length is the stage's
 * share of the starting cohort, so lengths can be compared directly. The slim
 * bar underneath is the previous period on the same scale.
 */
function FunnelChart({ current, previous, selected, onSelect, t }: { current: FunnelResult; previous: FunnelResult; selected: FunnelStageKey | null; onSelect: (key: FunnelStageKey) => void; t: T }) {
  if (current.cohort === 0) {
    return <EmptyState icon={<LuUsers />} title={t('crm.funnel.empty.title')} body={current.tooRecent > 0 ? t('crm.funnel.empty.too_recent', { n: current.tooRecent }) : t('crm.funnel.empty.body')} />;
  }
  return (
    <ol className="space-y-1" data-testid="funnel">
      {current.stages.map((stage, i) => {
        const before = previous.stages[i];
        const active = selected === stage.key;
        return (
          <li key={stage.key}>
            {stage.dropOff !== null && (
              <p className="flex items-center gap-1.5 py-1 ps-1 text-[12px] text-ink-3 tabular-nums sm:ps-[10.5rem]" data-testid={`dropoff-${stage.key}`}>
                <LuArrowDown className="size-3.5" aria-hidden />
                {t('crm.funnel.drop_off', { n: num(stage.dropOff), pct: pct(stage.dropOffRate, 1) })}
              </p>
            )}
            <button
              type="button"
              onClick={() => onSelect(stage.key)}
              aria-pressed={active}
              className={cx('grid w-full grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-inner border px-3 py-2.5 text-start transition-colors sm:grid-cols-[9.5rem_minmax(0,1fr)_11rem]', active ? 'border-accent/60 bg-accent/[0.07]' : 'border-transparent hover:bg-raised/60')}
              data-testid={`stage-${stage.key}`}
            >
              <span className="text-[13.5px] font-medium text-ink">{t(`crm.funnel.stage.${stage.key}`)}</span>
              <span className="block min-w-0" dir="ltr">
                <span className="block h-6 rounded-chip bg-raised">
                  <span className="block h-full rounded-chip bg-accent" style={{ width: `${stage.ofCohort * 100}%`, minWidth: stage.count > 0 ? 2 : 0 }} />
                </span>
                {before && previous.cohort > 0 && (
                  <span className="mt-1 block h-1 rounded-full bg-raised" title={t('crm.funnel.previous_period')}>
                    <span className="block h-full rounded-full bg-ink-3/70" style={{ width: `${before.ofCohort * 100}%` }} />
                  </span>
                )}
              </span>
              <span className="flex items-baseline justify-between gap-3 text-[13px] tabular-nums sm:justify-end">
                <span className="text-[17px] font-semibold text-ink" data-testid={`stage-${stage.key}-count`}>
                  {num(stage.count)}
                </span>
                <span className="text-end leading-tight">
                  <span className="block text-ink-2" data-testid={`stage-${stage.key}-of-cohort`}>
                    {t('crm.funnel.of_cohort', { pct: pct(stage.ofCohort, 1) })}
                  </span>
                  {stage.ofPrevious !== null && (
                    <span className="block text-[12px] text-ink-3" data-testid={`stage-${stage.key}-of-previous`}>
                      {t('crm.funnel.of_previous', { pct: pct(stage.ofPrevious, 1) })}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function FunnelTab({ club, range, setRange }: { club: Club; range: RangeState; setRange: (r: RangeState) => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [kind, setKind] = useState<FunnelKind>('followers');
  const [windowChoice, setWindowChoice] = useState<WindowChoice>('30');
  const [selected, setSelected] = useState<FunnelStageKey | null>(null);
  const { from, to } = rangeOf(range, now, club);
  const windowDays = windowChoice === 'none' ? null : Number(windowChoice);
  const key = [club.id, me.id, kind, Math.round(from / 60_000), Math.round(to / 60_000), windowDays];
  const report = useReport(() => analytics.funnelReport(db, me.id, club.id, { kind, from, to, windowDays }), key);
  const kpis = useReport(() => analytics.kpiReport(db, me.id, club.id, from, to, windowDays), key);
  const stage = selected ? report.current.stages.find((s) => s.key === selected) : undefined;
  const drill = useReport(() => (stage ? { rows: crm.queryPlayers(db, me.id, club.id, { userIds: stage.userIds, sort: 'most_active' }).rows, tags: crm.listTags(db, me.id, club.id) } : null), [...key, selected]);
  const overall = report.current.stages.at(-1);
  const before = report.previous.stages.at(-1);

  return (
    <div className="space-y-4" data-testid="analytics-funnel">
      <Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <Segmented<FunnelKind>
            value={kind}
            onChange={(k) => {
              setKind(k);
              setSelected(null);
            }}
            label={t('crm.funnel.view')}
            size="sm"
            options={[
              { value: 'followers', label: t('crm.funnel.view.followers') },
              { value: 'acquisition', label: t('crm.funnel.view.acquisition') },
            ]}
          />
          <RangePicker value={range} onChange={setRange} presets={['7', '30', '60', '90', 'all', 'custom']} t={t} />
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            {t('crm.funnel.window')}
            <Select<WindowChoice> value={windowChoice} onChange={setWindowChoice} className="h-8 w-auto text-[12.5px]" data-testid="funnel-window" options={(['7', '14', '30', '60', '90', 'none'] as WindowChoice[]).map((w) => ({ value: w, label: w === 'none' ? t('crm.funnel.window.none') : t('crm.range.days', { n: w }) }))} />
          </label>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">{t(kind === 'followers' ? 'crm.funnel.explain.followers' : 'crm.funnel.explain.acquisition')} {windowDays === null ? t('crm.funnel.explain.to_date') : t('crm.funnel.explain.window', { n: windowDays })}</p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard id="follower_to_member" kpi={kpis.followerToMember} rate t={t} unit={t('crm.kpi.unit.followers')} />
        <KpiCard id="member_to_player" kpi={kpis.memberToPlayer} rate t={t} unit={t('crm.kpi.unit.members')} />
        <KpiCard id="repeat_rate" kpi={kpis.repeatRate} rate t={t} unit={t('crm.kpi.unit.first_timers')} />
        <KpiCard id="per_active" kpi={kpis.tournamentsPerActive} rate={false} t={t} unit={t('crm.kpi.unit.players')} />
      </div>

      <Panel>
        <PanelHeader
          title={kind === 'followers' ? t('crm.funnel.title.followers') : t('crm.funnel.title.acquisition')}
          hint={
            overall && report.current.cohort > 0
              ? t('crm.funnel.overall', { pct: pct(overall.ofCohort, 1), previous: before && report.previous.cohort > 0 ? pct(before.ofCohort, 1) : '—' })
              : undefined
          }
          action={<DemoTag label={t('common.demo_history')} />}
        />
        <FunnelChart current={report.current} previous={report.previous} selected={selected} onSelect={(k) => setSelected(selected === k ? null : k)} t={t} />
        {report.current.cohort > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12.5px] leading-snug text-ink-3">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-5 rounded-[3px] bg-accent" aria-hidden />
              {t('crm.funnel.legend.current')}
              <span className="ms-3 h-1 w-5 rounded-full bg-ink-3/70" aria-hidden />
              {t('crm.funnel.legend.previous', { n: num(report.previous.cohort) })}
            </li>
            {report.current.tooRecent > 0 && <li data-testid="funnel-too-recent">{t.n('crm.funnel.too_recent', report.current.tooRecent)}</li>}
            {report.current.alreadyInPipeline > 0 && <li>{t.n('crm.funnel.in_pipeline', report.current.alreadyInPipeline)}</li>}
            <li>{t('crm.funnel.click_hint')}</li>
          </ul>
        )}
      </Panel>

      {stage && drill && (
        <Panel pad={false} data-testid="funnel-drilldown">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">{t('crm.funnel.drill.title', { stage: t(`crm.funnel.stage.${stage.key}`) })}</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-3" data-testid="drilldown-count">
                {t.n('crm.funnel.drill.count', drill.rows.length)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BulkActions club={club} userIds={stage.userIds} tags={drill.tags} t={t} suggestedName={t('crm.funnel.drill.segment_name', { stage: t(`crm.funnel.stage.${stage.key}`) })} />
              <Button size="sm" variant="ghost" trailing={<LuArrowRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go('console.crm.players', { clubId: club.id, ids: stage.userIds.join(',') })}>
                {t('crm.funnel.drill.open')}
              </Button>
            </div>
          </div>
          {drill.rows.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-ink-3 sm:px-5">{t('crm.funnel.drill.empty')}</p>
          ) : (
            <TableShell minWidth={640}>
              <thead>
                <tr>
                  <Th>{t('crm.col.player')}</Th>
                  <Th>{t('crm.col.status')}</Th>
                  <Th>{t('crm.col.lifecycle')}</Th>
                  <Th end>{t('crm.col.tournaments')}</Th>
                  <Th>{t('crm.col.tags')}</Th>
                </tr>
              </thead>
              <tbody>
                {drill.rows.slice(0, 40).map((r) => (
                  <tr key={r.userId} className="border-t border-line">
                    <Td className="max-w-[260px]">
                      <PlayerCell row={r} club={club} t={t} />
                    </Td>
                    <Td>
                      <StatusBadge row={r} t={t} />
                    </Td>
                    <Td>
                      <LifecycleBadge stage={r.lifecycle} t={t} />
                    </Td>
                    <Td end className="tabular-nums">
                      {r.tournaments}
                    </Td>
                    <Td>
                      <TagList ids={r.tagIds} tags={drill.tags} max={2} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          {drill.rows.length > 40 && <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3 sm:px-5">{t('crm.funnel.drill.more', { n: drill.rows.length - 40 })}</p>}
        </Panel>
      )}
    </div>
  );
}

// =============================================================================
// Retention
// =============================================================================

function RetentionTab({ club, range, setRange }: { club: Club; range: RangeState; setRange: (r: RangeState) => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const { from, to } = rangeOf(range, now, club);
  const r = useReport(() => analytics.retentionReport(db, me.id, club.id, from, to), [club.id, me.id, Math.round(from / 60_000), Math.round(to / 60_000)]);
  const cell = (w: { measured: number; returned: number; rate: number | null }) =>
    w.rate === null ? (
      <span className="text-ink-3" title={t('crm.retention.not_yet')}>
        {t('crm.retention.not_yet_short')}
      </span>
    ) : (
      <span className="inline-flex min-w-[4.5rem] flex-col items-end leading-tight">
        <span className="rounded-chip px-1.5 font-medium text-ink tabular-nums" style={{ background: `color-mix(in oklab, var(--accent) ${Math.round(w.rate * 55)}%, transparent)` }}>
          {pct(w.rate)}
        </span>
        <span className="text-[11.5px] text-ink-3 tabular-nums" dir="ltr">
          {w.returned} / {w.measured}
        </span>
      </span>
    );
  return (
    <div className="space-y-4" data-testid="analytics-retention">
      <Panel>
        <RangePicker value={range} onChange={setRange} presets={['30', '60', '90', 'all', 'custom']} t={t} />
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">{t('crm.retention.explain')}</p>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label={t('crm.retention.new')} value={num(r.newParticipants)} hint={t('crm.retention.new_hint')} />
        <StatTile label={t('crm.retention.twice')} value={num(r.playedTwice)} hint={t('crm.retention.twice_hint')} />
        <StatTile label={t('crm.retention.three_plus')} value={num(r.playedThreePlus)} hint={t('crm.retention.three_plus_hint')} />
        <StatTile label={t('crm.kpi.per_active')} value={r.tournamentsPerActive === null ? '—' : r.tournamentsPerActive.toFixed(2)} hint={t('crm.retention.per_active_hint')} />
        <StatTile label={t('crm.retention.gap')} value={r.averageGapDays === null ? '—' : t('crm.retention.days_n', { n: r.averageGapDays.toFixed(1) })} hint={t('crm.retention.gap_hint')} />
      </div>
      <Panel>
        <PanelHeader title={t('crm.retention.repeat_title')} hint={t('crm.retention.repeat_hint')} action={<DemoTag label={t('common.demo_history')} />} />
        <div className="grid gap-3 sm:grid-cols-3">
          {r.repeat.map((w) => (
            <div key={w.days} className="rounded-inner border border-line p-3" data-testid={`repeat-${w.days}`}>
              <p className="text-[12.5px] text-ink-2">{t('crm.retention.within', { n: w.days })}</p>
              <p className="mt-1 text-[24px] leading-none font-semibold text-ink tabular-nums">{w.rate === null ? '—' : pct(w.rate, 1)}</p>
              <p className="mt-1.5 text-[12px] text-ink-3 tabular-nums">{w.measured === 0 ? t('crm.retention.not_yet') : t('crm.retention.measured', { returned: w.returned, measured: w.measured })}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel pad={false}>
        <PanelHeader title={t('crm.retention.cohorts')} hint={t('crm.retention.cohorts_hint')} className="px-4 pt-4 sm:px-5" />
        {r.cohorts.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-ink-3 sm:px-5">{t('crm.retention.no_cohorts')}</p>
        ) : (
          <TableShell minWidth={620}>
            <thead>
              <tr>
                <Th>{t('crm.retention.cohort')}</Th>
                <Th end>{t('crm.retention.size')}</Th>
                {r.cohorts[0]!.windows.map((w) => (
                  <Th key={w.days} end>
                    {t('crm.retention.within', { n: w.days })}
                  </Th>
                ))}
                <Th end>{t('crm.retention.ever')}</Th>
              </tr>
            </thead>
            <tbody>
              {r.cohorts.map((c) => (
                <tr key={c.month} className="border-t border-line" data-testid={`cohort-${c.month}`}>
                  <Td className="whitespace-nowrap text-ink">{monthLabel(c.month, t.lang)}</Td>
                  <Td end className="tabular-nums">
                    {c.size}
                  </Td>
                  {c.windows.map((w) => (
                    <Td key={w.days} end>
                      {cell(w)}
                    </Td>
                  ))}
                  <Td end className="tabular-nums">
                    {c.returnedEver} <span className="text-ink-3">({pct(c.size > 0 ? c.returnedEver / c.size : null)})</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <p className="border-t border-line px-4 py-2.5 text-[12px] leading-snug text-ink-3 sm:px-5">{t('crm.retention.maturity_note')}</p>
      </Panel>
    </div>
  );
}

// =============================================================================
// Acquisition sources
// =============================================================================

function AcquisitionTab({ club, range, setRange }: { club: Club; range: RangeState; setRange: (r: RangeState) => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const { from, to } = rangeOf(range, now, club);
  const rows = useReport(() => analytics.acquisitionReport(db, me.id, club.id, from, to), [club.id, me.id, Math.round(from / 60_000), Math.round(to / 60_000)]).filter((r) => r.links + r.opens + r.follows + r.requests + r.approvals + r.firstPlayed > 0);
  const total = (key: 'opens' | 'registrations' | 'follows' | 'requests' | 'approvals' | 'firstPlayed' | 'returning') => rows.reduce((n, r) => n + r[key], 0);
  const best = [...rows].filter((r) => r.source !== 'unknown' && r.approvals >= 5).sort((a, b) => b.firstPlayed / b.approvals - a.firstPlayed / a.approvals)[0];
  return (
    <div className="space-y-4" data-testid="analytics-acquisition">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RangePicker value={range} onChange={setRange} presets={['30', '60', '90', 'all', 'custom']} t={t} />
          {can(db, me.id, 'crm.configure', club.id) && (
            <Button size="sm" onClick={() => go('console.crm.settings', { clubId: club.id })}>
              {t('crm.acquisition.manage_links')}
            </Button>
          )}
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">{t('crm.acquisition.explain')}</p>
      </Panel>
      <div className="space-y-4">
        <Panel pad={false}>
          <PanelHeader title={t('crm.acquisition.title')} action={<DemoTag label={t('common.demo_history')} />} className="px-4 pt-4 sm:px-5" />
          {rows.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-ink-3 sm:px-5">{t('crm.acquisition.empty')}</p>
          ) : (
            <TableShell minWidth={820}>
              <thead>
                <tr>
                  <Th>{t('crm.profile.source')}</Th>
                  <Th end>{t('crm.acquisition.opens')}</Th>
                  <Th end>{t('crm.acquisition.registrations')}</Th>
                  <Th end>{t('crm.acquisition.follows')}</Th>
                  <Th end>{t('crm.acquisition.requests')}</Th>
                  <Th end>{t('crm.acquisition.approvals')}</Th>
                  <Th end>{t('crm.acquisition.first')}</Th>
                  <Th end>{t('crm.acquisition.returning')}</Th>
                  <Th end>{t('crm.acquisition.play_rate')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.source} className="border-t border-line" data-testid={`source-${r.source}`}>
                    <Td className="whitespace-nowrap">
                      <span className={cx('font-medium', r.source === 'unknown' ? 'text-ink-2' : 'text-ink')}>{t(`crm.source.${r.source}`)}</span>
                      {r.links > 0 && <span className="ms-2 text-[12px] text-ink-3">{t.n('crm.acquisition.links', r.links)}</span>}
                    </Td>
                    {(['opens', 'registrations', 'follows', 'requests', 'approvals', 'firstPlayed', 'returning'] as const).map((k) => (
                      <Td key={k} end className="tabular-nums">
                        {(k === 'opens' || k === 'registrations') && r.links === 0 ? <span className="text-ink-3">—</span> : num(r[k])}
                      </Td>
                    ))}
                    <Td end className="tabular-nums">
                      {pct(r.approvals > 0 ? r.firstPlayed / r.approvals : null)}
                    </Td>
                  </tr>
                ))}
                <tr className="border-t border-line-strong font-medium">
                  <Td>{t('crm.acquisition.total')}</Td>
                  {(['opens', 'registrations', 'follows', 'requests', 'approvals', 'firstPlayed', 'returning'] as const).map((k) => (
                    <Td key={k} end className="tabular-nums">
                      {num(total(k))}
                    </Td>
                  ))}
                  <Td end className="tabular-nums">
                    {pct(total('approvals') > 0 ? total('firstPlayed') / total('approvals') : null)}
                  </Td>
                </tr>
              </tbody>
            </TableShell>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[12px] leading-snug text-ink-3 sm:px-5">{t('crm.acquisition.columns_note')}</p>
        </Panel>
        <aside className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title={t('crm.acquisition.followers_by_source')} />
            <RankBars title={t('crm.acquisition.followers_by_source')} data={[...rows].sort((a, b) => b.follows - a.follows).map((r) => ({ label: t(`crm.source.${r.source}`), value: r.follows }))} />
          </Panel>
          <div className="space-y-4">
            {best && (
              <Notice tone="info" icon={<LuInfo />}>
                {t('crm.acquisition.best', { source: t(`crm.source.${best.source}`), pct: pct(best.firstPlayed / best.approvals), n: best.approvals })}
              </Notice>
            )}
            <Notice tone="neutral">{t('crm.acquisition.unknown_note')}</Notice>
          </div>
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
// Engagement, tournaments and membership
// =============================================================================

/** How many hours the club's time zone is ahead of UTC right now. */
function zoneOffsetHours(timezone: string, at: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, weekday: 'short', hour: '2-digit' }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const utc = new Date(at).getUTCHours();
    let diff = hour - utc;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    return diff;
  } catch {
    return 0;
  }
}

/** Re-bucket a Monday-first 7×24 UTC grid into the club's local time. */
function shiftPeak(peak: number[][], offset: number): number[][] {
  const out = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const local = h + offset;
      const day = (d + Math.floor(local / 24) + 7) % 7;
      out[day]![((local % 24) + 24) % 24] = peak[d]?.[h] ?? 0;
    }
  }
  return out;
}

function EngagementTab({ club, range, setRange }: { club: Club; range: RangeState; setRange: (r: RangeState) => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const { from, to } = rangeOf(range, now, club);
  const e = useReport(() => analytics.engagementReport(db, me.id, club.id, from, to), [club.id, me.id, Math.round(from / 60_000), Math.round(to / 60_000)]);
  const labels = dayLabels(e.dau, t);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(t.lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + i)));
  const demo = <DemoTag label={t('common.demo_history')} />;
  return (
    <div className="space-y-4" data-testid="analytics-engagement">
      <Panel>
        <RangePicker value={range} onChange={setRange} presets={['7', '30', '90', 'all', 'custom']} t={t} />
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">{t('crm.engagement.explain')}</p>
      </Panel>

      <h2 className="text-[14px] font-semibold text-ink">{t('crm.engagement.section.activity')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('crm.engagement.dau')} value={e.averageDau.toFixed(1)} hint={t('crm.engagement.dau_hint')} trend={e.dau.map((p) => p.value)} />
        <StatTile label={t('crm.engagement.wau')} value={num(e.wau)} hint={t('crm.engagement.wau_hint')} />
        <StatTile label={t('crm.engagement.mau')} value={num(e.mau)} hint={t('crm.engagement.mau_hint')} />
        <StatTile label={t('crm.engagement.participants')} value={num(e.activeParticipants)} hint={t('crm.engagement.participants_hint')} />
        <StatTile label={t('crm.engagement.completed')} value={num(e.completedParticipations)} hint={t('crm.engagement.completed_hint')} />
        <StatTile label={t('crm.engagement.open_registrations')} value={num(e.openRegistrations)} hint={t('crm.engagement.open_registrations_hint')} />
        <StatTile label={t('crm.engagement.messages')} value={num(e.messages)} hint={t('crm.engagement.messages_hint')} />
        <StatTile label={t('crm.engagement.announcements')} value={num(e.announcements)} hint={t('crm.engagement.announcements_hint')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t('crm.engagement.dau_chart')} hint={t('crm.chart.engagement_hint')} action={demo} />
          <LineChart title={t('crm.engagement.dau_chart')} labels={labels} series={[{ name: t('crm.engagement.dau'), values: e.dau.map((p) => p.value) }]} />
        </Panel>
        <Panel>
          <PanelHeader title={t('crm.engagement.followers_chart')} hint={t('crm.engagement.followers_hint', { n: num(e.followersNow) })} />
          <LineChart title={t('crm.engagement.followers_chart')} labels={labels} series={[{ name: t('crm.kpi.followers'), values: e.followers.map((p) => p.value) }]} />
        </Panel>
      </div>

      <h2 className="pt-2 text-[14px] font-semibold text-ink">{t('crm.engagement.section.tournaments')}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t('crm.engagement.created')} value={num(e.tournamentsCreated)} />
        <StatTile label={t('crm.engagement.finished')} value={num(e.tournamentsCompleted)} />
        <StatTile label={t('crm.engagement.average_entrants')} value={e.averageEntrants === null ? '—' : e.averageEntrants.toFixed(1)} hint={t('crm.engagement.average_entrants_hint')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t('crm.engagement.by_week')} hint={t('crm.engagement.by_week_hint')} action={demo} />
          <BarChart title={t('crm.engagement.by_week')} data={e.entriesByWeek.map((p) => ({ label: dayLabels([p], t)[0]!, value: p.value }))} />
        </Panel>
        <Panel>
          <PanelHeader title={t('crm.engagement.formats')} hint={t('crm.engagement.formats_hint')} />
          {e.formats.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t('crm.engagement.no_tournaments')}</p>
          ) : (
            <>
              <RankBars title={t('crm.engagement.formats')} data={e.formats.map((f) => ({ label: presetLabel(t, { preset: f.preset, format: f.preset === 'sng' ? 'sng' : 'mtt' }), value: f.entries }))} />
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12.5px] text-ink-2">
                {e.formats.map((f) => (
                  <li key={f.preset} className="flex justify-between gap-3 tabular-nums">
                    <span>{presetLabel(t, { preset: f.preset, format: f.preset === 'sng' ? 'sng' : 'mtt' })}</span>
                    <span className="text-ink-3">{t('crm.engagement.format_row', { tournaments: f.tournaments, returning: f.returning })}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
      <Panel>
        <PanelHeader title={t('crm.engagement.peak')} hint={t('crm.engagement.peak_hint', { zone: club.timezone })} action={demo} />
        <Heatmap title={t('crm.engagement.peak')} rows={weekdays} columns={Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))} values={shiftPeak(e.peak, zoneOffsetHours(club.timezone, now))} />
      </Panel>

      <h2 className="pt-2 text-[14px] font-semibold text-ink">{t('crm.engagement.section.membership')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('crm.engagement.requests')} value={num(e.requests)} />
        <StatTile label={t('crm.engagement.approval_rate')} value={pct(e.approvalRate)} hint={t('crm.engagement.approval_rate_hint')} />
        <StatTile label={t('crm.engagement.approval_time')} value={e.averageApprovalHours === null ? '—' : t('crm.engagement.hours_n', { n: e.averageApprovalHours.toFixed(1) })} hint={t('crm.engagement.approval_time_hint')} />
        <StatTile label={t('crm.kpi.inactive')} value={num(e.inactiveMembers)} hint={t('crm.kpi.inactive_hint')} />
      </div>
      <Panel>
        <PanelHeader title={t('crm.chart.growth')} hint={t('crm.chart.growth_hint')} />
        <LineChart title={t('crm.chart.growth')} labels={labels} series={[{ name: t('crm.kpi.approved_members'), values: e.memberGrowth.map((p) => p.value) }]} />
      </Panel>
    </div>
  );
}

const TABS: readonly Tab[] = ['funnel', 'retention', 'acquisition', 'engagement', 'scheduling', 'weekly'];

export function CrmAnalytics({ club, initialTab }: { club: Club; initialTab?: string }) {
  const t = useT();
  const now = useNow(60_000);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'funnel');
  const [range, setRange] = useState(() => defaultRange('90', now));
  return (
    <div data-testid="crm-analytics">
      <PageHeader title={t('crm.analytics.title')} subtitle={t('crm.analytics.subtitle')} />
      <Tabs
        value={tab}
        onChange={setTab}
        label={t('crm.analytics.title')}
        className="mb-4"
        tabs={[
          { value: 'funnel', label: t('crm.analytics.tab.funnel') },
          { value: 'retention', label: t('crm.analytics.tab.retention') },
          { value: 'acquisition', label: t('crm.analytics.tab.acquisition') },
          { value: 'engagement', label: t('crm.analytics.tab.engagement') },
          { value: 'scheduling', label: t('crm.analytics.tab.scheduling') },
          { value: 'weekly', label: t('crm.analytics.tab.weekly') },
        ]}
      />
      {tab === 'funnel' && <FunnelTab club={club} range={range} setRange={setRange} />}
      {tab === 'retention' && <RetentionTab club={club} range={range} setRange={setRange} />}
      {tab === 'acquisition' && <AcquisitionTab club={club} range={range} setRange={setRange} />}
      {tab === 'engagement' && <EngagementTab club={club} range={range} setRange={setRange} />}
      {tab === 'scheduling' && <SchedulingTab club={club} />}
      {tab === 'weekly' && <WeeklyTab club={club} />}
    </div>
  );
}
