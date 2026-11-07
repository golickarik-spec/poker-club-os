/**
 * v0.3 lobby title block: the event as a marquee — club mark, display title, the
 * access badges, and the same table cameo as the home page showing the clock.
 */
import { useNow, useT } from '../app/hooks.ts';
import { presetLabel, StatusPill, structureSummary, useLiveBrief } from '../shared/tournament.tsx';
import { TableCameo } from '../shared/tournament.v3.tsx';
import { ClubLogo, ClubName } from '../ui/identity.tsx';
import { AccessBadges, type LobbyHeroProps } from './lobby-hero.tsx';

export function LobbyHero({ db, tournament, club, lateReg }: LobbyHeroProps) {
  const t = useT();
  const now = useNow(1000);
  const brief = useLiveBrief(tournament.id);
  return (
    <section className="stage relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" aria-hidden />
      <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_240px] md:items-center">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <ClubLogo branding={club.branding} name={club.name} size={18} />
            <ClubName club={club} />
            <span className="text-ink-3">·</span>
            <span>{presetLabel(t, tournament)}</span>
            <StatusPill status={tournament.status} lateReg={lateReg} />
          </p>
          <h1 className="display mt-2 text-[30px] leading-[1.02] text-ink sm:text-[38px]" data-testid="lobby-title">
            {tournament.name}
          </h1>
          <p className="mt-2 text-[13.5px] text-ink-2">{structureSummary(t, tournament.structure)}</p>
          {tournament.description && <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{tournament.description}</p>}
          <AccessBadges tournament={tournament} className="mt-4" />
        </div>
        <TableCameo db={db} tournament={tournament} now={now} brief={brief} />
      </div>
    </section>
  );
}
