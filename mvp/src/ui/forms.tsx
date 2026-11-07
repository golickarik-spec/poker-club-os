import { useId, type ReactNode } from 'react';
import { LuCheck, LuMinus, LuPlus } from 'react-icons/lu';
import { cx } from './core.tsx';

const CONTROL =
  'h-10 w-full min-w-0 rounded-control border border-line-strong/80 bg-bg px-3 text-sm text-ink shadow-[0_1px_2px_rgb(0_0_0/0.25)_inset] placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

/** Control classes with the caller's width/height taking precedence over the defaults (utility order is not source order). */
function control(className?: string): string {
  let base = CONTROL;
  if (className && /(^|\s)w-/.test(className)) base = base.replace(' w-full', '');
  if (className && /(^|\s)h-/.test(className)) base = base.replace('h-10 ', '');
  return base;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  optional?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium text-ink">
        <span>{label}</span>
        {optional && <span className="text-[12px] font-normal text-ink-3">{optional}</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[12.5px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  id,
  placeholder,
  type = 'text',
  invalid,
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  type?: 'text' | 'search' | 'email' | 'password' | 'datetime-local' | 'color' | 'time' | 'date';
  invalid?: boolean;
  className?: string;
  [attr: string]: unknown;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cx(control(className), invalid && 'border-danger/70', className)}
      {...rest}
    />
  );
}

export function TextArea({ value, onChange, id, placeholder, rows = 3, className }: { value: string; onChange: (value: string) => void; id?: string; placeholder?: string; rows?: number; className?: string }) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cx(CONTROL.replace('h-10 ', ''), 'h-auto resize-y py-2 leading-relaxed', className)}
    />
  );
}

export function Select<V extends string>({
  value,
  onChange,
  options,
  id,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string; disabled?: boolean }[];
  id?: string;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value as V)}
      className={cx(
        control(className),
        'appearance-none bg-[length:16px] bg-no-repeat pe-9 [background-position:right_0.6rem_center] rtl:[background-position:left_0.6rem_center]',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2393a1b2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Whole-number input with optional stepper buttons. Emits a number, or keeps the last valid one while the field is empty. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
  stepper,
  className,
  suffix,
  invalid,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  stepper?: boolean;
  className?: string;
  suffix?: string;
  invalid?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const input = (
    <div className="relative min-w-0 flex-1">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => onChange(clamp(value))}
        className={cx(CONTROL, 'tabular-nums', suffix && 'pe-12', invalid && 'border-danger/70', stepper && 'rounded-none border-x-0 text-center')}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[12.5px] text-ink-3">{suffix}</span>}
    </div>
  );
  if (!stepper) return <div className={cx('flex', className)}>{input}</div>;
  const stepButton = 'flex h-10 w-10 shrink-0 items-center justify-center border border-line-strong/80 bg-raised text-ink-2 hover:bg-raised-2 hover:text-ink disabled:opacity-40';
  return (
    <div className={cx('flex', className)}>
      <button type="button" className={cx(stepButton, 'rounded-s-[8px]')} onClick={() => onChange(clamp(value - step))} disabled={min !== undefined && value <= min} aria-label="−">
        <LuMinus className="size-4" aria-hidden />
      </button>
      {input}
      <button type="button" className={cx(stepButton, 'rounded-e-[8px]')} onClick={() => onChange(clamp(value + step))} disabled={max !== undefined && value >= max} aria-label="+">
        <LuPlus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; disabled?: boolean; id?: string }) {
  const auto = useId();
  const controlId = id ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={controlId} className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{description}</span>}
      </label>
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
          checked ? 'bg-accent' : 'bg-raised-2',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start] duration-200',
            checked ? 'start-[22px]' : 'start-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; id?: string }) {
  const auto = useId();
  const controlId = id ?? auto;
  return (
    <label htmlFor={controlId} className="flex items-start gap-2.5 text-sm text-ink">
      <span className="relative mt-0.5 flex size-[18px] shrink-0">
        <input id={controlId} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 size-full opacity-0" />
        <span className="flex size-full items-center justify-center rounded-chip border border-line-strong bg-bg text-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
          <LuCheck className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      </span>
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** A small set of mutually exclusive options shown side by side. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
  full,
}: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: ReactNode; title?: string }[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
  full?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex max-w-full overflow-x-auto rounded-[9px] border border-line bg-bg p-0.5', full && 'flex w-full', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-[7px] px-3 font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-7 text-[12.5px]' : 'h-8 text-[13px]',
              full && 'min-w-0 flex-1 px-2',
              active ? 'bg-raised-2 text-ink shadow-[0_0_0_1px_var(--color-line-strong)]' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, label, id }: { value: number; onChange: (value: number) => void; min: number; max: number; step?: number; label: string; id?: string }) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      id={id}
      type="range"
      className="pc-range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--fill': `${fill}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
