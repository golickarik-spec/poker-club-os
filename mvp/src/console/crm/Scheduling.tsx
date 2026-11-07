/**
 * Best times (v0.4): the club's activity heatmap in its own timezone and the slots that have
 * drawn the biggest fields, each with a "schedule a tournament then" shortcut. Also the weekly
 * report tab. Both read tournament history only.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { LuCalendarPlus, LuChevronLeft, LuChevronRight, LuCopy, LuSend } from 'react-icons/lu';
import { act, toasts } from '../../app/context.ts';
import { dateShort, dateTimeIn, num } from '../../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import { notify } from '../../platform/core.ts';
import { can } from '../../platform/permissions.ts';
import * as ret from '../../platform/retention.ts';
import type { Club } from '../../platform/types.ts';
import { WEEKDAYS } from '../../shared/weekdays.ts';
import { Heatmap, StatTile } from '../../ui/charts.tsx';
import { Badge, Button, DemoTag, Notice, Panel, PanelHeader } from '../../ui/core.tsx';
import { Segmented } from '../../ui/forms.tsx';
import { useReport } from './shared.tsx';

const DAY = 86_400_000;
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

export const slotLabel = (weekday: number, hour: number, lang: 'en' | 'he'): string => `${WEEKDAYS[lang][weekday]} ${String(hour).padStart(2, '0')}:00`;

export function SchedulingTab({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [metric, setMetric] = useState<'avgEntrants' | 'players' | 'tournaments'>('avgEntrants');
  const [windowDays, setWindowDays] = useState<'60' | '120' | '365'>('120');
  const h = useReport(() => ret.activityHeatmap(db, me.id, club.id, Number(windowDays), now), [club.id, me.id, windowDays, Math.floor(now / 3_600_000)]);
  const values = useMemo(() => {
    const grid = h[metric];
    const max = Math.max(1, ...grid.flat());
    return grid.map((row) => row.map((v) => v / max));
  }, [h, metric]);
  const canCreate = can(db, me.id, 'tournaments.create', club.id);
  const raw = (r: number, c: number) => h[metric][r]?.[c] ?? 0;
  return (
    <div data-testid="crm-scheduling">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-2">
          {t('scheduling.sample', { n: h.sample, days: h.windowDays })} <DemoTag label={t('common.demo_history')} />
        </p>
        <div className="flex max-w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Segmented value={windowDays} onChange={setWindowDays} size="sm" label={t('scheduling.window')} options={[{ value: '60', label: t('crm.range.last_days', { n: 60 }) }, { value: '120', label: t('crm.range.last_days', { n: 120 }) }, { value: '365', label: t('crm.range.last_days', { n: 365 }) }]} />
          <Segmented value={metric} onChange={setMetric} size="sm" label={t('scheduling.metric')} options={[{ value: 'avgEntrants', label: t('scheduling.metric.avg') }, { value: 'players', label: t('scheduling.metric.players') }, { value: 'tournaments', label: t('scheduling.metric.tournaments') }]} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title={t('scheduling.heatmap')} hint={t('scheduling.heatmap_hint', { tz: club.timezone })} />
          <Heatmap title={t('scheduling.heatmap')} rows={WEEKDAYS[t.lang]} columns={HOURS} values={values} format={(v) => String(v)} />
          <HeatmapLegend h={h} metric={metric} raw={raw} t={t} />
        </Panel>
        <Panel>
          <PanelHeader title={t('scheduling.recommended')} hint={t('scheduling.recommended_hint')} />
          {h.recommendations.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t('scheduling.none')}</p>
          ) : (
            <ol className="space-y-2" data-testid="scheduling-recommendations">
              {h.recommendations.map((r, i) => (
                <li key={`${r.weekday}-${r.hour}`} className="rounded-inner border border-line bg-raised/40 p-3" data-testid={`slot-${i}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-ink">{slotLabel(r.weekday, r.hour, t.lang)}</span>
                    <Badge tone={i === 0 ? 'accent' : 'neutral'}>{t('scheduling.score', { pct: Math.round(r.score * 100) })}</Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-2">{t('scheduling.slot_stats', { avg: r.avgEntrants, n: r.tournaments })}</p>
                  <p className="text-[12px] text-ink-3">{t('scheduling.next', { when: dateTimeIn(r.nextAt, t.lang, club.timezone) })}</p>
                  {canCreate && (
                    <Button size="sm" className="mt-2" icon={<LuCalendarPlus className="size-3.5" aria-hidden />} onClick={() => go('console.wizard', { clubId: club.id, startAt: String(r.nextAt) })} data-testid={`slot-use-${i}`}>
                      {t('scheduling.schedule_then')}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <Notice tone="neutral" className="mt-3">
            {t('scheduling.method')}
          </Notice>
        </Panel>
      </div>
    </div>
  );
}

function HeatmapLegend({ h, metric, raw, t }: { h: ret.HeatmapReport; metric: 'avgEntrants' | 'players' | 'tournaments'; raw: (r: number, c: number) => number; t: ReturnType<typeof useT> }) {
  let best = { r: 0, c: 0, v: -1 };
  for (let r = 0; r < 7; r++) for (let c = 0; c < 24; c++) if (raw(r, c) > best.v) best = { r, c, v: raw(r, c) };
  if (best.v <= 0) return null;
  return (
    <p className="mt-1 text-[12px] text-ink-3">
      {t('scheduling.peak_cell', { slot: slotLabel(best.r, best.c, t.lang), value: metric === 'avgEntrants' ? best.v.toFixed(1) : String(best.v) })} · {t('scheduling.window_note', { days: h.windowDays })}
    </p>
  );
}

// ----- Weekly report ---------------------------------------------------------------------------

export function WeeklyTab({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [offset, setOffset] = useState(1); // 1 = last full week
  const weekStart = ret.startOfWeek(now) - offset * 7 * DAY;
  const r = useReport(() => ret.weeklyReport(db, me.id, club.id, weekStart), [club.id, me.id, weekStart]);
  const delta = (cur: number, prev: number) => (prev === 0 ? undefined : (cur - prev) / prev);
  const title = `${dateShort(r.from, t.lang)} – ${dateShort(r.to - DAY / 2, t.lang)}`;
  const text = () =>
    [
      `${club.name} — ${t('weekly.title')} ${title}`,
      `${t('weekly.tournaments')}: ${r.tournaments} (${t('weekly.previous')}: ${r.previous.tournaments})`,
      `${t('weekly.entries')}: ${r.entries} (${r.previous.entries})`,
      `${t('weekly.players')}: ${r.uniquePlayers} (${r.previous.uniquePlayers}) — ${t('weekly.first_timers')}: ${r.firstTimers}, ${t('weekly.returning')}: ${r.returning}`,
      `${t('weekly.new_members')}: ${r.newMembers} (${r.previous.newMembers}) — ${t('weekly.pending')}: ${r.requestsPending}`,
      `${t('weekly.referrals')}: ${r.referralsApproved}`,
      `${t('weekly.inactive')}: ${r.inactive.map((x) => `${x.days}d ${x.count}`).join(', ')}`,
      r.busiest ? `${t('weekly.busiest')}: ${r.busiest.name} (${r.busiest.entrants})` : '',
      r.topPlayers.length ? `${t('weekly.top')}: ${r.topPlayers.map((p) => `${p.name} ${p.wins}W/${p.tournaments}`).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  const copy = () => navigator.clipboard?.writeText(text()).then(() => toasts.push('success', t('weekly.copied')), () => toasts.push('info', text()));
  const send = () => {
    act(() => {
      let n = 0;
      for (const m of db.memberships) {
        if (m.clubId !== club.id || m.status !== 'active' || m.role === 'player' || !can(db, m.userId, 'analytics.view', club.id)) continue;
        if (notify(db, m.userId, 'system', 'notif.weekly_report', { club: club.name, week: title }, { name: 'console.crm.analytics', params: { clubId: club.id, tab: 'weekly' } }, { clubId: club.id, dedupeKey: `wk:${club.id}:${r.from}:${m.userId}` }) === 'delivered') n++;
      }
      return n;
    }, { key: 'weekly.sent' });
  };
  return (
    <div data-testid="crm-weekly">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label={t('calendar.previous')} className="inline-flex size-8 items-center justify-center rounded-control border border-line-strong/70 text-ink-2 hover:bg-raised hover:text-ink" onClick={() => setOffset(offset + 1)} data-testid="weekly-prev">
            <LuChevronLeft className="size-4 flip-rtl" aria-hidden />
          </button>
          <button type="button" aria-label={t('calendar.next')} className="inline-flex size-8 items-center justify-center rounded-control border border-line-strong/70 text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40" onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0} data-testid="weekly-next">
            <LuChevronRight className="size-4 flip-rtl" aria-hidden />
          </button>
          <h2 className="ms-2 text-[16px] font-semibold text-ink" data-testid="weekly-title">
            {title}
            {offset === 0 && <span className="ms-2 text-[12px] font-normal text-ink-3">{t('weekly.in_progress')}</span>}
          </h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" icon={<LuCopy className="size-3.5" aria-hidden />} onClick={copy} data-testid="weekly-copy">
            {t('weekly.copy')}
          </Button>
          <Button size="sm" icon={<LuSend className="size-3.5" aria-hidden />} onClick={send} data-testid="weekly-send">
            {t('weekly.send')}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('weekly.tournaments')} value={num(r.tournaments)} delta={delta(r.tournaments, r.previous.tournaments)} deltaLabel={t('weekly.vs_previous')} />
        <StatTile label={t('weekly.entries')} value={num(r.entries)} delta={delta(r.entries, r.previous.entries)} deltaLabel={t('weekly.vs_previous')} />
        <StatTile label={t('weekly.players')} value={num(r.uniquePlayers)} delta={delta(r.uniquePlayers, r.previous.uniquePlayers)} deltaLabel={t('weekly.vs_previous')} hint={t('weekly.players_hint', { first: r.firstTimers, back: r.returning })} />
        <StatTile label={t('weekly.new_members')} value={num(r.newMembers)} delta={delta(r.newMembers, r.previous.newMembers)} deltaLabel={t('weekly.vs_previous')} hint={t('weekly.pending_hint', { n: r.requestsPending })} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t('weekly.health')} />
          <dl className="space-y-2 text-[13.5px]">
            <Row label={t('weekly.referrals')} value={String(r.referralsApproved)} />
            {r.inactive.map((x) => (
              <Row key={x.days} label={t(`retention.alerts.bucket_${x.days as ret.AlertBucket}`)} value={String(x.count)} />
            ))}
            {r.busiest && (
              <Row
                label={t('weekly.busiest')}
                value={
                  <button type="button" className="text-accent hover:underline" onClick={() => go('console.tournament', { clubId: club.id, id: r.busiest!.tournamentId })}>
                    {r.busiest.name} · {r.busiest.entrants}
                  </button>
                }
              />
            )}
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title={t('weekly.top')} hint={t('weekly.top_hint')} />
          {r.topPlayers.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t('weekly.no_players')}</p>
          ) : (
            <ol className="space-y-1.5 text-[13.5px]">
              {r.topPlayers.map((p, i) => (
                <li key={p.userId} className="flex items-center gap-2">
                  <span className="w-5 text-ink-3 tabular-nums">{i + 1}</span>
                  <button type="button" className="min-w-0 flex-1 truncate text-start text-ink hover:underline" onClick={() => go('console.crm.player', { clubId: club.id, userId: p.userId })}>
                    {p.name}
                  </button>
                  <span className="text-[12.5px] text-ink-2 tabular-nums">{t('weekly.player_line', { wins: p.wins, n: p.tournaments })}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2 last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}
