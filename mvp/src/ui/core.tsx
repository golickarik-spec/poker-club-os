import type { MouseEvent, ReactNode } from 'react';
import { LuChevronRight, LuLoaderCircle } from 'react-icons/lu';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ----- Button ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none transition-[background-color,filter,border-color,color,transform] duration-150 active:scale-[0.985] disabled:opacity-40 disabled:pointer-events-none';
const BUTTON_SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
};
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_1px_2px_rgb(0_0_0/0.3)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-raised text-ink border border-line-strong/70 hover:bg-raised-2',
  outline: 'border border-line-strong text-ink hover:bg-raised',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
  danger: 'bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20',
};

export interface ButtonProps {
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  trailing?: ReactNode;
  full?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
  'data-testid'?: string;
  id?: string;
}

export function Button({ children, variant = 'secondary', size = 'md', icon, trailing, full, loading, className, type = 'button', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], full && 'w-full', className)}
      {...rest}
    >
      {loading ? <LuLoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {trailing}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  size = 'md',
  ...rest
}: {
  label: string;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  'aria-expanded'?: boolean;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40',
        size === 'sm' ? 'size-8' : 'size-10',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ----- Badges and tags ---------------------------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'gold';

const TONE: Record<Tone, string> = {
  neutral: 'bg-raised-2/70 text-ink-2',
  accent: 'bg-accent/14 text-accent',
  success: 'bg-success/14 text-success',
  warning: 'bg-warning/14 text-warning',
  danger: 'bg-danger/14 text-danger',
  info: 'bg-info/14 text-info',
  gold: 'bg-gold/14 text-gold',
};

export function Badge({ tone = 'neutral', children, dot, pulse, className }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-badge px-2 text-[11.5px] font-medium leading-none whitespace-nowrap', TONE[tone], className)}>
      {dot && <span className={cx('size-1.5 rounded-full bg-current', pulse && 'animate-pulse-dot')} aria-hidden />}
      {children}
    </span>
  );
}

/** Marks simulated accounts. Shown wherever a computer-controlled player appears. */
export function BotTag({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cx('inline-flex h-4 shrink-0 items-center rounded-[4px] border border-line-strong px-1 text-[9.5px] font-semibold leading-none tracking-[0.04em] text-ink-3', className)}>
      {label}
    </span>
  );
}

/** Marks figures that are sample data rather than something measured. */
export function DemoTag({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cx('inline-flex h-[18px] shrink-0 items-center rounded-chip bg-raised-2/60 px-1.5 text-[10.5px] font-medium leading-none text-ink-3', className)}>
      {label}
    </span>
  );
}

// ----- Surfaces -------------------------------------------------------------------------------

export function Panel({ children, className, pad = true, as = 'section', ...rest }: { children: ReactNode; className?: string; pad?: boolean; as?: 'section' | 'div' | 'article' | 'aside'; [attr: string]: unknown }) {
  const Tag = as;
  return (
    <Tag className={cx('panel min-w-0', pad && 'p-4 sm:p-5', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function PanelHeader({ title, hint, action, className }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A trail of places above a page title. The last entry is the page itself and is not a link. */
export function Breadcrumbs({ items, className }: { items: { label: ReactNode; onClick?: () => void }[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cx('mb-1.5 flex min-w-0 flex-wrap items-center gap-1 text-[12.5px] text-ink-3', className)} data-testid="breadcrumbs">
      {items.map((item, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <LuChevronRight className="size-3 shrink-0 flip-rtl text-ink-3/70" aria-hidden />}
          {item.onClick && i < items.length - 1 ? (
            <button type="button" onClick={item.onClick} className="max-w-[28ch] truncate hover:text-ink hover:underline">
              {item.label}
            </button>
          ) : (
            <span className={cx('max-w-[32ch] truncate', i === items.length - 1 && 'text-ink-2')} aria-current={i === items.length - 1 ? 'page' : undefined}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions, back, crumbs, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode; crumbs?: { label: ReactNode; onClick?: () => void }[]; eyebrow?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back}
        {crumbs && <Breadcrumbs items={crumbs} />}
        {eyebrow && <p className="mb-1 text-[12.5px] font-medium text-ink-3">{eyebrow}</p>}
        <h1 className="display text-[24px] leading-tight text-ink sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong/60 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-raised text-ink-2 [&>svg]:size-5">{icon}</div>}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body && <p className="max-w-[46ch] text-[13px] text-ink-2">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function SkeletonPage() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-7 w-56" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-40" />
    </div>
  );
}

/** A value with its label, for definition-style rows. */
export function Fact({ label, children, className, wrap = false }: { label: string; children: ReactNode; className?: string; wrap?: boolean }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={cx('mt-0.5 text-sm font-medium text-ink tabular-nums', wrap ? 'break-words' : 'truncate')}>{children}</dd>
    </div>
  );
}

/** Thin progress meter. */
export function Meter({ value, max, tone = 'accent', className, label }: { value: number; max: number; tone?: 'accent' | 'warning' | 'danger' | 'gold'; className?: string; label?: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const fill = tone === 'accent' ? 'bg-accent' : tone === 'warning' ? 'bg-warning' : tone === 'gold' ? 'bg-gold' : 'bg-danger';
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-raised-2', className)} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Notice({ tone = 'info', icon, children, action, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  const border: Record<Tone, string> = {
    neutral: 'border-line-strong/70 bg-raised/50',
    accent: 'border-accent/30 bg-accent/8',
    success: 'border-success/30 bg-success/8',
    warning: 'border-warning/30 bg-warning/8',
    danger: 'border-danger/30 bg-danger/8',
    info: 'border-info/30 bg-info/8',
    gold: 'border-gold/30 bg-gold/8',
  };
  const ink: Record<Tone, string> = {
    neutral: 'text-ink-2',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
    gold: 'text-gold',
  };
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-inner border px-3.5 py-2.5 text-[13px] text-ink', border[tone], className)}>
      {icon && <span className={cx('shrink-0 [&>svg]:size-4', ink[tone])}>{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
