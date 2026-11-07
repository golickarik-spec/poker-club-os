import { readImage } from '../ui/image.ts';
import { useRef, useState, type ReactNode } from 'react';
import { LuImage, LuLock, LuRotateCcw, LuUpload } from 'react-icons/lu';
import { act, toasts } from '../app/context.ts';
import { readableInk } from '../app/format.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import { parseCards } from '../engine/cards.ts';
import * as api from '../platform/api.ts';
import { can } from '../platform/permissions.ts';
import { SOCIAL_KEYS, type Club, type ClubBranding, type CoverPattern, type SocialKey, type SocialLink, type TableThemeId } from '../platform/types.ts';
import { SOCIAL_ICONS } from '../player/ClubPage.tsx';
import { CardBack, PlayingCard } from '../table/Card.tsx';
import { Badge, Button, cx, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { Checkbox, Field, Segmented, Select, Switch, TextArea, TextInput } from '../ui/forms.tsx';
import { accentStyle, ClubCover, ClubLogo, ClubMark, ClubName, COVER_PATTERNS, Glyph, LOGO_GLYPHS } from '../ui/identity.tsx';

const ACCENTS = ['#14B8A6', '#8EA2FF', '#D6B36A', '#F0883E', '#E5677D', '#5BB974', '#6AA5FF', '#C792EA'];
const THEMES: TableThemeId[] = ['midnight', 'emerald', 'royal', 'burgundy', 'graphite'];
const SAMPLE = parseCards('Ah Kd');

const TIMEZONES = ['Asia/Jerusalem', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Athens', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

export function Branding({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const plan = db.plans[club.planId];
  const [draft, setDraft] = useState<ClubBranding>(() => structuredClone(club.branding));
  const [tagline, setTagline] = useState(club.tagline);
  const [description, setDescription] = useState(club.description);
  const [rules, setRules] = useState(club.rules.join('\n'));
  const [joinPolicy, setJoinPolicy] = useState(club.joinPolicy);
  const [location, setLocation] = useState(club.location);
  const [timezone, setTimezone] = useState(club.timezone);
  const [publicResults, setPublicResults] = useState(club.publicResults);
  const [publicMemberCount, setPublicMemberCount] = useState(club.publicMemberCount);
  const socialOf = (c: Club): Record<SocialKey, SocialLink> => Object.fromEntries(SOCIAL_KEYS.map((k) => [k, { url: c.social[k]?.url ?? '', public: c.social[k]?.public ?? true }])) as Record<SocialKey, SocialLink>;
  const [social, setSocial] = useState(() => socialOf(club));
  const socialProblems = Object.fromEntries(SOCIAL_KEYS.map((k) => [k, social[k].url.trim() ? api.checkSocialUrl(k, social[k].url).problem : null])) as Record<SocialKey, api.SocialProblem | null>;
  const socialValid = SOCIAL_KEYS.every((k) => socialProblems[k] === null);
  const profileDirty = location !== club.location || timezone !== club.timezone || publicResults !== club.publicResults || publicMemberCount !== club.publicMemberCount || JSON.stringify(social) !== JSON.stringify(socialOf(club));
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const canProfile = can(db, me.id, 'club.edit_profile', club.id);
  const patch = (p: Partial<ClubBranding>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(club.branding) || tagline !== club.tagline || description !== club.description || rules !== club.rules.join('\n') || joinPolicy !== club.joinPolicy || profileDirty;
  const validAccent = /^#[0-9a-fA-F]{6}$/.test(draft.accent);
  const previewClub: Club = { ...club, branding: validAccent ? draft : { ...draft, accent: club.branding.accent }, tagline, description };

  const upload = async (file: File | undefined, kind: 'logo' | 'cover') => {
    if (!file) return;
    try {
      const dataUrl = await readImage(file, kind === 'logo' ? 256 : 1200, 0.82);
      patch(kind === 'logo' ? { logo: { kind: 'image', dataUrl } } : { cover: { kind: 'image', dataUrl } });
    } catch {
      toasts.push('error', t('branding.upload_failed'));
    }
  };

  const save = () => {
    act(() => {
      api.updateBranding(db, me.id, club.id, draft);
      if (canProfile) api.updateClubProfile(db, me.id, club.id, { tagline, description, rules: rules.split('\n'), joinPolicy, location, timezone, publicResults, publicMemberCount, social });
    }, { key: 'branding.saved' });
  };
  const reset = () => {
    setDraft(structuredClone(club.branding));
    setTagline(club.tagline);
    setDescription(club.description);
    setRules(club.rules.join('\n'));
    setJoinPolicy(club.joinPolicy);
    setLocation(club.location);
    setTimezone(club.timezone);
    setPublicResults(club.publicResults);
    setPublicMemberCount(club.publicMemberCount);
    setSocial(socialOf(club));
  };

  return (
    <>
      <PageHeader
        title={t('branding.title')}
        subtitle={t('branding.subtitle')}
        actions={
          <>
            <Button variant="ghost" icon={<LuRotateCcw className="size-4" aria-hidden />} onClick={reset} disabled={!dirty}>
              {t('branding.discard')}
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || !validAccent || !socialValid} data-testid="branding-save">
              {t('common.save')}
            </Button>
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <Section title={t('branding.accent')} hint={t('branding.accent_hint')}>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('branding.accent')}>
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.accent.toLowerCase() === c.toLowerCase()}
                  aria-label={c}
                  data-testid={`accent-${c.slice(1)}`}
                  onClick={() => patch({ accent: c })}
                  className={cx('size-9 rounded-full border-2 transition-transform hover:scale-105', draft.accent.toLowerCase() === c.toLowerCase() ? 'border-white' : 'border-transparent')}
                  style={{ background: c }}
                />
              ))}
              <label className="ms-1 flex h-9 items-center gap-2 rounded-control border border-line-strong/80 bg-bg ps-1.5 pe-2">
                <input type="color" value={validAccent ? draft.accent : '#14b8a6'} onChange={(e) => patch({ accent: e.target.value.toUpperCase() })} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={t('branding.custom_colour')} id="accent-picker" />
                <input value={draft.accent} onChange={(e) => patch({ accent: e.target.value })} className="w-[76px] bg-transparent text-[13px] text-ink uppercase tabular-nums outline-none" aria-label={t('branding.hex')} dir="ltr" id="accent-hex" />
              </label>
            </div>
            {!validAccent && <p className="text-[12.5px] text-danger">{t('err.bad_color')}</p>}
          </Section>

          <Section title={t('branding.logo')}>
            <Segmented
              value={draft.logo.kind}
              onChange={(kind) => {
                if (kind === 'glyph') patch({ logo: { kind: 'glyph', glyph: 'spade' } });
                else if (kind === 'monogram') patch({ logo: { kind: 'monogram', text: club.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() } });
                else if (plan.customBranding) logoInput.current?.click();
              }}
              label={t('branding.logo')}
              options={[
                { value: 'glyph', label: t('branding.logo.glyph') },
                { value: 'monogram', label: t('branding.logo.monogram') },
                { value: 'image', label: <>{!plan.customBranding && <LuLock className="size-3.5" aria-hidden />}{t('branding.logo.image')}</> },
              ]}
            />
            {draft.logo.kind === 'glyph' && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('branding.logo.glyph')}>
                {LOGO_GLYPHS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={draft.logo.kind === 'glyph' && draft.logo.glyph === g}
                    aria-label={g}
                    onClick={() => patch({ logo: { kind: 'glyph', glyph: g } })}
                    className={cx('flex size-11 items-center justify-center rounded-inner border text-ink-2', draft.logo.kind === 'glyph' && draft.logo.glyph === g ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:border-line-strong')}
                  >
                    <Glyph glyph={g} className="size-5" />
                  </button>
                ))}
              </div>
            )}
            {draft.logo.kind === 'monogram' && (
              <Field label={t('branding.monogram')} htmlFor="b-mono" hint={t('branding.monogram_hint')}>
                <TextInput id="b-mono" value={draft.logo.text} onChange={(text) => patch({ logo: { kind: 'monogram', text: text.toUpperCase().slice(0, 3) } })} className="w-28 text-center font-semibold" maxLength={3} />
              </Field>
            )}
            {draft.logo.kind === 'image' && (
              <Button size="sm" icon={<LuUpload className="size-3.5" aria-hidden />} onClick={() => logoInput.current?.click()}>
                {t('branding.replace_image')}
              </Button>
            )}
            {!plan.customBranding && <PlanNote text={t('branding.plan_note', { plan: plan.name })} />}
            <input ref={logoInput} type="file" accept="image/*" className="hidden" id="logo-file" onChange={(e) => (upload(e.target.files?.[0], 'logo'), (e.target.value = ''))} />
          </Section>

          <Section title={t('branding.cover')}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label={t('branding.cover')}>
              {COVER_PATTERNS.map((p: CoverPattern) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={draft.cover.kind === 'pattern' && draft.cover.pattern === p}
                  onClick={() => patch({ cover: { kind: 'pattern', pattern: p } })}
                  className={cx('overflow-hidden rounded-inner border text-[11.5px] text-ink-2', draft.cover.kind === 'pattern' && draft.cover.pattern === p ? 'border-accent text-ink' : 'border-line hover:border-line-strong')}
                >
                  <ClubCover branding={{ ...previewClub.branding, cover: { kind: 'pattern', pattern: p } }} seed={Number(club.code)} className="h-10" />
                  <span className="block py-1">{t(`branding.pattern.${p}`)}</span>
                </button>
              ))}
              <button
                type="button"
                disabled={!plan.customBranding}
                onClick={() => coverInput.current?.click()}
                className={cx('flex flex-col items-center justify-center gap-1 rounded-inner border border-dashed text-[11.5px] text-ink-2 disabled:opacity-50', draft.cover.kind === 'image' ? 'border-accent text-ink' : 'border-line-strong hover:text-ink')}
              >
                {plan.customBranding ? <LuImage className="size-4" aria-hidden /> : <LuLock className="size-4" aria-hidden />}
                {t('branding.cover.upload')}
              </button>
            </div>
            <input ref={coverInput} type="file" accept="image/*" className="hidden" id="cover-file" onChange={(e) => (upload(e.target.files?.[0], 'cover'), (e.target.value = ''))} />
          </Section>

          <Section title={t('branding.table')} hint={t('branding.table_hint')}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t('branding.table')}>
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={draft.tableTheme === theme}
                  data-testid={`theme-${theme}`}
                  onClick={() => patch({ tableTheme: theme })}
                  className={cx('rounded-inner border p-1.5 text-center text-[11.5px]', draft.tableTheme === theme ? 'border-accent text-ink' : 'border-line text-ink-2 hover:border-line-strong')}
                >
                  <span className={cx('pc-rail mb-1.5 block h-9 rounded-full p-[3px]', `felt-${theme}`)}>
                    <span className="pc-felt block size-full rounded-full" />
                  </span>
                  {t(`theme.${theme}`)}
                </button>
              ))}
            </div>
            <Field label={t('branding.title_font')} htmlFor="b-font">
              <Segmented
                value={draft.titleFont}
                onChange={(titleFont) => patch({ titleFont })}
                label={t('branding.title_font')}
                options={[
                  { value: 'sans', label: t('branding.font.sans') },
                  { value: 'serif', label: <span className="font-serif">{t('branding.font.serif')}</span> },
                ]}
              />
            </Field>
          </Section>

          {canProfile && (
            <Section title={t('branding.profile')}>
              <Field label={t('branding.tagline')} htmlFor="b-tagline">
                <TextInput id="b-tagline" value={tagline} onChange={setTagline} maxLength={80} />
              </Field>
              <Field label={t('branding.description')} htmlFor="b-desc">
                <TextArea id="b-desc" value={description} onChange={setDescription} rows={3} />
              </Field>
              <Field label={t('branding.rules')} htmlFor="b-rules" hint={t('branding.rules_hint')}>
                <TextArea id="b-rules" value={rules} onChange={setRules} rows={5} />
              </Field>
              <Field label={t('branding.join_policy')} htmlFor="b-join" hint={joinPolicy === 'open' ? t('join.explain.open') : t('branding.join_policy.approval_hint')}>
                <Segmented
                  value={joinPolicy}
                  onChange={setJoinPolicy}
                  label={t('branding.join_policy')}
                  options={[
                    { value: 'approval', label: t('clubs.policy.approval') },
                    { value: 'open', label: t('clubs.policy.open') },
                  ]}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('branding.location')} htmlFor="b-location" hint={t('branding.location_hint')}>
                  <TextInput id="b-location" value={location} onChange={(v) => setLocation(v.slice(0, 60))} data-testid="b-location" />
                </Field>
                <Field label={t('branding.timezone')} htmlFor="b-timezone">
                  <Select id="b-timezone" value={timezone} onChange={setTimezone} options={[...new Set([club.timezone, ...TIMEZONES])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} />
                </Field>
              </div>
            </Section>
          )}

          {canProfile && (
            <Section title={t('branding.public')} hint={t('branding.public_hint')}>
              <Switch checked={publicMemberCount} onChange={setPublicMemberCount} label={t('branding.public_members')} description={t('branding.public_members_hint')} />
              <Switch checked={publicResults} onChange={setPublicResults} label={t('branding.public_results')} description={t('branding.public_results_hint')} />
            </Section>
          )}

          {canProfile && (
            <Section title={t('branding.social')} hint={t('branding.social_hint')}>
              <ul className="space-y-3" data-testid="social-links">
                {SOCIAL_KEYS.map((key) => (
                  <li key={key} className="grid items-start gap-x-3 gap-y-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                    <label htmlFor={`social-${key}`} className="flex h-10 items-center gap-2 text-[13.5px] font-medium text-ink [&>svg]:size-4 [&>svg]:text-ink-2">
                      {SOCIAL_ICONS[key]}
                      {t(`social.${key}`)}
                    </label>
                    <div className="min-w-0">
                      <TextInput id={`social-${key}`} value={social[key].url} onChange={(url) => setSocial({ ...social, [key]: { ...social[key], url } })} placeholder="https://" invalid={socialProblems[key] !== null} dir="ltr" data-testid={`social-input-${key}`} />
                      {socialProblems[key] !== null && (
                        <p className="mt-1 text-[12.5px] text-danger" role="alert" data-testid={`social-error-${key}`}>
                          {t(`branding.social_problem.${socialProblems[key]}`, { site: t(`social.${key}`) })}
                        </p>
                      )}
                    </div>
                    <div className="flex h-10 items-center">
                      <Checkbox checked={social[key].public} onChange={(v) => setSocial({ ...social, [key]: { ...social[key], public: v } })} label={<span className="text-[13px] text-ink-2">{t('branding.social_public')}</span>} />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* Live preview */}
        <aside className="min-w-0 xl:sticky xl:top-0 xl:self-start" style={accentStyle(previewClub.branding.accent)} data-testid="branding-preview">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-ink-2">{t('branding.preview')}</h2>
            {dirty && <Badge tone="warning">{t('branding.unsaved')}</Badge>}
          </div>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-panel border border-line bg-surface">
              <ClubCover branding={previewClub.branding} seed={Number(club.code)} className="h-24" />
              <div className="relative -mt-8 px-4 pb-4">
                <ClubLogo branding={previewClub.branding} name={club.name} size={56} className="ring-4 ring-surface" />
                <p className="mt-2.5 text-[18px] leading-tight font-semibold text-ink">
                  <ClubName club={previewClub} />
                </p>
                <p className="mt-0.5 text-[13px] text-ink-2">{tagline || '—'}</p>
                <div className="mt-3 flex gap-2">
                  <span className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-[13.5px] font-medium text-accent-ink">{t('tour.register')}</span>
                  <span className="inline-flex h-9 items-center rounded-control bg-accent/12 px-3.5 text-[13.5px] font-medium text-accent">{t('club.tab.tournaments')}</span>
                </div>
              </div>
            </div>
            <div className={cx('relative h-44 overflow-hidden rounded-panel bg-[#080b0f] p-3', `felt-${draft.tableTheme}`)}>
              <div className="pc-rail absolute inset-3 rounded-full">
                <div className="pc-felt absolute inset-[10px] rounded-full">
                  <div className="pc-felt-line absolute inset-[11%] rounded-full" />
                </div>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/[0.18]">
                <ClubMark branding={previewClub.branding} size={34} />
              </div>
              <div className="absolute inset-x-0 bottom-5 flex items-end justify-center gap-1.5 deck-four" dir="ltr">
                <CardBack width={30} />
                {SAMPLE.map((c) => (
                  <PlayingCard key={c} card={c} width={36} />
                ))}
                <CardBack width={30} />
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-3">
              {t('branding.contrast', { ink: readableInk(previewClub.branding.accent) === '#ffffff' ? t('branding.ink.light') : t('branding.ink.dark') })}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      <div className="mt-3.5 space-y-3.5">{children}</div>
    </Panel>
  );
}

function PlanNote({ text }: { text: string }) {
  return (
    <Notice tone="neutral" icon={<LuLock />}>
      {text}
    </Notice>
  );
}
