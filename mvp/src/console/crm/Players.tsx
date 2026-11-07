import { useEffect, useMemo, useState } from 'react';
import { LuDownload, LuEllipsis, LuListFilter, LuMail, LuMegaphone, LuSave, LuSearch, LuStickyNote, LuTag, LuUserCheck, LuUserRound, LuUserX, LuX } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { relativeTime } from '../../app/format.ts';
import { go, useDb, useMe, useMediaQuery, useNow, useT, type T } from '../../app/hooks.ts';
import * as api from '../../platform/api.ts';
import * as crm from '../../platform/crm.ts';
import type { PlayerQuery, PlayerRow, PlayerSort } from '../../platform/crm.ts';
import { can } from '../../platform/permissions.ts';
import { LIFECYCLE_STAGES, type Club, type CrmTag, type LifecycleStage, type MemberStatus } from '../../platform/types.ts';
import { Badge, Button, cx, EmptyState, Notice, PageHeader, Panel } from '../../ui/core.tsx';
import { Checkbox, Field, Select, TextArea, TextInput } from '../../ui/forms.tsx';
import { Dialog, Menu, MenuItem } from '../../ui/overlay.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { dateOrDash, LifecycleBadge, PlayerCell, StatusBadge, TagChip, TagList, Toolbar, useReport } from './shared.tsx';

const PAGE = 25;

type Activity = 'any' | 'active' | 'new14' | 'active30' | 'idle30' | 'idle60';
type Played = 'any' | '0' | '1' | '2' | '5' | '10';

interface Filters {
  search: string;
  status: MemberStatus | 'none' | 'all';
  tagId: string;
  lifecycle: LifecycleStage | 'all';
  assigned: string;
  activity: Activity;
  played: Played;
  segmentId: string;
  sort: PlayerSort;
}

const EMPTY: Filters = { search: '', status: 'all', tagId: '', lifecycle: 'all', assigned: '', activity: 'any', played: 'any', segmentId: '', sort: 'most_active' };

function toQuery(f: Filters, userIds: string[] | null): PlayerQuery {
  const q: PlayerQuery = { search: f.search, sort: f.sort };
  if (f.status !== 'all') q.statuses = [f.status];
  if (f.tagId) q.tagIds = [f.tagId];
  if (f.lifecycle !== 'all') q.lifecycle = [f.lifecycle];
  if (f.assigned) q.assignedTo = f.assigned;
  if (f.activity === 'active') q.active = true;
  if (f.activity === 'new14') q.joinedWithinDays = 14;
  if (f.activity === 'active30') q.activeWithinDays = 30;
  if (f.activity === 'idle30') q.inactiveForDays = 30;
  if (f.activity === 'idle60') q.inactiveForDays = 60;
  if (f.played === '0') q.maxTournaments = 0;
  else if (f.played === '1') (q.minTournaments = 1), (q.maxTournaments = 1);
  else if (f.played !== 'any') q.minTournaments = Number(f.played);
  if (f.segmentId) q.segmentId = f.segmentId;
  if (userIds) q.userIds = userIds;
  return q;
}

/** Bulk actions for a set of players. Also used by the funnel drill-down, so a report and the database act on people the same way. */
export function BulkActions({ club, userIds, tags, t, onDone, suggestedName }: { club: Club; userIds: string[]; tags: CrmTag[]; t: T; onDone?: () => void; suggestedName?: string }) {
  const db = useDb();
  const me = useMe()!;
  const [dialog, setDialog] = useState<'tag' | 'untag' | 'assign' | 'segment' | 'export' | null>(null);
  const [tagId, setTagId] = useState('');
  const [staffId, setStaffId] = useState('none');
  const [name, setName] = useState(suggestedName ?? '');
  const [csv, setCsv] = useState('');
  const allow = (p: Parameters<typeof can>[2]) => can(db, me.id, p, club.id);
  const staff = dialog === 'assign' ? crm.staffOf(db, me.id, club.id) : [];
  const n = userIds.length;
  const close = () => setDialog(null);
  useEffect(() => {
    if (dialog === 'segment') setName(suggestedName ?? '');
  }, [dialog, suggestedName]);

  const announce = () => {
    // The announcement goes to exactly these people: they are saved as a list first.
    const label = `${suggestedName ?? t('crm.bulk.selection')} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const segment = act(() => crm.createStaticSegment(db, me.id, club.id, label.slice(0, 48), userIds));
    if (segment) go('console.announcements', { clubId: club.id, segmentId: segment.id });
  };

  return (
    <>
      <Toolbar>
        {allow('crm.edit') && (
          <>
            <Button size="sm" icon={<LuTag className="size-3.5" aria-hidden />} onClick={() => setDialog('tag')} disabled={n === 0} data-testid="bulk-tag">
              {t('crm.bulk.add_tag')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog('untag')} disabled={n === 0}>
              {t('crm.bulk.remove_tag')}
            </Button>
            <Button size="sm" icon={<LuUserRound className="size-3.5" aria-hidden />} onClick={() => setDialog('assign')} disabled={n === 0} data-testid="bulk-assign">
              {t('crm.bulk.assign')}
            </Button>
          </>
        )}
        {allow('crm.configure') && (
          <Button size="sm" icon={<LuSave className="size-3.5" aria-hidden />} onClick={() => setDialog('segment')} disabled={n === 0} data-testid="bulk-segment">
            {t('crm.bulk.save_segment')}
          </Button>
        )}
        {allow('crm.configure') && allow('announcements.publish') && (
          <Button size="sm" icon={<LuMegaphone className="size-3.5" aria-hidden />} onClick={announce} disabled={n === 0} data-testid="bulk-announce">
            {t('crm.bulk.announce')}
          </Button>
        )}
        {allow('crm.export') && (
          <Button
            size="sm"
            icon={<LuDownload className="size-3.5" aria-hidden />}
            disabled={n === 0}
            data-testid="bulk-export"
            onClick={() => {
              const out = act(() => crm.exportPlayers(db, me.id, club.id, userIds));
              if (out) {
                setCsv(out.csv);
                setDialog('export');
              }
            }}
          >
            {t('crm.bulk.export')}
          </Button>
        )}
      </Toolbar>

      <Dialog
        open={dialog === 'tag' || dialog === 'untag'}
        onClose={close}
        title={dialog === 'untag' ? t('crm.bulk.remove_tag') : t('crm.bulk.add_tag')}
        description={t.n('crm.bulk.players', n)}
        size="sm"
        footer={
          <Button
            variant="primary"
            disabled={!tagId}
            data-testid="bulk-tag-confirm"
            onClick={() => {
              const done = act(() => (dialog === 'untag' ? crm.removeTag(db, me.id, club.id, userIds, tagId) : crm.addTag(db, me.id, club.id, userIds, tagId)), { key: dialog === 'untag' ? 'crm.toast.tag_removed' : 'crm.toast.tag_added' });
              if (done !== undefined) {
                close();
                onDone?.();
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button key={tag.id} type="button" onClick={() => setTagId(tag.id)} aria-pressed={tagId === tag.id} className={cx('rounded-full p-0.5', tagId === tag.id ? 'ring-2 ring-accent' : 'opacity-80 hover:opacity-100')} data-testid={`pick-tag-${tag.name}`}>
              <TagChip tag={tag} />
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'assign'}
        onClose={close}
        title={t('crm.bulk.assign')}
        description={t.n('crm.bulk.players', n)}
        size="sm"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              if (act(() => crm.assignStaff(db, me.id, club.id, userIds, staffId === 'none' ? null : staffId), { key: 'crm.toast.assigned' }) !== undefined) {
                close();
                onDone?.();
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        }
      >
        <Select value={staffId} onChange={setStaffId} aria-label={t('crm.col.assigned')} options={[{ value: 'none', label: t('crm.assigned.nobody') }, ...staff.map((s) => ({ value: s.userId, label: `${s.name} · ${t(`role.${s.role}`)}` }))]} />
      </Dialog>

      <Dialog
        open={dialog === 'segment'}
        onClose={close}
        title={t('crm.bulk.save_segment')}
        description={t('crm.bulk.save_segment_hint', { n })}
        size="sm"
        footer={
          <Button
            variant="primary"
            disabled={name.trim().length < 2}
            data-testid="bulk-segment-confirm"
            onClick={() => {
              if (act(() => crm.createStaticSegment(db, me.id, club.id, name, userIds), { key: 'crm.toast.segment_saved' }) !== undefined) {
                close();
                onDone?.();
              }
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <Field label={t('crm.segment.name')} htmlFor="bulk-segment-name">
          <TextInput id="bulk-segment-name" value={name} onChange={setName} data-autofocus />
        </Field>
      </Dialog>

      <Dialog open={dialog === 'export'} onClose={close} title={t('crm.export.title')} description={t('crm.export.hint')} size="lg">
        <TextArea value={csv} onChange={() => undefined} rows={10} className="font-mono text-[12px] leading-snug" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-[52ch] text-[12px] leading-snug text-ink-3">{t('crm.export.note')}</p>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(csv);
            }}
          >
            {t('crm.export.copy')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function Players({ club, segmentParam, idsParam }: { club: Club; segmentParam?: string; idsParam?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY, segmentId: segmentParam ?? '' });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteFor, setNoteFor] = useState<PlayerRow | null>(null);
  const [note, setNote] = useState('');
  // A phone gets a list of cards and keeps the filters folded away until asked for.
  const phone = useMediaQuery('(max-width: 639px)');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };
  const fixedIds = useMemo(() => (idsParam ? idsParam.split(',').filter(Boolean) : null), [idsParam]);
  const allow = (p: Parameters<typeof can>[2]) => can(db, me.id, p, club.id);

  const data = useReport(
    () => ({ result: crm.queryPlayers(db, me.id, club.id, toQuery(filters, fixedIds)), tags: crm.listTags(db, me.id, club.id), segments: crm.listSegments(db, me.id, club.id), staff: crm.staffOf(db, me.id, club.id) }),
    [club.id, me.id, filters, idsParam],
  );
  const { rows, total } = data.result;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const selectedIds = rows.filter((r) => selected.has(r.userId)).map((r) => r.userId);
  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.userId));
  const filtered = JSON.stringify({ ...filters, sort: '' }) !== JSON.stringify({ ...EMPTY, sort: '' }) || fixedIds !== null;
  const staffName = (id: string | null) => (id ? (data.staff.find((s) => s.userId === id)?.name ?? db.users[id]?.name ?? '—') : '—');
  const activeFilters = (Object.keys(EMPTY) as (keyof Filters)[]).filter((k) => k !== 'sort' && k !== 'search' && filters[k] !== EMPTY[k]).length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div data-testid="crm-players">
      <PageHeader title={t('crm.players.title')} subtitle={t('crm.players.subtitle', { total })} />

      <Panel pad={false}>
        <div className="space-y-2.5 border-b border-line p-3 sm:p-4">
          <Toolbar>
            <div className="relative min-w-[200px] flex-1">
              <LuSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <TextInput type="search" value={filters.search} onChange={(search) => set({ search })} placeholder={t('crm.players.search')} className="h-9 ps-9" aria-label={t('crm.players.search')} data-testid="player-search" />
            </div>
            <Select value={filters.sort} onChange={(sort) => set({ sort })} className="h-9 w-auto text-[13px]" aria-label={t('crm.sort.label')} data-testid="player-sort" options={(['most_active', 'least_active', 'joined', 'tournaments', 'wins', 'contacted', 'name'] as PlayerSort[]).map((s) => ({ value: s, label: t(`crm.sort.${s}`) }))} />
            {phone && (
              <Button size="sm" icon={<LuListFilter className="size-3.5" aria-hidden />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} data-testid="filters-toggle">
                {t('crm.filter.toggle')}
                {activeFilters > 0 && <span className="ms-1 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink tabular-nums">{activeFilters}</span>}
              </Button>
            )}
          </Toolbar>
          <Toolbar className={cx(phone && !filtersOpen && 'hidden', phone && '[&>*]:w-full')}>
            <Select
              value={filters.status}
              onChange={(status) => set({ status })}
              className="h-9 w-auto text-[13px]"
              aria-label={t('crm.col.status')}
              data-testid="filter-status"
              options={[{ value: 'all', label: t('crm.filter.any_status') }, ...(['active', 'pending', 'none', 'suspended', 'rejected', 'banned'] as const).map((s) => ({ value: s, label: t(`crm.status.${s === 'none' ? 'not_member' : s}`) }))]}
            />
            <Select value={filters.lifecycle} onChange={(lifecycle) => set({ lifecycle })} className="h-9 w-auto text-[13px]" aria-label={t('crm.col.lifecycle')} data-testid="filter-lifecycle" options={[{ value: 'all', label: t('crm.filter.any_lifecycle') }, ...LIFECYCLE_STAGES.map((s) => ({ value: s, label: t(`crm.lifecycle.${s}`) }))]} />
            <Select value={filters.tagId} onChange={(tagId) => set({ tagId })} className="h-9 w-auto text-[13px]" aria-label={t('crm.col.tags')} data-testid="filter-tag" options={[{ value: '', label: t('crm.filter.any_tag') }, ...data.tags.map((tag) => ({ value: tag.id, label: tag.name }))]} />
            <Select
              value={filters.activity}
              onChange={(activity) => set({ activity })}
              className="h-9 w-auto text-[13px]"
              aria-label={t('crm.filter.activity')}
              options={(['any', 'active', 'new14', 'active30', 'idle30', 'idle60'] as Activity[]).map((a) => ({ value: a, label: t(`crm.filter.activity.${a}`) }))}
            />
            <Select value={filters.played} onChange={(played) => set({ played })} className="h-9 w-auto text-[13px]" aria-label={t('crm.col.tournaments')} options={(['any', '0', '1', '2', '5', '10'] as Played[]).map((p) => ({ value: p, label: t(`crm.filter.played.${p}`) }))} />
            <Select value={filters.assigned} onChange={(assigned) => set({ assigned })} className="h-9 w-auto text-[13px]" aria-label={t('crm.col.assigned')} options={[{ value: '', label: t('crm.filter.any_staff') }, { value: 'none', label: t('crm.assigned.nobody') }, ...data.staff.map((s) => ({ value: s.userId, label: s.name }))]} />
            <Select value={filters.segmentId} onChange={(segmentId) => set({ segmentId })} className="h-9 w-auto text-[13px]" aria-label={t('crm.filter.segment')} data-testid="filter-segment" options={[{ value: '', label: t('crm.filter.any_segment') }, ...data.segments.map((s) => ({ value: s.id, label: s.system ? t(`crm.segment.system.${s.system}`) : s.name }))]} />
            {filtered && (
              <Button
                size="sm"
                variant="ghost"
                icon={<LuX className="size-3.5" aria-hidden />}
                onClick={() => {
                  setFilters(EMPTY);
                  setPage(0);
                  if (fixedIds) go('console.crm.players', { clubId: club.id });
                }}
              >
                {t('crm.filter.clear')}
              </Button>
            )}
          </Toolbar>
          {fixedIds && <Notice tone="info">{t.n('crm.players.from_report', fixedIds.length)}</Notice>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-ink-2 tabular-nums" data-testid="player-count">
              {selectedIds.length > 0 ? t('crm.players.selected', { n: selectedIds.length, of: rows.length }) : t.n('crm.players.count', rows.length)}
            </p>
            {(!phone || selectedIds.length > 0 || filtered) && <BulkActions club={club} userIds={selectedIds.length > 0 ? selectedIds : filtered ? rows.map((r) => r.userId) : []} tags={data.tags} t={t} onDone={() => setSelected(new Set())} />}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState title={t('crm.players.empty.title')} body={t('crm.players.empty.body')} className="m-4" />
        ) : phone ? (
          <ul className="divide-y divide-line" data-testid="player-cards">
            {shown.map((r) => (
              <li key={r.userId} className={cx('flex items-start gap-3 px-3 py-3', selected.has(r.userId) && 'bg-accent/[0.06]')} data-testid={`row-${r.userId}`}>
                <span className="pt-1.5">
                  <Checkbox checked={selected.has(r.userId)} onChange={() => toggle(r.userId)} label={<span className="sr-only">{r.name}</span>} />
                </span>
                <div className="min-w-0 flex-1">
                  <PlayerCell row={r} club={club} t={t} />
                  <p className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusBadge row={r} t={t} />
                    <LifecycleBadge stage={r.lifecycle} active={r.active} t={t} />
                  </p>
                  <p className="mt-1.5 text-[12.5px] text-ink-2 tabular-nums">
                    {t('crm.col.tournaments')} {r.tournaments} · {t('crm.col.wins')} {r.wins}
                    {r.lastActiveAt !== null ? ` · ${relativeTime(r.lastActiveAt, now, t.lang)}` : ''}
                  </p>
                  {r.tagIds.length > 0 && (
                    <div className="mt-1.5">
                      <TagList ids={r.tagIds} tags={data.tags} max={3} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <TableShell minWidth={1080}>
            <thead>
              <tr>
                <Th className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onChange={(v) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const r of shown) {
                          if (v) next.add(r.userId);
                          else next.delete(r.userId);
                        }
                        return next;
                      })
                    }
                    label={<span className="sr-only">{t('crm.players.select_page')}</span>}
                  />
                </Th>
                <Th>{t('crm.col.player')}</Th>
                <Th>{t('crm.col.status')}</Th>
                <Th>{t('crm.col.lifecycle')}</Th>
                <Th>{t('crm.col.joined')}</Th>
                <Th>{t('crm.col.last_active')}</Th>
                <Th end>{t('crm.col.tournaments')}</Th>
                <Th end>{t('crm.col.wins')}</Th>
                <Th>{t('crm.col.tags')}</Th>
                <Th>{t('crm.col.assigned')}</Th>
                <Th>{t('crm.col.contacted')}</Th>
                <Th end>
                  <span className="sr-only">{t('crm.col.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.userId} className={cx('border-t border-line', selected.has(r.userId) && 'bg-accent/[0.06]')} data-testid={`row-${r.userId}`}>
                  <Td>
                    <Checkbox checked={selected.has(r.userId)} onChange={() => toggle(r.userId)} label={<span className="sr-only">{r.name}</span>} />
                  </Td>
                  <Td className="max-w-[240px]">
                    <PlayerCell row={r} club={club} t={t} />
                  </Td>
                  <Td>
                    <StatusBadge row={r} t={t} />
                  </Td>
                  <Td>
                    <LifecycleBadge stage={r.lifecycle} active={r.active} t={t} />
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2 tabular-nums">{dateOrDash(r.joinedAt, t)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{r.lastActiveAt === null ? '—' : relativeTime(r.lastActiveAt, now, t.lang)}</Td>
                  <Td end className="tabular-nums">
                    {r.tournaments}
                  </Td>
                  <Td end className="tabular-nums">
                    {r.wins}
                  </Td>
                  <Td className="max-w-[220px]">
                    <TagList ids={r.tagIds} tags={data.tags} max={2} />
                  </Td>
                  <Td className="max-w-[130px] truncate text-ink-2">{staffName(r.assignedTo)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{r.lastContactedAt === null ? '—' : relativeTime(r.lastContactedAt, now, t.lang)}</Td>
                  <Td end>
                    <Menu
                      trigger={(p) => (
                        <button type="button" {...p} aria-label={t('crm.col.actions')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink" data-testid={`row-menu-${r.userId}`}>
                          <LuEllipsis className="size-4" aria-hidden />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem
                            icon={<LuUserRound />}
                            onClick={() => {
                              close();
                              go('console.crm.player', { clubId: club.id, userId: r.userId });
                            }}
                          >
                            {t('crm.action.profile')}
                          </MenuItem>
                          {allow('crm.notes') && (
                            <MenuItem
                              icon={<LuStickyNote />}
                              onClick={() => {
                                close();
                                setNote('');
                                setNoteFor(r);
                              }}
                            >
                              {t('crm.action.note')}
                            </MenuItem>
                          )}
                          {allow('crm.messages') && r.status !== 'banned' && (
                            <MenuItem
                              icon={<LuMail />}
                              onClick={() => {
                                close();
                                go('console.crm.inbox', { clubId: club.id, userId: r.userId });
                              }}
                            >
                              {t('crm.action.message')}
                            </MenuItem>
                          )}
                          {allow('members.approve') && r.status === 'pending' && (
                            <>
                              <MenuItem
                                icon={<LuUserCheck />}
                                onClick={() => {
                                  close();
                                  act(() => api.approveMember(db, me.id, club.id, r.userId), { key: 'members.approved', params: { user: r.name } });
                                }}
                              >
                                {t('members.approve')}
                              </MenuItem>
                              <MenuItem
                                icon={<LuUserX />}
                                tone="danger"
                                onClick={() => {
                                  close();
                                  act(() => api.rejectMember(db, me.id, club.id, r.userId), { key: 'members.rejected', params: { user: r.name } });
                                }}
                              >
                                {t('members.reject')}
                              </MenuItem>
                            </>
                          )}
                        </>
                      )}
                    </Menu>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-2">
            <span className="tabular-nums" dir="ltr">
              {page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} / {rows.length}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t('crm.page.previous')}
              </Button>
              <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} data-testid="page-next">
                {t('crm.page.next')}
              </Button>
            </span>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-[12px] text-ink-3">
        <Badge className="me-1.5">{t('common.bot')}</Badge>
        {t('crm.players.bots_note')}
      </p>

      <Dialog
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        title={t('crm.action.note')}
        description={noteFor ? t('crm.notes.private_hint', { name: noteFor.name }) : undefined}
        size="md"
        footer={
          <Button
            variant="primary"
            disabled={note.trim().length < 2}
            onClick={() => {
              if (noteFor && act(() => crm.addNote(db, me.id, club.id, noteFor.userId, note), { key: 'crm.toast.note_added' }) !== undefined) setNoteFor(null);
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <TextArea value={note} onChange={setNote} rows={4} placeholder={t('crm.notes.placeholder')} />
      </Dialog>
    </div>
  );
}
