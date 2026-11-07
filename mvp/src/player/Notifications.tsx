import { LuAlarmClock, LuBell, LuCheckCheck, LuLifeBuoy, LuMail, LuMegaphone, LuServer, LuTicket, LuTrophy, LuUsers } from 'react-icons/lu';
import { act, session } from '../app/context.ts';
import { relativeTime } from '../app/format.ts';
import { useDb, useMe, useNow, useT } from '../app/hooks.ts';
import type { RouteName } from '../app/session.ts';
import * as api from '../platform/api.ts';
import type { Notification } from '../platform/types.ts';
import { Button, cx, EmptyState, PageHeader, Panel } from '../ui/core.tsx';

const ICONS: Record<Notification['kind'], typeof LuBell> = {
  membership: LuUsers,
  tournament: LuTrophy,
  registration: LuTicket,
  reminder: LuAlarmClock,
  message: LuMail,
  announcement: LuMegaphone,
  system: LuServer,
  result: LuTrophy,
  support: LuLifeBuoy,
};

export function Notifications() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const items = db.notifications.filter((n) => n.userId === me.id).sort((a, b) => b.at - a.at);
  const unread = items.filter((n) => !n.read).length;
  const open = (n: Notification) => {
    act(() => api.markNotificationRead(db, me.id, n.id));
    if (n.link) session.navigate(n.link.name as RouteName, n.link.params ?? {});
  };
  return (
    <div className="max-w-[760px]">
      <PageHeader
        title={t('notifications.title')}
        subtitle={unread > 0 ? t.n('notifications.unread', unread) : t('notifications.all_read')}
        actions={
          unread > 0 ? (
            <Button icon={<LuCheckCheck className="size-4" aria-hidden />} onClick={() => act(() => api.markAllNotificationsRead(db, me.id))} data-testid="mark-all-read">
              {t('notifications.mark_all')}
            </Button>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={<LuBell />} title={t('notifications.empty.title')} body={t('notifications.empty.body')} />
      ) : (
        <Panel pad={false}>
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const Icon = ICONS[n.kind];
              const body = t(`${n.key}.body`, n.params);
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} className={cx('flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-raised/50 sm:px-5', !n.read && 'bg-accent/[0.05]')}>
                    <span className={cx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', n.read ? 'bg-raised text-ink-3' : 'bg-accent/15 text-accent')}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-[14px] leading-snug', n.read ? 'text-ink-2' : 'font-medium text-ink')}>{t(n.key, n.params)}</span>
                      {body !== `${n.key}.body` && <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">{body}</span>}
                      <span className="mt-1 block text-[12px] text-ink-3">{relativeTime(n.at, now, t.lang)}</span>
                    </span>
                    {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label={t('notifications.new')} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
