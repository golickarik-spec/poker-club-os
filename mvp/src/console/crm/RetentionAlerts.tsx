/** Inactivity alerts (v0.4): 7 / 14 / 30 days without a tournament, each opening exactly its segment. */
import { LuMegaphone, LuMoonStar, LuUsers } from 'react-icons/lu';
import { go, useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import { can } from '../../platform/permissions.ts';
import * as ret from '../../platform/retention.ts';
import type { Club } from '../../platform/types.ts';
import { Button, cx, Panel, PanelHeader } from '../../ui/core.tsx';
import { useReport } from './shared.tsx';

const TONE: Record<ret.AlertBucket, string> = { 7: 'text-warning', 14: 'text-accent', 30: 'text-danger' };

export function RetentionAlerts({ club, className }: { club: Club; className?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const alerts = useReport(() => ret.inactivityAlerts(db, me.id, club.id, now), [club.id, me.id, Math.floor(now / 3_600_000)]);
  const announce = can(db, me.id, 'announcements.publish', club.id);
  return (
    <Panel className={className} data-testid="retention-alerts">
      <PanelHeader title={t('retention.alerts.title')} hint={t('retention.alerts.hint')} />
      <ul className="grid gap-3 md:grid-cols-3">
        {alerts.map((a) => (
          <li key={a.days} className="rounded-inner border border-line bg-raised/40 p-3" data-testid={`retention-alert-${a.days}`}>
            <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <LuMoonStar className={cx('size-4', TONE[a.days])} aria-hidden />
              {t(`retention.alerts.bucket_${a.days}`)}
            </p>
            <p className="mt-1 text-[26px] leading-none font-semibold text-ink tabular-nums" data-testid={`retention-count-${a.days}`}>
              {a.userIds.length}
            </p>
            <p className="mt-1 text-[12px] text-ink-3">{a.crossedToday.length > 0 ? t('retention.alerts.crossed_today', { n: a.crossedToday.length }) : t('retention.alerts.none_today')}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" icon={<LuUsers className="size-3.5" aria-hidden />} disabled={a.userIds.length === 0} onClick={() => go('console.crm.players', { clubId: club.id, ids: a.userIds.join(',') })} data-testid={`retention-open-${a.days}`}>
                {t('retention.alerts.open_people')}
              </Button>
              {announce && a.segmentId && (
                <Button size="sm" variant="ghost" icon={<LuMegaphone className="size-3.5" aria-hidden />} disabled={a.userIds.length === 0} onClick={() => go('console.announcements', { clubId: club.id, segmentId: a.segmentId! })}>
                  {t('retention.alerts.message_segment')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
