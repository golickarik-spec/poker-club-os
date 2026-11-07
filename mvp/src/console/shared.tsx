import type { ReactNode } from 'react';
import type { T } from '../app/hooks.ts';
import { hasMessage } from '../i18n/index.ts';
import type { AuditEntry } from '../platform/types.ts';
import { cx } from '../ui/core.tsx';

/** One line describing an audit entry, in the reader's language. */
export function auditText(t: T, entry: AuditEntry): string {
  const key = `audit.${entry.action}`;
  const params = { ...entry.params };
  if (typeof params.to === 'string' && hasMessage(`role.${params.to}`)) params.to = t(`role.${params.to}`);
  if (typeof params.from === 'string' && hasMessage(`role.${params.from}`)) params.from = t(`role.${params.from}`);
  if (typeof params.status === 'string' && hasMessage(`ticket.status.${params.status}`)) params.status = t(`ticket.status.${params.status}`);
  return hasMessage(key) ? t(key, params) : entry.action;
}

/** Simple responsive data table shell: horizontal scroll inside its own container. */
export function TableShell({ children, minWidth = 640, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cx('relative overflow-x-auto', className)}>
      <table className="w-full text-[13.5px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, end, className }: { children?: ReactNode; end?: boolean; className?: string }) {
  return <th className={cx('border-b border-line px-3 py-2 text-[12px] font-medium whitespace-nowrap text-ink-3 first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5', end ? 'text-end' : 'text-start', className)}>{children}</th>;
}

export function Td({ children, end, className, colSpan }: { children?: ReactNode; end?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('px-3 py-2.5 align-middle first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5', end && 'text-end', className)}>
      {children}
    </td>
  );
}
