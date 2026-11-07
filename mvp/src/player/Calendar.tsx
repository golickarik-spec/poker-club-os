/**
 * The person's calendar (v0.4): month grid, week and list views over the tournaments they
 * can see, the seats they hold and league seasons, with personal reminders and an .ics export.
 * Times are shown in the viewer's local time; the club's timezone is noted when it differs.
 */
import { useMemo, useState } from 'react';
import { LuBell, LuBellRing, LuCalendarDays, LuChevronLeft, LuChevronRight, LuDownload, LuTrophy } from 'react-icons/lu';
import { act, toasts } from '../app/context.ts';
import { dateLong, timeOfDay, weekday } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import * as cal from '../platform/calendar.ts';
import type { Lang } from '../platform/types.ts';
import { gameShort } from '../shared/tournament.tsx';
import { Badge, Button, cx, EmptyState, PageHeader, Panel } from '../ui/core.tsx';
import { Checkbox, Segmented } from '../ui/forms.tsx';
import { Menu, MenuItem } from '../ui/overlay.tsx';

type View = 'month' | 'week' | 'list';
const DAY = 86_400_000;

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfMonth = (ts: number): number => {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addMonths = (ts: number, n: number): number => {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
};
/** Weeks start on Sunday in Hebrew and on Monday in English. */
const startOfWeek = (ts: number, lang: Lang): number => {
  const d = new Date(startOfDay(ts));
  const first = lang === 'he' ? 0 : 1;
  const back = (d.getDay() - first + 7) % 7;
  return d.getTime() - back * DAY;
};
const localTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Calendar() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => startOfDay(Date.now()));
  const [onlyMine, setOnlyMine] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const range = useMemo(() => {
    if (view === 'month') {
      const first = startOfMonth(cursor);
      const gridStart = startOfWeek(first, t.lang);
      const last = addMonths(first, 1);
      const gridEnd = startOfWeek(last + 6 * DAY, t.lang);
      return { from: gridStart, to: gridEnd, first, last };
    }
    if (view === 'week') {
      const from = startOfWeek(cursor, t.lang);
      return { from, to: from + 7 * DAY, first: from, last: from + 7 * DAY };
    }
    const from = startOfDay(cursor);
    return { from, to: from + 60 * DAY, first: from, last: from + 60 * DAY };
  }, [view, cursor, t.lang]);

  const events = useMemo(() => cal.eventsFor(db, me.id, range.from, range.to, { onlyMine }), [db, me.id, range.from, range.to, onlyMine]);
  const byDay = useMemo(() => {
    const m = new Map<number, cal.CalendarEvent[]>();
    for (const e of events) {
      const k = startOfDay(e.at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events]);

  const monthTitle = new Intl.DateTimeFormat(t.lang === 'he' ? 'he-IL' : 'en-GB', { month: 'long', year: 'numeric' }).format(view === 'month' ? range.first : cursor);
  const step = (n: number) => {
    setSelected(null);
    setCursor(view === 'month' ? addMonths(startOfMonth(cursor), n) : view === 'week' ? cursor + n * 7 * DAY : cursor + n * 30 * DAY);
  };
  const exportIcs = () => {
    const ics = cal.toIcs(events, now);
    const a = document.createElement('a');
    a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    a.download = 'poker-club-os.ics';
    a.click();
    toasts.push('success', t('calendar.exported'));
  };

  const days: number[] = [];
  for (let d = range.from; d < range.to; d += DAY) days.push(d);
  const selectedEvents = selected !== null ? (byDay.get(selected) ?? []) : [];
  const weekdays = Array.from({ length: 7 }, (_, i) => weekday(range.from + i * DAY, t.lang));

  return (
    <div data-testid="calendar">
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.hint')}
        actions={
          <Button size="sm" icon={<LuDownload className="size-4" aria-hidden />} onClick={exportIcs} data-testid="calendar-export">
            {t('calendar.export')}
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label={t('calendar.previous')} className="inline-flex size-8 items-center justify-center rounded-control border border-line-strong/70 text-ink-2 hover:bg-raised hover:text-ink" onClick={() => step(-1)} data-testid="calendar-prev">
            <LuChevronLeft className="size-4 flip-rtl" aria-hidden />
          </button>
          <button type="button" aria-label={t('calendar.next')} className="inline-flex size-8 items-center justify-center rounded-control border border-line-strong/70 text-ink-2 hover:bg-raised hover:text-ink" onClick={() => step(1)} data-testid="calendar-next">
            <LuChevronRight className="size-4 flip-rtl" aria-hidden />
          </button>
          <Button size="sm" variant="ghost" onClick={() => { setCursor(startOfDay(Date.now())); setSelected(null); }}>
            {t('calendar.today')}
          </Button>
          <h2 className="ms-2 text-[16px] font-semibold text-ink" data-testid="calendar-title">
            {monthTitle}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox checked={onlyMine} onChange={setOnlyMine} label={t('calendar.only_registered')} id="calendar-only-mine" />
          <Segmented
            value={view}
            onChange={(v) => { setView(v); setSelected(null); }}
            size="sm"
            label={t('calendar.title')}
            options={[
              { value: 'month', label: t('calendar.view.month') },
              { value: 'week', label: t('calendar.view.week') },
              { value: 'list', label: t('calendar.view.list') },
            ]}
          />
        </div>
      </div>

      {view !== 'list' && (
        <Panel pad={false} className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line/70 text-center text-[11.5px] font-medium text-ink-3">
            {weekdays.map((w) => (
              <div key={w} className="py-1.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7" data-testid="calendar-grid">
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              const outside = view === 'month' && (d < range.first || d >= range.last);
              const today = startOfDay(now) === d;
              const dayNum = new Date(d).getDate();
              return (
                <button
                  type="button"
                  key={d}
                  onClick={() => setSelected(selected === d ? null : d)}
                  aria-pressed={selected === d}
                  className={cx(
                    'flex min-h-[64px] flex-col items-stretch gap-0.5 border-b border-e border-line/50 p-1 text-start sm:min-h-[92px] sm:p-1.5',
                    outside && 'bg-bg/60 text-ink-3',
                    selected === d && 'bg-accent/10',
                    'hover:bg-raised/40',
                  )}
                  data-testid={`calendar-day-${new Date(d).toISOString().slice(0, 10)}`}
                >
                  <span className={cx('inline-flex size-6 items-center justify-center rounded-full text-[12px] tabular-nums', today ? 'bg-accent text-accent-ink font-semibold' : outside ? 'text-ink-3' : 'text-ink-2')}>{dayNum}</span>
                  {list.slice(0, view === 'week' ? 6 : 2).map((e) => (
                    <span key={e.id} className={cx('hidden truncate rounded-chip px-1 py-0.5 text-[11px] leading-tight sm:block', e.kind !== 'tournament' ? 'bg-gold/15 text-gold' : e.mine === 'registered' ? 'bg-accent/20 text-ink' : 'bg-raised text-ink-2')} title={e.title}>
                      {e.kind === 'tournament' ? `${timeOfDay(e.at, t.lang)} ${e.title}` : e.title}
                    </span>
                  ))}
                  {list.length > 0 && (
                    <span className="flex gap-0.5 sm:hidden" aria-label={String(list.length)}>
                      {list.slice(0, 3).map((e) => (
                        <span key={e.id} className={cx('size-1.5 rounded-full', e.kind !== 'tournament' ? 'bg-gold' : e.mine === 'registered' ? 'bg-accent' : 'bg-ink-3')} />
                      ))}
                    </span>
                  )}
                  {list.length > (view === 'week' ? 6 : 2) && <span className="hidden text-[11px] text-ink-3 sm:block">{t('calendar.more_n', { n: list.length - (view === 'week' ? 6 : 2) })}</span>}
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {(view === 'list' || selected !== null) && (
        <div className={cx(view !== 'list' && 'mt-4')} data-testid="calendar-list">
          {selected !== null && <h3 className="mb-2 text-[14px] font-semibold text-ink">{dateLong(selected, t.lang)}</h3>}
          {(view === 'list' ? events : selectedEvents).length === 0 ? (
            <EmptyState icon={<LuCalendarDays />} title={t('calendar.empty')} className="py-10" />
          ) : (
            <Panel pad={false} className="overflow-hidden">
              <ul className="rows">
                {(view === 'list' ? events : selectedEvents).map((e) => (
                  <EventRow key={e.id} e={e} lang={t.lang} showDate={view === 'list'} />
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ e, lang, showDate }: { e: cal.CalendarEvent; lang: Lang; showDate: boolean }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const open = () => (e.tournamentId ? go('tournament', { id: e.tournamentId }) : e.leagueId ? go('league', { id: e.leagueId }) : undefined);
  const differentTz = e.timezone !== localTz();
  const canRemind = e.kind === 'tournament' && e.mine === 'registered' && e.status !== 'COMPLETED' && e.status !== 'RUNNING' && e.status !== 'PAUSED';
  const remind = (minutes: number | null) => {
    if (act(() => cal.setReminder(db, me.id, e.tournamentId!, minutes)) !== undefined) {
      toasts.push('success', minutes === null ? t('calendar.reminder_off') : t('calendar.reminder_set', { when: t(minutes === 60 ? 'calendar.remind_1h' : 'calendar.remind_24h') }));
    }
  };
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid={`calendar-event-${e.id}`}>
      <span className="w-[52px] shrink-0 text-[12.5px] leading-tight text-ink-2 tabular-nums">
        {showDate && <span className="block">{new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' }).format(e.at)}</span>}
        <span className="block font-medium text-ink">{timeOfDay(e.at, lang)}</span>
      </span>
      <button type="button" onClick={open} className="min-w-0 flex-1 text-start">
        <span className="flex items-center gap-2">
          {e.kind !== 'tournament' && <LuTrophy className="size-3.5 shrink-0 text-gold" aria-hidden />}
          <span className="truncate text-[13.5px] font-medium text-ink hover:underline">{e.title}</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">
          {e.clubName}
          {e.kind !== 'tournament' ? ` · ${t(e.kind === 'league_start' ? 'calendar.league_start' : 'calendar.league_end')}` : e.game ? ` · ${gameShort(e.game)}` : ''}
          {differentTz ? ` · ${e.timezone}` : ''}
        </span>
      </button>
      {e.mine === 'registered' && <Badge tone="success">{t('calendar.registered')}</Badge>}
      {e.mine === 'pending' && <Badge tone="warning">{t('calendar.pending')}</Badge>}
      {canRemind && (
        <Menu
          trigger={(p) => (
            <button type="button" {...p} aria-label={t('calendar.remind')} title={t('calendar.remind')} className={cx('inline-flex size-8 items-center justify-center rounded-control hover:bg-raised', e.reminder ? 'text-accent' : 'text-ink-3 hover:text-ink')} data-testid={`calendar-remind-${e.tournamentId}`}>
              {e.reminder ? <LuBellRing className="size-4" aria-hidden /> : <LuBell className="size-4" aria-hidden />}
            </button>
          )}
        >
          {(close) => (
            <>
              {cal.REMINDER_OPTIONS.map((m) => (
                <MenuItem key={m} active={e.reminder === m} onClick={() => { close(); remind(m); }}>
                  {t(m === 60 ? 'calendar.remind_1h' : 'calendar.remind_24h')}
                </MenuItem>
              ))}
              {e.reminder !== null && (
                <MenuItem tone="danger" onClick={() => { close(); remind(null); }}>
                  {t('calendar.reminder_off')}
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      )}
    </li>
  );
}
