/**
 * Spectator / streamer view (v0.4). Shows a table from the runtime's delayed feed: a spectator
 * sees the public view at least 30 seconds behind; club staff may switch to streamer mode,
 * which shows every hand face up but only ever from frames at least a minute old. The frame
 * is chosen on the "server" side (the runtime); this screen only renders what it is given.
 */
import { useEffect, useMemo, useState } from 'react';
import { LuArrowLeft, LuEye, LuRadio, LuTv } from 'react-icons/lu';
import { clock as clockLabel } from '../app/format.ts';
import { TableStage } from '../app/variants.ts';
import { runtime } from '../app/context.ts';
import { go, useDb, useMe, useNow, useRuntime, useSettings, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import { can } from '../platform/permissions.ts';
import { SPECTATE_DELAYS, STREAM_MIN_DELAY_MS, type SpectatorFrame } from '../platform/runtime.ts';
import { resolveTableBranding } from '../platform/table-branding.ts';
import type { DomainError } from '../platform/types.ts';
import { Badge, Button, cx, EmptyState } from '../ui/core.tsx';
import { Segmented } from '../ui/forms.tsx';
import { accentStyle, ClubMark } from '../ui/identity.tsx';
import type { Person } from './TableStage.tsx';
import { stageLabels } from './text.tsx';

export function SpectatorScreen({ tournamentId, tableNo, delayParam, modeParam }: { tournamentId: string; tableNo: number | null; delayParam?: string; modeParam?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe();
  const settings = useSettings();
  const now = useNow(1_000);
  const tournament = db.tournaments[tournamentId];
  const club = tournament ? db.clubs[tournament.clubId] : undefined;
  const [delay, setDelay] = useState<number>(() => (SPECTATE_DELAYS as readonly number[]).includes(Number(delayParam)) ? Number(delayParam) : SPECTATE_DELAYS[0]);
  const canStream = !!(tournament && me && can(db, me.id, 'tournaments.run', tournament.clubId));
  const [mode, setMode] = useState<'public' | 'streamer'>(modeParam === 'streamer' && canStream ? 'streamer' : 'public');
  const [overlay, setOverlay] = useState(false);
  const live = useRuntime(() => runtime.getLive(tournamentId));
  const chosenTable = tableNo ?? live?.tables.find((x) => !x.closed)?.no ?? 1;
  const [frame, setFrame] = useState<SpectatorFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the delayed feed once a second; the feed decides what is old enough to show.
  useEffect(() => {
    if (!tournament) return;
    const effectiveMode = mode === 'streamer' && delay >= STREAM_MIN_DELAY_MS ? 'streamer' : 'public';
    const pull = () => {
      try {
        setFrame(runtime.spectate(me?.id ?? null, tournamentId, chosenTable, delay, effectiveMode));
        setError(null);
      } catch (err) {
        setError((err as DomainError).code ?? 'unexpected');
      }
    };
    pull();
    const id = setInterval(pull, 1_000);
    return () => clearInterval(id);
  }, [tournamentId, chosenTable, delay, mode, me?.id, tournament]);

  const person = useMemo(
    () =>
      (id: string): Person => {
        const u = db.users[id];
        if (u) return { name: u.name, hue: u.hue, isBot: u.isBot };
        const p = live?.players[id];
        return { name: p?.name ?? '—', hue: 200, isBot: p?.isBot ?? true };
      },
    [db, live],
  );

  if (!tournament || !club) return <EmptyState title={t('table.not_running_title')} action={<Button onClick={() => go('tournaments')}>{t('nav.tournaments')}</Button>} />;
  if (!api.canWatchTournament(db, me?.id ?? null, tournament) || error === 'forbidden') {
    return <EmptyState icon={<LuEye />} title={t('spectate.forbidden_title')} body={t('spectate.forbidden_body')} action={<Button onClick={() => go('tournament', { id: tournamentId })}>{t('table.back_to_lobby')}</Button>} />;
  }
  const tableBranding = resolveTableBranding(tournament, club);
  const theme = settings.tableTheme === 'club' ? tableBranding.theme : settings.tableTheme;
  const themeVars = settings.tableTheme === 'club' ? tableBranding.vars : undefined;
  const labels = stageLabels(t, t('table.table_n', { n: chosenTable }), false);
  const running = tournament.status === 'RUNNING' || tournament.status === 'PAUSED';
  const behind = frame && !frame.waiting ? now - frame.at : delay;
  const streamerActive = frame?.mode === 'streamer';

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', overlay ? 'bg-[#00ff00]' : 'bg-bg')} style={accentStyle(club.branding.accent)} data-testid="spectator">
      {!overlay && (
        <header className="flex flex-wrap items-center gap-2 border-b border-line/70 bg-surface/85 px-3 py-2 sm:px-5">
          <button type="button" onClick={() => go('tournament', { id: tournamentId })} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
            {t('table.back_to_lobby')}
          </button>
          <span className="mx-1 text-ink-3">·</span>
          <span className="truncate text-[14px] font-semibold text-ink">{tournament.name}</span>
          <Badge tone={streamerActive ? 'accent' : 'neutral'} dot pulse={running}>
            {streamerActive ? t('spectate.streamer_badge') : t('spectate.delayed_badge')}
          </Badge>
          <span className="text-[12.5px] text-ink-2 tabular-nums" data-testid="spectate-behind">
            {t('spectate.behind', { time: clockLabel(behind) })}
          </span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Segmented value={String(delay)} onChange={(v) => setDelay(Number(v))} size="sm" label={t('spectate.delay')} options={SPECTATE_DELAYS.map((d) => ({ value: String(d), label: clockLabel(d) }))} />
            {canStream && (
              <Segmented
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  if (m === 'streamer' && delay < STREAM_MIN_DELAY_MS) setDelay(STREAM_MIN_DELAY_MS);
                }}
                size="sm"
                label={t('spectate.mode')}
                options={[
                  { value: 'public', label: t('spectate.mode.public') },
                  { value: 'streamer', label: t('spectate.mode.streamer') },
                ]}
              />
            )}
            <Button size="sm" variant="ghost" icon={<LuTv className="size-4" aria-hidden />} onClick={() => setOverlay(true)} data-testid="spectate-overlay">
              {t('spectate.overlay')}
            </Button>
          </div>
        </header>
      )}
      <div className="relative min-h-0 flex-1 px-1 pt-1 sm:px-4 sm:pt-3">
        {frame?.view ? (
          <TableStage
            view={frame.view}
            heroSeat={null}
            person={person}
            turn={null}
            theme={theme}
            themeVars={themeVars}
            deck={settings.deck}
            showBigBlinds={settings.showBigBlinds}
            lastEvent={null}
            eventCount={frame.handNo * 1000 + (frame.view.board.length ?? 0)}
            watermark={tableBranding.logo ? <ClubMark branding={{ ...club.branding, logo: tableBranding.logo }} size={40} /> : undefined}
            logoOpacity={tableBranding.opacity}
            logoScale={tableBranding.scale}
            labels={labels}
            motion={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<LuRadio />} title={running ? t('spectate.waiting_title') : t('table.not_running_title')} body={running ? t('spectate.waiting_body', { time: clockLabel(delay) }) : t('table.not_running_body')} />
          </div>
        )}
        {overlay && (
          <button type="button" onClick={() => setOverlay(false)} className="absolute end-3 top-3 rounded-control bg-black/60 px-2 py-1 text-[12px] text-white" data-testid="spectate-overlay-exit">
            {t('spectate.overlay_exit')}
          </button>
        )}
      </div>
      {!overlay && (
        <div className="shrink-0 border-t border-line/70 bg-surface/80 px-3 py-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
            {frame && !frame.waiting && (
              <>
                <span className="tabular-nums">{t('spectate.hand_n', { n: frame.handNo })}</span>
                <span className="tabular-nums">{t('spectate.level_n', { n: frame.level })}</span>
              </>
            )}
            <span>{streamerActive ? t('spectate.streamer_note', { time: clockLabel(STREAM_MIN_DELAY_MS) }) : t('spectate.public_note')}</span>
          </div>
          {live && live.tables.filter((x) => !x.closed).length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t('lobby.tab.tables')}>
              {live.tables
                .filter((x) => !x.closed)
                .map((x) => (
                  <button key={x.no} type="button" aria-pressed={x.no === chosenTable} onClick={() => go('spectate', { id: tournamentId, table: String(x.no), delay: String(delay), mode })} className={cx('rounded-chip border px-2.5 py-1 text-[12.5px] tabular-nums', x.no === chosenTable ? 'border-accent bg-accent/15 text-ink' : 'border-line text-ink-2 hover:border-line-strong')} data-testid={`spectate-table-${x.no}`}>
                    {t('table.table_n', { n: x.no })} · {x.state.seats.filter(Boolean).length}/{x.state.maxSeats}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
