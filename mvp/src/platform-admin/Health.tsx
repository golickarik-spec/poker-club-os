import { useEffect, useState } from 'react';
import { num } from '../app/format.ts';
import { useDb, useRuntime, useT } from '../app/hooks.ts';
import { runtime } from '../app/context.ts';
import { activeTables } from '../engine/tournament.ts';
import { Sparkline, StatTile } from '../ui/charts.tsx';
import { Badge, DemoTag, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';

/** Simulated service metrics: start from the seeded figures and wander a little so the page feels live. */
function useJitter(base: number[], spread: number): number[][] {
  const [series, setSeries] = useState<number[][]>(() => base.map((b) => Array.from({ length: 24 }, (_, i) => b * (1 + Math.sin(i * 1.3 + b) * spread * 0.5))));
  useEffect(() => {
    const id = setInterval(() => {
      setSeries((prev) => prev.map((s, i) => [...s.slice(1), Math.max(1, base[i]! * (1 + (Math.random() - 0.5) * spread))]));
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return series;
}

export function Health() {
  const t = useT();
  const db = useDb();
  const services = db.health;
  const latency = useJitter(services.map((s) => s.latencyMs), 0.35);
  const live = useRuntime(() => {
    let tournaments = 0;
    let tables = 0;
    let players = 0;
    for (const l of runtime.lives.values()) {
      if (l.status === 'COMPLETED') continue;
      tournaments++;
      tables += activeTables(l).length;
      for (const id in l.players) if (l.players[id]!.status === 'active') players++;
    }
    return { tournaments, tables, players };
  });
  const degraded = services.filter((s) => s.status !== 'operational');
  const perHand = db.counters.sessionHands > 0 ? db.counters.sessionEngineMs / db.counters.sessionHands : 0;
  return (
    <>
      <PageHeader title={t('health.title')} subtitle={t('health.subtitle')} />
      {degraded.length > 0 && (
        <Notice tone="warning" className="mb-5">
          <p className="font-medium">{t.n('health.degraded', degraded.length)}</p>
          <p className="mt-0.5 text-ink-2">{t('health.incident')}</p>
        </Notice>
      )}
      <h2 className="mb-2.5 text-[13px] font-medium text-ink-2">{t('health.measured')}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('health.live_tournaments')} value={num(live.tournaments)} hint={t('health.live_tournaments_hint')} />
        <StatTile label={t('health.live_tables')} value={num(live.tables)} hint={t('health.live_players', { n: num(live.players) })} />
        <StatTile label={t('platform.session.hands')} value={num(db.counters.sessionHands)} hint={t('health.session_hint')} />
        <StatTile label={t('platform.session.per_hand')} value={perHand > 0 ? `${perHand.toFixed(2)} ms` : '—'} hint={t('health.per_hand_hint')} />
      </div>
      <p className="mt-2 text-[12.5px] text-ink-3">{t('platform.session.note')}</p>

      <Panel pad={false} className="mt-6">
        <div className="px-4 pt-4 sm:px-5">
          <PanelHeader title={t('health.services')} hint={t('health.services_hint')} action={<DemoTag label={t('common.simulated')} />} />
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13.5px] tabular-nums">
            <thead>
              <tr className="border-y border-line text-[12px] text-ink-3">
                <th className="py-2 ps-4 text-start font-medium sm:ps-5">{t('health.col.service')}</th>
                <th className="py-2 text-start font-medium">{t('common.status')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('health.col.latency')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('health.col.trend')}</th>
                <th className="py-2 pe-4 text-end font-medium sm:pe-5">{t('health.col.uptime')}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s, i) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 ps-4 font-medium text-ink sm:ps-5">{t(`health.service.${s.id}`)}</td>
                  <td className="py-2.5">
                    <Badge tone={s.status === 'operational' ? 'success' : s.status === 'degraded' ? 'warning' : 'danger'} dot pulse={s.status !== 'operational'}>
                      {t(`health.status.${s.status}`)}
                    </Badge>
                  </td>
                  <td className="py-2.5 pe-3 text-end text-ink">{Math.round(latency[i]?.at(-1) ?? s.latencyMs)} ms</td>
                  <td className="py-2.5 pe-3">
                    <span className="flex justify-end">
                      <Sparkline values={latency[i] ?? []} width={110} height={26} />
                    </span>
                  </td>
                  <td className="py-2.5 pe-4 text-end text-ink-2 sm:pe-5">{s.uptime.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
