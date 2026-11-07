import { useMemo, type ReactNode } from 'react';
import { LuArmchair, LuCalendarClock, LuChevronRight, LuMegaphone, LuPlay, LuUsers } from 'react-icons/lu';
import { runtime } from '../app/context.ts';
import { blindsLabel, chips, ordinal, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useRuntime, useT } from '../app/hooks.ts';
import { currentBlinds, currentLevelNumber, remainingPlayers, standings } from '../engine/tournament.ts';
import { registrationOf } from '../platform/api.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { clubAnnouncements, feedClubIds, memberCount, playerStats, tournamentsForUser, userClubs } from '../platform/selectors.ts';
import type { DB, Tournament } from '../platform/types.ts';
import { TournamentCard } from '../shared/tournament.tsx';
import { Badge, Button, DemoTag, EmptyState, Panel, PanelHeader } from '../ui/core.tsx';
import { accentStyle, ClubLogo, ClubName } from '../ui/identity.tsx';

function greetingKey(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? 'home.greeting.night' : h < 12 ? 'home.greeting.morning' : h < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening';
}

/** Where the player is seated right now, if anywhere. */
function ActiveSeat({ db, tournament, userId }: { db: DB; tournament: Tournament; userId: string }) {
  const t = useT();
  const club = db.clubs[tournament.clubId]!;
  const info = useRuntime(() => {
    const live = runtime.getLive(tournament.id);
    const me = live?.players[userId];
    if (!live || !me || me.status !== 'active') return null;
    const rank = standings(live).find((s) => s.playerId === userId);
    const blinds = currentBlinds(live);
    return { level: currentLevelNumber(live), blinds: blindsLabel(blinds), rank: rank?.rank ?? 0, left: remainingPlayers(live), stack: rank?.stack ?? 0, table: me.tableNo ?? 0, away: me.away };
  });
  if (!info) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-panel border border-accent/35 bg-accent/8 p-4" style={accentStyle(club.branding.accent)} data-testid="active-seat">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <LuArmchair className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-ink-2">
          {info.away ? t('home.seat.away') : t('home.seat.playing')} · {club.name}
        </p>
        <p className="truncate text-[16px] font-semibold text-ink">{tournament.name}</p>
        <p className="mt-0.5 text-[13px] text-ink-2 tabular-nums">
          {t('table.table_n', { n: info.table })} · {t('tour.level_n', { n: info.level })} <span dir="ltr">{info.blinds}</span> · <span dir="ltr">{ordinal(info.rank, t.lang)} / {info.left}</span> · {chips(info.stack)}
        </p>
      </div>
      <Button variant="primary" icon={<LuPlay className="size-4" aria-hidden />} onClick={() => go('table', { id: tournament.id })} data-testid="return-to-table">
        {t('home.seat.return')}
      </Button>
    </div>
  );
}

export function Home() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const all = useMemo(() => tournamentsForUser(db, me.id), [db, me.id]);
  const seatedIn = useRuntime(() => all.filter((x) => isLive(x.status) && runtime.getLive(x.id)?.players[me.id]?.status === 'active').map((x) => x.id).join(','));
  const seated = all.filter((x) => seatedIn.split(',').includes(x.id));
  const registered = all.filter((x) => isUpcoming(x.status) && ['registered', 'requested', 'waitlisted', 'approved'].includes(registrationOf(x, me.id)?.status ?? ''));
  const running = all.filter((x) => isLive(x.status) && !seated.includes(x));
  const quick = all.filter((x) => x.status === 'REGISTRATION_OPEN' && x.startMode === 'when_full' && !registered.includes(x));
  const upcoming = all.filter((x) => isUpcoming(x.status) && !registered.includes(x) && !quick.includes(x)).slice(0, 5);
  const clubs = userClubs(db, me.id);
  const announcements = clubAnnouncements(db, me.id, feedClubIds(db, me.id)).slice(0, 3);
  const stats = playerStats(db, me.id);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <header>
          <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-ink sm:text-[28px]">{t(greetingKey(now), { name: me.name.split(' ')[0]! })}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {running.length + seated.length > 0 ? t.n('home.sub.running', running.length + seated.length) : t('home.sub.quiet')} {t.n('home.sub.upcoming', registered.length + upcoming.length)}
          </p>
        </header>

        {seated.map((x) => (
          <ActiveSeat key={x.id} db={db} tournament={x} userId={me.id} />
        ))}

        {clubs.length === 0 && (
          <EmptyState
            icon={<LuUsers />}
            title={t('home.no_clubs.title')}
            body={t('home.no_clubs.body')}
            action={
              <Button variant="primary" onClick={() => go('clubs')}>
                {t('clubs.join')}
              </Button>
            }
          />
        )}

        {registered.length > 0 && (
          <section aria-labelledby="home-registered">
            <SectionTitle id="home-registered" title={t('home.registered')} />
            <div className="space-y-2.5">
              {registered.map((x) => (
                <TournamentCard key={x.id} db={db} tournament={x} userId={me.id} />
              ))}
            </div>
          </section>
        )}

        {quick.length > 0 && (
          <section aria-labelledby="home-quick">
            <SectionTitle id="home-quick" title={t('home.quick')} />
            <div className="space-y-2.5">
              {quick.map((x) => (
                <TournamentCard key={x.id} db={db} tournament={x} userId={me.id} />
              ))}
            </div>
          </section>
        )}

        {running.length > 0 && (
          <section aria-labelledby="home-running">
            <SectionTitle id="home-running" title={t('home.running')} />
            <div className="space-y-2.5">
              {running.map((x) => (
                <TournamentCard key={x.id} db={db} tournament={x} userId={me.id} />
              ))}
            </div>
          </section>
        )}

        {clubs.length > 0 && (
          <section aria-labelledby="home-upcoming">
            <SectionTitle
              id="home-upcoming"
              title={t('home.upcoming')}
              action={
                <Button size="sm" variant="ghost" trailing={<LuChevronRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go('tournaments')}>
                  {t('home.all_tournaments')}
                </Button>
              }
            />
            {upcoming.length === 0 ? (
              <EmptyState icon={<LuCalendarClock />} title={t('home.no_upcoming.title')} body={t('home.no_upcoming.body')} />
            ) : (
              <div className="space-y-2.5">
                {upcoming.map((x) => (
                  <TournamentCard key={x.id} db={db} tournament={x} userId={me.id} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-4">
        <Panel>
          <PanelHeader
            title={t('home.form')}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('profile')}>
                {t('home.full_stats')}
              </Button>
            }
          />
          <dl className="grid grid-cols-3 gap-3 text-center">
            <MiniStat label={t('stats.tournaments')} value={String(stats.tournaments)} />
            <MiniStat label={t('stats.wins')} value={String(stats.wins)} />
            <MiniStat label={t('stats.final_tables')} value={String(stats.finalTables)} />
          </dl>
          {stats.recent.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {stats.recent.slice(0, 4).map((r) => (
                <li key={r.tournamentId}>
                  <button type="button" onClick={() => go('results', { id: r.tournamentId })} className="flex w-full items-center gap-3 py-2.5 text-start hover:bg-raised/40">
                    <span className={`flex h-8 w-11 shrink-0 items-center justify-center rounded-control text-[13px] font-semibold tabular-nums ${r.place === 1 ? 'bg-gold/15 text-gold' : r.place <= 3 ? 'bg-accent/12 text-accent' : 'bg-raised text-ink-2'}`}>
                      {ordinal(r.place, t.lang)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{r.name}</span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {t('results.of_n', { n: r.entrants })} · {relativeTime(r.completedAt, now, t.lang)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12.5px] text-ink-2 tabular-nums">+{r.points}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3">
            <DemoTag label={t('common.demo_history')} />
          </p>
        </Panel>

        <Panel>
          <PanelHeader title={t('home.announcements')} />
          {announcements.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t('home.no_announcements')}</p>
          ) : (
            <ul className="space-y-3.5">
              {announcements.map((a) => {
                const club = db.clubs[a.clubId];
                return (
                  <li key={a.id} className="flex gap-3">
                    {club ? <ClubLogo branding={club.branding} name={club.name} size={30} /> : <span className="flex size-[30px] shrink-0 items-center justify-center rounded-control bg-raised text-ink-2"><LuMegaphone className="size-4" aria-hidden /></span>}
                    <div className="min-w-0">
                      <p className="text-[13.5px] leading-snug font-medium text-ink">{a.title}</p>
                      {a.body && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{a.body}</p>}
                      <p className="mt-1 text-[11.5px] text-ink-3">
                        {club?.name} · {relativeTime(a.at, now, t.lang)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title={t('home.my_clubs')}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('clubs')}>
                {t('common.manage')}
              </Button>
            }
          />
          <ul className="space-y-1">
            {clubs.map(({ club, membership }) => (
              <li key={club.id}>
                <button type="button" onClick={() => go('club', { clubId: club.id })} className="flex w-full items-center gap-3 rounded-inner px-1.5 py-1.5 text-start hover:bg-raised">
                  <ClubLogo branding={club.branding} name={club.name} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      <ClubName club={club} />
                    </span>
                    <span className="block text-[12px] text-ink-3 tabular-nums">
                      {membership.status === 'pending' ? t('clubs.status.pending') : `${t.n('clubs.members', memberCount(db, club.id))} · ${t('common.points_n', { n: chips(membership.demoPoints) })}`}
                    </span>
                  </span>
                  {membership.status === 'pending' && <Badge tone="warning">{t('clubs.status.pending_short')}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  );
}

function SectionTitle({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex min-h-8 items-center justify-between gap-3">
      <h2 id={id} className="text-[15px] font-semibold text-ink">
        {title}
      </h2>
      {action}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-inner bg-raised/60 px-2 py-2.5">
      <dd className="text-[20px] leading-none font-semibold text-ink tabular-nums">{value}</dd>
      <dt className="mt-1.5 text-[11.5px] text-ink-3">{label}</dt>
    </div>
  );
}

