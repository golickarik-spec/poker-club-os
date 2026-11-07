/**
 * Multi-club overview (v0.4): one screen for a person who runs several clubs — what needs a
 * decision, what is live, what is next, and how each community is doing — with a jump into
 * each console. Only clubs where the person has console access appear.
 */
import type { ReactNode } from 'react';
import { LuArrowRight, LuBuilding2, LuMessagesSquare, LuMoonStar, LuRadio, LuUserPlus } from 'react-icons/lu';
import { num, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { inboxUnread } from '../platform/messaging.ts';
import { can, staffClubs } from '../platform/permissions.ts';
import * as ret from '../platform/retention.ts';
import { clubTournaments, memberCount, pendingMemberCount, scheduleOrder } from '../platform/selectors.ts';
import { Badge, Button, cx, EmptyState, PageHeader, Panel } from '../ui/core.tsx';
import { accentStyle, ClubCover, ClubLogo } from '../ui/identity.tsx';

export function StaffOverview() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const clubs = staffClubs(db, me.id).map((id) => db.clubs[id]!).filter(Boolean);
  if (clubs.length === 0) {
    return <EmptyState icon={<LuBuilding2 />} title={t('staff.none_title')} body={t('staff.none_body')} action={<Button variant="primary" onClick={() => go('club.new')}>{t('clubs.open_club')}</Button>} />;
  }
  const rows = clubs.map((club) => {
    const ts = clubTournaments(db, club.id).sort(scheduleOrder);
    const live = ts.filter((x) => isLive(x.status));
    const next = ts.find((x) => isUpcoming(x.status) && x.status !== 'DRAFT');
    const pulse = can(db, me.id, 'members.view', club.id) ? ret.clubPulse(db, me.id, club.id, now) : { active30: 0, weekEntries: 0, weekTournaments: 0, atRisk: 0 };
    return {
      club,
      members: memberCount(db, club.id),
      pending: can(db, me.id, 'members.view', club.id) ? pendingMemberCount(db, club.id) : 0,
      unread: can(db, me.id, 'crm.messages', club.id) ? inboxUnread(db, me.id, club.id) : 0,
      live,
      next,
      active: pulse.active30,
      atRisk: pulse.atRisk,
      weekEntries: pulse.weekEntries,
      weekTournaments: pulse.weekTournaments,
    };
  });
  const totals = rows.reduce((a, r) => ({ live: a.live + r.live.length, pending: a.pending + r.pending, unread: a.unread + r.unread, members: a.members + r.members }), { live: 0, pending: 0, unread: 0, members: 0 });
  return (
    <div data-testid="staff-overview">
      <PageHeader title={t('staff.title')} subtitle={t('staff.subtitle', { n: clubs.length })} actions={<Button onClick={() => go('club.new')}>{t('clubs.open_club')}</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={t('staff.total_members')} value={num(totals.members)} />
        <Tile label={t('staff.live_now')} value={String(totals.live)} tone={totals.live > 0 ? 'live' : undefined} />
        <Tile label={t('staff.pending')} value={String(totals.pending)} tone={totals.pending > 0 ? 'warn' : undefined} />
        <Tile label={t('staff.unread')} value={String(totals.unread)} tone={totals.unread > 0 ? 'warn' : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((r) => (
          <Panel key={r.club.id} pad={false} className="overflow-hidden" style={accentStyle(r.club.branding.accent)} data-testid={`staff-club-${r.club.id}`}>
            <ClubCover branding={r.club.branding} seed={Number(r.club.code)} className="h-14" />
            <div className="relative px-4 pb-4">
              <div className="flex items-end justify-between gap-3">
                <div className="-mt-6 flex items-end gap-3">
                  <ClubLogo branding={r.club.branding} name={r.club.name} size={44} className="ring-4 ring-surface" />
                  <div className="pb-0.5">
                    <p className="text-[15px] font-semibold text-ink">{r.club.name}</p>
                    <p className="text-[12px] text-ink-3">{t.n('clubs.members', r.members)} · {t('staff.active_30', { n: r.active })}</p>
                  </div>
                </div>
                <Button size="sm" variant="primary" className="mt-3" trailing={<LuArrowRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go('console.home', { clubId: r.club.id })} data-testid={`staff-open-${r.club.id}`}>
                  {t('nav.open_console')}
                </Button>
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
                <Stat icon={<LuUserPlus />} label={t('staff.pending')} value={r.pending} warn={r.pending > 0} onClick={() => go('console.crm.requests', { clubId: r.club.id })} />
                <Stat icon={<LuMessagesSquare />} label={t('staff.unread')} value={r.unread} warn={r.unread > 0} onClick={() => go('console.crm.inbox', { clubId: r.club.id })} />
                <Stat icon={<LuMoonStar />} label={t('staff.at_risk')} value={r.atRisk} onClick={() => go('console.crm', { clubId: r.club.id })} />
                <Stat icon={<LuRadio />} label={t('staff.week')} value={r.weekTournaments} hint={t('staff.week_entries', { n: r.weekEntries })} onClick={() => go('console.tournaments', { clubId: r.club.id })} />
              </ul>
              <div className="mt-3 space-y-1.5">
                {r.live.map((x) => (
                  <button key={x.id} type="button" onClick={() => go('console.tournament', { clubId: r.club.id, id: x.id })} className="flex w-full items-center gap-2 rounded-inner border border-success/30 bg-success/8 px-3 py-2 text-start text-[13px] hover:bg-success/12">
                    <Badge tone="success" dot pulse>
                      {t('status.RUNNING')}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-ink">{x.name}</span>
                    <span className="text-[12px] text-ink-3">{t.n('staff.players', x.registrations.filter((g) => g.status === 'registered').length)}</span>
                  </button>
                ))}
                {r.next && (
                  <button type="button" onClick={() => go('console.tournament', { clubId: r.club.id, id: r.next!.id })} className="flex w-full items-center gap-2 rounded-inner border border-line px-3 py-2 text-start text-[13px] hover:bg-raised/50">
                    <span className="text-[12px] text-ink-3">{t('staff.next')}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{r.next.name}</span>
                    <span className="text-[12px] text-ink-3">{r.next.startMode === 'scheduled' ? relativeTime(r.next.startAt, now, t.lang) : t(`wizard.start_mode.${r.next.startMode}`)}</span>
                  </button>
                )}
                {r.live.length === 0 && !r.next && <p className="text-[12.5px] text-ink-3">{t('staff.nothing_scheduled')}</p>}
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'live' | 'warn' }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <p className="text-[12.5px] text-ink-2">{label}</p>
      <p className={cx('mt-1 text-[26px] leading-none font-semibold tabular-nums', tone === 'live' ? 'text-success' : tone === 'warn' ? 'text-accent' : 'text-ink')}>{value}</p>
    </div>
  );
}

function Stat({ icon, label, value, hint, warn, onClick }: { icon: ReactNode; label: string; value: number; hint?: string; warn?: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-inner bg-raised/50 px-2.5 py-2 text-start hover:bg-raised">
        <span className={cx('[&>svg]:size-4', warn ? 'text-accent' : 'text-ink-3')}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink-3">{label}</span>
          {hint && <span className="block truncate text-[11px] text-ink-3">{hint}</span>}
        </span>
        <span className={cx('text-[15px] font-semibold tabular-nums', warn ? 'text-accent' : 'text-ink')}>{value}</span>
      </button>
    </li>
  );
}
