import { LuArrowRight, LuCircleAlert } from 'react-icons/lu';
import { monthLabel, num, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { platformMonthlyActive } from '../platform/analytics.ts';
import * as api from '../platform/api.ts';
import { isLive } from '../platform/lifecycle.ts';
import { TICKET_TONE } from '../shared/support.tsx';
import { LIMIT_KEYS, money, usageOf } from '../shared/plans.tsx';
import { LineChart, StatTile } from '../ui/charts.tsx';
import { Badge, Button, DemoTag, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { ClubLogo } from '../ui/identity.tsx';

export function Overview() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const clubs = Object.values(db.clubs).sort((a, b) => a.createdAt - b.createdAt);
  const active = clubs.filter((c) => c.status === 'active');
  const usage = clubs.map((c) => ({ club: c, usage: usageOf(db, c), limits: api.effectiveLimits(db, c), invoice: api.invoicePreview(db, c.id) }));
  const mau = usage.reduce((n, u) => n + u.usage.monthlyActive, 0);
  const members = usage.reduce((n, u) => n + u.usage.members, 0);
  const recurring = usage.filter((u) => u.club.status === 'active').reduce((n, u) => n + u.invoice.total, 0);
  const liveNow = Object.values(db.tournaments).filter((x) => isLive(x.status)).length;
  const openTickets = db.tickets.filter((x) => x.status !== 'resolved').sort((a, b) => b.updatedAt - a.updatedAt);
  const needsReply = openTickets.filter((x) => x.status === 'open').length;
  const degraded = db.health.filter((h) => h.status !== 'operational');
  const demo = <DemoTag label={t('common.demo')} />;
  // Monthly active players per club, counted from tournament records (at most three series: the palette has three colours).
  const monthly = platformMonthlyActive(db, me.id, 5);
  const charted = [...clubs].sort((a, b) => (monthly[b.id]?.at(-1)?.players ?? 0) - (monthly[a.id]?.at(-1)?.players ?? 0)).slice(0, 3);
  const months = charted[0] ? (monthly[charted[0].id] ?? []).map((m) => monthLabel(m.month, t.lang)) : [];
  const history = <DemoTag label={t('common.demo_history')} />;
  const alerts = usage.flatMap((u) => LIMIT_KEYS.filter((k) => u.usage[k] / Math.max(1, u.limits[k]) >= 0.85).map((k) => ({ club: u.club, key: k, used: u.usage[k], limit: u.limits[k] })));

  return (
    <>
      <PageHeader title={t('platform.home.title')} subtitle={t('platform.home.subtitle')} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('platform.kpi.clubs')} value={num(clubs.length)} hint={t('platform.kpi.clubs_hint', { active: active.length, suspended: clubs.length - active.length })} />
        <StatTile label={t('platform.kpi.mau')} value={num(mau)} hint={t('platform.kpi.mau_hint', { members: num(members) })} demo={history} />
        <StatTile label={t('platform.kpi.tournaments')} value={num(db.counters.tournamentsHosted)} hint={t('platform.kpi.tournaments_hint', { n: liveNow })} demo={demo} />
        <StatTile label={t('platform.kpi.recurring')} value={<span dir="ltr">{money(Math.round(recurring))}</span>} hint={t('platform.kpi.recurring_hint')} demo={<DemoTag label={t('billing.placeholder')} />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title={t('platform.chart.mau')} hint={t('platform.chart.mau_hint')} action={history} />
            {charted.length > 0 && (
              <div className="pt-5">
                <LineChart title={t('platform.chart.mau')} labels={months} series={charted.map((c) => ({ name: c.name, values: (monthly[c.id] ?? []).map((m) => m.players) }))} dots height={240} />
              </div>
            )}
          </Panel>

          <Panel pad={false}>
            <div className="px-4 pt-4 sm:px-5">
              <PanelHeader
                title={t('platform.home.tenants')}
                action={
                  <Button size="sm" variant="ghost" trailing={<LuArrowRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go('platform.clubs')}>
                    {t('platform.home.all_clubs')}
                  </Button>
                }
              />
            </div>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13.5px] tabular-nums">
                <thead>
                  <tr className="border-y border-line text-[12px] text-ink-3">
                    <th className="py-2 ps-4 text-start font-medium sm:ps-5">{t('common.club')}</th>
                    <th className="py-2 text-start font-medium">{t('billing.col.plan')}</th>
                    <th className="py-2 pe-3 text-end font-medium">{t('limit.members')}</th>
                    <th className="py-2 pe-3 text-end font-medium">{t('limit.monthlyActive')}</th>
                    <th className="py-2 pe-3 text-end font-medium">{t('platform.col.estimate')}</th>
                    <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map(({ club, usage: u, invoice }) => (
                    <tr key={club.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-raised/40" onClick={() => go('platform.club', { clubId: club.id })}>
                      <td className="py-2.5 ps-4 sm:ps-5">
                        <button type="button" className="flex items-center gap-2.5 text-start" onClick={() => go('platform.club', { clubId: club.id })}>
                          <ClubLogo branding={club.branding} name={club.name} size={26} />
                          <span className="font-medium text-ink hover:underline">{club.name}</span>
                        </button>
                      </td>
                      <td className="py-2.5 text-ink-2">{db.plans[club.planId].name}</td>
                      <td className="py-2.5 pe-3 text-end text-ink">{num(u.members)}</td>
                      <td className="py-2.5 pe-3 text-end text-ink">{num(u.monthlyActive)}</td>
                      <td className="py-2.5 pe-3 text-end text-ink" dir="ltr">
                        {money(invoice.total)}
                      </td>
                      <td className="py-2.5 pe-4 text-end sm:pe-5">
                        <Badge tone={club.status === 'active' ? 'success' : 'danger'} dot>
                          {t(`tenant.status.${club.status}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader
              title={t('platform.home.health')}
              action={
                <Button size="sm" variant="ghost" onClick={() => go('platform.health')}>
                  {t('common.details')}
                </Button>
              }
            />
            <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <span className={`size-2.5 rounded-full ${degraded.length === 0 ? 'bg-success' : 'bg-warning'}`} aria-hidden />
              {degraded.length === 0 ? t('health.all_ok') : t.n('health.degraded', degraded.length)}
            </p>
            {degraded.map((h) => (
              <p key={h.id} className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-2">
                <LuCircleAlert className="size-3.5 text-warning" aria-hidden />
                {t(`health.service.${h.id}`)}: {t(`health.status.${h.status}`)}
              </p>
            ))}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[13px]">
              <div>
                <dt className="text-[12px] text-ink-3">{t('platform.session.hands')}</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums" data-testid="session-hands">
                  {num(db.counters.sessionHands)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">{t('platform.session.per_hand')}</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums">{db.counters.sessionHands > 0 ? `${(db.counters.sessionEngineMs / db.counters.sessionHands).toFixed(2)} ms` : '—'}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{t('platform.session.note')}</p>
          </Panel>

          <Panel>
            <PanelHeader
              title={
                <>
                  {t('platform.home.support')}
                  {needsReply > 0 && <Badge tone="warning">{needsReply}</Badge>}
                </>
              }
              action={
                <Button size="sm" variant="ghost" onClick={() => go('platform.support')}>
                  {t('platform.home.all_tickets')}
                </Button>
              }
            />
            {openTickets.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('support.empty.open')}</p>
            ) : (
              <ul className="space-y-3">
                {openTickets.slice(0, 4).map((ticket) => (
                  <li key={ticket.id}>
                    <button type="button" onClick={() => go('platform.support')} className="block w-full text-start">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium text-ink">{ticket.subject}</span>
                        <Badge tone={TICKET_TONE[ticket.status]}>{t(`ticket.status.${ticket.status}`)}</Badge>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-3">
                        {db.clubs[ticket.clubId]?.name} · {relativeTime(ticket.updatedAt, now, t.lang)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {alerts.length > 0 && (
            <Panel>
              <PanelHeader title={t('platform.home.alerts')} hint={t('platform.home.alerts_hint')} />
              <ul className="space-y-2 text-[13px]">
                {alerts.map((a) => (
                  <li key={a.club.id + a.key} className="flex items-center justify-between gap-3">
                    <button type="button" className="min-w-0 truncate text-start text-ink hover:underline" onClick={() => go('platform.club', { clubId: a.club.id })}>
                      {a.club.name} · {t(`limit.${a.key}`)}
                    </button>
                    <span dir="ltr" className={`shrink-0 font-medium tabular-nums ${a.used >= a.limit ? 'text-danger' : 'text-warning'}`}>
                      {num(a.used)} / {num(a.limit)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
