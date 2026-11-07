import { useDb, useT, type T } from '../app/hooks.ts';
import { monthYear, num } from '../app/format.ts';
import * as api from '../platform/api.ts';
import type { Club, DB, Invoice, Plan, PlanLimits } from '../platform/types.ts';
import { Badge, cx, Meter } from '../ui/core.tsx';

/** Amounts are placeholders in an unnamed currency — never real prices. */
export const money = (n: number): string => `¤${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

export const LIMIT_KEYS: (keyof PlanLimits)[] = ['members', 'monthlyActive', 'concurrentTables', 'tournamentsPerMonth', 'adminSeats'];

export function usageOf(db: DB, club: Club): Record<keyof PlanLimits, number> {
  const u = api.clubUsage(db, club.id);
  return { members: u.members, monthlyActive: u.monthlyActive, concurrentTables: u.concurrentTables, tournamentsPerMonth: u.tournamentsThisMonth, adminSeats: u.adminSeats };
}

export function UsageMeters({ club, compact }: { club: Club; compact?: boolean }) {
  const t = useT();
  const db = useDb();
  const usage = usageOf(db, club);
  const limits = api.effectiveLimits(db, club);
  const plan = db.plans[club.planId];
  return (
    <dl className={cx('grid gap-x-6 gap-y-4', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
      {LIMIT_KEYS.map((key) => {
        const used = usage[key];
        const limit = limits[key];
        const ratio = used / Math.max(1, limit);
        const overridden = club.limitOverrides[key] !== undefined && club.limitOverrides[key] !== plan.limits[key];
        return (
          <div key={key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <dt className="flex min-w-0 items-center gap-1.5 text-ink-2">
                <span className="truncate">{t(`limit.${key}`)}</span>
                {overridden && <Badge tone="info">{t('limit.override')}</Badge>}
                {(key === 'monthlyActive' || key === 'concurrentTables') && <span className="text-[11px] text-ink-3">({t('common.demo')})</span>}
              </dt>
              <dd className="shrink-0 tabular-nums" dir="ltr">
                <span className={cx('font-semibold', ratio >= 1 ? 'text-danger' : ratio >= 0.85 ? 'text-warning' : 'text-ink')}>{num(used)}</span>
                <span className="text-ink-3"> / {num(limit)}</span>
              </dd>
            </div>
            <Meter value={used} max={limit} tone={ratio >= 1 ? 'danger' : ratio >= 0.85 ? 'warning' : 'accent'} className="mt-1.5" label={t(`limit.${key}`)} />
          </div>
        );
      })}
    </dl>
  );
}

export function planPriceText(t: T, plan: Plan): string {
  switch (plan.model) {
    case 'fixed':
      return t('plan.price.fixed', { base: money(plan.baseFee) });
    case 'per_active':
      return t('plan.price.per_active', { fee: money(plan.perActiveFee) });
    case 'hybrid':
      return t('plan.price.hybrid', { base: money(plan.baseFee), fee: money(plan.perActiveFee), included: num(plan.includedActive) });
    case 'enterprise':
      return t('plan.price.enterprise', { base: money(plan.baseFee), fee: money(plan.perActiveFee), included: num(plan.includedActive) });
  }
}

export function InvoicePreview({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const plan = db.plans[club.planId];
  const preview = api.invoicePreview(db, club.id);
  const billable = plan.model === 'fixed' ? 0 : Math.max(0, preview.activePlayers - plan.includedActive);
  return (
    <dl className="space-y-2 text-[13.5px]" data-testid="invoice-preview">
      <div className="flex justify-between gap-3">
        <dt className="text-ink-2">{t('billing.base', { plan: plan.name })}</dt>
        <dd className="font-medium text-ink tabular-nums" dir="ltr">
          {money(preview.base)}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-2">{plan.model === 'fixed' ? t('billing.usage_none') : t('billing.usage', { billable: num(billable), active: num(preview.activePlayers), fee: money(plan.perActiveFee) })}</dt>
        <dd className="font-medium text-ink tabular-nums" dir="ltr">
          {money(preview.usage)}
        </dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-line pt-2">
        <dt className="font-medium text-ink">{t('billing.total_estimate')}</dt>
        <dd className="text-[16px] font-semibold text-ink tabular-nums" dir="ltr" data-testid="invoice-total">
          {money(preview.total)}
        </dd>
      </div>
    </dl>
  );
}

export function InvoiceRows({ invoices, showClub }: { invoices: Invoice[]; showClub?: boolean }) {
  const t = useT();
  const db = useDb();
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[520px] text-[13.5px] tabular-nums">
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-3">
            <th className="py-2 ps-4 text-start font-medium sm:ps-5">{t('billing.col.period')}</th>
            {showClub && <th className="py-2 text-start font-medium">{t('common.club')}</th>}
            <th className="py-2 text-start font-medium">{t('billing.col.plan')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('billing.col.active')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('billing.col.total')}</th>
            <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('common.status')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-line last:border-0">
              <td className="py-2.5 ps-4 text-ink sm:ps-5">{monthYear(inv.period, t.lang)}</td>
              {showClub && <td className="py-2.5 text-ink-2">{db.clubs[inv.clubId]?.name ?? '—'}</td>}
              <td className="py-2.5 text-ink-2">{db.plans[inv.planId]?.name ?? inv.planId}</td>
              <td className="py-2.5 pe-3 text-end text-ink-2">{num(inv.activePlayers)}</td>
              <td className="py-2.5 pe-3 text-end font-medium text-ink" dir="ltr">
                {money(inv.total)}
              </td>
              <td className="py-2.5 pe-4 text-end sm:pe-5">
                <Badge tone={inv.status === 'paid' ? 'success' : inv.status === 'due' ? 'warning' : 'neutral'}>{t(`billing.status.${inv.status}`)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
