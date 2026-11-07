/**
 * Open a club in five minutes (v0.4): name and place, a look, an optional first tournament,
 * and the invitation to share. The person becomes the owner; the club runs on the Starter
 * plan with demo points — there is no payment anywhere in this flow.
 */
import { useState } from 'react';
import { LuArrowLeft, LuArrowRight, LuCheck, LuLayoutDashboard, LuSparkles } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { go, useDb, useMe, useT } from '../app/hooks.ts';
import { presetStructure, type PresetId } from '../engine/structure.ts';
import { newDraft } from '../console/Wizard.tsx';
import * as api from '../platform/api.ts';
import type { Club, ClubBranding, CoverPattern, LogoGlyph } from '../platform/types.ts';
import { QrCard } from '../shared/qr.tsx';
import { Button, cx, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { Field, Segmented, Select, TextInput } from '../ui/forms.tsx';
import { accentStyle, ClubCover, ClubLogo, COVER_PATTERNS, Glyph, LOGO_GLYPHS } from '../ui/identity.tsx';

const STEPS = ['basics', 'look', 'first', 'done'] as const;
type Step = (typeof STEPS)[number];
const ACCENTS = ['#14B8A6', '#8EA2FF', '#D6B36A', '#F0883E', '#E5677D', '#5BB974', '#6AA5FF', '#C792EA'];
const TIMEZONES = ['Asia/Jerusalem', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Athens', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

interface Setup {
  name: string;
  tagline: string;
  location: string;
  timezone: string;
  joinPolicy: Club['joinPolicy'];
  accent: string;
  logo: ClubBranding['logo'];
  cover: ClubBranding['cover'];
  titleFont: ClubBranding['titleFont'];
}

const monogram = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]!).join('').slice(0, 2).toUpperCase() || 'PC';

export function ClubWizard() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [step, setStep] = useState<Step>('basics');
  const [setup, setSetup] = useState<Setup>(() => ({
    name: '',
    tagline: '',
    location: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem',
    joinPolicy: 'approval',
    accent: ACCENTS[0]!,
    logo: { kind: 'monogram', text: 'PC' },
    cover: { kind: 'pattern', pattern: 'constellation' },
    titleFont: 'sans',
  }));
  const [first, setFirst] = useState<{ wanted: boolean; preset: Exclude<PresetId, 'custom'>; when: 'tomorrow' | 'weekend' }>({ wanted: true, preset: 'regular', when: 'tomorrow' });
  const [created, setCreated] = useState<{ club: Club; tournamentId: string | null } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const patch = (p: Partial<Setup>) => setSetup((s) => ({ ...s, ...p, ...(p.name !== undefined && s.logo.kind === 'monogram' ? { logo: { kind: 'monogram' as const, text: monogram(p.name) } } : {}) }));
  const nameProblem = setup.name.trim().length < 3 || setup.name.trim().length > 40 ? t('clubwiz.problem.name') : Object.values(db.clubs).some((c) => c.name.toLowerCase() === setup.name.trim().toLowerCase()) ? t('clubwiz.problem.duplicate') : null;
  const index = STEPS.indexOf(step);
  const preview: ClubBranding = { accent: setup.accent, logo: setup.logo, cover: setup.cover, tableTheme: 'midnight', titleFont: setup.titleFont };

  const firstStart = (): number => {
    const d = new Date();
    if (first.when === 'tomorrow') d.setDate(d.getDate() + 1);
    else d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    d.setHours(20, 0, 0, 0);
    return d.getTime();
  };

  const finish = () => {
    const result = act(() => {
      const club = api.createClub(db, me.id, { name: setup.name, tagline: setup.tagline, location: setup.location, timezone: setup.timezone, joinPolicy: setup.joinPolicy, accent: setup.accent, logo: setup.logo, cover: setup.cover, titleFont: setup.titleFont });
      let tournamentId: string | null = null;
      if (first.wanted) {
        const draft = newDraft(club, first.preset, Date.now());
        draft.name = t(`clubwiz.first.name.${first.preset}`, { club: club.name });
        draft.startAt = firstStart();
        draft.simulateRegistrations = false;
        const made = api.createTournament(db, me.id, club.id, draft);
        api.publishTournament(db, me.id, made.id, { announce: false });
        tournamentId = made.id;
      }
      return { club, tournamentId };
    }, { key: 'clubwiz.created' });
    if (result) {
      setCreated(result);
      setStep('done');
    }
  };

  const next = () => {
    if (step === 'basics') {
      if (nameProblem) return setShowErrors(true);
      setStep('look');
    } else if (step === 'look') setStep('first');
    else if (step === 'first') finish();
  };

  return (
    <div data-testid="club-wizard" style={accentStyle(setup.accent)}>
      <button type="button" onClick={() => go('clubs')} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        {t('nav.clubs')}
      </button>
      <PageHeader title={t('clubwiz.title')} subtitle={t('clubwiz.subtitle')} />
      <ol className="mb-5 flex gap-1 overflow-x-auto" aria-label={t('wizard.steps')}>
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-0 flex-1">
            <div className={cx('flex w-full min-w-[96px] items-center gap-2 rounded-inner border px-2.5 py-2', i === index ? 'border-accent bg-accent/10' : 'border-line')} aria-current={i === index ? 'step' : undefined} data-testid={`clubwiz-step-${s}`}>
              <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums', i < index ? 'bg-accent text-accent-ink' : i === index ? 'bg-accent/20 text-accent' : 'bg-raised text-ink-3')}>{i < index ? <LuCheck className="size-3.5" aria-hidden /> : i + 1}</span>
              <span className={cx('truncate text-[12.5px] font-medium', i === index ? 'text-ink' : 'text-ink-2')}>{t(`clubwiz.step.${s}`)}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="min-w-0">
          {step === 'basics' && (
            <div className="space-y-4">
              <Field label={t('clubwiz.name')} htmlFor="cw-name" error={showErrors ? nameProblem : null} hint={t('clubwiz.name_hint')}>
                <TextInput id="cw-name" value={setup.name} onChange={(name) => patch({ name })} placeholder={t('clubwiz.name_placeholder')} maxLength={40} data-testid="cw-name" />
              </Field>
              <Field label={t('clubwiz.tagline')} htmlFor="cw-tagline" optional={t('wizard.optional')}>
                <TextInput id="cw-tagline" value={setup.tagline} onChange={(tagline) => patch({ tagline })} placeholder={t('clubwiz.tagline_placeholder')} maxLength={80} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('clubwiz.location')} htmlFor="cw-location" optional={t('wizard.optional')}>
                  <TextInput id="cw-location" value={setup.location} onChange={(location) => patch({ location })} placeholder={t('clubwiz.location_placeholder')} maxLength={60} />
                </Field>
                <Field label={t('clubwiz.timezone')} htmlFor="cw-tz" hint={t('clubwiz.timezone_hint')}>
                  <Select id="cw-tz" value={TIMEZONES.includes(setup.timezone) ? setup.timezone : 'UTC'} onChange={(timezone) => patch({ timezone })} options={TIMEZONES.map((z) => ({ value: z, label: z }))} />
                </Field>
              </div>
              <Field label={t('clubwiz.join_policy')} hint={t(`clubwiz.join_policy.${setup.joinPolicy}_hint`)}>
                <Segmented value={setup.joinPolicy} onChange={(joinPolicy) => patch({ joinPolicy })} label={t('clubwiz.join_policy')} options={[{ value: 'approval', label: t('clubwiz.join_policy.approval') }, { value: 'open', label: t('clubwiz.join_policy.open') }]} />
              </Field>
            </div>
          )}

          {step === 'look' && (
            <div className="space-y-5">
              <Field label={t('branding.accent')}>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('branding.accent')}>
                  {ACCENTS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={setup.accent === c} aria-label={c} onClick={() => patch({ accent: c })} className={cx('size-9 rounded-full border-2 transition-transform hover:scale-105', setup.accent === c ? 'border-white' : 'border-transparent')} style={{ background: c }} data-testid={`cw-accent-${c.slice(1)}`} />
                  ))}
                </div>
              </Field>
              <Field label={t('branding.logo')}>
                <Segmented value={setup.logo.kind === 'glyph' ? 'glyph' : 'monogram'} onChange={(kind) => patch({ logo: kind === 'glyph' ? { kind: 'glyph', glyph: 'spade' } : { kind: 'monogram', text: monogram(setup.name) } })} label={t('branding.logo')} options={[{ value: 'monogram', label: t('branding.logo.monogram') }, { value: 'glyph', label: t('branding.logo.glyph') }]} />
                {setup.logo.kind === 'glyph' && (
                  <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t('branding.logo.glyph')}>
                    {LOGO_GLYPHS.map((g: LogoGlyph) => (
                      <button key={g} type="button" role="radio" aria-checked={setup.logo.kind === 'glyph' && setup.logo.glyph === g} aria-label={g} onClick={() => patch({ logo: { kind: 'glyph', glyph: g } })} className={cx('flex size-11 items-center justify-center rounded-inner border text-ink-2', setup.logo.kind === 'glyph' && setup.logo.glyph === g ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:border-line-strong')}>
                        <Glyph glyph={g} className="size-5" />
                      </button>
                    ))}
                  </div>
                )}
                {setup.logo.kind === 'monogram' && <TextInput value={setup.logo.text} onChange={(text) => setSetup((s) => ({ ...s, logo: { kind: 'monogram', text: text.toUpperCase().slice(0, 3) } }))} className="mt-2 w-28 text-center font-semibold" maxLength={3} aria-label={t('branding.monogram')} />}
              </Field>
              <Field label={t('branding.cover')}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t('branding.cover')}>
                  {COVER_PATTERNS.map((p: CoverPattern) => (
                    <button key={p} type="button" role="radio" aria-checked={setup.cover.kind === 'pattern' && setup.cover.pattern === p} onClick={() => patch({ cover: { kind: 'pattern', pattern: p } })} className={cx('overflow-hidden rounded-inner border text-[11.5px] text-ink-2', setup.cover.kind === 'pattern' && setup.cover.pattern === p ? 'border-accent text-ink' : 'border-line hover:border-line-strong')}>
                      <ClubCover branding={{ ...preview, cover: { kind: 'pattern', pattern: p } }} seed={setup.name.length + 7} className="h-10" />
                      <span className="block py-1">{t(`branding.pattern.${p}`)}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('branding.title_font')}>
                <Segmented value={setup.titleFont} onChange={(titleFont) => patch({ titleFont })} label={t('branding.title_font')} options={[{ value: 'sans', label: t('branding.font.sans') }, { value: 'serif', label: t('branding.font.serif') }]} />
              </Field>
              <p className="text-[12.5px] text-ink-3">{t('clubwiz.look_note')}</p>
            </div>
          )}

          {step === 'first' && (
            <div className="space-y-4">
              <Segmented value={first.wanted ? 'yes' : 'no'} onChange={(v) => setFirst({ ...first, wanted: v === 'yes' })} label={t('clubwiz.first.title')} options={[{ value: 'yes', label: t('clubwiz.first.yes') }, { value: 'no', label: t('clubwiz.first.no') }]} />
              {first.wanted && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('clubwiz.first.preset')}>
                    {(['turbo', 'regular', 'deep', 'sng'] as const).map((p) => {
                      const s = presetStructure(p);
                      return (
                        <button key={p} type="button" role="radio" aria-checked={first.preset === p} onClick={() => setFirst({ ...first, preset: p })} className={cx('rounded-inner border p-3 text-start', first.preset === p ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong')} data-testid={`cw-preset-${p}`}>
                          <span className="block text-[14px] font-semibold text-ink">{t(`preset.${p}`)}</span>
                          <span className="block text-[12.5px] text-ink-2">{t(`preset.${p}.about`)}</span>
                          <span className="mt-1 block text-[12px] text-ink-3">{t('clubwiz.first.stack', { stack: s.startingStack.toLocaleString('en-US'), min: s.entries[0]!.minutes })}</span>
                        </button>
                      );
                    })}
                  </div>
                  <Field label={t('clubwiz.first.when')}>
                    <Segmented value={first.when} onChange={(when) => setFirst({ ...first, when })} label={t('clubwiz.first.when')} options={[{ value: 'tomorrow', label: t('clubwiz.first.tomorrow') }, { value: 'weekend', label: t('clubwiz.first.weekend') }]} />
                  </Field>
                  <Notice tone="neutral">{t('clubwiz.first.note')}</Notice>
                </>
              )}
            </div>
          )}

          {step === 'done' && created && (
            <div className="space-y-4" data-testid="clubwiz-done">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-success/15 text-success">
                  <LuSparkles className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-[16px] font-semibold text-ink">{t('clubwiz.done.title', { club: created.club.name })}</p>
                  <p className="text-[13px] text-ink-2">{t('clubwiz.done.body', { code: created.club.code })}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <QrCard url={api.inviteLink(created.club)} caption={t('club.qr_caption', { code: created.club.code })} fileName={`club-${created.club.code}`} size={150} />
                <ol className="space-y-2 text-[13.5px] text-ink-2">
                  <li>{t('clubwiz.done.step1')}</li>
                  <li>{t('clubwiz.done.step2')}</li>
                  <li>{t('clubwiz.done.step3')}</li>
                </ol>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<LuLayoutDashboard className="size-4" aria-hidden />} onClick={() => go('console.home', { clubId: created.club.id })} data-testid="clubwiz-open-console">
                  {t('nav.open_console')}
                </Button>
                <Button onClick={() => go('club', { clubId: created.club.id })}>{t('clubwiz.done.view_page')}</Button>
                {created.tournamentId && <Button onClick={() => go('console.tournament', { clubId: created.club.id, id: created.tournamentId! })}>{t('clubwiz.done.view_tournament')}</Button>}
              </div>
            </div>
          )}

          {step !== 'done' && (
            <div className="mt-6 flex items-center justify-between gap-3">
              {index > 0 ? (
                <Button variant="ghost" icon={<LuArrowLeft className="size-4 flip-rtl" aria-hidden />} onClick={() => setStep(STEPS[index - 1]!)}>
                  {t('common.back')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="primary" trailing={<LuArrowRight className="size-4 flip-rtl" aria-hidden />} onClick={next} data-testid="cw-next">
                {step === 'first' ? t('clubwiz.create') : t('wizard.next', { step: t(`clubwiz.step.${STEPS[index + 1]}`) })}
              </Button>
            </div>
          )}
        </Panel>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <div className="overflow-hidden rounded-hero border border-line bg-surface" data-testid="clubwiz-preview">
            <ClubCover branding={preview} seed={setup.name.length + 7} className="h-24" />
            <div className="relative -mt-8 px-4 pb-4">
              <ClubLogo branding={preview} name={setup.name || t('clubwiz.preview_name')} size={56} className="ring-4 ring-surface" />
              <p className={cx('mt-2 text-[20px] leading-tight text-ink', setup.titleFont === 'serif' ? 'font-serif' : 'display')}>{setup.name || t('clubwiz.preview_name')}</p>
              <p className="text-[13px] text-ink-2">{setup.tagline || t('clubwiz.preview_tagline')}</p>
              <p className="mt-2 text-[12px] text-ink-3">
                {setup.location || '—'} · {setup.timezone} · {t(`clubwiz.join_policy.${setup.joinPolicy}`)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('clubwiz.plan_note')}</p>
        </aside>
      </div>
    </div>
  );
}
