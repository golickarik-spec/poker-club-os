/**
 * Shared competition UI: tier emblems, leaderboard and league standings tables, achievement
 * badges. Pure presentation over `platform/competition.ts`.
 */
import type { ReactNode } from 'react';
import { LuArrowDown, LuArrowUp, LuMinus } from 'react-icons/lu';
import { ordinal } from '../app/format.ts';
import { useT, type T } from '../app/hooks.ts';
import type { LeaderboardRow, LeaderboardCategory } from '../platform/competition.ts';
import type { AchievementAward, AchievementKey, LeagueStandingRow, PlayerTier } from '../platform/types.ts';
import { BotTag, cx, DemoTag } from '../ui/core.tsx';
import { Avatar } from '../ui/identity.tsx';

// ----- Tier emblems: an original mark per rank — a bevelled shield with one to eight facets --

const TIER_STYLE: Record<PlayerTier, { fill: string; stroke: string; facets: number; ink: string }> = {
  rookie: { fill: '#2a333c', stroke: '#6f7a85', facets: 0, ink: '#c9d1d8' },
  bronze: { fill: '#5a3a24', stroke: '#c0804a', facets: 1, ink: '#f3d2b0' },
  silver: { fill: '#4a5460', stroke: '#c5ced8', facets: 2, ink: '#f4f6f8' },
  gold: { fill: '#6b4f12', stroke: '#e3c27a', facets: 3, ink: '#fff1c9' },
  platinum: { fill: '#2d4f58', stroke: '#9fe3e8', facets: 4, ink: '#e6fbfc' },
  diamond: { fill: '#2b3a7a', stroke: '#9fb6ff', facets: 5, ink: '#e9efff' },
  master: { fill: '#5a1f4e', stroke: '#f0a5e2', facets: 6, ink: '#ffe6fb' },
  legend: { fill: '#3a1a08', stroke: '#ff8a3d', facets: 8, ink: '#ffe8d6' },
};

export function TierEmblem({ tier, size = 28, className }: { tier: PlayerTier; size?: number; className?: string }) {
  const s = TIER_STYLE[tier];
  const facets = Array.from({ length: s.facets }, (_, i) => {
    const a = (-90 + (360 / Math.max(1, s.facets)) * i) * (Math.PI / 180);
    return { x: 20 + Math.cos(a) * 8.5, y: 21 + Math.sin(a) * 8.5 };
  });
  return (
    <svg viewBox="0 0 40 44" width={size} height={size * 1.1} className={cx('shrink-0', className)} aria-hidden>
      <path d="M20 2 L36 9 V24 C36 33 28 39 20 42 C12 39 4 33 4 24 V9 Z" fill={s.fill} stroke={s.stroke} strokeWidth="2" strokeLinejoin="round" />
      <path d="M20 8 L30 12.5 V24 C30 29.5 25 33.6 20 36 C15 33.6 10 29.5 10 24 V12.5 Z" fill="none" stroke={s.stroke} strokeOpacity="0.45" strokeWidth="1" />
      {facets.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r="2.1" fill={s.stroke} />
      ))}
      {s.facets === 0 && <circle cx="20" cy="21" r="3" fill="none" stroke={s.stroke} strokeWidth="1.5" />}
    </svg>
  );
}

export function TierChip({ tier, size = 'sm' }: { tier: PlayerTier; size?: 'sm' | 'md' }) {
  const t = useT();
  const s = TIER_STYLE[tier];
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-badge pe-2 ps-1 font-medium', size === 'sm' ? 'h-[22px] text-[11.5px]' : 'h-7 text-[13px]')} style={{ background: s.fill, color: s.ink, boxShadow: `0 0 0 1px ${s.stroke}66` }} data-testid={`tier-${tier}`}>
      <TierEmblem tier={tier} size={size === 'sm' ? 14 : 18} />
      {t(`tier.${tier}`)}
    </span>
  );
}

// ----- Leaderboard --------------------------------------------------------------------------

export const CATEGORY_KEYS: Record<LeaderboardCategory, string> = {
  score: 'board.cat.score',
  wins: 'board.cat.wins',
  monthly: 'board.cat.monthly',
  season: 'board.cat.season',
  final_tables: 'board.cat.final_tables',
  avg_finish: 'board.cat.avg_finish',
};

export function valueLabel(t: T, category: LeaderboardCategory, row: LeaderboardRow): string {
  if (category === 'avg_finish') return `${row.value}%`;
  return String(row.value);
}

export function LeaderboardTable({ rows, category, meId, onPick, emptyText }: { rows: LeaderboardRow[]; category: LeaderboardCategory; meId: string | null; onPick?: (userId: string) => void; emptyText: string }) {
  const t = useT();
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-[13px] text-ink-3">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[520px] text-[13.5px]" data-testid="leaderboard">
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
            {t('board.final_tables')}
          </th>
          <th scope="col" className="px-3 py-2.5 text-end font-medium">
            {t(CATEGORY_KEYS[category])}
          </th>
        </tr>
      </thead>
      <tbody className="[&>tr]:border-t [&>tr]:border-line/70">
        {rows.map((r) => {
          const isMe = r.userId === meId;
          return (
            <tr key={r.userId} className={cx(isMe && 'bg-accent/[0.08]', onPick && 'cursor-pointer hover:bg-raised/40')} onClick={onPick ? () => onPick(r.userId) : undefined} data-testid={isMe ? 'board-me' : undefined}>
              <td className="px-3 py-2">
                <span className={cx('display flex size-7 items-center justify-center rounded-full text-[12.5px]', r.rank === 1 ? 'bg-gold text-[#1c1505]' : r.rank <= 3 ? 'bg-gold/15 text-gold' : 'text-ink-3')}>{r.rank}</span>
              </td>
              <td className="px-2 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar user={r} size={28} />
                  <span className="min-w-0 truncate font-medium text-ink">{r.name}</span>
                  <TierEmblem tier={r.tier} size={16} />
                  {isMe && <span className="rounded-chip bg-accent/15 px-1.5 py-px text-[10.5px] font-semibold text-accent">{t('rankings.you')}</span>}
                  {r.includesDemo && <DemoTag label={t('common.demo')} />}
                </span>
              </td>
              <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums sm:table-cell">{r.played}</td>
              <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums sm:table-cell">{r.wins}</td>
              <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums md:table-cell">{r.finalTables}</td>
              <td className="display px-3 py-2 text-end text-[15px] text-ink tabular-nums">{valueLabel(t, category, r)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

// ----- League standings ---------------------------------------------------------------------

function Movement({ row }: { row: LeagueStandingRow }) {
  if (row.previousRank === null) return <span className="text-[11px] text-ink-3">{'·'}</span>;
  const d = row.previousRank - row.rank;
  if (d === 0) return <LuMinus className="size-3.5 text-ink-3" aria-label="0" />;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums', d > 0 ? 'text-success' : 'text-danger')}>
      {d > 0 ? <LuArrowUp className="size-3.5" aria-hidden /> : <LuArrowDown className="size-3.5" aria-hidden />}
      {Math.abs(d)}
    </span>
  );
}

export function StandingsTable({ rows, meId, frozen, limit }: { rows: LeagueStandingRow[]; meId: string | null; frozen?: boolean; limit?: number }) {
  const t = useT();
  const shown = limit ? rows.slice(0, limit) : rows;
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-[13px] text-ink-3">{t('league.no_standings')}</p>;
  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[480px] text-[13.5px]" data-testid="league-standings">
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
            {t('board.final_tables')}
          </th>
          {!frozen && (
            <th scope="col" className="w-14 px-2 py-2.5 text-end font-medium">
              {t('league.movement')}
            </th>
          )}
          <th scope="col" className="px-3 py-2.5 text-end font-medium">
            {t('rankings.points')}
          </th>
        </tr>
      </thead>
      <tbody className="[&>tr]:border-t [&>tr]:border-line/70">
        {shown.map((r) => {
          const isMe = r.userId === meId;
          return (
            <tr key={r.userId} className={cx(isMe && 'bg-accent/[0.08]')} data-testid={isMe ? 'standings-me' : undefined}>
              <td className="px-3 py-2">
                <span className={cx('display flex size-7 items-center justify-center rounded-full text-[12.5px]', r.rank === 1 ? 'bg-gold text-[#1c1505]' : r.rank <= 3 ? 'bg-gold/15 text-gold' : 'text-ink-3')}>{r.rank}</span>
              </td>
              <td className="px-2 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar user={r} size={28} />
                  <span className="min-w-0 truncate font-medium text-ink">{r.name}</span>
                  {r.isBot && <BotTag label={t('common.bot')} />}
                  {isMe && <span className="rounded-chip bg-accent/15 px-1.5 py-px text-[10.5px] font-semibold text-accent">{t('rankings.you')}</span>}
                </span>
              </td>
              <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums sm:table-cell">{r.played}</td>
              <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums sm:table-cell">{r.wins}</td>
              <td className="hidden px-2 py-2 text-end text-ink-2 tabular-nums md:table-cell">{r.finalTables}</td>
              {!frozen && (
                <td className="px-2 py-2 text-end">
                  <Movement row={r} />
                </td>
              )}
              <td className="display px-3 py-2 text-end text-[15px] text-ink tabular-nums">{r.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

// ----- Achievements ---------------------------------------------------------------------------

export const ACHIEVEMENT_KEYS: AchievementKey[] = ['first_tournament', 'first_final_table', 'first_win', 'five_wins', 'ten_final_tables', 'multi_variant', 'returning', 'season_champion', 'league_top10', 'club_champion', 'referral_first', 'referral_five'];

export function AchievementBadge({ award, awardKey, icon, progress }: { award: AchievementAward | undefined; awardKey: AchievementKey; icon: ReactNode; progress?: string }) {
  const t = useT();
  const earned = !!award;
  return (
    <div className={cx('flex items-center gap-3 rounded-inner border p-2.5', earned ? 'border-gold/40 bg-gold/8' : 'border-line opacity-70')} data-testid={`achievement-${awardKey}`} data-earned={earned ? '1' : '0'}>
      <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-full [&>svg]:size-4', earned ? 'bg-gold/20 text-gold' : 'bg-raised text-ink-3')}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{t(`achievement.key.${awardKey}`)}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{earned ? t('achievement.earned') : (progress ?? t('achievement.locked'))}</span>
      </span>
    </div>
  );
}

export const placeText = (t: T, place: number): string => ordinal(place, t.lang);
