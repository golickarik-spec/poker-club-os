import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LuChevronFirst, LuChevronLast, LuChevronLeft, LuChevronRight, LuCopy, LuHistory, LuPause, LuPlay } from 'react-icons/lu';
import { toasts } from '../app/context.ts';
import { blindsLabel, chips, dateTime } from '../app/format.ts';
import { go, useDb, useMe, useSettings, useT } from '../app/hooks.ts';
import type { HandEvent } from '../engine/holdem.ts';
import { applyEvent, blankView, cloneView, type TableView } from '../engine/view.ts';
import type { HandRecord } from '../platform/types.ts';
import { PlayingCard } from '../table/Card.tsx';
import { TableStage } from '../app/variants.ts';
import { logLine, stageLabels } from '../table/text.tsx';
import { Badge, Button, cx, DemoTag, EmptyState, IconButton, PageHeader, Panel } from '../ui/core.tsx';
import { Segmented, Slider } from '../ui/forms.tsx';
import { Dialog } from '../ui/overlay.tsx';

const heroCards = (record: HandRecord) => {
  const e = record.events.find((x) => x.t === 'hole' && x.seat === record.heroSeat);
  return e && e.t === 'hole' && e.cards ? e.cards : [];
};

export function Hands() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const settings = useSettings();
  const [openId, setOpenId] = useState<string | null>(null);
  const hands = useMemo(() => db.hands.filter((h) => h.userId === me.id).sort((a, b) => b.at - a.at), [db.hands, me.id]);
  const open = hands.find((h) => h.id === openId) ?? null;
  return (
    <>
      <PageHeader title={t('hands.title')} subtitle={t('hands.subtitle')} />
      {hands.length === 0 ? (
        <EmptyState
          icon={<LuHistory />}
          title={t('hands.empty.title')}
          body={t('hands.empty.body')}
          action={
            <Button variant="primary" onClick={() => go('tournaments')}>
              {t('hands.empty.action')}
            </Button>
          }
        />
      ) : (
        <Panel pad={false}>
          <ul className={cx('divide-y divide-line', settings.deck === 'four_color' && 'deck-four')}>
            {hands.map((h) => {
              const cards = heroCards(h);
              return (
                <li key={h.id}>
                  <button type="button" onClick={() => setOpenId(h.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-raised/50 sm:gap-4 sm:px-5" data-testid="hand-row">
                    <span className="flex shrink-0 gap-1" dir="ltr">
                      {cards.map((c) => (
                        <PlayingCard key={c} card={c} width={30} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink">{h.heroHand ?? t('hands.no_showdown')}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">
                        {h.tournamentName} · {t('table.log.hand', { n: h.handNo })} · <span dir="ltr">{blindsLabel(h.blinds)}</span> · {dateTime(h.at, t.lang)}
                      </span>
                    </span>
                    {h.tournamentId === 'seed' && <DemoTag label={t('common.demo')} className="hidden sm:inline-flex" />}
                    <span className={cx('w-20 shrink-0 text-end text-[14px] font-semibold tabular-nums', h.net > 0 ? 'text-success' : h.net < 0 ? 'text-danger' : 'text-ink-3')} dir="ltr">
                      {h.net > 0 ? '+' : ''}
                      {chips(h.net)}
                    </span>
                    <LuChevronRight className="size-4 shrink-0 text-ink-3 flip-rtl" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <Dialog open={open !== null} onClose={() => setOpenId(null)} title={open ? `${open.tournamentName} · ${t('table.log.hand', { n: open.handNo })}` : ''} size="xl">
        {open && <Replayer record={open} />}
      </Dialog>
    </>
  );
}

/** Plain text of a log line's node (strings and nested children), for the copy button. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

/** Indices of the events at which the replayer stops. */
function stepIndices(events: HandEvent[]): number[] {
  const out: number[] = [];
  let lastHole = -1;
  events.forEach((e, i) => {
    if (e.t === 'hole') lastHole = i;
  });
  events.forEach((e, i) => {
    if (i === lastHole || e.t === 'action' || e.t === 'street' || e.t === 'showdown' || e.t === 'award') out.push(i);
  });
  if (out[out.length - 1] !== events.length - 1) out.push(events.length - 1);
  return out;
}

export function Replayer({ record }: { record: HandRecord }) {
  const t = useT();
  const settings = useSettings();
  const steps = useMemo(() => stepIndices(record.events), [record]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<'0.5' | '1' | '2'>('1');
  // Street markers: the step at which each street (and the showdown) begins.
  const streets = useMemo(() => {
    const out: { key: string; step: number }[] = [{ key: 'preflop', step: 0 }];
    steps.forEach((idx, i) => {
      const e = record.events[idx]!;
      if (e.t === 'street') out.push({ key: e.street, step: i });
      else if (e.t === 'showdown' && !out.some((x) => x.key === 'showdown')) out.push({ key: 'showdown', step: i });
    });
    return out;
  }, [steps, record]);

  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [record.id]);

  useEffect(() => {
    if (!playing) return;
    if (step >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setStep((s) => Math.min(steps.length - 1, s + 1)), 950 / Number(speed));
    return () => clearTimeout(id);
  }, [playing, step, steps.length, speed]);

  // Keyboard: arrows step, space plays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || (e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(steps.length - 1, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length]);

  const upto = steps[step] ?? 0;
  const view: TableView = useMemo(() => {
    const v = blankView(record.id, record.maxSeats);
    for (let i = 0; i <= upto; i++) applyEvent(v, record.events[i]!);
    return cloneView(v);
  }, [record, upto]);
  const lines = useMemo(() => {
    const nameOf = (seat: number) => (seat === record.heroSeat ? t('table.you') : (record.names[seat]?.name ?? String(seat + 1)));
    const out: { id: number; node: ReactNode; kind: string }[] = [];
    for (let i = 0; i <= upto; i++) {
      const line = logLine(t, record.events[i]!, nameOf, (seat) => seat === record.heroSeat);
      if (line) out.push({ id: i, ...line });
    }
    return out;
  }, [record, upto, t]);

  const person = (playerId: string) => {
    const entry = Object.values(record.names).find((n) => n.userId === playerId);
    return { name: entry?.name ?? '—', hue: [...playerId].reduce((a, c) => a + c.charCodeAt(0), 0) % 360, isBot: entry?.isBot ?? true };
  };
  const current = record.events[upto];
  const copyHand = () => {
    const nameOf = (seat: number) => (seat === record.heroSeat ? t('table.you') : (record.names[seat]?.name ?? String(seat + 1)));
    const text = [`${record.tournamentName} · ${t('table.table_n', { n: record.tableNo })} · #${record.handNo} · ${blindsLabel(record.blinds)}`, ...record.events.map((e) => logLine(t, e, nameOf, (seat) => seat === record.heroSeat)).filter((l): l is NonNullable<typeof l> => !!l).map((l) => textOf(l.node))].join('\n');
    navigator.clipboard?.writeText(text).then(() => toasts.push('success', t('replay.copied')), () => toasts.push('info', text));
  };

  return (
    <div data-testid="replayer">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="relative aspect-[4/3] overflow-hidden rounded-panel bg-[#080b0f] sm:aspect-[16/10]">
            <div className="absolute inset-0 p-2 sm:p-3">
              <TableStage
                view={view}
                heroSeat={record.heroSeat}
                person={person}
                turn={null}
                theme={settings.tableTheme === 'club' ? 'midnight' : settings.tableTheme}
                deck={settings.deck}
                showBigBlinds={false}
                lastEvent={current ?? null}
                eventCount={upto}
                labels={stageLabels(t, t('table.table_n', { n: record.tableNo }), true)}
                motion={false}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <IconButton label={t('replay.first')} onClick={() => setStep(0)} disabled={step === 0}>
              <LuChevronFirst className="size-5 flip-rtl" aria-hidden />
            </IconButton>
            <IconButton label={t('replay.previous')} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} data-testid="replay-prev">
              <LuChevronLeft className="size-5 flip-rtl" aria-hidden />
            </IconButton>
            <Button
              variant="primary"
              className="w-28"
              icon={playing ? <LuPause className="size-4" aria-hidden /> : <LuPlay className="size-4" aria-hidden />}
              onClick={() => {
                if (step >= steps.length - 1) setStep(0);
                setPlaying((p) => !p);
              }}
              data-testid="replay-play"
            >
              {playing ? t('replay.pause') : t('replay.play')}
            </Button>
            <IconButton label={t('replay.next')} onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} disabled={step >= steps.length - 1} data-testid="replay-next">
              <LuChevronRight className="size-5 flip-rtl" aria-hidden />
            </IconButton>
            <IconButton label={t('replay.last')} onClick={() => setStep(steps.length - 1)} disabled={step >= steps.length - 1}>
              <LuChevronLast className="size-5 flip-rtl" aria-hidden />
            </IconButton>
            <div className="ms-2 min-w-0 flex-1">
              <Slider value={step} onChange={setStep} min={0} max={Math.max(1, steps.length - 1)} label={t('replay.position')} id="replay-scrub" />
            </div>
            <span dir="ltr" className="w-14 shrink-0 text-center text-[12.5px] text-ink-3 tabular-nums" data-testid="replay-step">
              {step + 1} / {steps.length}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('replay.position')}>
              {streets.map((st) => (
                <button key={st.key} type="button" onClick={() => setStep(st.step)} aria-pressed={step >= st.step && (streets.find((x) => x.step > st.step)?.step ?? Infinity) > step} className={cx('rounded-chip border px-2 py-0.5 text-[12px]', step >= st.step && (streets.find((x) => x.step > st.step)?.step ?? Infinity) > step ? 'border-accent bg-accent/15 text-ink' : 'border-line text-ink-2 hover:border-line-strong')} data-testid={`replay-street-${st.key}`}>
                  {t(`replay.street.${st.key}`)}
                </button>
              ))}
            </div>
            <Segmented value={speed} onChange={setSpeed} size="sm" label={t('replay.speed')} options={[{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} className="ms-auto" />
            <Button size="sm" variant="ghost" icon={<LuCopy className="size-3.5" aria-hidden />} onClick={copyHand} data-testid="replay-copy">
              {t('replay.copy')}
            </Button>
            <span className="hidden text-[11.5px] text-ink-3 sm:inline">{t('replay.keys')}</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={record.net > 0 ? 'success' : record.net < 0 ? 'danger' : 'neutral'}>
              <span dir="ltr">
                {record.net > 0 ? '+' : ''}
                {chips(record.net)}
              </span>
            </Badge>
            <span className="text-[12.5px] text-ink-3" dir="ltr">
              {blindsLabel(record.blinds)}
            </span>
          </div>
          <ol className="max-h-[300px] min-h-[120px] flex-1 space-y-1 overflow-y-auto rounded-inner border border-line bg-bg p-3 text-[12.5px] leading-snug text-ink-2 lg:max-h-[420px]">
            {lines.map((line, i) => (
              <li key={line.id} className={cx(line.kind === 'street' && 'pt-1.5 text-ink', line.kind === 'result' && 'pt-1.5 text-ink', i === lines.length - 1 && 'rounded bg-raised px-1.5 py-0.5 text-ink')}>
                {line.node}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{t('replay.note')}</p>
        </div>
      </div>
    </div>
  );
}
