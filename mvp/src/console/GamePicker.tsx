/**
 * "Select poker game" for the tournament wizard: one card per implemented variant with
 * the facts that change play (hole cards, betting, table size), and the rest of the
 * catalogue listed as planned so nobody mistakes it for a dropdown of names.
 */
import { useState } from 'react';
import { LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { useT } from '../app/hooks.ts';
import { FAMILIES, maxTableSize, RULE_MODIFIERS, VARIANT_IDS, VARIANTS, type VariantId } from '../engine/variants.ts';
import { Badge, cx } from '../ui/core.tsx';

export function GamePicker({ value, onChange, tableSize }: { value: VariantId; onChange: (id: VariantId) => void; tableSize: number }) {
  const t = useT();
  const [showPlanned, setShowPlanned] = useState(false);
  const playable = VARIANT_IDS.filter((id) => VARIANTS[id].implemented);
  const planned = VARIANT_IDS.filter((id) => !VARIANTS[id].implemented);
  return (
    <section data-testid="game-picker">
      <h2 className="mb-1 text-[15px] font-semibold text-ink">{t('wizard.game_title')}</h2>
      <p className="mb-3 text-[13px] text-ink-2">{t('wizard.game_hint')}</p>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5" role="radiogroup" aria-label={t('wizard.game_title')}>
        {playable.map((id) => {
          const v = VARIANTS[id];
          const selected = id === value;
          const maxSeats = maxTableSize(v);
          const tooBig = tableSize > maxSeats;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(id)}
              data-testid={`game-${id}`}
              className={cx('flex min-w-0 flex-col rounded-panel border p-3 text-start transition-colors', selected ? 'border-accent bg-accent/8' : 'border-line hover:border-line-strong')}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-[13.5px] font-semibold leading-snug text-ink">{t(`variant.${id}`)}</span>
                <Badge tone={selected ? 'accent' : 'neutral'} className="shrink-0">
                  {t(`family.${v.family}`)}
                </Badge>
              </span>
              <span className="mt-1.5 text-[12px] leading-snug text-ink-2">{t(`variant.${id}.summary`)}</span>
              <dl className="mt-2.5 grid grid-cols-3 gap-1 text-[11.5px] text-ink-3">
                <div>
                  <dt>{t('wizard.game.hole')}</dt>
                  <dd className="font-medium text-ink">{v.holeCards}</dd>
                </div>
                <div>
                  <dt>{t('wizard.game.betting')}</dt>
                  <dd className="font-medium text-ink">{t(`betting.${v.betting}`)}</dd>
                </div>
                <div>
                  <dt>{t('wizard.game.players')}</dt>
                  <dd className={cx('font-medium', tooBig && selected ? 'text-warning' : 'text-ink')}>
                    {v.minPlayers}–{maxSeats}
                  </dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setShowPlanned((v) => !v)} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink" data-testid="games-planned-toggle">
        {showPlanned ? <LuChevronUp className="size-3.5" aria-hidden /> : <LuChevronDown className="size-3.5" aria-hidden />}
        {t('wizard.game.planned_n', { n: planned.length + Object.keys(RULE_MODIFIERS).length })}
      </button>
      {showPlanned && (
        <div className="mt-2 grid gap-x-6 gap-y-1 rounded-inner border border-dashed border-line-strong/60 p-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3" data-testid="games-planned">
          {FAMILIES.filter((f) => planned.some((id) => VARIANTS[id].family === f)).map((f) => (
            <div key={f}>
              <p className="mb-0.5 font-medium text-ink-2">{t(`family.${f}`)}</p>
              <ul className="space-y-0.5 text-ink-3">
                {planned
                  .filter((id) => VARIANTS[id].family === f)
                  .map((id) => (
                    <li key={id} className="flex items-center gap-1.5">
                      <span>{t(`variant.${id}`)}</span>
                      <span className="rounded-chip border border-line-strong/60 px-1 text-[10px]">{t('nav.planned')}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="mb-0.5 font-medium text-ink-2">{t('wizard.game.modifiers')}</p>
            <ul className="space-y-0.5 text-ink-3">
              {(Object.keys(RULE_MODIFIERS) as (keyof typeof RULE_MODIFIERS)[]).map((m) => (
                <li key={m} className="flex items-center gap-1.5">
                  <span>{t(`modifier.${m}`)}</span>
                  <span className="rounded-chip border border-line-strong/60 px-1 text-[10px]">{t('nav.planned')}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
