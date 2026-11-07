import { useMemo, useState, type ReactNode } from 'react';
import { LuArrowLeft, LuArrowRight, LuCheck, LuCircleAlert, LuCoffee, LuPlus, LuRotateCcw, LuSave, LuSend, LuSparkles, LuTrash2 } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { chips, dateTime, durationLabel } from '../app/format.ts';
import { go, useDb, useMe, useT, type T } from '../app/hooks.ts';
import type { AnteType } from '../engine/holdem.ts';
import { entryAt, estimateDurationMinutes, levelNumberAt, presetStructure, validateStructure, type PresetId, type StructureEntry, type TournamentStructure } from '../engine/structure.ts';
import * as api from '../platform/api.ts';
import { can } from '../platform/permissions.ts';
import * as ret from '../platform/retention.ts';
import * as sch from '../platform/scheduling.ts';
import { slotLabel } from './crm/Scheduling.tsx';
import type { Club, Tournament } from '../platform/types.ts';
import { StructureTable, TournamentCard } from '../shared/tournament.tsx';
import { TableBrandingStep } from './TableBrandingStep.tsx';
import { GamePicker } from './GamePicker.tsx';
import { maxTableSize, variantOf, type VariantId } from '../engine/variants.ts';
import { Badge, Button, cx, EmptyState, IconButton, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { Checkbox, Field, NumberInput, Segmented, Select, Slider, Switch, TextArea, TextInput } from '../ui/forms.tsx';
import { BANNERS, bannerClass } from '../ui/identity.tsx';
import { PresetCard } from './Tournaments.tsx';

const STEPS = ['basics', 'structure', 'registration', 'schedule', 'table', 'review', 'publish'] as const;
type Step = (typeof STEPS)[number];

const pad = (n: number): string => String(n).padStart(2, '0');
const toLocalInput = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string): number | null => {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
};
const roundUp = (ts: number, minutes: number): number => Math.ceil(ts / (minutes * 60_000)) * minutes * 60_000;

export function newDraft(club: Club, preset: Exclude<PresetId, 'custom'>, now: number): api.TournamentDraft {
  const structure = presetStructure(preset);
  const sng = preset === 'sng';
  return {
    name: '',
    description: '',
    banner: 'aurora',
    format: sng ? 'sng' : 'mtt',
    game: 'nlhe',
    preset,
    startMode: sng ? 'when_full' : 'scheduled',
    startAt: roundUp(now, 5) + 30 * 60_000,
    timezone: club.timezone,
    registrationOpensAt: now,
    minPlayers: sng ? structure.tableSize : 6,
    maxPlayers: sng ? structure.tableSize : 54,
    structure,
    // Private is the default: a new tournament is for approved members only until the club decides otherwise.
    visibility: 'private',
    access: 'members',
    accessCode: null,
    entryPoints: 100,
    simulateRegistrations: !sng,
    simulatedFill: 0.6,
    demoSpeed: 1,
  };
}

const STEP_PROBLEMS: Record<Step, (p: api.DraftProblem) => boolean> = {
  basics: (p) => p === 'name_required' || p === 'name_too_long' || p === 'game_not_available',
  structure: (p) => p.startsWith('structure.') || p === 'game_table_size',
  registration: (p) => p === 'bad_capacity' || p === 'min_above_max' || p === 'bad_entry' || p === 'bad_access_code',
  schedule: (p) => p === 'start_in_past' || p === 'registration_after_start',
  table: (p) => p === 'bad_table_logo',
  review: () => false,
  publish: () => false,
};

export function Wizard({ club, editId, presetParam, startAtParam, templateParam }: { club: Club; editId?: string; presetParam?: string; startAtParam?: string; templateParam?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const existing = editId ? db.tournaments[editId] : undefined;
  const initialPreset = (['turbo', 'regular', 'deep', 'sng'] as const).find((p) => p === presetParam) ?? 'regular';
  const [draft, setDraft] = useState<api.TournamentDraft>(() => {
    if (existing) return api.draftOf(existing);
    const fromTemplate = templateParam ? sch.draftFromTemplate(db, club.id, templateParam) : null;
    const d = fromTemplate ?? newDraft(club, initialPreset, Date.now());
    // Arriving from "Best times": the recommended slot is already filled in.
    const at = Number(startAtParam);
    if (Number.isFinite(at) && at > Date.now()) d.startAt = at;
    return d;
  });
  const recommended = useMemo(() => (existing || !can(db, me.id, 'analytics.view', club.id) ? [] : ret.activityHeatmap(db, me.id, club.id, 120).recommendations), [db, me.id, club.id, existing]);
  const [stepIndex, setStepIndex] = useState(0);
  const [visited, setVisited] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [regLater, setRegLater] = useState(() => (existing ? existing.registrationOpensAt > Date.now() : false));
  const step = STEPS[stepIndex]!;
  const patch = (p: Partial<api.TournamentDraft>) => setDraft((d) => ({ ...d, ...p }));
  const effective: api.TournamentDraft = useMemo(() => ({ ...draft, registrationOpensAt: regLater ? draft.registrationOpensAt : Math.min(draft.registrationOpensAt, Date.now()) }), [draft, regLater]);
  const problems = useMemo(() => api.validateDraft(effective, Date.now()), [effective]);
  const stepProblems = problems.filter(STEP_PROBLEMS[step]);

  if (editId && (!existing || existing.clubId !== club.id)) {
    return <EmptyState title={t('lobby.not_found')} action={<Button onClick={() => go('console.tournaments', { clubId: club.id })}>{t('console.nav.tournaments')}</Button>} />;
  }
  if (existing && existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
    return <EmptyState title={t('err.not_editable')} action={<Button onClick={() => go('console.tournament', { clubId: club.id, id: existing.id })}>{t('console.tournaments.manage')}</Button>} />;
  }

  const goStep = (index: number) => {
    setStepIndex(index);
    setVisited((v) => Math.max(v, index));
    setShowErrors(false);
  };
  const next = () => {
    if (stepProblems.length > 0) {
      setShowErrors(true);
      return;
    }
    goStep(Math.min(STEPS.length - 1, stepIndex + 1));
  };

  const setPreset = (preset: Exclude<PresetId, 'custom'>) => {
    const structure = presetStructure(preset);
    const sng = preset === 'sng';
    patch({
      preset,
      structure,
      format: sng ? 'sng' : 'mtt',
      startMode: sng ? 'when_full' : draft.startMode === 'when_full' ? 'scheduled' : draft.startMode,
      maxPlayers: sng ? structure.tableSize : draft.format === 'sng' ? 54 : draft.maxPlayers,
      minPlayers: sng ? structure.tableSize : draft.format === 'sng' ? 6 : draft.minPlayers,
      simulateRegistrations: sng ? false : draft.simulateRegistrations,
    });
  };
  const setStructure = (structure: TournamentStructure) => patch({ structure, preset: 'custom' });
  // Choosing a game caps the table size the deck allows (six-card Omaha seats seven) and keeps everything else.
  const setGame = (game: VariantId) => {
    const cap = maxTableSize(variantOf(game));
    const tableSize = Math.min(draft.structure.tableSize, cap);
    const structure = tableSize === draft.structure.tableSize ? draft.structure : { ...draft.structure, tableSize };
    patch({ game, structure, ...(draft.format === 'sng' ? { maxPlayers: Math.min(draft.maxPlayers, tableSize), minPlayers: Math.min(draft.minPlayers, tableSize) } : {}) });
  };

  const save = (publish: boolean) => {
    const result = act(() => {
      let id = existing?.id;
      if (id) api.updateTournament(db, me.id, id, effective);
      else id = api.createTournament(db, me.id, club.id, effective).id;
      if (publish) api.publishTournament(db, me.id, id, { announce });
      if (saveTemplate) sch.saveTemplate(db, me.id, club.id, templateName || effective.name, effective);
      return id;
    }, { key: publish ? 'wizard.published' : 'wizard.saved' });
    if (result) go('console.tournament', { clubId: club.id, id: result }, { replace: true });
  };

  const problemText = (p: api.DraftProblem): string => t(`wizard.problem.${p}`);
  const estimate = estimateDurationMinutes(draft.structure, Math.max(draft.minPlayers, Math.round(draft.maxPlayers * (draft.format === 'sng' ? 1 : 0.6))));

  return (
    <div className="mx-auto max-w-[980px]">
      <PageHeader
        title={existing ? t('wizard.title_edit') : t('wizard.title_new')}
        subtitle={existing ? existing.name : t('wizard.subtitle')}
        back={
          <button type="button" onClick={() => go('console.tournaments', { clubId: club.id })} className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
            {t('console.nav.tournaments')}
          </button>
        }
      />

      {/* Steps — a real sequence, so they are numbered. */}
      <ol className="mb-5 flex gap-1 overflow-x-auto" aria-label={t('wizard.steps')}>
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const reachable = i <= visited + 1 && i <= stepIndex + 1;
          const hasProblem = problems.some(STEP_PROBLEMS[s]) && i <= visited;
          return (
            <li key={s} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!reachable && i > stepIndex}
                onClick={() => (i <= stepIndex ? goStep(i) : next())}
                aria-current={i === stepIndex ? 'step' : undefined}
                data-testid={`step-${s}`}
                className={cx(
                  'flex w-full min-w-[104px] items-center gap-2 rounded-inner border px-2.5 py-2 text-start transition-colors',
                  i === stepIndex ? 'border-accent bg-accent/10' : done ? 'border-line bg-surface hover:border-line-strong' : 'border-line bg-transparent',
                )}
              >
                <span
                  className={cx(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums',
                    hasProblem ? 'bg-danger/15 text-danger' : done ? 'bg-accent text-accent-ink' : i === stepIndex ? 'bg-accent/20 text-accent' : 'bg-raised text-ink-3',
                  )}
                >
                  {hasProblem ? '!' : done ? <LuCheck className="size-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={cx('truncate text-[12.5px] font-medium', i === stepIndex ? 'text-ink' : 'text-ink-2')}>{t(`wizard.step.${s}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {showErrors && stepProblems.length > 0 && (
        <Notice tone="danger" icon={<LuCircleAlert />} className="mb-4">
          <ul className="list-disc space-y-0.5 ps-4">
            {stepProblems.map((p) => (
              <li key={p}>{problemText(p)}</li>
            ))}
          </ul>
        </Notice>
      )}

      {step === 'basics' && (
        <div className="space-y-4">
          <Panel>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label={t('wizard.name')} htmlFor="w-name" error={showErrors && problems.includes('name_required') ? problemText('name_required') : null} hint={t('wizard.name_hint')}>
                <TextInput id="w-name" value={draft.name} onChange={(name) => patch({ name })} placeholder={t('wizard.name_placeholder')} maxLength={60} data-testid="w-name" />
              </Field>
              <Field label={t('wizard.banner')} htmlFor="w-banner">
                <div className="flex gap-1.5" role="radiogroup" aria-label={t('wizard.banner')}>
                  {BANNERS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      role="radio"
                      aria-checked={draft.banner === b}
                      aria-label={b}
                      onClick={() => patch({ banner: b })}
                      className={cx('size-10 rounded-control border-2', bannerClass(b), draft.banner === b ? 'border-accent' : 'border-transparent')}
                    />
                  ))}
                </div>
              </Field>
            </div>
            <Field label={t('wizard.description')} htmlFor="w-desc" className="mt-4" optional={t('wizard.optional')}>
              <TextArea id="w-desc" value={draft.description} onChange={(description) => patch({ description })} placeholder={t('wizard.description_placeholder')} rows={2} />
            </Field>
          </Panel>
          <GamePicker value={draft.game ?? 'nlhe'} onChange={setGame} tableSize={draft.structure.tableSize} />
          <section>
            <h2 className="mb-1 text-[15px] font-semibold text-ink">{t('wizard.preset_title')}</h2>
            <p className="mb-3 text-[13px] text-ink-2">{t('wizard.preset_hint')}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(['turbo', 'regular', 'deep', 'sng'] as const).map((p) => (
                <button key={p} type="button" onClick={() => setPreset(p)} className="flex rounded-panel text-start [&>div]:w-full" aria-pressed={draft.preset === p} data-testid={`pick-${p}`}>
                  <PresetCard preset={p} selected={draft.preset === p} />
                </button>
              ))}
            </div>
            {draft.preset === 'custom' && (
              <Notice tone="info" className="mt-3">
                {t('wizard.custom_note')}
              </Notice>
            )}
          </section>
        </div>
      )}

      {step === 'structure' && <StructureStep t={t} draft={draft} setStructure={setStructure} onReset={() => setPreset(draft.format === 'sng' ? 'sng' : draft.preset === 'custom' ? 'regular' : draft.preset)} problems={validateStructure(draft.structure)} showErrors={showErrors} />}

      {step === 'registration' && (
        <Panel className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('wizard.max_players')} htmlFor="w-max" hint={t('wizard.max_players_hint', { tables: Math.ceil(draft.maxPlayers / draft.structure.tableSize) })}>
              <NumberInput id="w-max" value={draft.maxPlayers} onChange={(maxPlayers) => patch({ maxPlayers })} min={2} max={500} stepper step={draft.structure.tableSize} />
            </Field>
            <Field label={t('wizard.min_players')} htmlFor="w-min" hint={t('wizard.min_players_hint')} error={showErrors && problems.includes('min_above_max') ? problemText('min_above_max') : null}>
              <NumberInput id="w-min" value={draft.minPlayers} onChange={(minPlayers) => patch({ minPlayers })} min={2} max={500} stepper />
            </Field>
            <Field label={t('wizard.entry_points')} htmlFor="w-entry" hint={t('wizard.entry_points_hint')}>
              <NumberInput id="w-entry" value={draft.entryPoints} onChange={(entryPoints) => patch({ entryPoints })} min={0} max={100000} step={50} suffix={t('wizard.pts')} data-testid="w-entry" />
            </Field>
          </div>
          <p className="rounded-inner bg-raised px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-3">{t('common.points_note')}</p>
          <div className="space-y-4 border-t border-line pt-4">
            <Field label={t('wizard.visibility')} htmlFor="w-visibility" hint={t(`wizard.visibility.${draft.visibility}_hint`)}>
              <Segmented
                value={draft.visibility}
                onChange={(visibility) => patch({ visibility })}
                label={t('wizard.visibility')}
                options={[
                  { value: 'private', label: t('wizard.visibility.private') },
                  { value: 'public', label: t('wizard.visibility.public') },
                ]}
              />
            </Field>
            <Field label={t('wizard.access')} htmlFor="w-access" hint={t(`wizard.access.${draft.access}_hint`)}>
              <Select id="w-access" value={draft.access} onChange={(access) => patch({ access })} className="max-w-md" data-testid="w-access" options={(['members', 'approval', 'invite'] as const).map((a) => ({ value: a, label: t(`wizard.access.${a}`) }))} />
            </Field>
            <Switch checked={draft.accessCode !== null} onChange={(on) => patch({ accessCode: on ? '' : null })} label={t('wizard.code')} description={t('wizard.code_hint')} id="w-code-on" />
            {draft.accessCode !== null && (
              <Field label={t('wizard.code_value')} htmlFor="w-code" hint={t('wizard.code_value_hint')} error={showErrors && problems.includes('bad_access_code') ? problemText('bad_access_code') : null}>
                <TextInput id="w-code" value={draft.accessCode} onChange={(v) => patch({ accessCode: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) })} className="max-w-[220px] font-medium tracking-[0.12em]" dir="ltr" autoComplete="off" data-testid="w-code" />
              </Field>
            )}
            <Notice tone="neutral">{t('wizard.access_note')}</Notice>
            <Field label={t('wizard.reentry')} htmlFor="w-reentry" hint={t('wizard.reentry_hint')}>
              <Select id="w-reentry" value="none" onChange={() => undefined} className="max-w-xs" options={[{ value: 'none', label: t('wizard.reentry.none') }, { value: 'rebuy', label: t('wizard.reentry.rebuy'), disabled: true }, { value: 'reentry', label: t('wizard.reentry.reentry'), disabled: true }, { value: 'bounty', label: t('wizard.reentry.bounty'), disabled: true }]} />
            </Field>
          </div>
          {draft.format !== 'sng' && (
            <div className="space-y-4 rounded-inner border border-dashed border-warning/40 p-4">
              <div className="flex items-center gap-2">
                <Badge tone="warning">{t('demo.badge')}</Badge>
                <p className="text-[13px] font-medium text-ink">{t('wizard.demo_controls')}</p>
              </div>
              <Switch checked={draft.simulateRegistrations} onChange={(simulateRegistrations) => patch({ simulateRegistrations })} label={t('wizard.simulate')} description={t('wizard.simulate_hint')} id="w-simulate" />
              {draft.simulateRegistrations && (
                <Field label={t('wizard.simulate_fill', { pct: Math.round(draft.simulatedFill * 100), n: Math.round(draft.maxPlayers * draft.simulatedFill) })} htmlFor="w-fill">
                  <Slider id="w-fill" value={Math.round(draft.simulatedFill * 100)} onChange={(v) => patch({ simulatedFill: v / 100 })} min={10} max={100} step={5} label={t('wizard.simulate')} />
                </Field>
              )}
            </div>
          )}
        </Panel>
      )}

      {step === 'schedule' && (
        <Panel className="space-y-5">
          <Field label={t('wizard.start_mode')} htmlFor="w-mode" hint={t(`wizard.start_mode.${draft.startMode}_hint`)}>
            <Segmented
              value={draft.startMode}
              onChange={(startMode) => patch({ startMode })}
              label={t('wizard.start_mode')}
              options={[
                { value: 'scheduled', label: t('wizard.start_mode.scheduled') },
                { value: 'manual', label: t('wizard.start_mode.manual') },
                { value: 'when_full', label: t('wizard.start_mode.when_full') },
              ]}
            />
          </Field>
          {draft.startMode === 'scheduled' && (
            <>
              <Field label={t('wizard.start_at')} htmlFor="w-start" error={showErrors && problems.includes('start_in_past') ? problemText('start_in_past') : null} hint={t('wizard.timezone', { tz: draft.timezone })}>
                <div className="flex flex-wrap items-center gap-2">
                  <TextInput id="w-start" type="datetime-local" value={toLocalInput(draft.startAt)} onChange={(v) => { const ts = fromLocalInput(v); if (ts) patch({ startAt: ts }); }} className="w-auto" data-testid="w-start" />
                  {[
                    { label: t('wizard.quick.in_n', { n: 2 }), ts: roundUp(Date.now(), 1) + 2 * 60_000 },
                    { label: t('wizard.quick.in_n', { n: 15 }), ts: roundUp(Date.now(), 5) + 15 * 60_000 },
                    { label: t('wizard.quick.in_n', { n: 60 }), ts: roundUp(Date.now(), 5) + 60 * 60_000 },
                    { label: t('wizard.quick.tomorrow'), ts: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0); return d.getTime(); })() },
                  ].map((q) => (
                    <Button key={q.label} size="sm" variant="outline" onClick={() => patch({ startAt: q.ts })} data-testid="w-quick">
                      {q.label}
                    </Button>
                  ))}
                </div>
                {recommended.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-inner border border-accent/30 bg-accent/8 px-3 py-2" data-testid="w-recommended">
                    <LuSparkles className="size-4 text-accent" aria-hidden />
                    <span className="text-[12.5px] text-ink-2">{t('wizard.recommended_hint', { slot: slotLabel(recommended[0]!.weekday, recommended[0]!.hour, t.lang), avg: recommended[0]!.avgEntrants })}</span>
                    <Button size="sm" variant="primary" className="ms-auto" onClick={() => patch({ startAt: recommended[0]!.nextAt })} data-testid="w-use-recommended">
                      {t('wizard.use_recommended')}
                    </Button>
                    {recommended.length > 1 && (
                      <span className="flex gap-1">
                        {recommended.slice(1).map((r) => (
                          <Button key={`${r.weekday}-${r.hour}`} size="sm" variant="ghost" onClick={() => patch({ startAt: r.nextAt })}>
                            {slotLabel(r.weekday, r.hour, t.lang)}
                          </Button>
                        ))}
                      </span>
                    )}
                  </div>
                )}
              </Field>
              <Field label={t('wizard.reg_opens')} htmlFor="w-reg" error={showErrors && problems.includes('registration_after_start') ? problemText('registration_after_start') : null}>
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={regLater ? 'later' : 'now'} onChange={(v) => { setRegLater(v === 'later'); if (v === 'later') patch({ registrationOpensAt: Math.max(Date.now() + 60_000, draft.startAt - 12 * 3_600_000) }); }} label={t('wizard.reg_opens')} options={[{ value: 'now', label: t('wizard.reg_opens.now') }, { value: 'later', label: t('wizard.reg_opens.later') }]} />
                  {regLater && <TextInput id="w-reg" type="datetime-local" value={toLocalInput(draft.registrationOpensAt)} onChange={(v) => { const ts = fromLocalInput(v); if (ts) patch({ registrationOpensAt: ts }); }} className="w-auto" />}
                </div>
              </Field>
            </>
          )}
          <div className="space-y-3 rounded-inner border border-dashed border-warning/40 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="warning">{t('demo.badge')}</Badge>
              <p className="text-[13px] font-medium text-ink">{t('wizard.demo_clock')}</p>
            </div>
            <Segmented value={String(draft.demoSpeed)} onChange={(v) => patch({ demoSpeed: Number(v) })} label={t('wizard.demo_clock')} options={[1, 10, 60, 240].map((n) => ({ value: String(n), label: n === 1 ? t('wizard.speed.real') : `×${n}` }))} />
            <p className="text-[12.5px] leading-relaxed text-ink-3">{t('wizard.demo_clock_hint')}</p>
          </div>
        </Panel>
      )}

      {step === 'table' && <TableBrandingStep club={club} value={draft.tableBranding} onChange={(tableBranding) => patch({ tableBranding })} />}

      {step === 'review' && (
        <div className="space-y-4">
          {problems.length > 0 ? (
            <Notice tone="danger" icon={<LuCircleAlert />}>
              <p className="font-medium">{t('wizard.review.problems')}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-4">
                {problems.map((p) => (
                  <li key={p}>{problemText(p)}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice tone="success" icon={<LuCheck />}>
              {t('wizard.review.ok')}
            </Notice>
          )}
          <Panel>
            <h2 className="mb-3 text-[13px] font-medium text-ink-2">{t('wizard.review.card')}</h2>
            <div className="pointer-events-none" aria-hidden>
              <TournamentCard db={db} userId={me.id} tournament={previewTournament(effective, club, existing)} />
            </div>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <ReviewBlock title={t('wizard.step.basics')} onEdit={() => goStep(0)} t={t}>
              <ReviewRow label={t('wizard.name')} value={draft.name || '—'} />
              <ReviewRow label={t('wizard.game_title')} value={t(`variant.${draft.game ?? 'nlhe'}`)} />
              <ReviewRow label={t('wizard.preset')} value={t(`preset.${draft.preset}`)} />
              <ReviewRow label={t('wizard.description')} value={draft.description || '—'} />
            </ReviewBlock>
            <ReviewBlock title={t('wizard.step.registration')} onEdit={() => goStep(2)} t={t}>
              <ReviewRow label={t('wizard.players_range')} value={`${draft.minPlayers}–${draft.maxPlayers}`} />
              <ReviewRow label={t('wizard.entry_points')} value={draft.entryPoints > 0 ? t('common.points_n', { n: chips(draft.entryPoints) }) : t('common.free')} />
              <ReviewRow label={t('wizard.visibility')} value={t(`wizard.visibility.${draft.visibility}`)} />
              <ReviewRow label={t('wizard.access')} value={t(`wizard.access.${draft.access}`)} />
              <ReviewRow label={t('wizard.code')} value={draft.accessCode !== null ? draft.accessCode || '—' : t('common.no')} />
            </ReviewBlock>
            <ReviewBlock title={t('wizard.step.schedule')} onEdit={() => goStep(3)} t={t}>
              <ReviewRow label={t('wizard.start_mode')} value={t(`wizard.start_mode.${draft.startMode}`)} />
              {draft.startMode === 'scheduled' && <ReviewRow label={t('wizard.start_at')} value={dateTime(draft.startAt, t.lang)} />}
              {draft.startMode === 'scheduled' && <ReviewRow label={t('wizard.reg_opens')} value={regLater ? dateTime(draft.registrationOpensAt, t.lang) : t('wizard.reg_opens.now')} />}
              <ReviewRow label={t('lobby.fact.duration')} value={estimate ? `~${durationLabel(estimate, t.lang)}` : '—'} />
              {draft.demoSpeed > 1 && <ReviewRow label={t('wizard.demo_clock')} value={`×${draft.demoSpeed}`} />}
            </ReviewBlock>
            <ReviewBlock title={t('wizard.step.table')} onEdit={() => goStep(STEPS.indexOf('table'))} t={t}>
              <ReviewRow label={t('table.logo.source')} value={t(`table.logo.source.${draft.tableBranding?.source ?? 'club'}`)} />
              <ReviewRow label={t('table.logo.theme')} value={!draft.tableBranding || draft.tableBranding.theme === 'club' ? `${t('table.logo.theme.club')} · ${t(`felt.${club.branding.tableTheme}`)}` : t(`felt.${draft.tableBranding.theme}`)} />
              {draft.tableBranding?.source !== 'hidden' && <ReviewRow label={t('table.logo.opacity')} value={`${Math.round((draft.tableBranding?.opacity ?? 0.16) * 100)}%`} />}
            </ReviewBlock>
            <ReviewBlock title={t('wizard.step.structure')} onEdit={() => goStep(1)} t={t}>
              <ReviewRow label={t('lobby.starting_stack')} value={chips(draft.structure.startingStack)} />
              <ReviewRow label={t('lobby.fact.table_size')} value={t('lobby.seats_n', { n: draft.structure.tableSize })} />
              <ReviewRow label={t('wizard.levels')} value={String(draft.structure.entries.filter((e) => e.kind === 'level').length)} />
              <ReviewRow label={t('wizard.ante_type')} value={t(`wizard.ante.${draft.structure.anteType}`)} />
              <ReviewRow label={t('lobby.fact.late_reg')} value={draft.structure.lateRegLevels > 0 ? t('lobby.late_reg_n', { n: draft.structure.lateRegLevels }) : t('lobby.late_reg_none')} />
            </ReviewBlock>
          </div>
          <Panel>
            <details>
              <summary className="cursor-pointer text-[13.5px] font-medium text-ink">{t('wizard.review.structure')}</summary>
              <div className="mt-3">
                <StructureTable structure={draft.structure} />
              </div>
            </details>
          </Panel>
        </div>
      )}

      {step === 'publish' && (
        <Panel className="space-y-4">
          {problems.length > 0 ? (
            <Notice tone="danger" icon={<LuCircleAlert />} action={<Button size="sm" onClick={() => goStep(STEPS.indexOf('review'))}>{t('wizard.step.review')}</Button>}>
              {t('wizard.publish.blocked')}
            </Notice>
          ) : (
            <>
              <h2 className="text-[17px] font-semibold text-ink">{t('wizard.publish.title', { name: draft.name })}</h2>
              <p className="max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
                {draft.startMode === 'scheduled' && regLater ? t('wizard.publish.scheduled', { time: dateTime(draft.registrationOpensAt, t.lang) }) : t('wizard.publish.open')}
              </p>
              <Checkbox checked={announce} onChange={setAnnounce} label={t('wizard.publish.announce')} id="w-announce" />
            </>
          )}
          <div className="rounded-inner border border-line bg-raised/40 p-3" data-testid="w-template">
            <Checkbox checked={saveTemplate} onChange={setSaveTemplate} label={t('wizard.template.save')} id="w-save-template" />
            {saveTemplate && <TextInput value={templateName} onChange={setTemplateName} placeholder={draft.name || t('wizard.template.name_placeholder')} className="mt-2 max-w-sm" maxLength={60} aria-label={t('wizard.template.name')} data-testid="w-template-name" />}
            <p className="mt-1.5 text-[12px] text-ink-3">{t('wizard.template.hint')}</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button variant="primary" size="lg" icon={<LuSend className="size-4 flip-rtl" aria-hidden />} disabled={problems.length > 0} onClick={() => save(true)} data-testid="w-publish">
              {t('wizard.publish.action')}
            </Button>
            <Button size="lg" icon={<LuSave className="size-4" aria-hidden />} disabled={problems.filter((p) => p !== 'start_in_past').length > 0} onClick={() => save(false)} data-testid="w-save-draft">
              {t('wizard.publish.draft')}
            </Button>
          </div>
        </Panel>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="ghost" icon={<LuArrowLeft className="size-4 flip-rtl" aria-hidden />} onClick={() => (stepIndex === 0 ? go('console.tournaments', { clubId: club.id }) : goStep(stepIndex - 1))}>
          {stepIndex === 0 ? t('common.cancel') : t('common.back')}
        </Button>
        {stepIndex < STEPS.length - 1 && (
          <Button variant="primary" trailing={<LuArrowRight className="size-4 flip-rtl" aria-hidden />} onClick={next} data-testid="w-next">
            {t('wizard.next', { step: t(`wizard.step.${STEPS[stepIndex + 1]}`) })}
          </Button>
        )}
      </div>
    </div>
  );
}

function previewTournament(draft: api.TournamentDraft, club: Club, existing: Tournament | undefined): Tournament {
  const now = Date.now();
  return {
    id: existing?.id ?? 'preview',
    clubId: club.id,
    ...draft,
    name: draft.name || '—',
    reentry: 'none',
    status: draft.registrationOpensAt > now ? 'SCHEDULED' : 'REGISTRATION_OPEN',
    registrations: existing?.registrations ?? [],
    createdBy: club.ownerId,
    createdAt: now,
    publishedAt: now,
    startedAt: null,
    completedAt: null,
    cancelReason: null,
    seatingUntil: null,
    seeded: false,
  };
}

function ReviewBlock({ title, onEdit, children, t }: { title: string; onEdit: () => void; children: ReactNode; t: T }) {
  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {t('common.edit')}
        </Button>
      </div>
      <dl className="space-y-1.5 text-[13.5px]">{children}</dl>
    </Panel>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 font-medium break-words text-ink tabular-nums" dir="auto">{value}</dd>
    </div>
  );
}

// ----- Structure editor ------------------------------------------------------------------------

function StructureStep({ t, draft, setStructure, onReset, problems, showErrors }: { t: T; draft: api.TournamentDraft; setStructure: (s: TournamentStructure) => void; onReset: () => void; problems: string[]; showErrors: boolean }) {
  const s = draft.structure;
  const setEntries = (entries: StructureEntry[]) => setStructure({ ...s, entries });
  const update = (index: number, patch: Partial<Extract<StructureEntry, { kind: 'level' }>> | { minutes: number }) => {
    setEntries(s.entries.map((e, i) => (i === index ? ({ ...e, ...patch } as StructureEntry) : e)));
  };
  const setAnteType = (anteType: AnteType) => {
    const entries = s.entries.map((e, i): StructureEntry => {
      if (e.kind !== 'level') return e;
      const levelNo = levelNumberAt(s, i);
      if (anteType === 'none') return { ...e, ante: 0 };
      const from = Math.max(1, s.entries.findIndex((x) => x.kind === 'level' && x.ante > 0) >= 0 ? levelNumberAt(s, s.entries.findIndex((x) => x.kind === 'level' && x.ante > 0)) : 4);
      if (levelNo < from) return { ...e, ante: 0 };
      return { ...e, ante: anteType === 'bb' ? e.bb : Math.max(1, Math.round(e.bb / 8)) };
    });
    setStructure({ ...s, anteType, entries });
  };
  const setAllMinutes = (minutes: number) => setEntries(s.entries.map((e) => (e.kind === 'level' ? { ...e, minutes } : e)));
  const addLevel = () => {
    const next = entryAt({ ...s, entries: s.entries }, s.entries.length);
    setEntries([...s.entries, next]);
  };
  const levels = s.entries.filter((e) => e.kind === 'level');
  const firstMinutes = levels[0]?.minutes ?? 10;
  const estimate = estimateDurationMinutes(s, Math.max(draft.minPlayers, Math.round(draft.maxPlayers * 0.6)));

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('lobby.starting_stack')} htmlFor="s-stack" hint={levels[0] && levels[0].kind === 'level' ? t('wizard.stack_hint', { bb: Math.round(s.startingStack / levels[0].bb) }) : undefined}>
            <NumberInput id="s-stack" value={s.startingStack} onChange={(startingStack) => setStructure({ ...s, startingStack })} min={100} max={1_000_000} step={500} data-testid="s-stack" />
          </Field>
          <Field label={t('lobby.fact.table_size')} htmlFor="s-size">
            <Select id="s-size" value={String(s.tableSize)} onChange={(v) => setStructure({ ...s, tableSize: Number(v) })} options={[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: t('lobby.seats_n', { n }) }))} />
          </Field>
          <Field label={t('lobby.fact.levels')} htmlFor="s-minutes" hint={t('wizard.minutes_hint')}>
            <NumberInput id="s-minutes" value={firstMinutes} onChange={(m) => setAllMinutes(Math.max(1, m))} min={1} max={120} suffix={t('wizard.min')} stepper />
          </Field>
          <Field label={t('lobby.fact.late_reg')} htmlFor="s-late" hint={t('wizard.late_hint')}>
            <NumberInput id="s-late" value={s.lateRegLevels} onChange={(lateRegLevels) => setStructure({ ...s, lateRegLevels: Math.max(0, lateRegLevels) })} min={0} max={levels.length} stepper />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
          <Field label={t('wizard.ante_type')} htmlFor="s-ante" hint={t(`wizard.ante.${s.anteType}_hint`)}>
            <Segmented value={s.anteType} onChange={setAnteType} label={t('wizard.ante_type')} options={[{ value: 'none', label: t('wizard.ante.none') }, { value: 'bb', label: t('wizard.ante.bb') }, { value: 'classic', label: t('wizard.ante.classic') }]} />
          </Field>
          <p className="text-[12.5px] text-ink-2 tabular-nums">{estimate ? t('wizard.estimate', { time: durationLabel(estimate, t.lang) }) : ''}</p>
        </div>
      </Panel>

      <Panel pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{t('wizard.levels_title')}</h2>
            <p className="text-[12.5px] text-ink-3">{t('wizard.levels_hint')}</p>
          </div>
          <Button size="sm" icon={<LuRotateCcw className="size-3.5" aria-hidden />} onClick={onReset} data-testid="s-reset">
            {t('wizard.reset_preset')}
          </Button>
        </div>
        {showErrors && problems.length > 0 && (
          <p className="px-4 pb-2 text-[12.5px] text-danger sm:px-5">{problems.map((p) => t(`wizard.problem.structure.${p}`)).join(' ')}</p>
        )}
        <div className="max-h-[440px] overflow-auto border-t border-line">
          <table className="w-full min-w-[560px] text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-[12px] text-ink-3">
                <th className="w-14 border-b border-line py-2 ps-4 text-start font-medium sm:ps-5">{t('structure.level')}</th>
                <th className="border-b border-line px-1.5 py-2 text-start font-medium">{t('wizard.sb')}</th>
                <th className="border-b border-line px-1.5 py-2 text-start font-medium">{t('wizard.bb')}</th>
                <th className="border-b border-line px-1.5 py-2 text-start font-medium">{t('structure.ante')}</th>
                <th className="border-b border-line px-1.5 py-2 text-start font-medium">{t('wizard.minutes')}</th>
                <th className="w-24 border-b border-line py-2 pe-4 text-end font-medium sm:pe-5">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {s.entries.map((entry, index) => {
                if (entry.kind === 'break') {
                  return (
                    <tr key={index} className="border-b border-line bg-warning/[0.06]">
                      <td className="py-1.5 ps-4 text-warning sm:ps-5" colSpan={4}>
                        <span className="inline-flex items-center gap-1.5">
                          <LuCoffee className="size-3.5" aria-hidden />
                          {t('structure.break')}
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <NumberInput value={entry.minutes} onChange={(minutes) => update(index, { minutes: Math.max(1, minutes) })} min={1} max={120} className="w-20" aria-label={t('wizard.minutes')} />
                      </td>
                      <td className="py-1.5 pe-4 text-end sm:pe-5">
                        <IconButton label={t('wizard.remove_break')} size="sm" onClick={() => setEntries(s.entries.filter((_, i) => i !== index))}>
                          <LuTrash2 className="size-4" aria-hidden />
                        </IconButton>
                      </td>
                    </tr>
                  );
                }
                const levelNo = levelNumberAt(s, index);
                const nextIsBreak = s.entries[index + 1]?.kind === 'break';
                return (
                  <tr key={index} className="border-b border-line" data-testid={`level-row-${levelNo}`}>
                    <td className="py-1.5 ps-4 text-ink-2 sm:ps-5">{levelNo}</td>
                    <td className="px-1.5 py-1.5">
                      <NumberInput value={entry.sb} onChange={(sb) => update(index, { sb })} min={1} className="w-24" aria-label={`${t('wizard.sb')} ${levelNo}`} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <NumberInput value={entry.bb} onChange={(bb) => update(index, { bb, ...(s.anteType === 'bb' && entry.ante > 0 ? { ante: bb } : {}) })} min={1} className="w-24" aria-label={`${t('wizard.bb')} ${levelNo}`} data-testid={`bb-${levelNo}`} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <NumberInput value={entry.ante} onChange={(ante) => update(index, { ante: Math.max(0, ante) })} min={0} className="w-24" aria-label={`${t('structure.ante')} ${levelNo}`} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <NumberInput value={entry.minutes} onChange={(minutes) => update(index, { minutes: Math.max(1, minutes) })} min={1} max={120} className="w-20" aria-label={`${t('wizard.minutes')} ${levelNo}`} />
                    </td>
                    <td className="py-1.5 pe-4 text-end whitespace-nowrap sm:pe-5">
                      {!nextIsBreak && index < s.entries.length - 1 && (
                        <IconButton label={t('wizard.add_break_after', { n: levelNo })} size="sm" onClick={() => setEntries([...s.entries.slice(0, index + 1), { kind: 'break', minutes: 5 }, ...s.entries.slice(index + 1)])}>
                          <LuCoffee className="size-4" aria-hidden />
                        </IconButton>
                      )}
                      <IconButton label={t('wizard.remove_level', { n: levelNo })} size="sm" disabled={levels.length <= 1} onClick={() => setEntries(s.entries.filter((_, i) => i !== index))}>
                        <LuTrash2 className="size-4" aria-hidden />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 sm:px-5">
          <Button size="sm" icon={<LuPlus className="size-3.5" aria-hidden />} onClick={addLevel} data-testid="s-add-level">
            {t('wizard.add_level')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
