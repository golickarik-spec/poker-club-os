/**
 * The player's profile. v0.4 adds tabs — Overview, Statistics, Tournament history,
 * Rankings, Achievements, Seasons — over the competition layer. Every figure is computed
 * from result records; achievements are the ones actually awarded by the rules engine.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { LuAward, LuCrown, LuFlame, LuHistory, LuLayers, LuMedal, LuRepeat, LuSettings, LuTrophy, LuUserPlus, LuUsers } from 'react-icons/lu';
import { dateShort, ordinal, percent } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { VARIANTS } from '../engine/variants.ts';
import * as comp from '../platform/competition.ts';
import { clubRanking, playerStats as clubPlayerStats, userClubs } from '../platform/selectors.ts';
import type { AchievementKey } from '../platform/types.ts';
import { AchievementBadge, ACHIEVEMENT_KEYS, TierChip, TierEmblem } from '../shared/competition.tsx';
import { BarChart, LineChart } from '../ui/charts.tsx';
import { Badge, Button, cx, DemoTag, EmptyState, Fact, Meter, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Select, Switch } from '../ui/forms.tsx';
import { Avatar, ClubLogo } from '../ui/identity.tsx';
import { Tabs } from '../ui/overlay.tsx';
import { act } from '../app/context.ts';
import * as api from '../platform/api.ts';

type Tab = 'overview' | 'statistics' | 'history' | 'rankings' | 'achievements' | 'seasons';
const TABS: Tab[] = ['overview', 'statistics', 'history', 'rankings', 'achievements', 'seasons'];

const ICONS: Record<AchievementKey, ReactNode> = {
  first_tournament: <LuFlame />,
  first_final_table: <LuMedal />,
  first_win: <LuTrophy />,
  five_wins: <LuCrown />,
  ten_final_tables: <LuAward />,
  season_champion: <LuTrophy />,
  club_champion: <LuCrown />,
  multi_variant: <LuLayers />,
  returning: <LuRepeat />,
  league_top10: <LuMedal />,
  referral_first: <LuUserPlus />,
  referral_five: <LuUsers />,
};

export function Profile({ initialTab }: { initialTab?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'overview');
  const [clubFilter, setClubFilter] = useState('all');
  const [includeDemo, setIncludeDemo] = useState(true);
  const clubs = userClubs(db, me.id).filter((c) => c.membership.status === 'active');
  const legacy = clubPlayerStats(db, me.id, clubFilter === 'all' ? undefined : clubFilter);
  const stats = useMemo(() => comp.playerStats(db, me.id, { includeDemo, clubIds: clubFilter === 'all' ? null : [clubFilter] }), [db, me.id, includeDemo, clubFilter]);
  const allTime = useMemo(() => comp.playerStats(db, me.id, { includeDemo }), [db, me.id, includeDemo]);
  const tier = comp.tierOf(allTime);
  const next = comp.nextTier(allTime);
  const awards = comp.awardsFor(db, me.id);
  const chrono = [...stats.history].reverse();
  const settings = db.settings[me.id];
  const publicProfile = settings?.privacy.showProfile !== false;

  return (
    <>
      <PageHeader
        title={t('profile.title')}
        actions={
          <>
            <Button icon={<LuHistory className="size-4" aria-hidden />} onClick={() => go('hands')}>
              {t('nav.hands')}
            </Button>
            <Button icon={<LuSettings className="size-4" aria-hidden />} onClick={() => go('settings')}>
              {t('nav.settings')}
            </Button>
          </>
        }
      />
      <Panel className="flex flex-wrap items-center gap-4">
        <Avatar user={me} size={72} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 truncate text-[22px] leading-tight font-semibold text-ink">
            {me.name}
            <TierChip tier={tier} size="md" />
          </p>
          <p className="text-[13.5px] text-ink-3" dir="ltr">
            @{me.handle}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {clubs.map(({ club }) => (
              <button key={club.id} type="button" onClick={() => go('club', { clubId: club.id })} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 ps-0.5 pe-2.5 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink">
                <ClubLogo branding={club.branding} name={club.name} size={20} />
                {club.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {clubs.length > 1 && (
            <Select value={clubFilter} onChange={setClubFilter} aria-label={t('profile.filter')} className="h-9 w-auto min-w-[180px]" options={[{ value: 'all', label: t('tournaments.all_clubs') }, ...clubs.map((c) => ({ value: c.club.id, label: c.club.name }))]} />
          )}
          <Switch checked={includeDemo} onChange={setIncludeDemo} label={t('board.include_demo')} id="profile-demo" />
        </div>
      </Panel>

      <Tabs
        value={tab}
        onChange={setTab}
        label={t('profile.title')}
        className="mt-5 mb-4"
        tabs={TABS.map((v) => ({ value: v, label: t(`profile.tab.${v}`), count: v === 'achievements' ? awards.length : undefined }))}
      />

      {tab === 'overview' && (
        stats.played === 0 ? (
          <EmptyState
            icon={<LuTrophy />}
            title={t('profile.empty.title')}
            body={t('profile.empty.body')}
            action={
              <Button variant="primary" onClick={() => go('tournaments')}>
                {t('hands.empty.action')}
              </Button>
            }
          />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label={t('stats.tournaments')} value={String(stats.played)} />
              <Stat label={t('stats.wins')} value={String(stats.wins)} hint={percent(stats.winRate)} gold={stats.wins > 0} />
              <Stat label={t('stats.final_tables')} value={String(stats.finalTables)} />
              <Stat label={t('stats.avg_finish')} value={stats.avgFinish.toFixed(1)} hint={t('stats.top_pct', { pct: Math.max(1, Math.round(stats.avgPercentile * 100)) })} />
              <Stat label={t('board.cat.score')} value={String(stats.score)} hint={legacy.best ? t('stats.best', { place: ordinal(legacy.best.place, t.lang), n: legacy.best.entrants }) : undefined} />
            </dl>
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Panel>
                <PanelHeader title={t('profile.chart.title')} hint={t('profile.chart.hint')} action={stats.includesDemo ? <DemoTag label={t('common.demo_history')} /> : undefined} />
                <LineChart
                  title={t('profile.chart.title')}
                  labels={chrono.map((r) => dateShort(r.completedAt, t.lang))}
                  series={[{ name: t('profile.chart.series'), values: chrono.map((r) => Math.round((1 - (r.field > 1 ? (r.place - 1) / (r.field - 1) : 0)) * 100)) }]}
                  min={0}
                  max={100}
                  format={(n) => `${Math.round(n)}%`}
                  dots
                  height={230}
                />
              </Panel>
              <TierPanel tier={tier} next={next} stats={allTime} />
            </div>
          </>
        )
      )}

      {tab === 'statistics' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader title={t('profile.by_game')} hint={t('profile.by_game_hint')} />
            {Object.keys(stats.byGame).length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('profile.empty.title')}</p>
            ) : (
              <BarChart title={t('profile.by_game')} data={Object.entries(stats.byGame).map(([g, n]) => ({ label: t(`variant.${g}`), value: n }))} height={200} />
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t('profile.tab.statistics')} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label={t('stats.tournaments')}>{stats.played}</Fact>
              <Fact label={t('stats.wins')}>{stats.wins}</Fact>
              <Fact label={t('stats.final_tables')}>{stats.finalTables}</Fact>
              <Fact label={t('board.win_rate')}>{percent(stats.winRate)}</Fact>
              <Fact label={t('stats.avg_finish')}>{stats.avgFinish.toFixed(1)}</Fact>
              <Fact label={t('board.avg_percentile')}>{t('stats.top_pct', { pct: Math.max(1, Math.round(stats.avgPercentile * 100)) })}</Fact>
              <Fact label={t('board.most_played')}>{stats.mostPlayed ? t(`variant.${stats.mostPlayed}`) : '—'}</Fact>
              <Fact label={t('board.cat.score')}>{stats.score}</Fact>
              <Fact label={t('board.cat.season')}>{comp.playerStats(db, me.id, { includeDemo, ...comp.seasonBounds(now) }).score}</Fact>
              <Fact label={t('board.cat.monthly')}>{comp.playerStats(db, me.id, { includeDemo, ...comp.monthBounds(now) }).score}</Fact>
            </dl>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('board.scoring_note')}</p>
          </Panel>
        </div>
      )}

      {tab === 'history' && (
        <Panel pad={false}>
          <div className="relative overflow-x-auto">
            {stats.history.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-ink-3">{t('profile.empty.title')}</p>
            ) : (
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-[12px] text-ink-3">
                    <th className="py-2 ps-4 text-start font-medium sm:ps-5">{t('profile.col.date')}</th>
                    <th className="py-2 text-start font-medium">{t('profile.col.tournament')}</th>
                    <th className="py-2 text-start font-medium">{t('wizard.game_title')}</th>
                    <th className="py-2 pe-3 text-end font-medium">{t('profile.col.finish')}</th>
                    <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('board.cat.score')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.history.map((r) => (
                    <tr key={r.tournamentId} className="cursor-pointer border-t border-line hover:bg-raised/50" onClick={() => go('results', { id: r.tournamentId })}>
                      <td className="py-2.5 ps-4 text-ink-3 tabular-nums sm:ps-5">{dateShort(r.completedAt, t.lang)}</td>
                      <td className="py-2.5">
                        <span className="font-medium text-ink">{r.name}</span>
                        <span className="block text-[12px] text-ink-3">
                          {db.clubs[r.clubId]?.name}
                          {r.demo ? ` · ${t('common.demo')}` : ''}
                        </span>
                      </td>
                      <td className="py-2.5 text-ink-2">{t(`variant.${r.game}`)}</td>
                      <td className="py-2.5 pe-3 text-end tabular-nums">
                        <span dir="ltr">
                          <Badge tone={r.place === 1 ? 'gold' : r.place <= 3 ? 'accent' : 'neutral'}>{ordinal(r.place, t.lang)}</Badge>
                          <span className="ml-1.5 text-ink-3">/ {r.field}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pe-4 text-end font-medium text-ink tabular-nums sm:pe-5">+{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      )}

      {tab === 'rankings' && <RankingsTab includeDemo={includeDemo} publicProfile={publicProfile} />}

      {tab === 'achievements' && (
        <Panel>
          <PanelHeader title={t('profile.achievements')} hint={t('profile.achievements_hint', { n: awards.length, total: ACHIEVEMENT_KEYS.length })} />
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACHIEVEMENT_KEYS.map((key) => {
              const award = awards.find((a) => a.key === key);
              const progress = key === 'five_wins' ? `${Math.min(allTime.wins, 5)}/5` : key === 'ten_final_tables' ? `${Math.min(allTime.finalTables, 10)}/10` : key === 'multi_variant' ? `${Math.min(Object.keys(allTime.byGame).length, 3)}/3` : undefined;
              return (
                <li key={key}>
                  <AchievementBadge award={award} awardKey={key} icon={ICONS[key]} progress={progress} />
                  {award && <p className="mt-1 ps-1 text-[11px] text-ink-3">{dateShort(award.awardedAt, t.lang)}</p>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12px] text-ink-3">{t('profile.achievements_note')}</p>
        </Panel>
      )}

      {tab === 'seasons' && <SeasonsTab />}
    </>
  );
}

function TierPanel({ tier, next, stats }: { tier: ReturnType<typeof comp.tierOf>; next: ReturnType<typeof comp.nextTier>; stats: comp.PlayerStats }) {
  const t = useT();
  const rule = comp.TIER_RULES.find((r) => r.tier === (next?.tier ?? tier))!;
  return (
    <Panel data-testid="tier-panel">
      <PanelHeader title={t('profile.tier')} hint={t('profile.tier_hint')} />
      <div className="flex items-center gap-4">
        <TierEmblem tier={tier} size={56} />
        <div className="min-w-0">
          <p className="display text-[22px] leading-tight text-ink">{t(`tier.${tier}`)}</p>
          <p className="text-[12.5px] text-ink-3">{t(`tier.${tier}.desc`)}</p>
        </div>
      </div>
      {next ? (
        <div className="mt-4 space-y-2.5">
          <p className="text-[12.5px] text-ink-2">{t('profile.next_tier', { tier: t(`tier.${next.tier}`) })}</p>
          <div>
            <div className="mb-1 flex justify-between text-[11.5px] text-ink-3">
              <span>{t('board.cat.score')}</span>
              <span className="tabular-nums">
                {stats.score} / {rule.score}
              </span>
            </div>
            <Meter value={stats.score} max={rule.score} tone="gold" label={t('board.cat.score')} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span>
              {t('stats.tournaments')}: {stats.played} / {rule.played}
            </span>
            <span>
              {t('stats.wins')}: {stats.wins} / {rule.wins}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-gold">{t('profile.top_tier')}</p>
      )}
    </Panel>
  );
}

function RankingsTab({ includeDemo, publicProfile }: { includeDemo: boolean; publicProfile: boolean }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const categories: comp.LeaderboardCategory[] = ['score', 'wins', 'final_tables', 'season', 'monthly'];
  const clubs = userClubs(db, me.id).filter((c) => c.membership.status === 'active');
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel>
        <PanelHeader title={t('rankings.tab.global')} action={<Button size="sm" variant="ghost" onClick={() => go('rankings')}>{t('board.open_board')}</Button>} />
        {!publicProfile && <p className="mb-3 text-[12.5px] text-warning">{t('board.hidden_note')}</p>}
        <ul className="rows">
          {categories.map((c) => {
            const rows = comp.globalLeaderboard(db, c, { now, includeDemo });
            const mine = rows.find((r) => r.userId === me.id);
            return (
              <li key={c} className="flex items-center justify-between py-2 text-[13.5px]">
                <span className="text-ink-2">{t(`board.cat.${c}`)}</span>
                <span className="display text-ink">{mine ? `${ordinal(mine.rank, t.lang)} / ${rows.length}` : '—'}</span>
              </li>
            );
          })}
        </ul>
        <Switch checked={publicProfile} onChange={(on) => act(() => api.updateSettings(db, me.id, { privacy: { ...db.settings[me.id]!.privacy, showProfile: on } }))} label={t('profile.public')} description={t('profile.public_hint')} id="profile-public" />
      </Panel>
      <Panel>
        <PanelHeader title={t('rankings.tab.club')} action={<Button size="sm" variant="ghost" onClick={() => go('rankings', { tab: 'club' })}>{t('board.open_board')}</Button>} />
        <ul className="rows">
          {clubs.map(({ club }) => {
            const rows = clubRanking(db, club.id);
            const i = rows.findIndex((r) => r.userId === me.id);
            return (
              <li key={club.id} className="flex items-center gap-3 py-2 text-[13.5px]">
                <ClubLogo branding={club.branding} name={club.name} size={24} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{club.name}</span>
                <span className="display text-ink">{i >= 0 ? `${ordinal(i + 1, t.lang)} / ${rows.length}` : '—'}</span>
              </li>
            );
          })}
          {clubs.length === 0 && <li className="py-2 text-[13px] text-ink-3">{t('rankings.no_clubs_title')}</li>}
        </ul>
      </Panel>
    </div>
  );
}

function SeasonsTab() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const mine = db.leagues
    .filter((l) => l.status !== 'draft')
    .map((l) => ({ league: l, row: comp.leagueStandings(db, l).find((r) => r.userId === me.id) }))
    .filter((x) => x.row)
    .sort((a, b) => b.league.startAt - a.league.startAt);
  if (mine.length === 0) return <EmptyState icon={<LuTrophy />} title={t('profile.seasons_empty')} body={t('profile.seasons_empty_body')} />;
  return (
    <Panel pad={false} className="overflow-hidden">
      <ul className="rows">
        {mine.map(({ league, row }) => (
          <li key={league.id}>
            <button type="button" onClick={() => go('league', { id: league.id })} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-raised/40">
              <span className={cx('display flex size-9 shrink-0 items-center justify-center rounded-full text-[14px]', row!.rank === 1 ? 'bg-gold text-[#1c1505]' : row!.rank <= 3 ? 'bg-gold/15 text-gold' : 'bg-raised text-ink-2')}>{row!.rank}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{league.name}</span>
                <span className="block text-[12px] text-ink-3">
                  {db.clubs[league.clubId]?.name} · {dateShort(league.startAt, t.lang)} – {dateShort(league.endAt, t.lang)} · {t.n('club.played', row!.played)}
                </span>
              </span>
              <span className="display text-[15px] text-ink tabular-nums">{row!.points}</span>
              <Badge tone={league.status === 'active' ? 'success' : 'neutral'}>{t(`league.status.${league.status}`)}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Stat({ label, value, hint, gold }: { label: string; value: string; hint?: string; gold?: boolean }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <dt className="text-[12.5px] text-ink-2">{label}</dt>
      <dd className={cx('display mt-1.5 text-[26px] leading-none', gold ? 'text-gold' : 'text-ink')}>{value}</dd>
      {hint && <p className="mt-1.5 text-[12px] text-ink-3 tabular-nums">{hint}</p>}
    </div>
  );
}

export const variantName = (id: string): string => VARIANTS[id as keyof typeof VARIANTS]?.name ?? id;
