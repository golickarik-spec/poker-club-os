import type { ReactNode } from 'react';
import { LuArrowLeft, LuClock, LuCopy, LuHand, LuLayers, LuTrophy, LuUsers } from 'react-icons/lu';
import { toasts } from '../app/context.ts';
import { chips, dateLong, durationLabel, ordinal } from '../app/format.ts';
import { go, useDb, useMe, useT } from '../app/hooks.ts';
import type { TournamentResult } from '../platform/types.ts';
import { Badge, BotTag, Button, cx, DemoTag, EmptyState, Panel, PanelHeader } from '../ui/core.tsx';
import { accentStyle, Avatar, ClubLogo, ClubName } from '../ui/identity.tsx';

export function Results({ tournamentId, staffView }: { tournamentId: string; staffView?: boolean }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const result = db.results[tournamentId];
  const tournament = db.tournaments[tournamentId];
  if (!result || !tournament) {
    return (
      <EmptyState
        icon={<LuTrophy />}
        title={t('results.none.title')}
        body={t('results.none.body')}
        action={<Button onClick={() => go(tournament ? 'tournament' : 'tournaments', tournament ? { id: tournamentId } : {})}>{t('table.back_to_lobby')}</Button>}
      />
    );
  }
  const club = db.clubs[result.clubId]!;
  const winner = result.places[0]!;
  const winnerUser = db.users[winner.userId];
  const mine = result.places.find((p) => p.userId === me.id);
  const nameOf = (id: string | null): string => (id ? (db.users[id]?.name ?? '—') : '—');
  const finalTable = result.places.slice(0, Math.min(9, tournament.structure.tableSize, result.entrants));

  const copySummary = () => {
    const text = `${result.name} — ${club.name}\n1. ${winner.name}\n2. ${result.places[1]?.name ?? ''}\n3. ${result.places[2]?.name ?? ''}\n${result.entrants} players`;
    navigator.clipboard?.writeText(text).then(
      () => toasts.push('success', t('results.copied')),
      () => toasts.push('info', t('results.copy_failed')),
    );
  };

  return (
    <div style={accentStyle(club.branding.accent)} data-testid="results">
      {!staffView && (
        <button type="button" onClick={() => go('tournament', { id: tournamentId })} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
          <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
          {t('results.back')}
        </button>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* Winner card — laid out as a self-contained image a club could post. */}
        <div>
          <div className="relative overflow-hidden rounded-hero border border-gold/30 bg-[#0f1319] px-6 pt-6 pb-5 text-center" data-testid="winner-card">
            <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full bg-gold/10 blur-3xl" aria-hidden />
            <p className="relative flex items-center justify-center gap-2 text-[12.5px] text-ink-2">
              <ClubLogo branding={club.branding} name={club.name} size={20} />
              <ClubName club={club} />
            </p>
            <p className="relative mt-1 text-[15px] font-medium text-ink">{result.name}</p>
            <div className="relative mx-auto mt-6 w-fit">
              <span className="absolute -inset-2 rounded-full border border-gold/40" aria-hidden />
              <span className="absolute -inset-4 rounded-full border border-gold/15" aria-hidden />
              {winnerUser ? <Avatar user={winnerUser} size={104} /> : <span className="block size-[104px] rounded-full bg-raised" />}
              <span className="absolute -end-1 -bottom-1 flex size-9 items-center justify-center rounded-full bg-gold text-[#1c1505] shadow-lg">
                <LuTrophy className="size-5" aria-hidden />
              </span>
            </div>
            <p className="relative mt-6 text-[13px] font-medium text-gold">{t('results.champion')}</p>
            <p className={cx('relative mt-1 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink', club.branding.titleFont === 'serif' && 'font-serif font-medium')} data-testid="winner-name">
              {winner.name}
            </p>
            <p className="relative mt-1 flex items-center justify-center gap-2 text-[13px] text-ink-2">
              {winner.isBot && <BotTag label={t('common.bot')} />}
              {t('results.beat_field', { n: result.entrants })}
            </p>
            <dl className="relative mt-6 grid grid-cols-3 divide-x divide-line border-t border-line pt-4 text-[12.5px] rtl:divide-x-reverse">
              <div>
                <dt className="text-ink-3">{t('results.players_label')}</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums">{result.entrants}</dd>
              </div>
              <div>
                <dt className="text-ink-3">{t('results.duration')}</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums">{durationLabel(result.durationMin, t.lang)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">{t('results.hands')}</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums">{chips(result.hands)}</dd>
              </div>
            </dl>
            <p className="relative mt-4 text-[11.5px] text-ink-3">{dateLong(result.completedAt, t.lang)} · Poker Club OS</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<LuCopy className="size-3.5" aria-hidden />} onClick={copySummary}>
              {t('results.copy')}
            </Button>
            {result.seeded && <DemoTag label={t('results.seeded')} />}
            <span className="text-[12px] text-ink-3">{t('results.share_note')}</span>
          </div>

          {mine && (
            <Panel className="mt-4" data-testid="my-result">
              <p className="text-[13px] text-ink-2">{t('results.your_result')}</p>
              <p className="mt-1 text-[26px] leading-none font-semibold text-ink tabular-nums">
                {ordinal(mine.place, t.lang)} <span className="text-[15px] font-normal text-ink-3">{t('results.of_n', { n: result.entrants })}</span>
              </p>
              <p className="mt-2 text-[13px] text-ink-2 tabular-nums">
                {t('results.points_earned', { n: mine.points })}
                {mine.bustedBy ? ` · ${t('results.out_by', { name: nameOf(mine.bustedBy), level: mine.bustLevel ?? 0 })}` : ''}
              </p>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={<LuUsers />} label={t('results.players_label')} value={String(result.entrants)} />
            <Tile icon={<LuClock />} label={t('results.duration')} value={durationLabel(result.durationMin, t.lang)} />
            <Tile icon={<LuHand />} label={t('results.hands')} value={chips(result.hands)} />
            <Tile icon={<LuLayers />} label={t('results.chips')} value={chips(result.totalChips, true)} />
          </dl>

          <Panel>
            <PanelHeader title={t('results.final_table')} hint={t('results.final_table_hint', { level: result.levelReached })} />
            <ol className="grid gap-2 sm:grid-cols-3">
              {finalTable.map((p) => {
                const u = db.users[p.userId];
                return (
                  <li key={p.userId} className={cx('flex items-center gap-2.5 rounded-inner border px-2.5 py-2', p.place === 1 ? 'border-gold/40 bg-gold/8' : 'border-line', p.userId === me.id && 'ring-1 ring-accent')}>
                    <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold tabular-nums', p.place === 1 ? 'bg-gold text-[#1c1505]' : p.place <= 3 ? 'bg-gold/15 text-gold' : 'bg-raised text-ink-2')}>{p.place}</span>
                    {u && <Avatar user={u} size={26} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                      <span className="block text-[11.5px] text-ink-3 tabular-nums">+{p.points}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel pad={false}>
            <div className="px-4 pt-4 sm:px-5">
              <PanelHeader title={t('results.standings')} hint={t('results.standings_hint')} />
            </div>
            <StandingsFull result={result} meId={me.id} nameOf={nameOf} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-3.5">
      <dt className="flex items-center gap-1.5 text-[12.5px] text-ink-2 [&>svg]:size-3.5 [&>svg]:text-ink-3">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 text-[20px] leading-none font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function StandingsFull({ result, meId, nameOf }: { result: TournamentResult; meId: string; nameOf: (id: string | null) => string }) {
  const t = useT();
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full min-w-[460px] text-[13.5px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-[12px] text-ink-3">
            <th className="w-14 py-2 ps-4 text-start font-medium sm:ps-5">{t('results.col.place')}</th>
            <th className="py-2 text-start font-medium">{t('standings.player')}</th>
            <th className="py-2 pe-3 text-start font-medium">{t('results.col.out_by')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('results.col.level')}</th>
            <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('results.col.points')}</th>
          </tr>
        </thead>
        <tbody>
          {result.places.map((p) => (
            <tr key={p.userId} className={cx('border-t border-line', p.userId === meId && 'bg-accent/10')}>
              <td className="py-2 ps-4 text-ink-2 tabular-nums sm:ps-5">{p.place}</td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span className={cx('truncate text-ink', p.userId === meId && 'font-semibold')}>{p.name}</span>
                  {p.isBot && <BotTag label={t('common.bot')} />}
                  {p.place === 1 && <Badge tone="gold">{t('results.winner')}</Badge>}
                </span>
              </td>
              <td className="max-w-[160px] truncate py-2 pe-3 text-ink-2">{p.place === 1 ? '—' : nameOf(p.bustedBy)}</td>
              <td className="py-2 pe-3 text-end text-ink-2 tabular-nums">{p.bustLevel ?? '—'}</td>
              <td className="py-2 pe-4 text-end font-medium text-ink tabular-nums sm:pe-5">{p.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
