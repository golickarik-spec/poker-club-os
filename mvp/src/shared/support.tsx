import { useState } from 'react';
import { LuSend } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateTime, relativeTime } from '../app/format.ts';
import { useDb, useMe, useNow, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import { isPlatformAdmin } from '../platform/permissions.ts';
import type { SupportTicket, TicketStatus } from '../platform/types.ts';
import { Badge, Button, cx, type Tone } from '../ui/core.tsx';
import { Select, TextArea } from '../ui/forms.tsx';
import { Avatar } from '../ui/identity.tsx';
import { Dialog } from '../ui/overlay.tsx';

export const TICKET_TONE: Record<TicketStatus, Tone> = { open: 'warning', in_progress: 'info', waiting: 'neutral', resolved: 'success' };
const PRIORITY_TONE = { low: 'neutral', normal: 'neutral', high: 'danger' } as const;

export function TicketList({ tickets, onOpen, showClub }: { tickets: SupportTicket[]; onOpen: (id: string) => void; showClub?: boolean }) {
  const t = useT();
  const db = useDb();
  const now = useNow(60_000);
  return (
    <ul className="divide-y divide-line">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <button type="button" onClick={() => onOpen(ticket.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-raised/50 sm:px-5" data-testid="ticket-row">
            <span className="w-[74px] shrink-0 text-[12.5px] text-ink-3 tabular-nums" dir="ltr">
              {ticket.ref}
            </span>
            <span className="min-w-0 flex-1 basis-[220px]">
              <span className="block truncate text-[14px] font-medium text-ink">{ticket.subject}</span>
              <span className="block truncate text-[12.5px] text-ink-3">
                {showClub ? `${db.clubs[ticket.clubId]?.name ?? '—'} · ` : ''}
                {t(`ticket.category.${ticket.category}`)} · {t('ticket.updated', { when: relativeTime(ticket.updatedAt, now, t.lang) })}
              </span>
            </span>
            {ticket.priority === 'high' && <Badge tone={PRIORITY_TONE[ticket.priority]}>{t('ticket.priority.high')}</Badge>}
            <Badge tone={TICKET_TONE[ticket.status]} dot>
              {t(`ticket.status.${ticket.status}`)}
            </Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TicketDialog({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [reply, setReply] = useState('');
  const ticket = ticketId ? db.tickets.find((x) => x.id === ticketId) : undefined;
  const staff = isPlatformAdmin(db, me.id);
  const send = () => {
    if (!ticket) return;
    if (act(() => api.replyToTicket(db, me.id, ticket.id, reply), { key: 'ticket.reply_sent' }) !== undefined) setReply('');
  };
  return (
    <Dialog open={!!ticket} onClose={onClose} title={ticket ? `${ticket.ref} · ${ticket.subject}` : ''} size="lg">
      {ticket && (
        <div data-testid="ticket-dialog">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
            <Badge tone={TICKET_TONE[ticket.status]} dot>
              {t(`ticket.status.${ticket.status}`)}
            </Badge>
            <span>{db.clubs[ticket.clubId]?.name}</span>
            <span>· {t(`ticket.category.${ticket.category}`)}</span>
            <span>· {t(`ticket.priority.${ticket.priority}`)}</span>
            <span>· {t('ticket.opened', { when: dateTime(ticket.createdAt, t.lang) })}</span>
          </div>
          <ol className="space-y-3">
            {ticket.messages.map((m, i) => {
              const author = db.users[m.authorId];
              return (
                <li key={i} className={cx('flex gap-2.5', m.staff && 'flex-row-reverse')}>
                  {author && <Avatar user={author} size={30} />}
                  <div className={cx('max-w-[82%] rounded-inner px-3.5 py-2.5', m.staff ? 'bg-accent/12' : 'bg-raised')}>
                    <p className="text-[12px] text-ink-3">
                      {author?.name ?? '—'} · {m.staff ? t('ticket.platform_support') : t('ticket.club_staff')} · {dateTime(m.at, t.lang)}
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed whitespace-pre-line text-ink">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 border-t border-line pt-4">
            <label htmlFor="ticket-reply" className="mb-1.5 block text-[13px] font-medium text-ink">
              {t('ticket.reply')}
            </label>
            <TextArea id="ticket-reply" value={reply} onChange={setReply} rows={3} placeholder={staff ? t('ticket.reply_placeholder_staff') : t('ticket.reply_placeholder')} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              {staff ? (
                <Select
                  value={ticket.status}
                  aria-label={t('common.status')}
                  className="h-9 w-auto min-w-[170px]"
                  onChange={(status) => act(() => api.setTicketStatus(db, me.id, ticket.id, status), { key: 'ticket.status_changed' })}
                  options={(['open', 'in_progress', 'waiting', 'resolved'] as const).map((s) => ({ value: s, label: t(`ticket.status.${s}`) }))}
                />
              ) : ticket.status === 'resolved' ? (
                <Button size="sm" variant="ghost" onClick={() => act(() => api.setTicketStatus(db, me.id, ticket.id, 'open'), { key: 'ticket.status_changed' })}>
                  {t('ticket.reopen')}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => act(() => api.setTicketStatus(db, me.id, ticket.id, 'resolved'), { key: 'ticket.status_changed' })} data-testid="ticket-resolve">
                  {t('ticket.mark_resolved')}
                </Button>
              )}
              <Button variant="primary" icon={<LuSend className="size-4 flip-rtl" aria-hidden />} onClick={send} disabled={reply.trim().length < 2} data-testid="ticket-send">
                {t('ticket.send')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
