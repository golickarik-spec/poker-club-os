/**
 * "Table" step of the tournament wizard: what the felt shows for this event. The preview
 * is the real table component in preview mode, fed by the same `resolveTableBranding`
 * the live table uses, so what staff see here is what players get.
 */
import { useRef, useState } from 'react';
import { LuBookmark, LuImage, LuTrash2, LuUpload } from 'react-icons/lu';
import { useDb, useMe, useT } from '../app/hooks.ts';
import { act } from '../app/context.ts';
import * as api from '../platform/api.ts';
import { can } from '../platform/permissions.ts';
import { TableStage } from '../app/variants.ts';
import { makeCard } from '../engine/cards.ts';
import type { TableView } from '../engine/view.ts';
import { resolveTableBranding, resolveTableColors, THEMES } from '../platform/table-branding.ts';
import { DEFAULT_TABLE_BRANDING, TABLE_LOGO_LIMITS, type Club, type TableBranding } from '../platform/types.ts';
import { stageLabels } from '../table/text.tsx';
import { Button, cx, Notice, Panel } from '../ui/core.tsx';
import { Field, Select, Slider, TextInput } from '../ui/forms.tsx';
import { ClubMark } from '../ui/identity.tsx';
import { readImagePreservingAlpha } from '../ui/image.ts';

const { opacity: OPACITY, scale: SCALE } = TABLE_LOGO_LIMITS;

/** A still of a hand in progress, so the preview shows the logo under real cards and chips. */
const SAMPLE_VIEW: TableView = {
  tableId: 'preview',
  maxSeats: 6,
  variant: 'nlhe',
  holeCards: 2,
  handNo: 1,
  button: 0,
  sbSeat: 1,
  bbSeat: 2,
  blinds: { sb: 50, bb: 100, ante: 0, anteType: 'none' },
  street: 'turn',
  board: [makeCard(12, 3), makeCard(11, 2), makeCard(6, 0), makeCard(2, 1)],
  pots: [{ amount: 1450, eligible: [2, 3, 4] }],
  potTotal: 1450,
  seats: [
    null,
    { seat: 1, playerId: 'p1', stack: 2900, bet: 0, inHand: false, folded: true, allIn: false, hasCards: false, cards: null, lastAction: { type: 'fold', amount: 0, to: 0, allIn: false }, won: 0, shown: null },
    { seat: 2, playerId: 'p2', stack: 6100, bet: 300, inHand: true, folded: false, allIn: false, hasCards: true, cards: null, lastAction: { type: 'bet', amount: 300, to: 300, allIn: false }, won: 0, shown: null },
    { seat: 3, playerId: 'p0', stack: 4200, bet: 0, inHand: true, folded: false, allIn: false, hasCards: true, cards: null, lastAction: null, won: 0, shown: null },
    { seat: 4, playerId: 'p4', stack: 3550, bet: 0, inHand: true, folded: false, allIn: false, hasCards: true, cards: null, lastAction: null, won: 0, shown: null },
    { seat: 5, playerId: 'p5', stack: 5000, bet: 0, inHand: false, folded: true, allIn: false, hasCards: false, cards: null, lastAction: null, won: 0, shown: null },
  ],
  toAct: 4,
  showdown: false,
  winners: [],
};
const SAMPLE_PEOPLE: Record<string, { name: string; hue: number; isBot: boolean }> = {
  p0: { name: 'Dana', hue: 200, isBot: true },
  p1: { name: 'Omer', hue: 30, isBot: true },
  p2: { name: 'Noa', hue: 290, isBot: true },
  p4: { name: 'Avi', hue: 140, isBot: true },
  p5: { name: 'Maya', hue: 350, isBot: true },
};

export function TableBrandingStep({ club, value, onChange }: { club: Club; value: TableBranding | undefined; onChange: (b: TableBranding) => void }) {
  const t = useT();
  const b = value ?? DEFAULT_TABLE_BRANDING;
  const patch = (p: Partial<TableBranding>) => onChange({ ...b, ...p });
  const file = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const resolved = resolveTableBranding({ tableBranding: b }, club);
  const db = useDb();
  const me = useMe()!;
  const presets = club.branding.tablePresets ?? [];
  const shown = resolveTableColors(b, club).colors;
  const canSave = can(db, me.id, 'club.branding', club.id);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');
  const pick = async (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return setFileError(t('table.logo.bad_type'));
    try {
      const dataUrl = await readImagePreservingAlpha(f, 384, TABLE_LOGO_LIMITS.maxBytes);
      if (dataUrl.length > TABLE_LOGO_LIMITS.maxBytes * 1.37) return setFileError(t('table.logo.too_large'));
      patch({ source: 'custom', logoDataUrl: dataUrl });
    } catch {
      setFileError(t('table.logo.bad_type'));
    }
  };

  const sources: { id: TableBranding['source']; label: string; hint: string }[] = [
    { id: 'club', label: t('table.logo.source.club'), hint: t('table.logo.source.club_hint') },
    { id: 'custom', label: t('table.logo.source.custom'), hint: t('table.logo.source.custom_hint') },
    { id: 'hidden', label: t('table.logo.source.hidden'), hint: t('table.logo.source.hidden_hint') },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="table-branding-step">
      <Panel className="space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{t('table.logo.title')}</h2>
          <p className="mt-1 text-[13px] text-ink-2">{t('table.logo.subtitle')}</p>
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink">{t('table.logo.source')}</legend>
          <div className="space-y-2" role="radiogroup" aria-label={t('table.logo.source')}>
            {sources.map((s) => {
              const active = b.source === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => patch({ source: s.id })}
                  data-testid={`logo-source-${s.id}`}
                  className={cx('flex w-full items-start gap-3 rounded-inner border p-3 text-start transition-colors', active ? 'border-accent bg-accent/8' : 'border-line hover:border-line-strong')}
                >
                  <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-accent' : 'border-line-strong')} aria-hidden>
                    {active && <span className="size-2 rounded-full bg-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink">{s.label}</span>
                    <span className="block text-[12.5px] text-ink-3">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {b.source === 'custom' && (
          <div className="rounded-inner border border-dashed border-line-strong/70 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-inner bg-raised text-ink-3" style={{ backgroundImage: 'linear-gradient(45deg, rgb(255 255 255 / 0.04) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 0.04) 75%), linear-gradient(45deg, rgb(255 255 255 / 0.04) 25%, transparent 25%, transparent 75%, rgb(255 255 255 / 0.04) 75%)', backgroundSize: '12px 12px', backgroundPosition: '0 0, 6px 6px' }}>
                {b.logoDataUrl ? <img src={b.logoDataUrl} alt="" className="size-full object-contain" /> : <LuImage className="size-6" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<LuUpload className="size-3.5" aria-hidden />} onClick={() => file.current?.click()} data-testid="logo-upload">
                    {b.logoDataUrl ? t('table.logo.replace') : t('table.logo.upload')}
                  </Button>
                  {b.logoDataUrl && (
                    <Button size="sm" variant="ghost" icon={<LuTrash2 className="size-3.5" aria-hidden />} onClick={() => patch({ logoDataUrl: null })} data-testid="logo-remove">
                      {t('table.logo.remove')}
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] text-ink-3">{b.logoDataUrl ? t('table.logo.upload_hint') : t('table.logo.none_yet')}</p>
                {fileError && <p className="mt-1 text-[12.5px] text-danger">{fileError}</p>}
              </div>
            </div>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} data-testid="logo-file" />
          </div>
        )}

        <Field label={t('table.logo.theme')} htmlFor="tb-theme" hint={t('table.logo.theme_hint')}>
          <Select
            id="tb-theme"
            value={b.theme}
            onChange={(theme) => {
              if (theme === 'custom') {
                // Start the free colours from whatever is showing now, so the change is gradual.
                patch({ theme: 'custom', colors: b.colors ?? resolveTableColors(b, club).colors });
              } else patch({ theme });
            }}
            className="max-w-xs"
            data-testid="tb-theme"
            options={[
              { value: 'club' as const, label: `${t('table.logo.theme.club')} · ${t(`felt.${club.branding.tableTheme}`)}` },
              ...THEMES.map((id) => ({ value: id, label: t(`felt.${id}`) })),
              ...presets.map((p) => ({ value: `preset:${p.id}` as const, label: `${t('table.colors.preset')} · ${p.name}` })),
              { value: 'custom' as const, label: t('table.colors.custom') },
            ]}
          />
        </Field>

        {/* Free colours: felt and rail, everything else derived. A club can keep the pair under a name. */}
        {(b.theme === 'custom' || b.theme.startsWith('preset:')) && (
          <div className="space-y-3 rounded-inner border border-line p-3" data-testid="table-colors">
            <div className="grid grid-cols-2 gap-3">
              <ColorField id="tb-felt" label={t('table.colors.felt')} value={shown.felt} disabled={b.theme !== 'custom'} onChange={(felt) => patch({ theme: 'custom', colors: { ...shown, felt } })} testId="tb-felt" />
              <ColorField id="tb-rail" label={t('table.colors.rail')} value={shown.rail} disabled={b.theme !== 'custom'} onChange={(rail) => patch({ theme: 'custom', colors: { ...shown, rail } })} testId="tb-rail" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {b.theme !== 'custom' && (
                <Button size="sm" variant="outline" onClick={() => patch({ theme: 'custom', colors: { ...shown } })} data-testid="tb-edit-preset">
                  {t('table.colors.edit_copy')}
                </Button>
              )}
              {b.theme === 'custom' && canSave && !naming && (
                <Button size="sm" variant="outline" icon={<LuBookmark className="size-3.5" aria-hidden />} onClick={() => setNaming(true)} data-testid="tb-save-preset">
                  {t('table.colors.save')}
                </Button>
              )}
              {b.theme === 'custom' && canSave && naming && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const saved = act(() => api.saveTablePreset(db, me.id, club.id, { name: presetName, colors: shown }), { key: 'table.colors.saved', params: { name: presetName.trim() } });
                    if (saved) {
                      setNaming(false);
                      setPresetName('');
                      patch({ theme: `preset:${saved.id}`, colors: shown });
                    }
                  }}
                >
                  <TextInput value={presetName} onChange={setPresetName} placeholder={t('table.colors.name_placeholder')} className="w-48" maxLength={40} data-testid="tb-preset-name" />
                  <Button size="sm" variant="primary" type="submit" disabled={!presetName.trim()} data-testid="tb-preset-confirm">
                    {t('common.confirm')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
                    {t('common.cancel')}
                  </Button>
                </form>
              )}
              {b.theme.startsWith('preset:') && canSave && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LuTrash2 className="size-3.5" aria-hidden />}
                  onClick={() => {
                    const id = b.theme.slice('preset:'.length);
                    if (act(() => { api.deleteTablePreset(db, me.id, club.id, id); return true; }, { key: 'table.colors.deleted' })) patch({ theme: 'custom', colors: { ...shown } });
                  }}
                  data-testid="tb-delete-preset"
                >
                  {t('table.colors.delete')}
                </Button>
              )}
            </div>
            <p className="text-[12px] text-ink-3">{canSave ? t('table.colors.hint_save') : t('table.colors.hint')}</p>
          </div>
        )}

        {b.source !== 'hidden' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t('table.logo.opacity')} · ${Math.round(b.opacity * 100)}%`} htmlFor="tb-opacity">
              <Slider id="tb-opacity" value={Math.round(b.opacity * 100)} onChange={(v) => patch({ opacity: v / 100 })} min={Math.round(OPACITY.min * 100)} max={Math.round(OPACITY.max * 100)} label={t('table.logo.opacity')} />
            </Field>
            <Field label={`${t('table.logo.scale')} · ${Math.round(b.scale * 100)}%`} htmlFor="tb-scale">
              <Slider id="tb-scale" value={Math.round(b.scale * 100)} onChange={(v) => patch({ scale: v / 100 })} min={Math.round(SCALE.min * 100)} max={Math.round(SCALE.max * 100)} step={5} label={t('table.logo.scale')} />
            </Field>
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-ink-3">
          {t('table.logo.safe', { max: Math.round(OPACITY.max * 100), min: Math.round(SCALE.min * 100), maxs: Math.round(SCALE.max * 100) })} {t('table.logo.fallback')}
        </p>
      </Panel>

      <Panel pad={false} className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold text-ink">{t('table.logo.preview')}</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">{t('table.logo.preview_hint')}</p>
        </div>
        <div className="pc3-floor relative aspect-[4/3]" data-testid="table-preview">
          <div className="absolute inset-0 p-3">
            <TableStage
              view={SAMPLE_VIEW}
              heroSeat={null}
              person={(id) => SAMPLE_PEOPLE[id] ?? { name: id, hue: 0, isBot: true }}
              turn={null}
              theme={resolved.theme}
              themeVars={resolved.vars}
              deck="classic"
              showBigBlinds={false}
              lastEvent={null}
              eventCount={0}
              labels={stageLabels(t, t('table.table_n', { n: 1 }), true)}
              watermark={resolved.logo ? <ClubMark branding={{ ...club.branding, logo: resolved.logo }} size={48} /> : undefined}
              logoOpacity={resolved.opacity}
              logoScale={resolved.scale}
              motion={false}
              preview
            />
          </div>
        </div>
        {b.source === 'custom' && !b.logoDataUrl && (
          <Notice tone="neutral" className="m-3">
            {t('table.logo.none_yet')}
          </Notice>
        )}
      </Panel>
    </div>
  );
}

function ColorField({ id, label, value, onChange, disabled, testId }: { id: string; label: string; value: string; onChange: (hex: string) => void; disabled?: boolean; testId?: string }) {
  return (
    <label htmlFor={id} className={cx('flex items-center gap-2.5 rounded-control border border-line bg-bg px-2.5 py-2', disabled && 'opacity-70')}>
      <span className="relative size-7 shrink-0 overflow-hidden rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.15)_inset]" style={{ background: value }}>
        <input id={id} type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" data-testid={testId} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink-3">{label}</span>
        <span className="block font-mono text-[12.5px] text-ink" dir="ltr">
          {value.toUpperCase()}
        </span>
      </span>
    </label>
  );
}
