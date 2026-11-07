import { useState } from 'react';
import { LuAlarmClock, LuBell, LuCheckCheck, LuMail, LuMegaphone, LuTicket, LuTrophy, LuUsers } from 'react-icons/lu';
import { act, session } from '../../app/context.ts';
import { dateTime, num, relativeTime } from '../../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import type { RouteName } from '../../app/session.ts';
import * as api from '../../platform/api.ts';
import { CHANNELS, channelSummary } from '../../platform/channels.ts';
import type { Club, Notification } from '../../platform/types.ts';
import { Badge, Button, cx, DemoTag, EmptyState, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Tabs } from '../../ui/overlay.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { useReport } from './shared.tsx';

const ICONS: Partial<Record<Notification['kind'], typeof LuBell>> = { membership: LuUsers, registration: LuTicket, tournament: LuTrophy, reminder: LuAlarmClock, message: LuMail, announcement: LuMegaphone };

/**
 * Notifications for club staff: what needs this person's attention in this
 * club, and a log of what the club has sent to its players.
 */
export function NotificationsCenter({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const [tab, setTab] = useState<'mine' | 'sent'>('mine');
  // A person's own notifications; the club filter keeps another club's out of this console.
  const mine = db.notifications.filter((n) => n.userId === me.id && (n.clubId === club.id || n.link?.params?.clubId === club.id)).sort((a, b) => b.at - a.at);
  const unread = mine.filter((n) => !n.read).length;
  const sent = useReport(() => api.clubDeliveryLog(db, me.id, club.id), [club.id, me.id]);
  const channels = useReport(() => channelSummary(db, club.id), [club.id, db.outbox.length, db.notifications.length]);
  const open = (n: Notification) => {
    act(() => api.markNotificationRead(db, me.id, n.id));
    if (n.link) session.navigate(n.link.name as RouteName, n.link.params ?? {});
  };

  return (
    <div data-testid="crm-notifications">
      <PageHeader
        title={t('crm.notifications.title')}
        subtitle={t('crm.notifications.subtitle')}
        actions={
          <>
            {unread > 0 && tab === 'mine' && (
              <Button icon={<LuCheckCheck className="size-4" aria-hidden />} onClick={() => act(() => mine.forEach((n) => api.markNotificationRead(db, me.id, n.id)))}>
                {t('notifications.mark_all')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => go('settings')}>
              {t('crm.notifications.preferences')}
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        label={t('crm.notifications.title')}
        tabs={[
          { value: 'mine', label: t('crm.notifications.tab.mine'), count: unread },
          { value: 'sent', label: t('crm.notifications.tab.sent') },
        ]}
      />

      {tab === 'mine' &&
        (mine.length === 0 ? (
          <EmptyState icon={<LuBell />} title={t('notifications.empty.title')} body={t('crm.notifications.empty')} className="mt-4" />
        ) : (
          <Panel pad={false} className="mt-4 max-w-[820px]">
            <ul className="divide-y divide-line">
              {mine.map((n) => {
                const Icon = ICONS[n.kind] ?? LuBell;
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => open(n)} className={cx('flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-raised/50 sm:px-5', !n.read && 'bg-accent/[0.05]')} data-testid={`staff-notification-${n.kind}`}>
                      <span className={cx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', n.read ? 'bg-raised text-ink-3' : 'bg-accent/15 text-accent')}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-[14px] leading-snug', n.read ? 'text-ink-2' : 'font-medium text-ink')}>{t(n.key, n.params)}</span>
                        <span className="mt-1 block text-[12px] text-ink-3">
                          {t(`crm.notifications.kind.${n.kind}`)} · {relativeTime(n.at, now, t.lang)}
                        </span>
                      </span>
                      {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label={t('notifications.new')} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}

      {tab === 'sent' && (
        <Panel className="mt-4" data-testid="channel-summary">
          <PanelHeader title={t('channels.title')} hint={t('channels.hint')} />
          <ul className="grid gap-2 sm:grid-cols-5">
            {CHANNELS.map((c) => {
              const row = channels[c];
              return (
                <li key={c} className="rounded-inner border border-line bg-raised/40 p-3">
                  <p className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    {t(`settings.channel.${c}`)}
                    {!row.real && <DemoTag label={t('channels.simulated')} />}
                  </p>
                  <p className="mt-1 text-[20px] leading-none font-semibold text-ink tabular-nums">{num(row.real ? row.delivered : row.simulated)}</p>
                  <p className="mt-1 text-[11.5px] text-ink-3">{row.real ? t('channels.delivered') : t('channels.not_sent')}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('channels.note')}</p>
        </Panel>
      )}
      {tab === 'sent' && (
        <Panel pad={false} className="mt-4">
          <PanelHeader title={t('crm.notifications.sent_title')} hint={t('crm.notifications.sent_hint')} className="px-4 pt-4 sm:px-5" />
          {sent.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-ink-3 sm:px-5">{t('crm.notifications.sent_empty')}</p>
          ) : (
            <TableShell minWidth={760}>
              <thead>
                <tr>
                  <Th>{t('crm.notifications.col.what')}</Th>
                  <Th>{t('crm.notifications.col.when')}</Th>
                  <Th end>{t('announcements.stat.recipients')}</Th>
                  <Th end>{t('announcements.stat.delivered')}</Th>
                  <Th end>{t('announcements.stat.opted_out')}</Th>
                  <Th end>{t('announcements.stat.read')}</Th>
                  <Th end>{t('announcements.stat.errors')}</Th>
                </tr>
              </thead>
              <tbody>
                {sent.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <Td className="max-w-[320px]">
                      <span className="flex items-center gap-2">
                        <Badge tone={row.kind === 'reminder' ? 'info' : row.kind === 'tournament' ? 'accent' : 'neutral'}>{t(`crm.notifications.batch.${row.kind}`)}</Badge>
                        <span className="truncate text-ink" dir="auto">
                          {row.subject}
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{dateTime(row.at, t.lang)}</Td>
                    <Td end className="tabular-nums">
                      {num(row.eligible)}
                    </Td>
                    <Td end className="tabular-nums">
                      {num(row.delivered)}
                    </Td>
                    <Td end className="tabular-nums">
                      {num(row.optedOut)}
                    </Td>
                    <Td end className="tabular-nums">
                      {num(row.read + row.simulatedRead)}
                    </Td>
                    <Td end className="tabular-nums">
                      {num(row.errors)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <p className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">
            <DemoTag label={t('announcements.simulated')} />
            {t('crm.notifications.simulated_note')}
          </p>
        </Panel>
      )}
    </div>
  );
}
