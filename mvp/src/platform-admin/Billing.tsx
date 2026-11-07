import { num } from '../app/format.ts';
import { go, useDb, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import { InvoiceRows, money } from '../shared/plans.tsx';
import { DemoTag, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { StatTile } from '../ui/charts.tsx';

export function Billing() {
  const t = useT();
  const db = useDb();
  const clubs = Object.values(db.clubs);
  const previews = clubs.map((club) => ({ club, plan: db.plans[club.planId], preview: api.invoicePreview(db, club.id) }));
  const total = previews.filter((p) => p.club.status === 'active').reduce((n, p) => n + p.preview.total, 0);
  const invoices = [...db.invoices].sort((a, b) => b.period.localeCompare(a.period) || a.clubId.localeCompare(b.clubId));
  const due = invoices.filter((i) => i.status === 'due');
  const placeholder = <DemoTag label={t('billing.placeholder')} />;
  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />
      <Notice tone="warning" className="mb-5">
        {t('billing.placeholder_note')}
      </Notice>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('billing.kpi.this_period')} value={<span dir="ltr">{money(Math.round(total))}</span>} hint={t('billing.kpi.this_period_hint')} demo={placeholder} />
        <StatTile label={t('billing.kpi.subscriptions')} value={num(clubs.filter((c) => c.status === 'active').length)} hint={t('billing.kpi.subscriptions_hint')} />
        <StatTile label={t('billing.kpi.due')} value={num(due.length)} hint={due.length > 0 ? <span dir="ltr">{money(due.reduce((n, i) => n + i.total, 0))}</span> : t('billing.kpi.none_due')} demo={placeholder} />
        <StatTile label={t('billing.kpi.billable')} value={num(previews.reduce((n, p) => n + p.preview.activePlayers, 0))} hint={t('billing.kpi.billable_hint')} demo={<DemoTag label={t('common.demo')} />} />
      </div>

      <Panel pad={false} className="mt-5">
        <div className="px-4 pt-4 sm:px-5">
          <PanelHeader title={t('billing.current')} hint={t('billing.current_hint')} />
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px] tabular-nums">
            <thead>
              <tr className="border-y border-line text-[12px] text-ink-3">
                <th className="py-2 ps-4 text-start font-medium sm:ps-5">{t('common.club')}</th>
                <th className="py-2 text-start font-medium">{t('billing.col.plan')}</th>
                <th className="py-2 text-start font-medium">{t('plans.field.model')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('billing.col.active')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('billing.col.base')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('billing.col.usage')}</th>
                <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('billing.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {previews.map(({ club, plan, preview }) => (
                <tr key={club.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-raised/40" onClick={() => go('platform.club', { clubId: club.id })}>
                  <td className="py-2.5 ps-4 font-medium text-ink sm:ps-5">{club.name}</td>
                  <td className="py-2.5 text-ink-2">{plan.name}</td>
                  <td className="py-2.5 text-ink-2">{t(`plan.model.${plan.model}`)}</td>
                  <td className="py-2.5 pe-3 text-end text-ink-2">{num(preview.activePlayers)}</td>
                  <td className="py-2.5 pe-3 text-end text-ink-2" dir="ltr">
                    {money(preview.base)}
                  </td>
                  <td className="py-2.5 pe-3 text-end text-ink-2" dir="ltr">
                    {money(preview.usage)}
                  </td>
                  <td className="py-2.5 pe-4 text-end font-semibold text-ink sm:pe-5" dir="ltr">
                    {money(preview.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel pad={false} className="mt-5">
        <div className="px-4 pt-4 sm:px-5">
          <PanelHeader title={t('billing.history')} action={<DemoTag label={t('common.demo')} />} />
        </div>
        <InvoiceRows invoices={invoices} showClub />
      </Panel>
      <p className="mt-3 text-[12.5px] text-ink-3">{t('billing.scope_note')}</p>
    </>
  );
}
