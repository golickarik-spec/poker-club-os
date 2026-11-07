/**
 * Referral dashboard (v0.4): who brings people to the club and how far those people get —
 * opened the link, requested membership, were approved, played, came back. Every number is
 * derived from CRM events and tournament history; nothing here is a delivery statistic.
 */
import { LuArrowRight, LuUsers } from 'react-icons/lu';
import { dateShort } from '../../app/format.ts';
import { go, useDb, useMe, useT } from '../../app/hooks.ts';
import * as crm from '../../platform/crm.ts';
import type { Club } from '../../platform/types.ts';
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { StatTile } from '../../ui/charts.tsx';
import { Avatar } from '../../ui/identity.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { useReport } from './shared.tsx';

const STAGE_TONE = { opened: 'neutral', requested: 'warning', approved: 'success', played: 'success', returning: 'accent', rejected: 'danger' } as const;

export function Referrals({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const report = useReport(() => crm.referralReport(db, me.id, club.id), [club.id, me.id]);
  const s = report.summary;
  const rate = (n: number): string => (s.opens === 0 ? '—' : t('referral.rate', { pct: Math.round((100 * n) / s.opens) }));
  const names = (id: string) => db.users[id]?.name ?? '—';
  return (
    <div data-testid="crm-referrals">
      <PageHeader title={t('referral.dashboard')} subtitle={t('referral.dashboard_hint')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="referral-kpis">
        <StatTile label={t('referral.kpi.links')} value={String(s.links)} />
        <StatTile label={t('referral.kpi.opens')} value={String(s.opens)} />
        <StatTile label={t('referral.kpi.approved')} value={String(s.approved)} hint={rate(s.approved)} />
        <StatTile label={t('referral.kpi.played')} value={String(s.played)} hint={rate(s.played)} />
        <StatTile label={t('referral.kpi.returning')} value={String(s.returning)} hint={rate(s.returning)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel pad={false} className="overflow-hidden">
          <PanelHeader title={t('referral.referrers')} className="px-4 pt-4 sm:px-5" />
          {report.referrers.length === 0 ? (
            <EmptyState icon={<LuUsers />} title={t('referral.no_referrers')} className="py-10" />
          ) : (
            <TableShell minWidth={520}>
              <thead>
                <tr>
                  <Th>{t('referral.referrer')}</Th>
                  <Th>{t('referral.campaigns')}</Th>
                  <Th end>{t('referral.stage.opens')}</Th>
                  <Th end>{t('referral.stage.requested')}</Th>
                  <Th end>{t('referral.stage.approved')}</Th>
                  <Th end>{t('referral.stage.played')}</Th>
                  <Th end>{t('referral.stage.returning')}</Th>
                  <Th end>
                    <span className="sr-only">{t('crm.col.actions')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody data-testid="referrer-rows">
                {report.referrers.map((r) => {
                  const ids = report.recent.filter((x) => x.referrerId === r.referrerId && x.approvedAt).map((x) => x.userId);
                  return (
                    <tr key={r.referrerId} className="border-t border-line" data-testid={`referrer-${r.referrerId}`}>
                      <Td>
                        <button type="button" className="flex items-center gap-2.5 text-start hover:underline" onClick={() => go('console.crm.player', { clubId: club.id, userId: r.referrerId })}>
                          <Avatar user={{ name: r.name, hue: r.hue }} size={28} />
                          <span className="truncate text-[13.5px] font-medium text-ink">{r.name}</span>
                        </button>
                      </Td>
                      <Td className="text-[12.5px] text-ink-2">{r.campaigns.length === 0 ? '—' : r.campaigns.join(', ')}</Td>
                      <Td end className="tabular-nums">
                        {r.opens}
                      </Td>
                      <Td end className="tabular-nums">
                        {r.requested}
                      </Td>
                      <Td end className="font-semibold text-ink tabular-nums">
                        {r.approved}
                      </Td>
                      <Td end className="tabular-nums">
                        {r.played}
                      </Td>
                      <Td end className="tabular-nums">
                        {r.returning}
                      </Td>
                      <Td end>
                        {ids.length > 0 && (
                          <button type="button" aria-label={t('referral.view_people')} title={t('referral.view_people')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => go('console.crm.players', { clubId: club.id, ids: ids.join(',') })} data-testid={`referrer-people-${r.referrerId}`}>
                            <LuArrowRight className="size-4 flip-rtl" aria-hidden />
                          </button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          )}
        </Panel>
        <Panel pad={false} className="overflow-hidden">
          <PanelHeader title={t('referral.recent')} className="px-4 pt-4 sm:px-5" />
          {report.recent.length === 0 ? (
            <p className="px-4 pb-6 text-[13px] text-ink-3">{t('referral.no_recent')}</p>
          ) : (
            <ul className="rows" data-testid="referral-recent">
              {report.recent.slice(0, 20).map((p) => (
                <li key={`${p.referrerId}:${p.userId}`} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full truncate text-[13.5px] font-medium text-ink hover:underline" onClick={() => go('console.crm.player', { clubId: club.id, userId: p.userId })}>
                      {p.name}
                    </button>
                    <span className="block text-[12px] text-ink-3">
                      {t('referral.referred_by', { name: names(p.referrerId) })} · {dateShort(p.openedAt, t.lang)}
                    </span>
                  </span>
                  <Badge tone={STAGE_TONE[p.status]}>{t(`referral.status.${p.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
