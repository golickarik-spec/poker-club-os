import { useEffect, useRef, useState } from 'react';
import { LuArrowLeft, LuBan, LuCheck, LuFlag, LuInbox, LuLock, LuRotateCcw, LuSearch, LuSend, LuUserRound } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { dateShort, relativeTime } from '../../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import * as crm from '../../platform/crm.ts';
import * as messaging from '../../platform/messaging.ts';
import type { InboxItem } from '../../platform/messaging.ts';
import { can } from '../../platform/permissions.ts';
import type { Club } from '../../platform/types.ts';
import { Bubble } from '../../player/Messages.tsx';
import { Badge, BotTag, Button, cx, EmptyState, Notice, PageHeader, Panel } from '../../ui/core.tsx';
import { Checkbox, Select, TextArea, TextInput } from '../../ui/forms.tsx';
import { Avatar } from '../../ui/identity.tsx';
import { Dialog } from '../../ui/overlay.tsx';
import { LifecycleBadge, StatusBadge, TagList, useReport } from './shared.tsx';

type Filter = 'open' | 'mine' | 'unassigned' | 'resolved' | 'all';

/**
 * The club's inbox: conversations on one side, the thread in the middle, the
 * player's CRM summary on the other side. Only this club's staff with the
 * messages permission get past the service layer.
 */
export function Inbox({ club, userParam, conversationParam }: { club: Club; userParam?: string; conversationParam?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const data = useReport(() => ({ inbox: messaging.clubInbox(db, me.id, club.id), staff: crm.staffOf(db, me.id, club.id).filter((s) => can(db, s.userId, 'crm.messages', club.id)), tags: crm.listTags(db, me.id, club.id) }), [club.id, me.id]);
  const byConversation = conversationParam ? data.inbox.find((i) => i.conversation.id === conversationParam) : undefined;
  const targetUser = userParam ?? byConversation?.user.id ?? null;
  const matches = (i: InboxItem): boolean => {
    const c = i.conversation;
    if (filter === 'open' && c.status !== 'open') return false;
    if (filter === 'resolved' && c.status !== 'resolved') return false;
    if (filter === 'mine' && (c.assignedTo !== me.id || c.status !== 'open')) return false;
    if (filter === 'unassigned' && (c.assignedTo !== null || c.status !== 'open')) return false;
    const q = search.trim().toLowerCase();
    return !q || i.user.name.toLowerCase().includes(q) || i.user.handle.toLowerCase().includes(q) || (i.last?.body.toLowerCase().includes(q) ?? false);
  };
  const list = data.inbox.filter(matches);
  const selected = targetUser ? data.inbox.find((i) => i.user.id === targetUser) : undefined;
  // Writing to someone for the first time: there is no conversation yet, only the person.
  const fresh = targetUser && !selected ? db.users[targetUser] : undefined;
  const thread = selected ? messaging.conversationThread(db, me.id, selected.conversation.id) : null;
  const profile = useReport(() => {
    if (!targetUser) return null;
    try {
      return crm.playerProfile(db, me.id, club.id, targetUser);
    } catch (err) {
      if (err instanceof Error && err.name === 'DomainError') return null;
      throw err;
    }
  }, [club.id, me.id, targetUser]);
  const unread = selected?.conversation.unreadClub ?? 0;
  const count = thread?.messages.length ?? 0;

  useEffect(() => {
    if (selected && unread > 0) act(() => messaging.markConversationRead(db, me.id, selected.conversation.id));
  }, [selected, unread, db, me.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, targetUser]);

  const open = (userId: string | null) => go('console.crm.inbox', userId ? { clubId: club.id, userId } : { clubId: club.id });
  const send = () => {
    if (!targetUser) return;
    if (act(() => messaging.sendClubMessage(db, me.id, club.id, targetUser, text, { internal })) !== undefined) {
      setText('');
      setInternal(false);
    }
  };
  const person = selected?.user ?? (fresh ? { id: fresh.id, name: fresh.name, handle: fresh.handle, hue: fresh.hue, isBot: fresh.isBot } : null);
  const blocked = thread?.block ?? null;
  const counts = {
    open: data.inbox.filter((i) => i.conversation.status === 'open').length,
    mine: data.inbox.filter((i) => i.conversation.status === 'open' && i.conversation.assignedTo === me.id).length,
    unassigned: data.inbox.filter((i) => i.conversation.status === 'open' && i.conversation.assignedTo === null).length,
  };

  return (
    <div data-testid="crm-inbox">
      <PageHeader title={t('crm.inbox.title')} subtitle={t('crm.inbox.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        {/* Conversations */}
        <Panel pad={false} className={cx('self-start', person && 'hidden lg:block')}>
          <div className="space-y-2 border-b border-line p-3">
            <div className="relative">
              <LuSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <TextInput type="search" value={search} onChange={setSearch} placeholder={t('crm.inbox.search')} className="h-9 ps-9" aria-label={t('crm.inbox.search')} />
            </div>
            <Select<Filter>
              value={filter}
              onChange={setFilter}
              className="h-9 text-[13px]"
              aria-label={t('crm.inbox.filter')}
              data-testid="inbox-filter"
              options={[
                { value: 'open', label: `${t('crm.inbox.filter.open')} (${counts.open})` },
                { value: 'mine', label: `${t('crm.inbox.filter.mine')} (${counts.mine})` },
                { value: 'unassigned', label: `${t('crm.inbox.filter.unassigned')} (${counts.unassigned})` },
                { value: 'resolved', label: t('crm.inbox.filter.resolved') },
                { value: 'all', label: t('crm.inbox.filter.all') },
              ]}
            />
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-3">{t('crm.inbox.none')}</p>
          ) : (
            <ul className="max-h-[62vh] divide-y divide-line overflow-y-auto">
              {list.map((i) => {
                const active = i.user.id === targetUser;
                return (
                  <li key={i.conversation.id}>
                    <button type="button" onClick={() => open(i.user.id)} aria-current={active ? 'true' : undefined} className={cx('flex w-full items-start gap-2.5 px-3 py-2.5 text-start hover:bg-raised/60', active && 'bg-accent/8')} data-testid={`inbox-${i.user.id}`}>
                      <Avatar user={i.user} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cx('truncate text-[13.5px] text-ink', i.conversation.unreadClub > 0 ? 'font-semibold' : 'font-medium')}>{i.user.name}</span>
                          <span className="shrink-0 text-[11.5px] text-ink-3">{relativeTime(i.conversation.lastMessageAt, now, t.lang)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2" dir="auto">
                            {i.last ? `${i.last.internal ? `${t('messages.internal_note')}: ` : i.last.from !== 'player' ? `${t('crm.inbox.club')}: ` : ''}${i.last.body}` : ''}
                          </span>
                          {i.conversation.unreadClub > 0 && <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink tabular-nums">{i.conversation.unreadClub}</span>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {i.conversation.status === 'resolved' && <Badge>{t('crm.inbox.resolved')}</Badge>}
                          {i.assignedName && <span className="text-[11.5px] text-ink-3">{i.assignedName}</span>}
                          {i.blocked && <Badge tone="danger">{t('crm.inbox.blocked')}</Badge>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Thread */}
        <div className={cx('min-w-0', !person && 'hidden lg:block')}>
          {!person ? (
            <EmptyState icon={<LuInbox />} title={t('crm.inbox.pick.title')} body={t('crm.inbox.pick.body')} />
          ) : (
            <Panel pad={false} className="flex min-h-[460px] flex-col" data-testid="inbox-thread">
              <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-3 py-2.5 sm:px-4">
                <button type="button" onClick={() => open(null)} className="inline-flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink lg:hidden" aria-label={t('common.back')}>
                  <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
                </button>
                <Avatar user={person} size={34} />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="flex items-center gap-1.5 text-[14.5px] font-semibold text-ink">
                    <span className="truncate">{person.name}</span>
                    {person.isBot && <BotTag label={t('common.bot')} />}
                  </p>
                  <p className="truncate text-[12px] text-ink-3" dir="ltr">
                    @{person.handle}
                  </p>
                </div>
                {selected && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Select
                      value={selected.conversation.assignedTo ?? 'none'}
                      onChange={(id) => act(() => messaging.assignConversation(db, me.id, selected.conversation.id, id === 'none' ? null : id))}
                      className="h-8 w-auto text-[12.5px]"
                      aria-label={t('crm.col.assigned')}
                      data-testid="inbox-assign"
                      options={[{ value: 'none', label: t('crm.inbox.unassigned') }, ...data.staff.map((s) => ({ value: s.userId, label: s.name }))]}
                    />
                    {selected.conversation.status === 'open' ? (
                      <Button size="sm" icon={<LuCheck className="size-3.5" aria-hidden />} onClick={() => act(() => messaging.setConversationStatus(db, me.id, selected.conversation.id, 'resolved'), { key: 'crm.toast.resolved' })} data-testid="inbox-resolve">
                        {t('crm.inbox.resolve')}
                      </Button>
                    ) : (
                      <Button size="sm" icon={<LuRotateCcw className="size-3.5" aria-hidden />} onClick={() => act(() => messaging.setConversationStatus(db, me.id, selected.conversation.id, 'open'))} data-testid="inbox-reopen">
                        {t('crm.inbox.reopen')}
                      </Button>
                    )}
                  </span>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" style={{ maxHeight: '52vh' }}>
                {!thread || thread.messages.length === 0 ? (
                  <p className="mx-auto mt-8 max-w-[40ch] text-center text-[13.5px] text-ink-2">{t('crm.inbox.first', { name: person.name })}</p>
                ) : (
                  <ul className="space-y-2">
                    {thread.messages.map((m) => (
                      <Bubble key={m.id} message={m} mine={m.from !== 'player'} authorName={m.from === 'club' ? (db.users[m.authorId ?? '']?.name ?? null) : null} t={t} />
                    ))}
                  </ul>
                )}
                <div ref={end} />
              </div>
              <footer className="border-t border-line p-3">
                {blocked?.by === 'player' && !internal && (
                  <Notice tone="neutral" icon={<LuBan />} className="mb-2">
                    {t('err.blocked_by_player')}
                  </Notice>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <label htmlFor="reply-text" className="sr-only">
                    {t('crm.inbox.reply')}
                  </label>
                  <TextArea id="reply-text" value={text} onChange={setText} rows={2} placeholder={internal ? t('crm.inbox.note_placeholder') : t('crm.inbox.reply')} className={cx(internal && 'border-warning/50 bg-warning/[0.06]')} />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <Checkbox
                      checked={internal}
                      onChange={setInternal}
                      label={
                        <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                          <LuLock className="size-3.5" aria-hidden />
                          {t('crm.inbox.internal')}
                        </span>
                      }
                    />
                    <Button type="submit" variant="primary" size="sm" disabled={!text.trim()} icon={<LuSend className="size-3.5 flip-rtl" aria-hidden />} data-testid="inbox-send">
                      {internal ? t('crm.inbox.save_note') : t('messages.send')}
                    </Button>
                  </div>
                </form>
              </footer>
            </Panel>
          )}
        </div>

        {/* Player summary */}
        {person && (
          <Panel className="self-start lg:col-span-2 2xl:col-span-1" data-testid="inbox-details">
            {profile ? (
              <>
                <p className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge row={profile.row} t={t} />
                  <LifecycleBadge stage={profile.row.lifecycle} active={profile.row.active} t={t} />
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] 2xl:grid-cols-1">
                  <div>
                    <dt className="text-[12px] text-ink-3">{t('crm.col.tournaments')}</dt>
                    <dd className="text-ink tabular-nums">
                      {profile.stats.tournaments} · {t.n('club.wins', profile.stats.wins)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-ink-3">{t('crm.col.tags')}</dt>
                    <dd className="mt-0.5">
                      <TagList ids={profile.row.tagIds} tags={data.tags} max={4} />
                    </dd>
                  </div>
                </dl>
                {profile.history.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-[12px] text-ink-3">{t('crm.inbox.recent')}</p>
                    <ul className="mt-1 space-y-1 text-[13px]">
                      {profile.history.slice(0, 3).map((h) => (
                          <li key={h.tournamentId} className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-ink">{h.name}</span>
                            <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">
                              {dateShort(h.at, t.lang)}
                              {h.place !== null ? ` · ` : ''}
                              {h.place !== null && <span dir="ltr">{`${h.place} / ${h.entrants}`}</span>}
                            </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {profile.notes !== null && profile.notes.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
                      <LuLock className="size-3" aria-hidden />
                      {t('crm.notes.title')}
                    </p>
                    <ul className="mt-1 space-y-1.5 text-[13px] text-ink-2">
                      {profile.notes.slice(0, 2).map((n) => (
                        <li key={n.id} className="line-clamp-3" dir="auto">
                          {n.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-ink-3">{t('crm.profile.unknown.body')}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" icon={<LuUserRound className="size-3.5" aria-hidden />} onClick={() => go('console.crm.player', { clubId: club.id, userId: person.id })}>
                {t('crm.action.profile')}
              </Button>
              {blocked?.by === 'club' ? (
                <Button size="sm" variant="ghost" onClick={() => act(() => messaging.unblockPlayer(db, me.id, club.id, person.id), { key: 'messages.unblocked' })}>
                  {t('crm.inbox.unblock')}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<LuBan className="size-3.5" aria-hidden />} onClick={() => act(() => messaging.blockPlayer(db, me.id, club.id, person.id), { key: 'messages.blocked' })} data-testid="inbox-block">
                  {t('crm.inbox.block')}
                </Button>
              )}
              {selected && (
                <Button size="sm" variant="ghost" icon={<LuFlag className="size-3.5" aria-hidden />} onClick={() => setReporting(true)}>
                  {t('messages.report')}
                </Button>
              )}
            </div>
            <p className="mt-3 text-[11.5px] leading-snug text-ink-3">{t('crm.inbox.privacy')}</p>
          </Panel>
        )}
      </div>

      <Dialog
        open={reporting}
        onClose={() => setReporting(false)}
        title={t('messages.report')}
        description={t('crm.inbox.report_hint')}
        size="sm"
        footer={
          <Button
            variant="danger"
            disabled={reason.trim().length < 5}
            onClick={() => {
              if (selected && act(() => messaging.reportConversation(db, me.id, selected.conversation.id, reason), { key: 'messages.reported' }) !== undefined) {
                setReporting(false);
                setReason('');
              }
            }}
          >
            {t('messages.report_send')}
          </Button>
        }
      >
        <TextArea value={reason} onChange={setReason} rows={3} placeholder={t('messages.report_placeholder')} />
      </Dialog>
    </div>
  );
}
