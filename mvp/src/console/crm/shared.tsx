/**
 * Building blocks shared by the CRM screens.
 *
 * Every CRM screen reads through the guarded service functions (`crm.ts`,
 * `analytics.ts`, `messaging.ts`, `automation.ts`), passing the signed-in
 * person and the club. Nothing here touches the CRM store directly.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuX } from 'react-icons/lu';
import { actions, store } from '../../app/context.ts';
import { dateShort } from '../../app/format.ts';
import { go, useDb, type T } from '../../app/hooks.ts';
import type { PlayerRow } from '../../platform/crm.ts';
import { memberId } from '../../platform/crm.ts';
import type { Club, CrmTag, LifecycleStage, MemberStatus, TagColor } from '../../platform/types.ts';
import { Badge, BotTag, cx, type Tone } from '../../ui/core.tsx';
import { Segmented, TextInput } from '../../ui/forms.tsx';
import { Avatar } from '../../ui/identity.tsx';

const DAY = 86_400_000;

/**
 * Compute a report and keep it until something relevant changes. Reports are
 * recomputed at once after a person acts, and at most every second and a half
 * while background activity (simulated registrations, the tournament clock)
 * keeps changing the database.
 */
export function useReport<R>(fn: () => R, deps: unknown[]): R {
  useDb();
  const version = store.getVersion();
  const key = JSON.stringify(deps);
  const cache = useRef<{ key: string; at: number; version: number; action: number; value: R } | null>(null);
  const [, refresh] = useState(0);
  const now = Date.now();
  const c = cache.current;
  const stale = !!c && c.version !== version;
  if (!c || c.key !== key || c.action !== actions.count || (stale && now - c.at > 1500)) {
    cache.current = { key, at: now, version, action: actions.count, value: fn() };
  }
  useEffect(() => {
    if (!stale) return;
    const id = setTimeout(() => refresh((n) => n + 1), 1600);
    return () => clearTimeout(id);
  }, [stale, version]);
  return cache.current!.value;
}

// ----- Tags -------------------------------------------------------------------------------

export const TAG_HEX: Record<TagColor, string> = {
  slate: '#93a1b2',
  blue: '#5aa2f0',
  teal: '#2cc5b0',
  green: '#3ecf8e',
  gold: '#d6b36a',
  orange: '#f08a4b',
  red: '#f06a6a',
  violet: '#a78bfa',
  pink: '#f27ab0',
};

/** A tag. The colour is a quick cue; the name always carries the meaning. */
export function TagChip({ tag, onRemove, removeLabel }: { tag: Pick<CrmTag, 'name' | 'color'>; onRemove?: () => void; removeLabel?: string }) {
  const hex = TAG_HEX[tag.color];
  return (
    <span className="inline-flex h-[22px] max-w-full shrink-0 items-center gap-1 rounded-full ps-2 pe-2 text-[11.5px] font-medium whitespace-nowrap text-ink" style={{ background: `color-mix(in oklab, ${hex} 18%, transparent)` }}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: hex }} aria-hidden />
      <span className="truncate" dir="auto">
        {tag.name}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel} className="-me-1 inline-flex size-4 items-center justify-center rounded-full text-ink-2 hover:bg-white/10 hover:text-ink">
          <LuX className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

export function TagList({ ids, tags, max = 3 }: { ids: string[]; tags: CrmTag[]; max?: number }) {
  const mine = ids.map((id) => tags.find((t) => t.id === id)).filter((t): t is CrmTag => !!t);
  if (mine.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {mine.slice(0, max).map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {mine.length > max && <span className="text-[11.5px] text-ink-3 tabular-nums">+{mine.length - max}</span>}
    </span>
  );
}

// ----- Status and lifecycle ---------------------------------------------------------------------

const STATUS_TONE: Record<MemberStatus | 'none', Tone> = { active: 'success', pending: 'warning', suspended: 'danger', rejected: 'neutral', banned: 'danger', none: 'neutral' };

/** Membership status: what the person is allowed to do in the club. */
export function StatusBadge({ row, t }: { row: Pick<PlayerRow, 'status' | 'following'>; t: T }) {
  const key = row.status === 'none' ? (row.following ? 'follower' : 'none') : row.status;
  return (
    <Badge tone={row.status === 'none' && row.following ? 'info' : STATUS_TONE[row.status]} dot>
      {t(`crm.status.${key}`)}
    </Badge>
  );
}

const LIFECYCLE_TONE: Record<LifecycleStage, Tone> = { new_follower: 'info', interested: 'warning', approved: 'neutral', first_time: 'accent', returning: 'success', inactive: 'neutral' };

/** Lifecycle: what the person has actually done. Separate from, and never a substitute for, membership status. */
export function LifecycleBadge({ stage, active, t }: { stage: LifecycleStage | null; active?: boolean; t: T }) {
  if (!stage) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={LIFECYCLE_TONE[stage]}>{t(`crm.lifecycle.${stage}`)}</Badge>
      {active && stage !== 'inactive' && <Badge tone="success">{t('crm.lifecycle.active')}</Badge>}
    </span>
  );
}

// ----- People --------------------------------------------------------------------------------

export function PlayerCell({ row, club, t, link = true, compact }: { row: Pick<PlayerRow, 'userId' | 'name' | 'handle' | 'hue' | 'isBot' | 'memberNo'>; club: Club; t: T; link?: boolean; compact?: boolean }) {
  const body = (
    <>
      <Avatar user={row} size={compact ? 26 : 30} />
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-ink">{row.name}</span>
          {row.isBot && <BotTag label={t('common.bot')} />}
        </span>
        {!compact && (
          <span className="block truncate text-[12px] text-ink-3" dir="ltr">
            @{row.handle}
            {row.memberNo !== null ? ` · ${memberId(club, row.memberNo)}` : ''}
          </span>
        )}
      </span>
    </>
  );
  if (!link) return <span className="flex min-w-0 items-center gap-2.5">{body}</span>;
  return (
    <button type="button" onClick={() => go('console.crm.player', { clubId: club.id, userId: row.userId })} className="flex min-w-0 max-w-full items-center gap-2.5 text-start hover:[&_.truncate]:underline" data-testid={`player-${row.userId}`}>
      {body}
    </button>
  );
}

export const dateOrDash = (ts: number | null, t: T): string => (ts === null ? '—' : dateShort(ts, t.lang));

// ----- Date range ------------------------------------------------------------------------------

export type RangePreset = '7' | '30' | '60' | '90' | 'all' | 'custom';
export interface RangeState {
  preset: RangePreset;
  /** YYYY-MM-DD, used when the preset is `custom`. */
  from: string;
  to: string;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const defaultRange = (preset: RangePreset, now: number): RangeState => ({ preset, from: isoDay(now - 30 * DAY), to: isoDay(now) });

/** The period as timestamps. "All time" starts when the club was created. */
export function rangeOf(state: RangeState, now: number, club: Club): { from: number; to: number; days: number } {
  if (state.preset === 'custom') {
    const from = Date.parse(`${state.from}T00:00:00Z`);
    const to = Math.min(now, Date.parse(`${state.to}T23:59:59.999Z`));
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) return { from, to, days: Math.max(1, Math.round((to - from) / DAY)) };
    return { from: now - 30 * DAY, to: now, days: 30 };
  }
  if (state.preset === 'all') return { from: club.createdAt - DAY, to: now, days: Math.max(1, Math.round((now - club.createdAt) / DAY)) };
  const days = Number(state.preset);
  return { from: now - days * DAY, to: now, days };
}

export function RangePicker({ value, onChange, presets, t }: { value: RangeState; onChange: (next: RangeState) => void; presets: RangePreset[]; t: T }) {
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2" data-testid="range-picker">
      <Segmented<RangePreset> value={value.preset} onChange={(preset) => onChange({ ...value, preset })} label={t('crm.range.label')} size="sm" className="max-w-full overflow-x-auto [scrollbar-width:none]" options={presets.map((p) => ({ value: p, label: p === 'all' ? t('crm.range.all') : p === 'custom' ? t('crm.range.custom') : t('crm.range.days', { n: p }) }))} />
      {value.preset === 'custom' && (
        <span className="flex items-center gap-1.5">
          <TextInput type="date" value={value.from} max={value.to} onChange={(from) => onChange({ ...value, from })} className="h-8 w-[9.5rem] text-[13px]" aria-label={t('crm.range.from')} />
          <span className="text-ink-3">–</span>
          <TextInput type="date" value={value.to} min={value.from} onChange={(to) => onChange({ ...value, to })} className="h-8 w-[9.5rem] text-[13px]" aria-label={t('crm.range.to')} />
        </span>
      )}
    </div>
  );
}

/** A section of filters or actions that wraps onto more lines on a phone. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

/** Labels for a daily series, short enough for a chart axis. */
export const dayLabels = (points: { day: number }[], t: T): string[] => points.map((p) => dateShort(p.day, t.lang));

export const pct = (x: number | null, digits = 0): string => (x === null ? '—' : `${(x * 100).toFixed(digits)}%`);
