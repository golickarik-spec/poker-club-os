/**
 * Rankings: the global leaderboard (v0.4), the club standings (v0.3) and the leagues the
 * player can see. All three read the same result records through `platform/competition`.
 */
import { useMemo, useState } from 'react';
import { LuMedal, LuTrophy } from 'react-icons/lu';
import { dateShort, ordinal } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { VARIANT_IDS, VARIANTS, type VariantId } from '../engine/variants.ts';
import * as api from '../platform/api.ts';
import * as comp from '../platform/competition.ts';
import { clubRanking, userClubs } from '../platform/selectors.ts';
import type { League } from '../platform/types.ts';
import { LeaderboardTable, StandingsTable, TierChip } from '../shared/competition.tsx';
import { Badge, BotTag, Button, cx, DemoTag, EmptyState, PageHeader, Panel } from '../ui/core.tsx';
import { Segmented, Select, Switch } from '../ui/forms.tsx';
import { Avatar, ClubLogo, ClubName, accentStyle } from '../ui/identity.tsx';
import { Tabs } from '../ui/overlay.tsx';

type Tab = 'global' | 'club' | 'leagues';
type Season = 'all' | '30' | '90';
type Period = 'all' | 'season' | 'month';

export function Rankings({ initialTab }: { initialTab?: string }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab === 'club' || initialTab === 'leagues' ? initialTab : 'global');
  return (
    <div>
      <PageHeader title={t('rankings.title')} subtitle={t('rankings.subtitle_v4')} />
      <Tabs
        value={tab}
        onChange={setTab}
        label={t('rankings.title')}
        className="mb-4"
        tabs={[
          { value: 'global', label: t('rankings.tab.global') },
          { value: 'club', label: t('rankings.tab.club') },
          { value: 'leagues', label: t('rankings.tab.leagues') },
        ]}
      />
      {tab === 'global' && <GlobalBoard />}
      {tab === 'club' && <ClubBoard />}
      {tab === 'leagues' && <LeaguesTab />}
    </div>
  );
}

// ----- Global ---------------------------------------------------------------------------------

function GlobalBoard() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [category, setCategory] = useState<comp.LeaderboardCategory>('score');
  const [period, setPeriod] = useState<Period>('all');
  const [game, setGame] = useState<VariantId | 'all'>('all');
  const [clubId, setClubId] = useState<string>('all');
  const [includeDemo, setIncludeDemo] = useState(true);
  const clubs = Object.values(db.clubs).filter((c) => c.status === 'active');
  const rows = useMemo(() => {
    const cat: comp.LeaderboardCategory = period === 'season' ? 'season' : period === 'month' ? 'monthly' : category;
    return comp.globalLeaderboard(db, cat, { now, game, clubIds: clubId === 'all' ? null : [clubId], includeDemo, limit: 100 });
  }, [db, now, category, period, game, clubId, includeDemo]);
  const effectiveCategory: comp.LeaderboardCategory = period === 'season' ? 'season' : period === 'month' ? 'monthly' : category;
  const mine = rows.find((r) => r.userId === me.id);
  const myStats = comp.playerStats(db, me.id, { includeDemo });
  const tier = comp.tierOf(myStats);
  const hidden = db.settings[me.id]?.privacy.showProfile === false;
  const hasDemo = rows.some((r) => r.includesDemo);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented<comp.LeaderboardCategory>
            value={period === 'all' ? category : 'score'}
            onChange={(c) => {
              setCategory(c);
              setPeriod('all');
            }}
            label={t('board.category')}
            size="sm"
            options={[
              { value: 'score', label: t('board.cat.score') },
              { value: 'wins', label: t('board.cat.wins') },
              { value: 'final_tables', label: t('board.cat.final_tables') },
              { value: 'avg_finish', label: t('board.cat.avg_finish') },
            ]}
          />
          <Segmented<Period>
            value={period}
            onChange={setPeriod}
            label={t('board.period')}
            size="sm"
            options={[
              { value: 'all', label: t('crm.range.all') },
              { value: 'season', label: `${t('board.cat.season')} · ${comp.seasonBounds(now).label}` },
              { value: 'month', label: t('board.cat.monthly') },
            ]}
          />
          <Select<VariantId | 'all'>
            value={game}
            onChange={setGame}
            className="w-auto min-w-[160px]"
            aria-label={t('board.game')}
            data-testid="board-game"
            options={[{ value: 'all' as const, label: t('board.all_games') }, ...VARIANT_IDS.filter((id) => VARIANTS[id].implemented).map((id) => ({ value: id, label: t(`variant.${id}`) }))]}
          />
          <Select<string> value={clubId} onChange={setClubId} className="w-auto min-w-[160px]" aria-label={t('board.clubs')} options={[{ value: 'all', label: t('board.all_clubs') }, ...clubs.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        <Panel pad={false} className="overflow-hidden">
          <LeaderboardTable rows={rows} category={effectiveCategory} meId={me.id} emptyText={t('board.empty')} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-3 py-2.5">
            <Switch checked={includeDemo} onChange={setIncludeDemo} label={t('board.include_demo')} id="board-demo" />
            {hasDemo && <DemoTag label={t('board.demo_note')} />}
          </div>
        </Panel>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('board.scoring_note')}</p>
      </div>

      <Panel data-testid="board-me-card">
        <div className="flex items-center gap-3">
          <Avatar user={me} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{me.name}</p>
            <TierChip tier={tier} />
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-[13px]">
          <Stat label={t('board.your_rank')} value={mine ? ordinal(mine.rank, t.lang) : '—'} />
          <Stat label={t('board.cat.score')} value={String(myStats.score)} />
          <Stat label={t('rankings.played')} value={String(myStats.played)} />
          <Stat label={t('rankings.wins')} value={String(myStats.wins)} />
        </dl>
        {hidden && <p className="mt-3 text-[12px] text-warning">{t('board.hidden_note')}</p>}
        {!mine && !hidden && <p className="mt-3 text-[12px] text-ink-3">{t('board.not_listed')}</p>}
        <Button size="sm" variant="ghost" className="mt-3" onClick={() => go('profile', { tab: 'rankings' })}>
          {t('board.open_profile')}
        </Button>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="display mt-0.5 text-[18px] leading-tight text-ink tabular-nums">{value}</dd>
    </div>
  );
}

// ----- Club (v0.3 standings, kept) --------------------------------------------------------------

function ClubBoard() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const clubs = useMemo(() => userClubs(db, me.id).filter((x) => x.membership.status === 'active'), [db, me.id]);
  const [clubId, setClubId] = useState<string>(clubs[0]?.club.id ?? '');
  const [season, setSeason] = useState<Season>('all');
  const selected = clubs.find((x) => x.club.id === clubId) ?? clubs[0];

  if (!selected) {
    return (
      <EmptyState
        icon={<LuMedal />}
        title={t('rankings.no_clubs_title')}
        body={t('rankings.no_clubs_body')}
        action={
          <Button variant="primary" onClick={() => go('clubs')}>
            {t('clubs.join')}
          </Button>
        }
      />
    );
  }

  const { club } = selected;
  const view = api.clubView(db, me.id, club.id);
  const since = season === 'all' ? 0 : now - Number(season) * 86_400_000;
  const rows = view.showResults ? clubRanking(db, club.id, since) : [];
  const myIndex = rows.findIndex((r) => r.userId === me.id);
  const mine = myIndex >= 0 ? rows[myIndex]! : null;
  const champions = db.leagues.filter((l) => l.clubId === club.id && l.status !== 'draft' && l.championId).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  return (
    <div style={accentStyle(club.branding.accent)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label={t('rankings.club')} className="flex flex-wrap gap-1.5">
          {clubs.map(({ club: c }) => {
            const active = c.id === club.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setClubId(c.id)}
                data-testid={`rankings-club-${c.id}`}
                className={cx('flex h-9 items-center gap-2 rounded-control border px-2.5 pe-3 text-[13px] font-medium transition-colors', active ? 'border-line-strong bg-raised text-ink' : 'border-transparent text-ink-2 hover:bg-raised/60 hover:text-ink')}
                style={accentStyle(c.branding.accent)}
              >
                <ClubLogo branding={c.branding} name={c.name} size={20} />
                <ClubName club={c} />
              </button>
            );
          })}
        </div>
        <Segmented<Season>
          value={season}
          onChange={setSeason}
          label={t('rankings.season')}
          size="sm"
          options={[
            { value: 'all', label: t('crm.range.all') },
            { value: '90', label: t('crm.range.days', { n: 90 }) },
            { value: '30', label: t('crm.range.days', { n: 30 }) },
          ]}
        />
      </div>

      {rows.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="club-top3">
          {rows.slice(0, 3).map((r, i) => (
            <Panel key={r.userId} className={cx('flex items-center gap-3', i === 0 && 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-gold)_45%,transparent)_inset]')}>
              <span className={cx('display flex size-9 shrink-0 items-center justify-center rounded-full text-[14px]', i === 0 ? 'bg-gold text-[#1c1505]' : 'bg-gold/15 text-gold')}>{i + 1}</span>
              <Avatar user={r} size={36} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-ink">
                  {r.name}
                  {r.isBot && <BotTag label={t('common.bot')} />}
                </span>
                <span className="block text-[12px] text-ink-3 tabular-nums">
                  {r.points} {t('rankings.points').toLowerCase()} · {t.n('club.wins', r.wins)}
                </span>
              </span>
            </Panel>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <Panel pad={false} className="overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState icon={<LuMedal />} title={t('rankings.empty_title')} body={t('rankings.empty_body')} className="m-4" />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]" data-testid="rankings-table">
              <thead>
                <tr className="text-[11.5px] text-ink-3">
                  <th scope="col" className="w-12 px-3 py-2.5 text-start font-medium">
                    {t('rankings.rank')}
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-start font-medium">
                    {t('rankings.player')}
                  </th>
                  <th scope="col" className="hidden px-2 py-2.5 text-end font-medium sm:table-cell">
                    {t('rankings.played')}
                  </th>
                  <th scope="col" className="hidden px-2 py-2.5 text-end font-medium sm:table-cell">
                    {t('rankings.wins')}
                  </th>
                  <th scope="col" className="hidden px-2 py-2.5 text-end font-medium md:table-cell">
                    {t('rankings.best')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-end font-medium">
                    {t('rankings.points')}
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-t [&>tr]:border-line/70">
                {rows.slice(0, 50).map((r, i) => {
                  const isMe = r.userId === me.id;
                  return (
                    <tr key={r.userId} className={cx(isMe && 'bg-accent/[0.08]')} data-testid={isMe ? 'rankings-me' : undefined}>
                      <td className="px-3 py-2">
                        <span className={cx('display flex size-7 items-center justify-center rounded-full text-[12.5px]', i === 0 ? 'bg-gold text-[#1c1505]' : i < 3 ? 'bg-gold/15 text-gold' : 'text-ink-3')}>{i + 1}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar user={r} size={28} />
                          <span className="min-w-0 truncate font-medium text-ink">{r.name}</span>
                          {isMe && <span className="rounded-chip bg-accent/15 px-1.5 py-px text-[10.5px] font-semibold text-accent">{t('rankings.you')}</span>}
                          {r.isBot && <BotTag label={t('common.bot')} />}
                        </span>
                      </td>
                      <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums sm:table-cell">{r.played}</td>
                      <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums sm:table-cell">{r.wins}</td>
                      <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums md:table-cell">{ordinal(r.best, t.lang)}</td>
                      <td className="display px-3 py-2 text-end text-[15px] text-ink tabular-nums">{r.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          <p className="border-t border-line/70 px-3 py-2.5">
            <DemoTag label={t('rankings.points_hint')} />
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel data-testid="rankings-summary">
            <p className="text-[12.5px] text-ink-3">{t('rankings.your_place')}</p>
            {mine ? (
              <>
                <p className={cx('display mt-1 text-[40px] leading-none', myIndex < 3 ? 'text-gold' : 'text-ink')}>{ordinal(myIndex + 1, t.lang)}</p>
                <p className="mt-1 text-[13px] text-ink-2">
                  {t('results.of_n', { n: rows.length })} · <ClubName club={club} />
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-[13px]">
                  <Stat label={t('rankings.points')} value={String(mine.points)} />
                  <Stat label={t('rankings.played')} value={String(mine.played)} />
                  <Stat label={t('rankings.wins')} value={String(mine.wins)} />
                  <Stat label={t('rankings.best')} value={ordinal(mine.best, t.lang)} />
                </dl>
              </>
            ) : (
              <>
                <p className="display mt-1 text-[24px] leading-tight text-ink">{t('rankings.not_ranked')}</p>
                <p className="mt-1 text-[13px] text-ink-2">{t('rankings.not_ranked_hint')}</p>
              </>
            )}
            <Button size="sm" variant="ghost" className="mt-4" onClick={() => go('club', { clubId: club.id })}>
              {t('club.full_ranking')}
            </Button>
          </Panel>
          {champions.length > 0 && (
            <Panel data-testid="previous-champions">
              <p className="mb-2 text-[13px] font-semibold text-ink">{t('league.previous_champions')}</p>
              <ul className="space-y-2">
                {champions.slice(0, 5).map((l) => {
                  const u = db.users[l.championId!];
                  return (
                    <li key={l.id} className="flex items-center gap-2.5">
                      <LuTrophy className="size-4 shrink-0 text-gold" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <button type="button" className="block truncate text-[13px] font-medium text-ink hover:underline" onClick={() => go('league', { id: l.id })}>
                          {l.name}
                        </button>
                        <span className="block truncate text-[11.5px] text-ink-3">
                          {u?.name ?? '—'} · {l.completedAt ? dateShort(l.completedAt, t.lang) : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- Leagues -----------------------------------------------------------------------------------

function LeaguesTab() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const clubs = userClubs(db, me.id);
  const leagues: { league: League; club: (typeof clubs)[number]['club'] }[] = [];
  for (const { club } of clubs) for (const league of comp.visibleLeagues(db, me.id, club.id)) leagues.push({ league, club });
  // Public leagues of followed/other clubs too.
  for (const club of Object.values(db.clubs)) {
    if (clubs.some((c) => c.club.id === club.id)) continue;
    for (const league of comp.visibleLeagues(db, me.id, club.id)) leagues.push({ league, club });
  }
  const active = leagues.filter((x) => x.league.status === 'active');
  const past = leagues.filter((x) => x.league.status !== 'active' && x.league.status !== 'draft');
  if (leagues.length === 0) return <EmptyState icon={<LuTrophy />} title={t('league.none_title')} body={t('league.none_body')} />;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2.5 text-[15px] font-semibold text-ink">{t('league.active')}</h2>
        {active.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('league.no_active')}</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {active.map(({ league, club }) => (
              <LeagueCard key={league.id} league={league} clubName={club.name} meId={me.id} />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[15px] font-semibold text-ink">{t('league.history')}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {past.map(({ league, club }) => (
              <LeagueCard key={league.id} league={league} clubName={club.name} meId={me.id} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function LeagueCard({ league, clubName, meId }: { league: League; clubName: string; meId: string }) {
  const t = useT();
  const db = useDb();
  const rows = comp.leagueStandings(db, league);
  const mine = rows.find((r) => r.userId === meId);
  const leader = rows[0];
  return (
    <Panel pad={false} className="overflow-hidden" data-testid={`league-card-${league.id}`}>
      <button type="button" onClick={() => go('league', { id: league.id })} className="flex w-full items-start justify-between gap-3 p-4 text-start hover:bg-raised/40">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-ink">{league.name}</span>
          <span className="block text-[12.5px] text-ink-3">
            {clubName} · {t(`league.type.${league.type}`)} · {dateShort(league.startAt, t.lang)} – {dateShort(league.endAt, t.lang)}
          </span>
        </span>
        <Badge tone={league.status === 'active' ? 'success' : 'neutral'}>{t(`league.status.${league.status}`)}</Badge>
      </button>
      <div className="border-t border-line/70">
        <StandingsTable rows={rows} meId={meId} frozen={!!league.finalStandings} limit={3} />
      </div>
      <div className="flex items-center justify-between border-t border-line/70 px-4 py-2 text-[12.5px] text-ink-2">
        <span>{mine ? t('league.your_place_n', { n: ordinal(mine.rank, t.lang), pts: mine.points }) : t('league.not_in')}</span>
        {leader && league.finalStandings && <span className="text-gold">{t('league.champion')}: {leader.name}</span>}
      </div>
    </Panel>
  );
}
