/** The v2 lobby title block, extracted unchanged so the v3 build can swap it. */
import { LuGlobe, LuKeyRound, LuLock } from 'react-icons/lu';
import { useT } from '../app/hooks.ts';
import type { Club, DB, Tournament } from '../platform/types.ts';
import { presetLabel, StatusPill } from '../shared/tournament.tsx';
import { Badge, cx } from '../ui/core.tsx';
import { bannerClass, ClubLogo, ClubName } from '../ui/identity.tsx';

export interface LobbyHeroProps {
  db: DB;
  tournament: Tournament;
  club: Club;
  lateReg: boolean | undefined;
}

export function LobbyHero({ tournament, club, lateReg }: LobbyHeroProps) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-hero border border-line bg-surface">
      <div className={cx('h-2', bannerClass(tournament.banner))} />
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[13px] text-ink-2">
              <ClubLogo branding={club.branding} name={club.name} size={20} />
              <ClubName club={club} />
              <span className="text-ink-3">·</span>
              {presetLabel(t, tournament)}
            </p>
            <h1 className="mt-1.5 text-[24px] leading-tight font-semibold tracking-[-0.015em] text-ink sm:text-[28px]" data-testid="lobby-title">
              {tournament.name}
            </h1>
          </div>
          <StatusPill status={tournament.status} lateReg={lateReg} />
        </div>
        {tournament.description && <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{tournament.description}</p>}
        <AccessBadges tournament={tournament} />
      </div>
    </div>
  );
}

export function AccessBadges({ tournament, className }: { tournament: Tournament; className?: string }) {
  const t = useT();
  return (
    <p className={cx('mt-3 flex flex-wrap gap-1.5', className)} data-testid="lobby-access">
      <Badge tone={tournament.visibility === 'public' ? 'info' : 'neutral'}>
        {tournament.visibility === 'public' ? <LuGlobe className="size-3" aria-hidden /> : <LuLock className="size-3" aria-hidden />}
        {t(`tour.visibility.${tournament.visibility}`)}
      </Badge>
      <Badge>{t(`tour.access_long.${tournament.access}`)}</Badge>
      {tournament.accessCode !== null && (
        <Badge>
          <LuKeyRound className="size-3" aria-hidden />
          {t('tour.access.code')}
        </Badge>
      )}
    </p>
  );
}
