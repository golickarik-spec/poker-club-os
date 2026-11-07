import { useState } from 'react';
import { LuArrowLeft, LuBan, LuPlus, LuUndo2 } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateShort, dateTime, num } from '../app/format.ts';
import { go, useDb, useMe, useT } from '../app/hooks.ts';
import { auditText } from '../console/shared.tsx';
import * as api from '../platform/api.ts';
import { isLive } from '../platform/lifecycle.ts';
import { clubTournaments } from '../platform/selectors.ts';
import type { Club, PlanId, PlanLimits } from '../platform/types.ts';
import { InvoicePreview, InvoiceRows, LIMIT_KEYS, money, planPriceText, UsageMeters, usageOf } from '../shared/plans.tsx';
import { TicketDialog, TicketList } from '../shared/support.tsx';
import { Badge, Button, DemoTag, EmptyState, Fact, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Field, NumberInput, Segmented, Select, TextArea, TextInput } from '../ui/forms.tsx';
import { Avatar, ClubLogo, codeFor } from '../ui/identity.tsx';
import { Dialog } from '../ui/overlay.tsx';

const PLAN_IDS: PlanId[] = ['starter', 'professional', 'enterprise'];

export function Clubs() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [planId, setPlanId] = useState<PlanId>('starter');
  const [policy, setPolicy] = useState<Club['joinPolicy']>('approval');
  const [accent, setAccent] = useState('#6AA5FF');
  const clubs = Object.values(db.clubs).sort((a, b) => a.createdAt - b.createdAt);
  const create = () => {
    const club = act(() => api.createTenant(db, me.id, { clubName: name, ownerName: owner, planId, joinPolicy: policy, accent }), { key: 'tenant.created', params: { club: name } });
    if (club) {
      setCreating(false);
      setName('');
      setOwner('');
      go('platform.club', { clubId: club.id });
    }
  };
  return (
    <>
      <PageHeader
        title={t('tenants.title')}
        subtitle={t('tenants.subtitle')}
        actions={
          <Button variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setCreating(true)} data-testid="new-tenant">
            {t('tenants.new')}
          </Button>
        }
      />
      <Panel pad={false}>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13.5px] tabular-nums">
            <thead>
              <tr className="border-b border-line text-[12px] text-ink-3">
                <th className="py-2 ps-4 text-start font-medium sm:ps-5">{t('common.club')}</th>
                <th className="py-2 text-start font-medium">{t('tenants.col.owner')}</th>
                <th className="py-2 text-start font-medium">{t('billing.col.plan')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('limit.members')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('limit.tournamentsPerMonth')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('tenants.col.since')}</th>
                <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((club) => {
                const u = usageOf(db, club);
                const limits = api.effectiveLimits(db, club);
                return (
                  <tr key={club.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-raised/40" onClick={() => go('platform.club', { clubId: club.id })} data-testid={`tenant-${club.id}`}>
                    <td className="py-2.5 ps-4 sm:ps-5">
                      <button type="button" className="flex items-center gap-2.5 text-start" onClick={() => go('platform.club', { clubId: club.id })}>
                        <ClubLogo branding={club.branding} name={club.name} size={30} />
                        <span>
                          <span className="block font-medium text-ink hover:underline">{club.name}</span>
                          <span className="block text-[12px] text-ink-3" dir="ltr">
                            ID {codeFor(club)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="py-2.5 text-ink-2">{db.users[club.ownerId]?.name ?? '—'}</td>
                    <td className="py-2.5 text-ink-2">{db.plans[club.planId].name}</td>
                    <td className="py-2.5 pe-3 text-end text-ink">
                      <span dir="ltr">{num(u.members)} <span className="text-ink-3">/ {num(limits.members)}</span></span>
                    </td>
                    <td className="py-2.5 pe-3 text-end text-ink">
                      <span dir="ltr">{num(u.tournamentsPerMonth)} <span className="text-ink-3">/ {num(limits.tournamentsPerMonth)}</span></span>
                    </td>
                    <td className="py-2.5 pe-3 text-end text-ink-2">{dateShort(club.createdAt, t.lang)}</td>
                    <td className="py-2.5 pe-4 text-end sm:pe-5">
                      <Badge tone={club.status === 'active' ? 'success' : 'danger'} dot>
                        {t(`tenant.status.${club.status}`)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="mt-3 text-[12.5px] text-ink-3">{t('tenants.isolation_note')}</p>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t('tenants.new')}
        description={t('tenants.new_hint')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={create} disabled={name.trim().length < 3 || owner.trim().length < 2} data-testid="tenant-create">
              {t('tenants.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label={t('tenants.field.name')} htmlFor="tn-name">
            <TextInput id="tn-name" value={name} onChange={setName} maxLength={40} data-autofocus data-testid="tn-name" />
          </Field>
          <Field label={t('tenants.field.owner')} htmlFor="tn-owner" hint={t('tenants.field.owner_hint')}>
            <TextInput id="tn-owner" value={owner} onChange={setOwner} data-testid="tn-owner" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('billing.col.plan')} htmlFor="tn-plan">
              <Select id="tn-plan" value={planId} onChange={setPlanId} options={PLAN_IDS.map((p) => ({ value: p, label: db.plans[p].name }))} />
            </Field>
            <Field label={t('branding.accent')} htmlFor="tn-accent">
              <div className="flex h-10 items-center gap-2 rounded-control border border-line-strong/80 bg-bg px-2">
                <input id="tn-accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value.toUpperCase())} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
                <span className="text-[13px] text-ink tabular-nums" dir="ltr">
                  {accent}
                </span>
              </div>
            </Field>
          </div>
          <Field label={t('branding.join_policy')} htmlFor="tn-policy">
            <Segmented
              value={policy}
              onChange={setPolicy}
              label={t('branding.join_policy')}
              options={[
                { value: 'approval', label: t('clubs.policy.approval') },
                { value: 'open', label: t('clubs.policy.open') },
              ]}
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

export function ClubDetail({ clubId }: { clubId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const club = db.clubs[clubId];
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [limits, setLimits] = useState<Partial<PlanLimits> | null>(null);
  if (!club) return <EmptyState title={t('club.not_found')} action={<Button onClick={() => go('platform.clubs')}>{t('platform.nav.clubs')}</Button>} />;
  const plan = db.plans[club.planId];
  const owner = db.users[club.ownerId];
  const effective = api.effectiveLimits(db, club);
  const editing = limits ?? {};
  const tournaments = clubTournaments(db, club.id);
  const invoices = db.invoices.filter((i) => i.clubId === club.id).sort((a, b) => b.period.localeCompare(a.period));
  const tickets = db.tickets.filter((x) => x.clubId === club.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const audit = db.audit.filter((a) => a.clubId === null && a.params.club === club.name).slice(-8).reverse();
  const limitsDirty = limits !== null && LIMIT_KEYS.some((k) => (editing[k] ?? effective[k]) !== effective[k]);

  const saveLimits = () => {
    const overrides: Partial<PlanLimits> = {};
    for (const k of LIMIT_KEYS) {
      const v = editing[k] ?? effective[k];
      if (v !== plan.limits[k]) overrides[k] = v;
    }
    if (act(() => api.setTenantLimits(db, me.id, club.id, overrides), { key: 'tenant.limits_saved' }) !== undefined) setLimits(null);
  };

  return (
    <div data-testid="tenant-detail">
      <button type="button" onClick={() => go('platform.clubs')} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        {t('platform.nav.clubs')}
      </button>
      <Panel>
        <div className="flex flex-wrap items-center gap-4">
          <ClubLogo branding={club.branding} name={club.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] leading-tight font-semibold text-ink sm:text-[26px]">{club.name}</h1>
              <Badge tone={club.status === 'active' ? 'success' : 'danger'} dot>
                {t(`tenant.status.${club.status}`)}
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-ink-2">
              <span dir="ltr">ID {codeFor(club)}</span> · {t('tenants.since', { date: dateShort(club.createdAt, t.lang) })} · {club.timezone}
            </p>
          </div>
          {club.status === 'active' ? (
            <Button variant="danger" icon={<LuBan className="size-4" aria-hidden />} onClick={() => setSuspending(true)} data-testid="tenant-suspend">
              {t('tenants.suspend')}
            </Button>
          ) : (
            <Button variant="primary" icon={<LuUndo2 className="size-4 flip-rtl" aria-hidden />} onClick={() => act(() => api.restoreTenant(db, me.id, club.id), { key: 'tenant.restored' })} data-testid="tenant-restore">
              {t('tenants.restore')}
            </Button>
          )}
        </div>
        {club.status === 'suspended' && (
          <Notice tone="danger" className="mt-4">
            {t('tenants.suspended_note', { reason: club.suspendedReason ?? '—' })}
          </Notice>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {owner && <Avatar user={owner} size={32} />}
            <Fact label={t('tenants.col.owner')}>{owner?.name ?? '—'}</Fact>
          </div>
          <Fact label={t('limit.members')}>{num(usageOf(db, club).members)}</Fact>
          <Fact label={t('tenants.live_tournaments')}>{tournaments.filter((x) => isLive(x.status)).length}</Fact>
          <Fact label={t('tenants.join_policy')}>{t(`clubs.policy.${club.joinPolicy}`)}</Fact>
        </dl>
      </Panel>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title={t('subscription.usage')} hint={t('tenants.usage_hint')} />
            <UsageMeters club={club} />
          </Panel>

          <Panel>
            <PanelHeader title={t('tenants.limits')} hint={t('tenants.limits_hint', { plan: plan.name })} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LIMIT_KEYS.map((key) => (
                <Field key={key} label={t(`limit.${key}`)} htmlFor={`lim-${key}`} hint={t('tenants.plan_default', { n: num(plan.limits[key]) })}>
                  <NumberInput id={`lim-${key}`} value={editing[key] ?? effective[key]} onChange={(v) => setLimits({ ...editing, [key]: Math.max(1, Math.round(v)) })} min={1} data-testid={`limit-${key}`} />
                </Field>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {Object.keys(club.limitOverrides).length > 0 && (
                <Button variant="ghost" onClick={() => (act(() => api.setTenantLimits(db, me.id, club.id, {}), { key: 'tenant.limits_reset' }), setLimits(null))}>
                  {t('tenants.reset_limits')}
                </Button>
              )}
              <Button variant="primary" disabled={!limitsDirty} onClick={saveLimits} data-testid="limits-save">
                {t('tenants.save_limits')}
              </Button>
            </div>
          </Panel>

          <Panel pad={false}>
            <div className="px-4 pt-4 sm:px-5">
              <PanelHeader title={t('billing.history')} action={<DemoTag label={t('common.demo')} />} />
            </div>
            {invoices.length === 0 ? <p className="px-5 pb-4 text-[13px] text-ink-3">{t('billing.no_invoices')}</p> : <InvoiceRows invoices={invoices} />}
          </Panel>

          <Panel pad={false}>
            <div className="px-4 pt-4 sm:px-5">
              <PanelHeader title={t('tenants.support')} />
            </div>
            {tickets.length === 0 ? <p className="px-5 pb-4 text-[13px] text-ink-3">{t('support.empty.open')}</p> : <TicketList tickets={tickets} onOpen={setTicketId} />}
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title={t('tenants.plan')} />
            <Field label={t('billing.col.plan')} htmlFor="tenant-plan" hint={planPriceText(t, plan)}>
              <Select id="tenant-plan" value={club.planId} onChange={(id) => act(() => api.setTenantPlan(db, me.id, club.id, id), { key: 'tenant.plan_changed', params: { plan: db.plans[id].name } })} options={PLAN_IDS.map((p) => ({ value: p, label: `${db.plans[p].name} · ${money(db.plans[p].baseFee)}` }))} data-testid="tenant-plan" />
            </Field>
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-[12.5px] text-ink-3">{t('billing.this_period')}</p>
              <InvoicePreview club={club} />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('billing.placeholder_note')}</p>
          </Panel>
          <Panel>
            <PanelHeader title={t('tenants.activity')} hint={t('tenants.activity_hint')} />
            {audit.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('audit.empty')}</p>
            ) : (
              <ol className="space-y-2.5 text-[13px]">
                {audit.map((a) => (
                  <li key={a.id}>
                    <p className="text-ink">{auditText(t, a)}</p>
                    <p className="text-[12px] text-ink-3">
                      {db.users[a.actorId]?.name ?? '—'} · {dateTime(a.at, t.lang)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <p className="rounded-inner border border-line px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-3">{t('tenants.privacy_note')}</p>
        </div>
      </div>

      <Dialog
        open={suspending}
        onClose={() => setSuspending(false)}
        title={t('tenants.suspend_title', { club: club.name })}
        description={t('tenants.suspend_body')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuspending(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="tenant-suspend-confirm"
              onClick={() => {
                act(() => api.suspendTenant(db, me.id, club.id, reason), { key: 'tenant.suspended' });
                setSuspending(false);
              }}
            >
              {t('tenants.suspend')}
            </Button>
          </>
        }
      >
        <label htmlFor="suspend-reason" className="mb-1.5 block text-[13px] font-medium text-ink">
          {t('tenants.suspend_reason')}
        </label>
        <TextArea id="suspend-reason" value={reason} onChange={setReason} rows={2} placeholder={t('tenants.suspend_reason_placeholder')} />
      </Dialog>
      <TicketDialog ticketId={ticketId} onClose={() => setTicketId(null)} />
    </div>
  );
}
