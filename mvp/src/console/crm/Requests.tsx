import { useState } from 'react';
import { LuCheck, LuCheckCheck, LuInbox, LuUndo2, LuX } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { relativeTime } from '../../app/format.ts';
import { useDb, useMe, useMediaQuery, useNow, useT } from '../../app/hooks.ts';
import * as api from '../../platform/api.ts';
import * as crm from '../../platform/crm.ts';
import type { PlayerRow } from '../../platform/crm.ts';
import { can } from '../../platform/permissions.ts';
import type { Club } from '../../platform/types.ts';
import { UsageMeters } from '../../shared/plans.tsx';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Tabs } from '../../ui/overlay.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { dateOrDash, PlayerCell, StatusBadge, useReport } from './shared.tsx';

type Tab = 'pending' | 'declined' | 'restricted';

/** The membership approval queue: who is waiting, who was declined, and who is suspended or banned. */
export function Requests({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>('pending');
  const phone = useMediaQuery('(max-width: 639px)');
  const canDecide = can(db, me.id, 'members.approve', club.id);
  const canSuspend = can(db, me.id, 'members.suspend', club.id);
  const data = useReport(
    () => ({
      pending: crm.queryPlayers(db, me.id, club.id, { statuses: ['pending'] }).rows.sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0)),
      declined: crm.queryPlayers(db, me.id, club.id, { statuses: ['rejected'], sort: 'joined' }).rows,
      restricted: crm.queryPlayers(db, me.id, club.id, { statuses: ['suspended', 'banned'] }).rows,
    }),
    [club.id, me.id],
  );
  const rows = data[tab];
  const approveAll = () =>
    act(
      () => {
        for (const r of data.pending) api.approveMember(db, me.id, club.id, r.userId);
      },
      { key: 'crm.toast.approved_all' },
    );

  const actions = (r: PlayerRow) =>
    tab === 'pending' && canDecide ? (
      <span className="flex gap-1.5 sm:justify-end">
        <Button size="sm" variant="primary" icon={<LuCheck className="size-3.5" aria-hidden />} onClick={() => act(() => api.approveMember(db, me.id, club.id, r.userId), { key: 'members.approved', params: { user: r.name } })} data-testid={`approve-${r.userId}`}>
          {t('members.approve')}
        </Button>
        <Button size="sm" variant="ghost" icon={<LuX className="size-3.5" aria-hidden />} onClick={() => act(() => api.rejectMember(db, me.id, club.id, r.userId), { key: 'members.rejected', params: { user: r.name } })} data-testid={`reject-${r.userId}`}>
          {t('members.reject')}
        </Button>
      </span>
    ) : tab === 'restricted' && canSuspend ? (
      <Button
        size="sm"
        icon={<LuUndo2 className="size-3.5" aria-hidden />}
        onClick={() => (r.status === 'banned' ? act(() => api.unbanMember(db, me.id, club.id, r.userId), { key: 'crm.toast.unbanned' }) : act(() => api.reinstateMember(db, me.id, club.id, r.userId), { key: 'members.reinstated', params: { user: r.name } }))}
      >
        {r.status === 'banned' ? t('crm.action.unban') : t('members.reinstate')}
      </Button>
    ) : null;

  return (
    <div data-testid="crm-requests">
      <PageHeader
        title={t('crm.requests.title')}
        subtitle={club.joinPolicy === 'open' ? t('crm.requests.subtitle_open') : t('crm.requests.subtitle')}
        actions={
          canDecide && data.pending.length > 1 ? (
            <Button icon={<LuCheckCheck className="size-4" aria-hidden />} onClick={approveAll} data-testid="approve-all">
              {t('crm.requests.approve_all', { n: data.pending.length })}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel pad={false}>
          <Tabs
            value={tab}
            onChange={setTab}
            label={t('crm.requests.title')}
            className="px-2 sm:px-3"
            tabs={[
              { value: 'pending', label: t('crm.requests.tab.pending'), count: data.pending.length },
              { value: 'declined', label: t('crm.requests.tab.declined'), count: data.declined.length },
              { value: 'restricted', label: t('crm.requests.tab.restricted'), count: data.restricted.length },
            ]}
          />
          {rows.length === 0 ? (
            <EmptyState icon={<LuInbox />} title={t(`crm.requests.empty.${tab}`)} className="m-4" />
          ) : phone ? (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.userId} className="space-y-2.5 px-3 py-3" data-testid={`request-${r.userId}`}>
                  <PlayerCell row={r} club={club} t={t} />
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
                    {tab === 'pending' ? (r.requestedAt ? relativeTime(r.requestedAt, now, t.lang) : '') : <StatusBadge row={r} t={t} />}
                    <span>· {t(`crm.source.${r.source}`)}</span>
                    {r.following && <Badge tone="info">{t('crm.profile.follows')}</Badge>}
                    {r.tournaments > 0 && <Badge>{t.n('crm.requests.played', r.tournaments)}</Badge>}
                  </p>
                  {actions(r)}
                </li>
              ))}
            </ul>
          ) : (
            <TableShell minWidth={720}>
              <thead>
                <tr>
                  <Th>{t('crm.col.player')}</Th>
                  <Th>{tab === 'pending' ? t('crm.requests.asked') : t('crm.col.status')}</Th>
                  <Th>{t('crm.profile.source')}</Th>
                  <Th>{t('crm.requests.relationship')}</Th>
                  <Th end>
                    <span className="sr-only">{t('crm.col.actions')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-t border-line" data-testid={`request-${r.userId}`}>
                    <Td className="max-w-[260px]">
                      <PlayerCell row={r} club={club} t={t} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{tab === 'pending' ? (r.requestedAt ? relativeTime(r.requestedAt, now, t.lang) : '—') : <StatusBadge row={r} t={t} />}</Td>
                    <Td className="text-ink-2">{t(`crm.source.${r.source}`)}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1.5">
                        {r.following && <Badge tone="info">{t('crm.profile.follows')}</Badge>}
                        {(() => {
                          const ref = crm.referrerFor(db, club.id, r.userId);
                          return ref ? (
                            <Badge tone="accent" className="max-w-[200px]" data-testid={`referred-by-${r.userId}`}>
                              <span className="truncate">{t('referral.referred_by', { name: ref.name })}</span>
                            </Badge>
                          ) : null;
                        })()}
                        {r.tournaments > 0 && <Badge>{t.n('crm.requests.played', r.tournaments)}</Badge>}
                        {tab !== 'pending' && r.joinedAt !== null && <Badge>{t('crm.requests.member_since', { date: dateOrDash(r.joinedAt, t) })}</Badge>}
                        {!r.following && r.tournaments === 0 && (tab === 'pending' || r.joinedAt === null) && <span className="text-ink-3">{t('crm.requests.new_contact')}</span>}
                      </span>
                    </Td>
                    <Td end>{actions(r)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>
        <aside className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title={t('crm.requests.capacity')} />
            <UsageMeters club={club} compact />
          </Panel>
          <Notice tone="neutral">{t('crm.requests.approval_note')}</Notice>
        </aside>
      </div>
    </div>
  );
}
