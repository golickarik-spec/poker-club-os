import { useMemo, useState } from 'react';
import { LuCalendarClock } from 'react-icons/lu';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { registrationOf } from '../platform/api.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { tournamentsForUser, userClubs } from '../platform/selectors.ts';
import type { Tournament } from '../platform/types.ts';
import { dayLabel, TournamentCard } from '../shared/tournament.tsx';
import { Button, EmptyState, PageHeader } from '../ui/core.tsx';
import { Segmented, Select } from '../ui/forms.tsx';

type Filter = 'all' | 'mine' | 'running' | 'upcoming' | 'finished';

export function Tournaments() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>('all');
  const [clubId, setClubId] = useState<string>('all');
  const clubs = userClubs(db, me.id).filter((c) => c.membership.status === 'active');
  const all = useMemo(() => tournamentsForUser(db, me.id), [db, me.id]);

  const filtered = all.filter((x) => {
    if (clubId !== 'all' && x.clubId !== clubId) return false;
    const mine = !!registrationOf(x, me.id) && registrationOf(x, me.id)!.status !== 'rejected';
    switch (filter) {
      case 'mine':
        return mine && x.status !== 'CANCELLED';
      case 'running':
        return isLive(x.status);
      case 'upcoming':
        return isUpcoming(x.status);
      case 'finished':
        return x.status === 'COMPLETED' || x.status === 'CANCELLED';
      default:
        return x.status !== 'COMPLETED' && x.status !== 'CANCELLED';
    }
  });

  // Group into "Running now", then by day.
  const groups: { title: string; items: Tournament[] }[] = [];
  const push = (title: string, item: Tournament) => {
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(item);
    else groups.push({ title, items: [item] });
  };
  for (const x of filtered) {
    if (isLive(x.status)) push(t('tournaments.group.running'), x);
    else if (x.startMode === 'when_full' && isUpcoming(x.status)) push(t('tournaments.group.sng'), x);
    else push(dayLabel(t, x.status === 'COMPLETED' || x.status === 'CANCELLED' ? (x.completedAt ?? x.startAt) : x.startAt, now), x);
  }

  return (
    <>
      <PageHeader title={t('tournaments.title')} subtitle={t('tournaments.subtitle')} />
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <div className="max-w-full overflow-x-auto">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            label={t('tournaments.filter')}
            options={[
              { value: 'all', label: t('tournaments.filter.all') },
              { value: 'mine', label: t('tournaments.filter.mine') },
              { value: 'running', label: t('tournaments.filter.running') },
              { value: 'upcoming', label: t('tournaments.filter.upcoming') },
              { value: 'finished', label: t('tournaments.filter.finished') },
            ]}
          />
        </div>
        {clubs.length > 1 && (
          <Select
            value={clubId}
            onChange={setClubId}
            aria-label={t('common.club')}
            className="h-9 w-auto min-w-[170px]"
            options={[{ value: 'all', label: t('tournaments.all_clubs') }, ...clubs.map((c) => ({ value: c.club.id, label: c.club.name }))]}
          />
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<LuCalendarClock />}
          title={clubs.length === 0 ? t('home.no_clubs.title') : t('tournaments.empty.title')}
          body={clubs.length === 0 ? t('home.no_clubs.body') : t('tournaments.empty.body')}
          action={
            clubs.length === 0 ? (
              <Button variant="primary" onClick={() => go('clubs')}>
                {t('clubs.join')}
              </Button>
            ) : filter !== 'all' ? (
              <Button onClick={() => setFilter('all')}>{t('tournaments.show_all')}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group, i) => (
            <section key={group.title + i}>
              <h2 className="mb-2.5 text-[13px] font-medium text-ink-2">{group.title}</h2>
              <div className="grid gap-2.5 2xl:grid-cols-2">
                {group.items.map((x) => (
                  <TournamentCard key={x.id} db={db} tournament={x} userId={me.id} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
