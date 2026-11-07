/** A league season as players see it: standings, the tournaments that count, the rules, the champion. */
import { useState } from 'react';
import { LuArrowLeft, LuTrophy } from 'react-icons/lu';
import { dateShort } from '../app/format.ts';
import { go, useDb, useMe, useT } from '../app/hooks.ts';
import * as comp from '../platform/competition.ts';
import { StandingsTable } from '../shared/competition.tsx';
import { Badge, Button, EmptyState, Fact, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { accentStyle, Avatar, ClubCover, ClubName } from '../ui/identity.tsx';
import { Tabs } from '../ui/overlay.tsx';

type Tab = 'standings' | 'tournaments' | 'rules';

export function LeaguePage({ leagueId }: { leagueId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [tab, setTab] = useState<Tab>('standings');
  const league = db.leagues.find((l) => l.id === leagueId);
  const club = league ? db.clubs[league.clubId] : undefined;
  if (!league || !club || !comp.visibleLeagues(db, me.id, club.id).some((l) => l.id === league.id)) {
    return <EmptyState icon={<LuTrophy />} title={t('league.not_found')} action={<Button onClick={() => go('rankings', { tab: 'leagues' })}>{t('nav.rankings')}</Button>} />;
  }
  const rows = comp.leagueStandings(db, league);
  const results = comp.leagueResults(db, league);
  const champion = league.championId ? db.users[league.championId] : undefined;
  const preset = comp.SCORING_PRESETS[league.scoring.preset];
  return (
    <div style={accentStyle(club.branding.accent)} data-testid="league-page">
      <button type="button" onClick={() => go('rankings', { tab: 'leagues' })} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        {t('nav.rankings')}
      </button>
      <div className="mb-5 overflow-hidden rounded-hero border border-line bg-surface">
        <ClubCover branding={club.branding} seed={Number(club.code)} className="h-24 sm:h-32" />
        <div className="px-4 py-4 sm:px-6">
          <PageHeader
            title={league.name}
            subtitle={
              <>
                <ClubName club={club} /> · {t(`league.type.${league.type}`)} · {dateShort(league.startAt, t.lang)} – {dateShort(league.endAt, t.lang)}
              </>
            }
            actions={<Badge tone={league.status === 'active' ? 'success' : 'neutral'}>{t(`league.status.${league.status}`)}</Badge>}
          />
          {league.description && <p className="-mt-2 max-w-[70ch] text-[13.5px] text-ink-2">{league.description}</p>}
          {champion && (
            <div className="mt-3 flex items-center gap-3 rounded-inner border border-gold/40 bg-gold/8 p-3" data-testid="league-champion">
              <LuTrophy className="size-5 text-gold" aria-hidden />
              <Avatar user={champion} size={30} />
              <span className="min-w-0">
                <span className="block text-[12px] text-ink-3">{t('league.champion')}</span>
                <span className="block truncate text-[14px] font-semibold text-ink">{champion.name}</span>
              </span>
            </div>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        label={league.name}
        className="mb-4"
        tabs={[
          { value: 'standings', label: t('league.tab.standings'), count: rows.length },
          { value: 'tournaments', label: t('league.tab.tournaments'), count: results.length },
          { value: 'rules', label: t('league.tab.rules') },
        ]}
      />
      {tab === 'standings' && (
        <Panel pad={false} className="overflow-hidden">
          <StandingsTable rows={rows} meId={me.id} frozen={!!league.finalStandings} />
          {league.finalStandings && <p className="border-t border-line/70 px-3 py-2 text-[12px] text-ink-3">{t('league.frozen_note', { date: dateShort(league.completedAt ?? 0, t.lang) })}</p>}
        </Panel>
      )}
      {tab === 'tournaments' && (
        <Panel pad={false} className="overflow-hidden">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-3">{t('league.no_tournaments')}</p>
          ) : (
            <ul className="rows">
              {[...results].reverse().map((r) => (
                <li key={r.tournamentId}>
                  <button type="button" onClick={() => go('results', { id: r.tournamentId })} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-raised/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{r.name}</span>
                      <span className="block text-[12px] text-ink-3">
                        {dateShort(r.completedAt, t.lang)} · {t('results.of_n', { n: r.entrants })} · {t(`variant.${r.game ?? 'nlhe'}`)}
                      </span>
                    </span>
                    <span className="text-[12.5px] text-ink-2">{r.places[0]?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {tab === 'rules' && (
        <Panel>
          <PanelHeader title={t('league.rules_title')} hint={t('league.rules_version', { v: league.scoring.version })} />
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Fact label={t('league.scoring')}>{t(`league.preset.${league.scoring.preset}`)}</Fact>
            <Fact label={t('league.best_n')}>{league.scoring.bestN > 0 ? String(league.scoring.bestN) : t('league.all_results')}</Fact>
            <Fact label={t('league.participation')}>{league.scoring.participation > 0 ? `${league.scoring.participation}${league.scoring.participationCap > 0 ? ` × ≤${league.scoring.participationCap}` : ''}` : '—'}</Fact>
            <Fact label={t('league.field_adjusted')}>{league.scoring.fieldAdjusted || league.scoring.preset === 'performance' ? t('common.yes') : t('common.no')}</Fact>
            <Fact label={t('league.eligible')}>{league.eligibility === 'all_members' ? t('league.eligible_all') : t('league.eligible_selected', { n: league.memberIds.length })}</Fact>
            <Fact label={t('league.counts')}>{league.includeAll ? t('league.counts_all') : t('league.counts_assigned', { n: league.tournamentIds.length })}</Fact>
          </dl>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">{preset.describe}</p>
        </Panel>
      )}
    </div>
  );
}
