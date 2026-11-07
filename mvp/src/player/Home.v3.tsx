/**
 * v0.3 player home. One featured event at the top (where the player is seated, what
 * they are registered for, or the best thing to join), a dense schedule under it, and
 * the player's own standing on the side. Data and actions are the v2 ones.
 */
import { useMemo, type ReactNode } from 'react';
import { LuArmchair, LuCalendarClock, LuChevronRight, LuMegaphone, LuPlay, LuUsers } from 'react-icons/lu';
import { runtime } from '../app/context.ts';
import { blindsLabel, chips, ordinal, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useRuntime, useT } from '../app/hooks.ts';
import { currentBlinds, currentLevelNumber, remainingPlayers, standings } from '../engine/tournament.ts';
import { registrationOf } from '../platform/api.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { clubAnnouncements, clubRanking, feedClubIds, memberCount, playerStats, tournamentsForUser, userClubs } from '../platform/selectors.ts';
import type { DB, Tournament } from '../platform/types.ts';
import { FeaturedTournament, TournamentList, TournamentRow } from '../shared/tournament.v3.tsx';
import { Badge, Button, cx, DemoTag, EmptyState, Panel, PanelHeader } from '../ui/core.tsx';
import { accentStyle, ClubLogo, ClubName } from '../ui/identity.tsx';

function greetingKey(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? 'home.greeting.night' : h < 12 ? 'home.greeting.morning' : h < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening';
}

/** The player's seat right now: table, level, position and stack, with the way back. */
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
    <section className="stage relative overflow-hidden" style={accentStyle(club.branding.accent)} data-testid="active-seat">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" aria-hidden />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <LuArmchair className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-accent">
            {info.away ? t('home.seat.away') : t('home.seat.playing')} <span className="text-ink-3">· {club.name}</span>
          </p>
          <h2 className="display mt-0.5 truncate text-[24px] leading-tight text-ink sm:text-[30px]">{tournament.name}</h2>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2 tabular-nums">
            <SeatFact label={t('table.table_n', { n: info.table })} />
            <SeatFact label={t('tour.level_n', { n: info.level })} value={info.blinds} />
            <SeatFact label={`${ordinal(info.rank, t.lang)} / ${info.left}`} />
            <SeatFact value={chips(info.stack)} />
          </dl>
        </div>
        <Button variant="primary" size="lg" icon={<LuPlay className="size-4" aria-hidden />} onClick={() => go('table', { id: tournament.id })} data-testid="return-to-table">
          {t('home.seat.return')}
        </Button>
      </div>
    </section>
  );
}

function SeatFact({ label, value }: { label?: string; value?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      {label && <dt>{label}</dt>}
      {value && (
        <dd className="font-medium text-ink" dir="ltr">
          {value}
        </dd>
      )}
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
  const upcoming = all.filter((x) => isUpcoming(x.status) && !registered.includes(x) && !quick.includes(x));
  const clubs = userClubs(db, me.id);
  const announcements = clubAnnouncements(db, me.id, feedClubIds(db, me.id)).slice(0, 3);
  const stats = playerStats(db, me.id);

  // The featured event: a held seat first, then something running, then the next scheduled start.
  const byStart = (a: Tournament, b: Tournament) => a.startAt - b.startAt;
  const featured: { tournament: Tournament; eyebrow: string } | null =
    registered.length > 0
      ? { tournament: [...registered].sort(byStart)[0]!, eyebrow: t('home.seat_held') }
      : running.length > 0
        ? { tournament: running[0]!, eyebrow: t('home.started') }
        : upcoming.length > 0
          ? { tournament: [...upcoming].sort(byStart)[0]!, eyebrow: t('home.featured') }
          : quick.length > 0
            ? { tournament: quick[0]!, eyebrow: t('home.quick') }
            : null;
  const rest = (list: Tournament[]) => list.filter((x) => x.id !== featured?.tournament.id);

  // Where the player stands in their most active club.
  const standing = useMemo(() => {
    let best: { club: string; rank: number; of: number; points: number } | null = null;
    for (const { club, membership } of clubs) {
      if (membership.status !== 'active') continue;
      const rows = clubRanking(db, club.id);
      const i = rows.findIndex((r) => r.userId === me.id);
      if (i < 0) continue;
      if (!best || rows[i]!.points > best.points) best = { club: club.name, rank: i + 1, of: rows.length, points: rows[i]!.points };
    }
    return best;
  }, [clubs, db, me.id]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="display text-[26px] leading-tight text-ink sm:text-[30px]">{t(greetingKey(now), { name: me.name.split(' ')[0]! })}</h1>
            <p className="mt-1 text-sm text-ink-2">
              {running.length + seated.length > 0 ? t.n('home.sub.running', running.length + seated.length) : t('home.sub.quiet')} {t.n('home.sub.upcoming', registered.length + upcoming.length)}
            </p>
          </div>
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

        {featured && seated.length === 0 && <FeaturedTournament db={db} tournament={featured.tournament} userId={me.id} eyebrow={featured.eyebrow} />}

        {rest(registered).length > 0 && (
          <Section id="home-registered" title={t('home.registered')}>
            {rest(registered).map((x) => (
              <TournamentRow key={x.id} db={db} tournament={x} userId={me.id} />
            ))}
          </Section>
        )}

        {rest(running).length > 0 && (
          <Section id="home-running" title={t('home.running')}>
            {rest(running).map((x) => (
              <TournamentRow key={x.id} db={db} tournament={x} userId={me.id} />
            ))}
          </Section>
        )}

        {rest(quick).length > 0 && (
          <Section id="home-quick" title={t('home.quick')}>
            {rest(quick).map((x) => (
              <TournamentRow key={x.id} db={db} tournament={x} userId={me.id} />
            ))}
          </Section>
        )}

        {clubs.length > 0 && (
          <Section
            id="home-upcoming"
            title={t('home.upcoming')}
            action={
              <Button size="sm" variant="ghost" trailing={<LuChevronRight className="size-3.5 flip-rtl" aria-hidden />} onClick={() => go('tournaments')}>
                {t('home.all_tournaments')}
              </Button>
            }
            empty={rest(upcoming).length === 0 ? <EmptyState icon={<LuCalendarClock />} title={t('home.no_upcoming.title')} body={t('home.no_upcoming.body')} /> : undefined}
          >
            {rest(upcoming)
              .sort(byStart)
              .slice(0, 6)
              .map((x) => (
                <TournamentRow key={x.id} db={db} tournament={x} userId={me.id} />
              ))}
          </Section>
        )}
      </div>

      <aside className="min-w-0 space-y-4">
        <Panel>
          <PanelHeader
            title={t('home.your_week')}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('profile')}>
                {t('home.full_stats')}
              </Button>
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <Tile
              label={t('home.rank_tile')}
              hint={standing ? t('home.rank_tile_hint', { club: standing.club }) : undefined}
              value={standing ? ordinal(standing.rank, t.lang) : '—'}
              tone={standing && standing.rank <= 3 ? 'gold' : 'default'}
              onClick={() => go('rankings')}
            />
            <Tile label={t('home.played_tile')} value={String(stats.tournaments)} />
            <Tile label={t('stats.wins')} value={String(stats.wins)} />
            <Tile label={t('stats.final_tables')} value={String(stats.finalTables)} />
          </div>
          {stats.recent.length > 0 && (
            <ul className="rows mt-4 border-t border-line">
              {stats.recent.slice(0, 4).map((r) => (
                <li key={r.tournamentId}>
                  <button type="button" onClick={() => go('results', { id: r.tournamentId })} className="flex w-full items-center gap-3 py-2.5 text-start hover:bg-raised/40">
                    <span className={cx('display flex h-8 w-11 shrink-0 items-center justify-center rounded-control text-[13px]', r.place === 1 ? 'bg-gold/15 text-gold' : r.place <= 3 ? 'bg-accent/12 text-accent' : 'bg-raised text-ink-2')}>
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
                    {club ? (
                      <ClubLogo branding={club.branding} name={club.name} size={30} />
                    ) : (
                      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-control bg-raised text-ink-2">
                        <LuMegaphone className="size-4" aria-hidden />
                      </span>
                    )}
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

function Section({ id, title, action, children, empty }: { id: string; title: string; action?: ReactNode; children: ReactNode; empty?: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-2.5 flex min-h-8 items-center justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {action}
      </div>
      {empty ?? <TournamentList>{children}</TournamentList>}
    </section>
  );
}

function Tile({ label, hint, value, tone = 'default', onClick }: { label: string; hint?: string; value: string; tone?: 'default' | 'gold'; onClick?: () => void }) {
  const body = (
    <>
      <span className={cx('display block text-[24px] leading-none', tone === 'gold' ? 'text-gold' : 'text-ink')}>{value}</span>
      <span className="mt-1.5 block text-[11.5px] leading-tight text-ink-3">{label}</span>
      {hint && <span className="block text-[11px] leading-tight text-ink-3/80">{hint}</span>}
    </>
  );
  const className = cx('well block w-full px-3 py-2.5 text-start', tone === 'gold' && 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-gold)_35%,transparent)_inset]', onClick && 'transition-colors hover:bg-raised/70');
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
