import { useState } from 'react';
import { act } from '../app/context.ts';
import { num } from '../app/format.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import type { Plan, PlanId } from '../platform/types.ts';
import { LIMIT_KEYS, planPriceText } from '../shared/plans.tsx';
import { Badge, Button, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { Field, NumberInput, Select, Switch, TextInput } from '../ui/forms.tsx';

const PLAN_IDS: PlanId[] = ['starter', 'professional', 'enterprise'];

export function Plans() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('plans.title')} subtitle={t('plans.subtitle')} />
      <Notice tone="warning" className="mb-5">
        {t('billing.placeholder_note')}
      </Notice>
      <div className="grid gap-4 xl:grid-cols-3">
        {PLAN_IDS.map((id) => (
          <PlanEditor key={id} planId={id} />
        ))}
      </div>
      <Panel className="mt-5">
        <h2 className="text-[15px] font-semibold text-ink">{t('plans.models.title')}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-2">
          {(['fixed', 'per_active', 'hybrid', 'enterprise'] as const).map((m) => (
            <div key={m}>
              <dt className="font-medium text-ink">{t(`plan.model.${m}`)}</dt>
              <dd className="mt-0.5 leading-relaxed text-ink-2">{t(`plan.model.${m}.about`)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}

function PlanEditor({ planId }: { planId: PlanId }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const saved = db.plans[planId];
  const [draft, setDraft] = useState<Plan>(() => structuredClone(saved));
  const patch = (p: Partial<Plan>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const clubs = Object.values(db.clubs).filter((c) => c.planId === planId).length;
  return (
    <Panel className="flex flex-col gap-4" data-testid={`plan-${planId}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Field label={t('plans.field.name')} htmlFor={`pl-name-${planId}`}>
            <TextInput id={`pl-name-${planId}`} value={draft.name} onChange={(name) => patch({ name })} className="font-semibold" />
          </Field>
        </div>
        <Badge className="mt-7">{t.n('plans.clubs_on', clubs)}</Badge>
      </div>
      <Field label={t('plans.field.model')} htmlFor={`pl-model-${planId}`}>
        <Select id={`pl-model-${planId}`} value={draft.model} onChange={(model) => patch({ model })} options={(['fixed', 'per_active', 'hybrid', 'enterprise'] as const).map((m) => ({ value: m, label: t(`plan.model.${m}`) }))} />
      </Field>
      <div className="grid grid-cols-3 gap-2.5">
        <Field label={t('plans.field.base')} htmlFor={`pl-base-${planId}`}>
          <NumberInput id={`pl-base-${planId}`} value={draft.baseFee} onChange={(baseFee) => patch({ baseFee })} min={0} data-testid={`plan-base-${planId}`} />
        </Field>
        <Field label={t('plans.field.per_active')} htmlFor={`pl-fee-${planId}`}>
          <NumberInput id={`pl-fee-${planId}`} value={draft.perActiveFee} onChange={(perActiveFee) => patch({ perActiveFee })} min={0} step={0.1} />
        </Field>
        <Field label={t('plans.field.included')} htmlFor={`pl-inc-${planId}`}>
          <NumberInput id={`pl-inc-${planId}`} value={draft.includedActive} onChange={(includedActive) => patch({ includedActive })} min={0} />
        </Field>
      </div>
      <p className="-mt-1 text-[12.5px] text-ink-2">{planPriceText(t, draft)}</p>
      <div className="grid grid-cols-2 gap-2.5 border-t border-line pt-4">
        {LIMIT_KEYS.map((key) => (
          <Field key={key} label={t(`limit.${key}`)} htmlFor={`pl-${key}-${planId}`}>
            <NumberInput id={`pl-${key}-${planId}`} value={draft.limits[key]} onChange={(v) => patch({ limits: { ...draft.limits, [key]: Math.max(1, Math.round(v)) } })} min={1} />
          </Field>
        ))}
      </div>
      <div className="space-y-3.5 border-t border-line pt-4">
        <Switch checked={draft.customBranding} onChange={(customBranding) => patch({ customBranding })} label={t('plan.custom_branding')} description={t('plan.custom_branding_hint')} id={`pl-brand-${planId}`} />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t('plan.reporting')} htmlFor={`pl-rep-${planId}`}>
            <Select id={`pl-rep-${planId}`} value={draft.reporting} onChange={(reporting) => patch({ reporting })} options={(['basic', 'advanced', 'full'] as const).map((r) => ({ value: r, label: t(`plan.reporting.${r}`) }))} />
          </Field>
          <Field label={t('plan.support')} htmlFor={`pl-sup-${planId}`}>
            <Select id={`pl-sup-${planId}`} value={draft.support} onChange={(support) => patch({ support })} options={(['standard', 'priority', 'dedicated'] as const).map((r) => ({ value: r, label: t(`plan.support.${r}`) }))} />
          </Field>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-4">
        <p className="text-[12px] text-ink-3 tabular-nums">{t('plans.members_hint', { n: num(draft.limits.members) })}</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(structuredClone(saved))}>
            {t('branding.discard')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty}
            data-testid={`plan-save-${planId}`}
            onClick={() => {
              const { id: _id, ...rest } = draft;
              act(() => api.updatePlan(db, me.id, planId, rest), { key: 'plans.saved', params: { plan: draft.name } });
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
