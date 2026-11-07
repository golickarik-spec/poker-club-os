/**
 * Charts. Hand-built SVG on d3 scales so they match the product exactly.
 *
 * Conventions (from the data-visualisation method the project follows):
 *  - one axis per chart; thin marks (2px lines, bars capped at 24px);
 *  - recessive hairline grid; text always in ink tokens, never the series colour;
 *  - single-series charts use the accent colour, multi-series charts use a
 *    fixed three-colour categorical palette that was validated for
 *    colour-vision-deficiency separation against this surface;
 *  - every chart has a hover/focus read-out, and the values are available as
 *    a table for assistive technology.
 */
import { scaleLinear } from 'd3-scale';
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape';
import { useMemo, useState, type ReactNode } from 'react';
import { useElementSize } from '../app/hooks.ts';
import { cx } from './core.tsx';

/** Categorical palette (dark surface). Order is fixed; do not cycle past three. */
export const SERIES_COLOURS = ['#3987e5', '#d95926', '#199e70'] as const;

export interface Point {
  label: string;
  value: number;
}

function niceTicks(min: number, max: number, count: number): number[] {
  return scaleLinear().domain([min, max]).nice(count).ticks(count);
}

const defaultFormat = (n: number): string => (Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : String(Math.round(n * 100) / 100));

function ScreenReaderTable({ caption, rows }: { caption: string; rows: { label: string; values: string[] }[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            {r.values.map((v, i) => (
              <td key={i}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-control border border-line-strong bg-raised px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-xl" style={{ left }}>
      {children}
    </div>
  );
}

// ----- Line / area ------------------------------------------------------------------------------

export interface Series {
  name: string;
  values: number[];
  colour?: string;
}

export function LineChart({
  labels,
  series,
  height = 220,
  format = defaultFormat,
  title,
  area = true,
  min,
  max,
  dots,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  /** Accessible name; also the caption of the fallback table. */
  title: string;
  area?: boolean;
  min?: number;
  max?: number;
  /** Draw a marker on every point (for short series). */
  dots?: boolean;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = size.width;
  const margin = { top: 14, right: 12, bottom: 24, left: 40 };
  const innerW = Math.max(10, W - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const n = labels.length;
  const single = series.length === 1;

  const { y, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const lo = min ?? Math.min(0, ...all);
    const hi = max ?? Math.max(1, ...all);
    const scale = scaleLinear().domain([lo, hi]).nice(4).range([innerH, 0]);
    return { y: scale, ticks: niceTicks(lo, hi, 4) };
  }, [series, min, max, innerH]);
  const x = (i: number): number => (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const colourOf = (i: number): string => series[i]!.colour ?? (single ? 'var(--accent)' : SERIES_COLOURS[i % SERIES_COLOURS.length]!);

  // Leave room for the longest label (Hebrew dates run wider than English ones).
  const labelWidth = Math.max(64, labels.reduce((m, l) => Math.max(m, l.length), 0) * 6.4 + 18);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / labelWidth))));

  const onMove = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - margin.left;
    const i = n <= 1 ? 0 : Math.round((px / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {W > 0 && (
        <svg
          width={W}
          height={height}
          role="img"
          aria-label={title}
          tabIndex={0}
          style={{ direction: 'ltr' }}
          className="block rounded-chip outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            const rtl = !!e.currentTarget.closest('[dir="rtl"]');
            const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
            if (step !== 0) {
              e.preventDefault();
              setHover((h) => Math.min(n - 1, Math.max(0, (h ?? (step > 0 ? -1 : n)) + step)));
            }
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1={0} x2={innerW} stroke="var(--color-line)" strokeWidth={1} />
                <text x={-8} y={3.500} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="tabular-nums">
                  {format(tick)}
                </text>
              </g>
            ))}
            {labels.map((label, i) =>
              (i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.8) || i === n - 1 ? (
                <text
                  key={i}
                  x={x(i)}
                  y={innerH + 16}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  fontSize={11}
                  fill="var(--color-ink-3)"
                  className={cx(i === n - 1 && i % labelEvery !== 0 && n > 2 && 'hidden sm:block')}
                >
                  {label}
                </text>
              ) : null,
            )}
            {series.map((s, si) => {
              const path = d3line<number>()
                .x((_, i) => x(i))
                .y((d) => y(d))
                .curve(curveMonotoneX)(s.values);
              const fill =
                area && single
                  ? d3area<number>()
                      .x((_, i) => x(i))
                      .y0(innerH)
                      .y1((d) => y(d))
                      .curve(curveMonotoneX)(s.values)
                  : null;
              const last = s.values.length - 1;
              return (
                <g key={s.name}>
                  {fill && <path d={fill} fill={colourOf(si)} fillOpacity={0.1} />}
                  <path d={path ?? ''} fill="none" stroke={colourOf(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {dots &&
                    s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3.500} fill={colourOf(si)} stroke="var(--color-surface)" strokeWidth={2} />)}
                  {last >= 0 && <circle cx={x(last)} cy={y(s.values[last]!)} r={4} fill={colourOf(si)} stroke="var(--color-surface)" strokeWidth={2} />}
                </g>
              );
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} stroke="var(--color-line-strong)" strokeWidth={1} />
                {series.map((s, si) => (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.500} fill={colourOf(si)} stroke="var(--color-surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </g>
        </svg>
      )}
      {hover !== null && W > 0 && (
        <Tooltip x={margin.left + x(hover)} width={W}>
          <p className="mb-0.5 text-ink-3">{labels[hover]}</p>
          {series.map((s, si) => (
            <p key={s.name} className="flex items-center gap-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: colourOf(si) }} aria-hidden />
              <span className="font-semibold text-ink tabular-nums">{format(s.values[hover] ?? 0)}</span>
              {!single && <span className="text-ink-2">{s.name}</span>}
            </p>
          ))}
        </Tooltip>
      )}
      {!single && W > 0 && (
        <ul className="absolute end-3 top-0 flex gap-3 text-[11.5px] text-ink-2">
          {series.map((s, si) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: colourOf(si) }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <ScreenReaderTable caption={title} rows={labels.map((label, i) => ({ label, values: series.map((s) => format(s.values[i] ?? 0)) }))} />
    </div>
  );
}

// ----- Columns -----------------------------------------------------------------------------------

export function BarChart({ data, height = 200, format = defaultFormat, title }: { data: Point[]; height?: number; format?: (n: number) => string; title: string }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = size.width;
  const margin = { top: 14, right: 8, bottom: 24, left: 40 };
  const innerW = Math.max(10, W - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const n = data.length;
  const band = innerW / Math.max(1, n);
  const barW = Math.max(2, Math.min(24, band - 2));
  const hi = Math.max(1, ...data.map((d) => d.value));
  const y = scaleLinear().domain([0, hi]).nice(4).range([innerH, 0]);
  const ticks = niceTicks(0, hi, 4);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 56))));
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {W > 0 && (
        <svg width={W} height={height} role="img" aria-label={title} className="block" style={{ direction: 'ltr' }} onPointerLeave={() => setHover(null)}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1={0} x2={innerW} stroke="var(--color-line)" strokeWidth={1} />
                <text x={-8} y={3.500} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="tabular-nums">
                  {format(tick)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const h = Math.max(0, innerH - y(d.value));
              const bx = i * band + (band - barW) / 2;
              const r = Math.min(4, barW / 2, h);
              // Rounded at the data end, square at the baseline.
              const path = `M${bx},${innerH} V${innerH - h + r} Q${bx},${innerH - h} ${bx + r},${innerH - h} H${bx + barW - r} Q${bx + barW},${innerH - h} ${bx + barW},${innerH - h + r} V${innerH} Z`;
              return (
                <g key={i}>
                  <path d={path} fill="var(--accent)" fillOpacity={hover === null || hover === i ? 1 : 0.55} />
                  <rect x={i * band} y={0} width={band} height={innerH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} />
                  {(i % labelEvery === 0 || n <= 8) && (
                    <text x={i * band + band / 2} y={innerH + 16} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover !== null && W > 0 && data[hover] && (
        <Tooltip x={margin.left + hover * band + band / 2} width={W}>
          <span className="font-semibold text-ink tabular-nums">{format(data[hover]!.value)}</span> <span className="text-ink-2">{data[hover]!.label}</span>
        </Tooltip>
      )}
      <ScreenReaderTable caption={title} rows={data.map((d) => ({ label: d.label, values: [format(d.value)] }))} />
    </div>
  );
}

// ----- Horizontal bars (ranked categories) ------------------------------------------------------------

export function RankBars({ data, format = defaultFormat, title }: { data: Point[]; format?: (n: number) => string; title: string }) {
  const hi = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5" aria-label={title}>
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-2">{d.label}</span>
          <span className="h-2.5 rounded-e-[4px] bg-accent" style={{ width: `${Math.max(1.500, (d.value / hi) * 100)}%` }} aria-hidden />
          <span className="font-medium text-ink tabular-nums">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// ----- Heatmap (sequential, one hue) ---------------------------------------------------------------------

export function Heatmap({
  rows,
  columns,
  values,
  title,
  format = (v) => `${Math.round(v * 100)}%`,
  columnEvery = 3,
}: {
  rows: string[];
  columns: string[];
  values: number[][];
  title: string;
  format?: (v: number) => string;
  columnEvery?: number;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  return (
    <div className="relative">
      <div className="relative overflow-x-auto pb-1">
        <div className="grid min-w-[520px] gap-[2px]" style={{ gridTemplateColumns: `2.6rem repeat(${columns.length}, minmax(0, 1fr))` }} role="img" aria-label={title}>
          <span />
          {columns.map((c, i) => (
            <span key={c + i} className="pb-1 text-center text-[10.5px] text-ink-3 tabular-nums">
              {i % columnEvery === 0 ? c : ''}
            </span>
          ))}
          {rows.map((row, r) => (
            <RowCells key={row} row={row} cells={values[r] ?? []} onHover={(c) => setHover(c === null ? null : { r, c })} />
          ))}
        </div>
      </div>
      <p className="mt-2 h-4 text-[12px] text-ink-2 tabular-nums">
        {hover ? (
          <>
            <span className="font-semibold text-ink">{format(values[hover.r]?.[hover.c] ?? 0)}</span> · {rows[hover.r]} {columns[hover.c]}
          </>
        ) : null}
      </p>
    </div>
  );
}

function RowCells({ row, cells, onHover }: { row: string; cells: number[]; onHover: (c: number | null) => void }) {
  return (
    <>
      <span className="flex items-center text-[11.5px] text-ink-3">{row}</span>
      {cells.map((v, c) => (
        <span
          key={c}
          className="h-[18px] rounded-[3px]"
          style={{ background: `color-mix(in oklab, var(--accent) ${Math.round(6 + Math.min(1, Math.max(0, v)) * 88)}%, var(--color-raised))` }}
          onPointerEnter={() => onHover(c)}
          onPointerLeave={() => onHover(null)}
        />
      ))}
    </>
  );
}

// ----- Sparkline ------------------------------------------------------------------------------

export function Sparkline({ values, width = 96, height = 28, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = (v: number) => 3 + (1 - (hi === lo ? 0.5 : (v - lo) / (hi - lo))) * (height - 6);
  const x = (i: number) => 3 + (i / (values.length - 1)) * (width - 6);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <path d={`${path} L${x(last)},${height} L${x(0)},${height} Z`} fill="var(--accent)" fillOpacity={0.1} />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.500} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last]!)} r={2.500} fill="var(--accent)" />
    </svg>
  );
}

// ----- Stat tile -----------------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  trend,
  hint,
  demo,
}: {
  label: string;
  value: ReactNode;
  /** Relative change, e.g. 0.12 for +12%. */
  delta?: number;
  deltaLabel?: string;
  trend?: number[];
  hint?: ReactNode;
  demo?: ReactNode;
}) {
  return (
    <div className="panel flex min-w-0 flex-col justify-between gap-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="text-[12.5px] text-ink-2">{label}</p>
        {demo}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="display truncate text-[26px] leading-none text-ink">{value}</p>
          {delta !== undefined && (
            <p className="mt-1.5 text-[12px] text-ink-3">
              <span className={cx('font-medium tabular-nums', delta >= 0 ? 'text-success' : 'text-danger')}>
                {delta >= 0 ? '+' : '−'}
                {Math.abs(delta * 100).toFixed(1)}%
              </span>{' '}
              {deltaLabel}
            </p>
          )}
          {hint && <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>}
        </div>
        {trend && <Sparkline values={trend} className="hidden shrink-0 sm:block" />}
      </div>
    </div>
  );
}

/**
 * One row of headline figures in a single panel (v0.3). Reads as a summary line rather than a
 * grid of cards; each figure can open the page that explains it.
 */
export function KpiStrip({ items, title, demo }: { items: { label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void; tone?: 'default' | 'warning' | 'accent'; testId?: string }[]; title?: string; demo?: ReactNode }) {
  return (
    <section className="panel overflow-hidden" data-testid="kpi-strip">
      {(title || demo) && (
        <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-2">
          {title && <h2 className="text-[12.5px] font-medium text-ink-2">{title}</h2>}
          {demo}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:divide-x lg:divide-line/70 lg:rtl:divide-x-reverse">
        {items.map((item, i) => {
          const body = (
            <>
              <span className="block text-[12px] text-ink-3">{item.label}</span>
              <span className={cx('display mt-1 block truncate text-[24px] leading-none', item.tone === 'warning' ? 'text-warning' : item.tone === 'accent' ? 'text-accent' : 'text-ink')}>{item.value}</span>
              {item.hint && <span className="mt-1.5 block truncate text-[11.5px] text-ink-3">{item.hint}</span>}
            </>
          );
          const className = cx('flex min-w-0 flex-col items-start justify-start px-4 py-3 text-start lg:flex-1', i >= 2 && 'border-t border-line/70 sm:border-t-0', i >= 3 && 'sm:border-t', 'lg:border-t-0', item.onClick && 'transition-colors hover:bg-raised/50');
          return item.onClick ? (
            <button key={i} type="button" onClick={item.onClick} className={className} data-testid={item.testId}>
              {body}
            </button>
          ) : (
            <div key={i} className={className} data-testid={item.testId}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
