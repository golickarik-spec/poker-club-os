import { useState } from 'react';
import { LuArrowLeft, LuBan, LuCheck, LuHistory, LuLock, LuMail, LuPencil, LuPlus, LuShieldAlert, LuTicket, LuTrash2, LuUndo2, LuX } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { dateShort, dateTime, num, ordinal, relativeTime } from '../../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import { hasMessage } from '../../i18n/index.ts';
import * as api from '../../platform/api.ts';
import * as crm from '../../platform/crm.ts';
import * as ret from '../../platform/retention.ts';
import { WEEKDAYS } from '../../shared/weekdays.ts';
import { isUpcoming } from '../../platform/lifecycle.ts';
import { can } from '../../platform/permissions.ts';
import type { Club, CrmNote } from '../../platform/types.ts';
import { presetLabel } from '../../shared/tournament.tsx';
import { Badge, BotTag, Button, DemoTag, EmptyState, Fact, Notice, Panel, PanelHeader } from '../../ui/core.tsx';
import { Select, TextArea } from '../../ui/forms.tsx';
import { Avatar } from '../../ui/identity.tsx';
import { ConfirmDialog, Dialog } from '../../ui/overlay.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { dateOrDash, LifecycleBadge, StatusBadge, TagChip, useReport } from './shared.tsx';

export function PlayerProfile({ club, userId }: { club: Club; userId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [noteText, setNoteText] = useState('');
  const [editing, setEditing] = useState<CrmNote | null>(null);
  const [editText, setEditText] = useState('');
  const [historyOf, setHistoryOf] = useState<CrmNote | null>(null);
  const [confirm, setConfirm] = useState<'suspend' | 'ban' | null>(null);
  const [inviting, setInviting] = useState(false);
  const [timelineAll, setTimelineAll] = useState(false);
  const allow = (p: Parameters<typeof can>[2]) => can(db, me.id, p, club.id);

  const data = useReport(() => {
    try {
      return { profile: crm.playerProfile(db, me.id, club.id, userId), tags: crm.listTags(db, me.id, club.id), staff: crm.staffOf(db, me.id, club.id) };
    } catch (err) {
      if (err instanceof Error && err.name === 'DomainError') return null;
      throw err;
    }
  }, [club.id, me.id, userId]);

  const back = (
    <button type="button" onClick={() => go('console.crm.players', { clubId: club.id })} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
      <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
      {t('crm.players.title')}
    </button>
  );
  if (!data) {
    return (
      <>
        {back}
        <EmptyState title={t('crm.profile.unknown.title')} body={t('crm.profile.unknown.body')} />
      </>
    );
  }
  const { profile, tags, staff } = data;
  const { row, stats } = profile;
  const referrer = crm.referrerFor(db, club.id, userId);
  const prefs = ret.playerPreferences(db, me.id, club.id, userId);
  const myTags = row.tagIds.map((id) => tags.find((x) => x.id === id)).filter((x): x is (typeof tags)[number] => !!x);
  const otherTags = tags.filter((x) => !row.tagIds.includes(x.id));
  const timeline = timelineAll ? profile.timeline : profile.timeline.slice(0, 14);
  const invitable = Object.values(db.tournaments).filter((x) => x.clubId === club.id && (isUpcoming(x.status) || x.status === 'RUNNING') && x.access !== 'members' && !['registered', 'approved', 'waitlisted'].includes(api.registrationOf(x, userId)?.status ?? ''));
  const name = (id: string | null) => (id === null ? t('crm.timeline.system') : id === 'system' ? t('crm.timeline.system') : (db.users[id]?.name ?? '—'));
  const timelineText = (type: string, params: Record<string, string | number>): string => {
    const key = `crm.timeline.${type}`;
    const p = { ...params };
    for (const k of ['from', 'to'] as const) if (typeof p[k] === 'string' && hasMessage(`role.${p[k]}`)) p[k] = t(`role.${p[k]}`);
    if (typeof p.via === 'string' && hasMessage(`crm.via.${p.via}`)) p.via = t(`crm.via.${p.via}`);
    return hasMessage(key) ? t(key, p) : type;
  };

  return (
    <div data-testid="crm-profile">
      {back}
      <Panel className="flex flex-wrap items-start gap-4">
        <Avatar user={row} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] leading-tight font-semibold text-ink">
            <span data-testid="profile-name">{row.name}</span>
            {row.isBot && <BotTag label={t('common.bot')} />}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-3" dir="ltr">
            @{row.handle}
            {row.memberNo !== null ? ` · ${crm.memberId(club, row.memberNo)}` : ''}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5">
            <span data-testid="profile-status">
              <StatusBadge row={row} t={t} />
            </span>
            <span data-testid="profile-lifecycle">
              <LifecycleBadge stage={row.lifecycle} active={row.active} t={t} />
            </span>
            {row.following && <Badge tone="info">{t('crm.profile.follows')}</Badge>}
            {row.role && row.role !== 'player' && <Badge tone="accent">{t(`role.${row.role}`)}</Badge>}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-4">
            <Fact label={t('crm.col.joined')}>{dateOrDash(row.joinedAt, t)}</Fact>
            <Fact label={t('crm.col.last_active')}>{row.lastActiveAt === null ? '—' : relativeTime(row.lastActiveAt, now, t.lang)}</Fact>
            <Fact label={t('crm.profile.language')}>{t(`crm.language.${row.lang}`)}</Fact>
            <Fact label={t('crm.profile.source')}>{t(`crm.source.${row.source}`)}</Fact>
            {referrer && (
              <Fact label={t('crm.profile.referrer')}>
                <button type="button" className="text-accent hover:underline" onClick={() => go('console.crm.player', { clubId: club.id, userId: referrer.id })} data-testid="profile-referrer">
                  {referrer.name}
                </button>
              </Fact>
            )}
            <Fact label={t('crm.profile.contact')}>{profile.email ?? t('crm.profile.contact_private')}</Fact>
            <Fact label={t('crm.col.contacted')}>{row.lastContactedAt === null ? '—' : relativeTime(row.lastContactedAt, now, t.lang)}</Fact>
            <Fact label={t('crm.col.assigned')}>{row.assignedTo ? name(row.assignedTo) : '—'}</Fact>
            {profile.demoPoints !== null && <Fact label={t('crm.profile.demo_points')}>{profile.demoPoints.toLocaleString('en-US')}</Fact>}
          </dl>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:max-w-[320px] sm:justify-end">
          {allow('members.approve') && row.status === 'pending' && (
            <>
              <Button variant="primary" size="sm" icon={<LuCheck className="size-4" aria-hidden />} onClick={() => act(() => api.approveMember(db, me.id, club.id, userId), { key: 'members.approved', params: { user: row.name } })} data-testid="profile-approve">
                {t('members.approve')}
              </Button>
              <Button size="sm" variant="danger" icon={<LuX className="size-4" aria-hidden />} onClick={() => act(() => api.rejectMember(db, me.id, club.id, userId), { key: 'members.rejected', params: { user: row.name } })}>
                {t('members.reject')}
              </Button>
            </>
          )}
          {allow('crm.messages') && row.status !== 'banned' && (
            <Button size="sm" icon={<LuMail className="size-4" aria-hidden />} onClick={() => go('console.crm.inbox', { clubId: club.id, userId })} data-testid="profile-message">
              {t('crm.action.message')}
            </Button>
          )}
          {allow('tournaments.registrations') && row.status === 'active' && (
            <Button size="sm" icon={<LuTicket className="size-4" aria-hidden />} onClick={() => setInviting(true)} data-testid="profile-invite">
              {t('crm.action.invite')}
            </Button>
          )}
          {allow('members.suspend') && row.status === 'active' && row.userId !== me.id && row.role !== 'owner' && (
            <Button size="sm" variant="ghost" icon={<LuShieldAlert className="size-4" aria-hidden />} onClick={() => setConfirm('suspend')}>
              {t('members.suspend')}
            </Button>
          )}
          {allow('members.suspend') && row.status === 'suspended' && (
            <Button size="sm" icon={<LuUndo2 className="size-4" aria-hidden />} onClick={() => act(() => api.reinstateMember(db, me.id, club.id, userId), { key: 'members.reinstated', params: { user: row.name } })}>
              {t('members.reinstate')}
            </Button>
          )}
          {allow('members.suspend') && row.status !== 'banned' && row.userId !== me.id && row.role !== 'owner' && (
            <Button size="sm" variant="ghost" icon={<LuBan className="size-4" aria-hidden />} onClick={() => setConfirm('ban')} data-testid="profile-ban">
              {t('crm.action.ban')}
            </Button>
          )}
          {allow('members.suspend') && row.status === 'banned' && (
            <Button size="sm" icon={<LuUndo2 className="size-4" aria-hidden />} onClick={() => act(() => api.unbanMember(db, me.id, club.id, userId), { key: 'crm.toast.unbanned' })}>
              {t('crm.action.unban')}
            </Button>
          )}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title={t('crm.profile.stats')} hint={t('crm.profile.stats_hint')} />
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-6">
              <Fact label={t('crm.col.tournaments')}>
                <span data-testid="profile-tournaments">{stats.tournaments}</span>
              </Fact>
              <Fact label={t('crm.col.wins')}>{stats.wins}</Fact>
              <Fact label={t('crm.profile.final_tables')}>{stats.finalTables}</Fact>
              <Fact label={t('crm.profile.average_finish')}>{stats.averageFinish === null ? '—' : stats.averageFinish.toFixed(1)}</Fact>
              <Fact label={t('crm.profile.best')}>{stats.best ? <span dir="ltr">{`${stats.best.place} / ${stats.best.entrants}`}</span> : '—'}</Fact>
              <Fact label={t('crm.profile.last_played')}>{dateOrDash(stats.lastPlayedAt, t)}</Fact>
            </dl>
          </Panel>

          <Panel data-testid="profile-preferences">
            <PanelHeader title={t('retention.prefs.title')} hint={t('retention.prefs.hint')} />
            {prefs.tournaments === 0 ? (
              <p className="text-[13px] text-ink-3">{t('retention.prefs.none')}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-6">
                <Fact label={t('retention.prefs.family')}>{prefs.family ? `${t(`family.${prefs.family}`)} · ${Math.round(prefs.familyShare * 100)}%` : '—'}</Fact>
                <Fact label={t('retention.prefs.format')}>{prefs.preset ? t(`preset.${prefs.preset}`) : '—'}</Fact>
                <Fact label={t('retention.prefs.when')}>{prefs.weekday !== null && prefs.hour !== null ? `${WEEKDAYS[t.lang][prefs.weekday]} ${String(prefs.hour).padStart(2, '0')}:00` : '—'}</Fact>
                <Fact label={t('retention.prefs.entry')}>{prefs.avgEntryPoints === null ? '—' : num(prefs.avgEntryPoints)}</Fact>
                <Fact label={t('retention.prefs.league')}>{t(prefs.inLeague ? 'common.yes' : 'common.no')}</Fact>
                <Fact label={t('crm.profile.referrer')}>{prefs.referredBy?.name ?? '—'}</Fact>
              </dl>
            )}
          </Panel>

          <Panel pad={false}>
            <PanelHeader title={t('crm.profile.history')} hint={t('crm.profile.history_hint')} className="px-4 pt-4 sm:px-5" />
            {profile.history.length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-ink-3 sm:px-5">{t('crm.profile.no_history')}</p>
            ) : (
              <TableShell minWidth={520}>
                <thead>
                  <tr>
                    <Th>{t('crm.profile.date')}</Th>
                    <Th>{t('crm.profile.tournament')}</Th>
                    <Th>{t('crm.profile.format')}</Th>
                    <Th end>{t('crm.profile.finish')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {profile.history.slice(0, 30).map((p) => (
                    <tr key={p.tournamentId} className="border-t border-line">
                      <Td className="whitespace-nowrap text-ink-2 tabular-nums">{dateShort(p.at, t.lang)}</Td>
                      <Td>
                        <button type="button" className="text-start text-ink hover:underline" onClick={() => go('console.tournament', { clubId: club.id, id: p.tournamentId })}>
                          {p.name}
                        </button>
                        {p.seeded && <DemoTag label={t('common.demo')} className="ms-2" />}
                      </Td>
                      <Td className="text-ink-2">{presetLabel(t, p)}</Td>
                      <Td end className="whitespace-nowrap tabular-nums">
                        {p.place === null ? (
                          <Badge tone="success" dot pulse>
                            {t('crm.profile.playing')}
                          </Badge>
                        ) : (
                          <span>
                            <span className={p.place === 1 ? 'font-semibold text-gold' : 'text-ink'}>{ordinal(p.place, t.lang)}</span>
                            <span className="text-ink-3"> / {p.entrants}</span>
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={t('crm.profile.timeline')} hint={t('crm.profile.timeline_hint')} />
            {profile.timeline.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('crm.profile.no_timeline')}</p>
            ) : (
              <ol className="relative space-y-3 border-s border-line ps-4" data-testid="profile-timeline">
                {timeline.map((item) => (
                  <li key={item.id} className="relative" data-type={item.type}>
                    <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-line-strong ring-4 ring-surface" aria-hidden />
                    <p className="text-[13.5px] leading-snug text-ink">{timelineText(item.type, item.params)}</p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {dateTime(item.at, t.lang)}
                      {item.actorId && item.actorId !== userId ? ` · ${name(item.actorId)}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {profile.timeline.length > 14 && (
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => setTimelineAll(!timelineAll)}>
                {timelineAll ? t('crm.profile.timeline_less') : t('crm.profile.timeline_all', { n: profile.timeline.length })}
              </Button>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title={t('crm.col.tags')} />
            <div className="flex flex-wrap gap-1.5" data-testid="profile-tags">
              {myTags.length === 0 && <span className="text-[13px] text-ink-3">{t('crm.profile.no_tags')}</span>}
              {myTags.map((tag) => (
                <TagChip key={tag.id} tag={tag} removeLabel={t('crm.bulk.remove_tag')} onRemove={allow('crm.edit') ? () => act(() => crm.removeTag(db, me.id, club.id, [userId], tag.id)) : undefined} />
              ))}
            </div>
            {allow('crm.edit') && otherTags.length > 0 && (
              <Select
                value=""
                onChange={(id) => {
                  if (id) act(() => crm.addTag(db, me.id, club.id, [userId], id), { key: 'crm.toast.tag_added' });
                }}
                className="mt-3 h-9 text-[13px]"
                aria-label={t('crm.bulk.add_tag')}
                data-testid="profile-add-tag"
                options={[{ value: '', label: t('crm.profile.add_tag') }, ...otherTags.map((tag) => ({ value: tag.id, label: tag.name }))]}
              />
            )}
          </Panel>

          {allow('crm.edit') && (
            <Panel>
              <PanelHeader title={t('crm.col.assigned')} hint={t('crm.profile.assigned_hint')} />
              <Select
                value={row.assignedTo ?? 'none'}
                onChange={(id) => act(() => crm.assignStaff(db, me.id, club.id, [userId], id === 'none' ? null : id), { key: 'crm.toast.assigned' })}
                className="h-9 text-[13px]"
                aria-label={t('crm.col.assigned')}
                options={[{ value: 'none', label: t('crm.assigned.nobody') }, ...staff.map((s) => ({ value: s.userId, label: `${s.name} · ${t(`role.${s.role}`)}` }))]}
              />
            </Panel>
          )}

          <Panel>
            <PanelHeader
              title={
                <>
                  <LuLock className="size-4 text-ink-3" aria-hidden />
                  {t('crm.notes.title')}
                </>
              }
              hint={t('crm.notes.hint')}
            />
            {profile.notes === null ? (
              <Notice tone="neutral" icon={<LuLock />}>
                {t('crm.notes.no_access')}
              </Notice>
            ) : (
              <>
                <TextArea value={noteText} onChange={setNoteText} rows={3} placeholder={t('crm.notes.placeholder')} />
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-2"
                  icon={<LuPlus className="size-4" aria-hidden />}
                  disabled={noteText.trim().length < 2}
                  data-testid="note-add"
                  onClick={() => {
                    if (act(() => crm.addNote(db, me.id, club.id, userId, noteText), { key: 'crm.toast.note_added' }) !== undefined) setNoteText('');
                  }}
                >
                  {t('crm.notes.add')}
                </Button>
                <ul className="mt-4 space-y-3" data-testid="profile-notes">
                  {profile.notes.map((n) => (
                    <li key={n.id} className="rounded-inner border border-line bg-raised/40 px-3 py-2.5">
                      <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink" dir="auto">
                        {n.body}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3">
                        <span>
                          {name(n.authorId)} · {dateTime(n.createdAt, t.lang)}
                        </span>
                        {n.history.length > 0 && (
                          <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setHistoryOf(n)}>
                            <LuHistory className="size-3" aria-hidden />
                            {t('crm.notes.edited', { name: name(n.updatedBy), when: relativeTime(n.updatedAt, now, t.lang) })}
                          </button>
                        )}
                        <span className="ms-auto flex gap-1">
                          <button
                            type="button"
                            aria-label={t('common.edit')}
                            title={t('common.edit')}
                            className="rounded p-1 hover:bg-raised hover:text-ink"
                            onClick={() => {
                              setEditText(n.body);
                              setEditing(n);
                            }}
                          >
                            <LuPencil className="size-3.5" aria-hidden />
                          </button>
                          {(n.authorId === me.id || allow('crm.configure')) && (
                            <button type="button" aria-label={t('common.delete')} title={t('common.delete')} className="rounded p-1 hover:bg-raised hover:text-danger" onClick={() => act(() => crm.deleteNote(db, me.id, club.id, n.id), { key: 'crm.toast.note_deleted' })}>
                              <LuTrash2 className="size-3.5" aria-hidden />
                            </button>
                          )}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </aside>
      </div>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('crm.notes.edit')}
        description={t('crm.notes.edit_hint')}
        footer={
          <Button
            variant="primary"
            disabled={editText.trim().length < 2}
            onClick={() => {
              if (editing && act(() => crm.updateNote(db, me.id, club.id, editing.id, editText)) !== undefined) setEditing(null);
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <TextArea value={editText} onChange={setEditText} rows={5} />
      </Dialog>

      <Dialog open={historyOf !== null} onClose={() => setHistoryOf(null)} title={t('crm.notes.history')} size="md">
        <ol className="space-y-3">
          {historyOf?.history.map((h, i) => (
            <li key={i} className="rounded-inner border border-line px-3 py-2.5">
              <p className="text-[13.5px] whitespace-pre-wrap text-ink-2" dir="auto">
                {h.body}
              </p>
              <p className="mt-1 text-[11.5px] text-ink-3">
                {name(h.editorId)} · {dateTime(h.at, t.lang)}
              </p>
            </li>
          ))}
        </ol>
      </Dialog>

      <Dialog open={inviting} onClose={() => setInviting(false)} title={t('crm.action.invite')} description={t('crm.invite.hint', { name: row.name })} size="md">
        {invitable.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('crm.invite.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {invitable.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{x.name}</span>
                  <span className="block text-[12.5px] text-ink-3">{t(`tour.access_long.${x.access}`)}</span>
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`invite-${x.id}`}
                  onClick={() => {
                    if (act(() => api.authorizePlayer(db, me.id, x.id, userId), { key: 'crm.toast.invited', params: { name: row.name } }) !== undefined) setInviting(false);
                  }}
                >
                  {t('crm.invite.send')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === 'suspend') act(() => api.suspendMember(db, me.id, club.id, userId), { key: 'members.suspended', params: { user: row.name } });
          if (confirm === 'ban') act(() => api.banMember(db, me.id, club.id, userId), { key: 'crm.toast.banned' });
          setConfirm(null);
        }}
        title={confirm === 'ban' ? t('crm.ban.title', { name: row.name }) : t('members.suspend_title', { name: row.name })}
        body={confirm === 'ban' ? t('crm.ban.body') : t('members.suspend_body')}
        confirmLabel={confirm === 'ban' ? t('crm.action.ban') : t('members.suspend')}
        danger
      />
    </div>
  );
}
