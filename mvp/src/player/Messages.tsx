import { useEffect, useRef, useState } from 'react';
import { LuArrowLeft, LuBan, LuBot, LuEllipsis, LuFlag, LuMail, LuSend } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { relativeTime, timeOfDay } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT, type T } from '../app/hooks.ts';
import { membershipOf } from '../platform/permissions.ts';
import * as messaging from '../platform/messaging.ts';
import type { ChatMessage, Club } from '../platform/types.ts';
import { Button, cx, EmptyState, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { TextArea } from '../ui/forms.tsx';
import { accentStyle, ClubLogo, ClubName } from '../ui/identity.tsx';
import { Dialog, Menu, MenuItem } from '../ui/overlay.tsx';

/** One message in a thread. Used by the player's inbox and by the club's. */
export function Bubble({ message, mine, authorName, t }: { message: ChatMessage; mine: boolean; authorName: string | null; t: T }) {
  return (
    <li className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'max-w-[min(34rem,86%)] rounded-panel px-3.5 py-2 text-[14px] leading-relaxed',
          message.internal ? 'border border-dashed border-warning/50 bg-warning/8 text-ink' : mine ? 'bg-accent/18 text-ink' : 'bg-raised text-ink',
        )}
      >
        {(message.internal || message.automated || authorName) && (
          <p className="mb-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
            {message.automated && <LuBot className="size-3.5" aria-hidden />}
            {message.internal ? t('messages.internal_note') : message.automated ? t('messages.automatic') : authorName}
            {message.internal && authorName ? ` · ${authorName}` : ''}
          </p>
        )}
        <p className="break-words whitespace-pre-wrap" dir="auto">
          {message.body}
        </p>
        <p className="mt-0.5 text-end text-[11px] text-ink-3 tabular-nums" dir="ltr">
          {timeOfDay(message.at, t.lang)}
        </p>
      </div>
    </li>
  );
}

function Thread({ club, onBack }: { club: Club; onBack: () => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const conversation = messaging.conversationOf(db, club.id, me.id);
  const thread = conversation ? messaging.conversationThread(db, me.id, conversation.id) : null;
  const messages = thread?.messages ?? [];
  const block = thread?.block ?? null;
  const banned = membershipOf(db, me.id, club.id)?.status === 'banned';
  const unread = conversation?.unreadPlayer ?? 0;

  useEffect(() => {
    if (conversation && unread > 0) act(() => messaging.markConversationRead(db, me.id, conversation.id));
  }, [conversation, unread, db, me.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = () => {
    if (act(() => messaging.sendPlayerMessage(db, me.id, club.id, text)) !== undefined) setText('');
  };

  return (
    <Panel pad={false} className="flex min-h-[420px] flex-col" style={accentStyle(club.branding.accent)} data-testid="thread">
      <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="inline-flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink lg:hidden" aria-label={t('common.back')}>
          <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        </button>
        <ClubLogo branding={club.branding} name={club.name} size={34} />
        <div className="min-w-0 flex-1 leading-tight">
          <button type="button" className="block max-w-full truncate text-[14.5px] font-semibold text-ink hover:underline" onClick={() => go('club', { clubId: club.id })}>
            <ClubName club={club} />
          </button>
          <p className="truncate text-[12px] text-ink-3">{t('messages.with_staff')}</p>
        </div>
        <Menu
          trigger={(p) => (
            <button type="button" {...p} aria-label={t('club.more')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink" data-testid="thread-more">
              <LuEllipsis className="size-4" aria-hidden />
            </button>
          )}
        >
          {(close) => (
            <>
              {block?.by === 'player' ? (
                <MenuItem
                  icon={<LuBan />}
                  onClick={() => {
                    close();
                    act(() => messaging.unblockClub(db, me.id, club.id), { key: 'messages.unblocked' });
                  }}
                >
                  {t('messages.unblock_club')}
                </MenuItem>
              ) : (
                <MenuItem
                  icon={<LuBan />}
                  onClick={() => {
                    close();
                    act(() => messaging.blockClub(db, me.id, club.id), { key: 'messages.blocked' });
                  }}
                >
                  {t('messages.block_club')}
                </MenuItem>
              )}
              {conversation && (
                <MenuItem
                  icon={<LuFlag />}
                  tone="danger"
                  onClick={() => {
                    close();
                    setReporting(true);
                  }}
                >
                  {t('messages.report')}
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {messages.length === 0 ? (
          <p className="mx-auto mt-8 max-w-[38ch] text-center text-[13.5px] leading-relaxed text-ink-2">{t('messages.start', { club: club.name })}</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <Bubble key={m.id} message={m} mine={m.from === 'player'} authorName={m.from === 'club' ? (db.users[m.authorId ?? '']?.name ?? null) : null} t={t} />
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>

      <footer className="border-t border-line p-3">
        {banned ? (
          <Notice tone="danger">{t('err.banned')}</Notice>
        ) : block ? (
          <Notice tone="neutral" icon={<LuBan />}>
            {block.by === 'player' ? t('messages.you_blocked') : t('err.blocked')}
          </Notice>
        ) : club.status !== 'active' ? (
          <Notice tone="danger">{t('club.suspended')}</Notice>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor="message-text" className="sr-only">
              {t('messages.write')}
            </label>
            <TextArea id="message-text" value={text} onChange={setText} rows={2} placeholder={t('messages.write')} className="min-h-[44px]" />
            <Button type="submit" variant="primary" disabled={!text.trim()} icon={<LuSend className="size-4 flip-rtl" aria-hidden />} data-testid="message-send">
              <span className="hidden sm:inline">{t('messages.send')}</span>
            </Button>
          </form>
        )}
        <p className="mt-2 text-[11.5px] leading-snug text-ink-3">{t('messages.privacy')}</p>
      </footer>

      <Dialog
        open={reporting}
        onClose={() => setReporting(false)}
        title={t('messages.report')}
        description={t('messages.report_hint')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReporting(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 5}
              onClick={() => {
                if (conversation && act(() => messaging.reportConversation(db, me.id, conversation.id, reason), { key: 'messages.reported' }) !== undefined) {
                  setReporting(false);
                  setReason('');
                }
              }}
            >
              {t('messages.report_send')}
            </Button>
          </>
        }
      >
        <TextArea value={reason} onChange={setReason} rows={3} placeholder={t('messages.report_placeholder')} />
      </Dialog>
    </Panel>
  );
}

export function Messages({ clubId }: { clubId: string | null }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const list = messaging.myConversations(db, me.id);
  const openClub = clubId ? db.clubs[clubId] : undefined;
  // On a wide screen the most recent conversation is open by default.
  const shown = openClub ?? (list[0] ? db.clubs[list[0].club.id] : undefined);

  return (
    <div data-testid="messages-page">
      <PageHeader title={t('messages.title')} subtitle={t('messages.subtitle')} />
      {list.length === 0 && !openClub ? (
        <EmptyState
          icon={<LuMail />}
          title={t('messages.empty.title')}
          body={t('messages.empty.body')}
          action={
            <Button variant="primary" onClick={() => go('clubs')}>
              {t('nav.clubs')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Panel pad={false} className={cx('self-start', openClub && 'hidden lg:block')}>
            <ul className="divide-y divide-line">
              {openClub && !list.some((c) => c.club.id === openClub.id) && (
                <li className="flex items-center gap-2.5 bg-accent/8 px-3 py-2.5">
                  <ClubLogo branding={openClub.branding} name={openClub.name} size={36} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{openClub.name}</span>
                </li>
              )}
              {list.map((item) => {
                const active = shown?.id === item.club.id;
                return (
                  <li key={item.conversation.id}>
                    <button
                      type="button"
                      onClick={() => go('messages', { clubId: item.club.id })}
                      aria-current={active ? 'true' : undefined}
                      className={cx('flex w-full items-center gap-2.5 px-3 py-2.5 text-start hover:bg-raised/60', active && 'lg:bg-accent/8')}
                      data-testid={`conversation-${item.club.id}`}
                    >
                      <ClubLogo branding={item.club.branding} name={item.club.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cx('truncate text-[13.5px] text-ink', item.conversation.unreadPlayer > 0 ? 'font-semibold' : 'font-medium')}>{item.club.name}</span>
                          <span className="shrink-0 text-[11.5px] text-ink-3">{relativeTime(item.conversation.lastMessageAt, now, t.lang)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2" dir="auto">
                            {item.last ? `${item.last.from === 'player' ? `${t('messages.you')}: ` : ''}${item.last.body}` : ''}
                          </span>
                          {item.conversation.unreadPlayer > 0 && <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink tabular-nums">{item.conversation.unreadPlayer}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <div className={cx('min-w-0', !openClub && 'hidden lg:block')}>{shown && <Thread key={shown.id} club={shown} onBack={() => go('messages')} />}</div>
        </div>
      )}
    </div>
  );
}
