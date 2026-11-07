import { LuCheck, LuMinus } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { num } from '../app/format.ts';
import { go, useDb, useMe, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import type { Club, PlanId } from '../platform/types.ts';
import { InvoicePreview, InvoiceRows, LIMIT_KEYS, planPriceText, UsageMeters } from '../shared/plans.tsx';
import { Badge, Button, cx, DemoTag, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';

export function Subscription({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const plan = db.plans[club.planId];
  const invoices = db.invoices.filter((i) => i.clubId === club.id).sort((a, b) => b.period.localeCompare(a.period));
  const plans: PlanId[] = ['starter', 'professional', 'enterprise'];
  const requestChange = (target: PlanId) => {
    const ticket = act(
      () =>
        api.createTicket(db, me.id, club.id, {
          category: 'billing',
          priority: 'normal',
          subject: t('subscription.ticket_subject', { plan: db.plans[target].name }),
          body: t('subscription.ticket_body', { club: club.name, from: plan.name, to: db.plans[target].name }),
        }),
      { key: 'subscription.requested' },
    );
    if (ticket) go('console.support', { clubId: club.id });
  };
  return (
    <>
      <PageHeader title={t('subscription.title')} subtitle={t('subscription.subtitle')} />
      <Notice tone="warning" className="mb-5">
        {t('billing.placeholder_note')}
      </Notice>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title={t('subscription.usage')} hint={t('subscription.usage_hint')} />
            <UsageMeters club={club} />
          </Panel>
          <Panel pad={false}>
            <div className="px-4 pt-4 sm:px-5">
              <PanelHeader title={t('billing.history')} action={<DemoTag label={t('common.demo')} />} />
            </div>
            <InvoiceRows invoices={invoices} />
          </Panel>
        </div>
        <div className="min-w-0 space-y-5">
          <Panel>
            <p className="text-[12.5px] text-ink-2">{t('subscription.current')}</p>
            <p className="mt-1 text-[24px] leading-none font-semibold text-ink">{plan.name}</p>
            <p className="mt-2 text-[13px] text-ink-2">{planPriceText(t, plan)}</p>
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-[12.5px] text-ink-3">{t('billing.this_period')}</p>
              <InvoicePreview club={club} />
            </div>
          </Panel>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold text-ink">{t('subscription.compare')}</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        {plans.map((id) => {
          const p = db.plans[id];
          const current = id === club.planId;
          return (
            <div key={id} className={cx('flex flex-col rounded-panel border bg-surface p-4', current ? 'border-accent' : 'border-line')}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[16px] font-semibold text-ink">{p.name}</h3>
                {current && <Badge tone="accent">{t('subscription.current_badge')}</Badge>}
              </div>
              <p className="mt-1 min-h-[2.6em] text-[13px] leading-snug text-ink-2">{planPriceText(t, p)}</p>
              <dl className="mt-3 space-y-1.5 text-[13px] tabular-nums">
                {LIMIT_KEYS.map((key) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-ink-3">{t(`limit.${key}`)}</dt>
                    <dd className="font-medium text-ink">{num(p.limits[key])}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">{t('plan.custom_branding')}</dt>
                  <dd>{p.customBranding ? <LuCheck className="size-4 text-accent" aria-label={t('common.yes')} /> : <LuMinus className="size-4 text-ink-3" aria-label={t('common.no')} />}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">{t('plan.reporting')}</dt>
                  <dd className="font-medium text-ink">{t(`plan.reporting.${p.reporting}`)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">{t('plan.support')}</dt>
                  <dd className="font-medium text-ink">{t(`plan.support.${p.support}`)}</dd>
                </div>
              </dl>
              {!current && (
                <Button className="mt-4" full onClick={() => requestChange(id)}>
                  {t('subscription.request', { plan: p.name })}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
