import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LuCircleAlert, LuCircleCheck, LuInfo, LuX } from 'react-icons/lu';
import { toasts } from '../app/context.ts';
import { useT, useToasts } from '../app/hooks.ts';
import { Button, cx, IconButton } from './core.tsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where overlays are mounted: inside the app root so they inherit direction, theme and club accent. */
function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}

/**
 * Modal dialog. Traps focus, closes on Escape and on backdrop click, restores
 * focus to the element that opened it. On small screens it becomes a bottom sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissable?: boolean;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open, dismissable]);

  if (!open) return null;
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade bg-black/65 backdrop-blur-[2px]" onClick={dismissable ? onClose : undefined} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[92%] w-full animate-sheet flex-col rounded-t-hero border border-line-strong/60 bg-surface shadow-pop outline-none sm:animate-pop sm:rounded-hero',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold text-ink">
              {title}
            </h2>
            {description && <div className="mt-1 text-[13px] leading-relaxed text-ink-2">{description}</div>}
          </div>
          {dismissable && (
            <IconButton label={t('common.close')} onClick={onClose} size="sm" className="-me-1.5 -mt-0.5">
              <LuX className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    overlayRoot(),
  );
}

/** Confirmation step for consequential actions. Native confirm() is not available in embedded views. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            data-testid="confirm"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** Dropdown menu anchored to its trigger. */
export function Menu({
  trigger,
  children,
  align = 'end',
  width = 'w-60',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open })}
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-40 mt-1.5 max-w-[calc(100vw-2rem)] animate-pop rounded-inner border border-line-strong/60 bg-raised p-1.5 shadow-pop',
            width,
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, tone, active, hint }: { icon?: ReactNode; children: ReactNode; onClick: () => void; tone?: 'danger'; active?: boolean; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-start text-[13.5px] transition-colors hover:bg-raised-2',
        tone === 'danger' ? 'text-danger' : 'text-ink',
        active && 'bg-raised-2',
      )}
    >
      {icon && <span className="shrink-0 text-ink-2 [&>svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {hint && <span className="shrink-0 text-[12px] text-ink-3">{hint}</span>}
    </button>
  );
}

export function Toaster() {
  const items = useToasts();
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
      {items.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex max-w-md animate-rise items-start gap-2.5 rounded-inner border border-line-strong/70 bg-raised px-3.5 py-2.5 text-[13.5px] text-ink shadow-pop"
        >
          <span className={cx('mt-0.5 shrink-0', toast.tone === 'success' ? 'text-success' : toast.tone === 'error' ? 'text-danger' : 'text-info')}>
            {toast.tone === 'success' ? <LuCircleCheck className="size-4" aria-hidden /> : toast.tone === 'error' ? <LuCircleAlert className="size-4" aria-hidden /> : <LuInfo className="size-4" aria-hidden />}
          </span>
          <span className="min-w-0">{toast.text}</span>
          <button type="button" className="-me-1 shrink-0 rounded p-0.5 text-ink-3 hover:text-ink" onClick={() => toasts.dismiss(toast.id)} aria-label={t('common.close')}>
            <LuX className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Tabs with arrow-key navigation. */
export function Tabs<V extends string>({
  value,
  onChange,
  tabs,
  label,
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  tabs: { value: V; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (delta: number) => {
    const index = tabs.findIndex((x) => x.value === value);
    const next = tabs[(index + delta + tabs.length) % tabs.length]!;
    onChange(next.value);
    refs.current[next.value]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cx('relative flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[tab.value] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-testid={`tab-${tab.value}`}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => {
              const rtl = document.dir === 'rtl' || !!e.currentTarget.closest('[dir="rtl"]');
              if (e.key === 'ArrowRight') move(rtl ? -1 : 1);
              if (e.key === 'ArrowLeft') move(rtl ? 1 : -1);
            }}
            className={cx(
              '-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors',
              active ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={cx('rounded-full px-1.5 py-px text-[11px] tabular-nums', active ? 'bg-accent/15 text-accent' : 'bg-raised-2 text-ink-2')}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
