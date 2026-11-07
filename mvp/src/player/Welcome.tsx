import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { LuArrowRight, LuEye } from 'react-icons/lu';
import { runtime, session, toasts } from '../app/context.ts';
import { blindsLabel } from '../app/format.ts';
import { useDb, useMediaQuery, useRuntime, useT } from '../app/hooks.ts';
import { IDENTITIES, identityContext, LanguageToggle } from '../app/shells.tsx';
import { occupiedSeats } from '../engine/holdem.ts';
import { activeTables } from '../engine/tournament.ts';
import type { TableDriver } from '../platform/runtime.ts';
import { DEMO_USERS } from '../platform/seed.ts';
import { summarise } from '../shared/tournament.tsx';
import { TableStage } from '../app/variants.ts';
import { stageLabels } from '../table/text.tsx';
import { Badge, Button, cx } from '../ui/core.tsx';
import { Field, TextInput } from '../ui/forms.tsx';
import { accentStyle, Avatar, ClubLogo, ClubMark, Wordmark } from '../ui/identity.tsx';
import { Dialog, Tabs } from '../ui/overlay.tsx';

/** Watch a real table from a running public demo tournament. Nobody is signed in, so only a public one may be shown, and no cards are visible. */
function useLivePreview(): { driver: TableDriver | null; tournamentId: string | null } {
  const db = useDb();
  const [driver, setDriver] = useState<TableDriver | null>(null);
  const tournamentId = useRuntime(() => {
    for (const [id, live] of runtime.lives) {
      if (live.status === 'RUNNING' && db.tournaments[id]?.status === 'RUNNING' && db.tournaments[id]?.visibility === 'public') return id;
    }
    return null;
  });
  useEffect(() => {
    if (!tournamentId) {
      setDriver(null);
      return;
    }
    const live = runtime.getLive(tournamentId);
    if (!live) return;
    const table = activeTables(live).sort((a, b) => occupiedSeats(b.state).length - occupiedSeats(a.state).length)[0];
    if (!table) return;
    let d: TableDriver;
    try {
      d = runtime.attach(null, tournamentId, table.no, false, { turnSeconds: 20, pace: 1 });
    } catch {
      setDriver(null);
      return;
    }
    setDriver(d);
    return () => {
      if (runtime.driver === d) runtime.detach();
    };
  }, [tournamentId]);
  useSyncExternalStore(driver ? driver.subscribe : noop, driver ? driver.getVersion : zero, zero);
  return { driver, tournamentId };
}
const noop = () => () => {};
const zero = () => 0;

export function Welcome() {
  const t = useT();
  const db = useDb();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legal, setLegal] = useState<'terms' | 'privacy' | null>(null);
  const { driver, tournamentId } = useLivePreview();
  const small = useMediaQuery('(max-width: 639px)');
  const tournament = tournamentId ? db.tournaments[tournamentId] : undefined;
  const club = tournament ? db.clubs[tournament.clubId] : undefined;
  const live = tournamentId ? runtime.getLive(tournamentId) : undefined;
  const summary = useRuntime(() => {
    const l = tournamentId ? runtime.getLive(tournamentId) : undefined;
    return l ? summarise(l) : null;
  });
  const person = useMemo(
    () => (id: string) => {
      const u = db.users[id];
      return { name: u?.name ?? '—', hue: u?.hue ?? 200, isBot: u?.isBot ?? true };
    },
    [db],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-6 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:gap-12 lg:py-14">
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <Wordmark />
            <LanguageToggle />
          </div>
          <h1 className="mt-8 text-[32px] leading-[1.08] font-semibold tracking-[-0.025em] text-ink sm:text-[42px]">{t('welcome.title')}</h1>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">{t('welcome.lead')}</p>

          <h2 className="mt-8 text-[13px] font-medium text-ink-2">{t('welcome.choose')}</h2>
          <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {IDENTITIES.map((identity) => {
              const user = db.users[DEMO_USERS[identity]]!;
              return (
                <li key={identity}>
                  <button
                    type="button"
                    data-testid={`enter-${identity}`}
                    onClick={() => session.signIn(db, user.id)}
                    className="group flex h-full w-full items-start gap-3 rounded-inner border border-line bg-surface px-3 py-3 text-start transition-colors hover:border-line-strong hover:bg-raised"
                  >
                    <Avatar user={user} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[14.5px] font-semibold text-ink">
                        {t(`identity.${identity}.role`)}
                        <LuArrowRight className="size-4 shrink-0 text-ink-3 transition-transform flip-rtl group-hover:translate-x-0.5 group-hover:text-accent rtl:group-hover:-translate-x-0.5" aria-hidden />
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                        {user.name} · {identityContext(db, t, identity)}
                      </span>
                      <span className="mt-1 block text-[12.5px] leading-snug text-ink-2">{t(`identity.${identity}.does`)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <details className="group mt-6 rounded-inner border border-line">
            <summary className="flex list-none items-center justify-between px-3.5 py-3 text-[13.5px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              {t('welcome.account_toggle')}
              <span className="text-ink-3 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="border-t border-line px-3.5 pt-1 pb-4">
              <Tabs
                value={mode}
                onChange={setMode}
                label={t('welcome.account_toggle')}
                tabs={[
                  { value: 'signin', label: t('welcome.sign_in') },
                  { value: 'create', label: t('welcome.create') },
                ]}
              />
              <form
                className="mt-4 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  toasts.push('info', t('welcome.accounts_off'));
                }}
              >
                <Field label={t('welcome.email')} htmlFor="welcome-email">
                  <TextInput id="welcome-email" type="email" value={email} onChange={setEmail} placeholder="name@club.example" autoComplete="off" />
                </Field>
                <Field label={t('welcome.password')} htmlFor="welcome-password">
                  <TextInput id="welcome-password" type="password" value={password} onChange={setPassword} autoComplete="off" />
                </Field>
                <Button type="submit" variant="secondary" full>
                  {mode === 'signin' ? t('welcome.sign_in') : t('welcome.create')}
                </Button>
                <p className="text-[12.5px] leading-relaxed text-ink-3">{t('welcome.accounts_note')}</p>
              </form>
            </div>
          </details>

          <p className="mt-6 text-[12.5px] leading-relaxed text-ink-3">
            {t('welcome.legal_note')}{' '}
            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setLegal('terms')}>
              {t('welcome.terms')}
            </button>{' '}
            ·{' '}
            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setLegal('privacy')}>
              {t('welcome.privacy')}
            </button>
          </p>
        </div>

        {/* Live table */}
        <div className="min-w-0 lg:pt-16" style={club ? accentStyle(club.branding.accent) : undefined}>
          <div className="overflow-hidden rounded-hero border border-line bg-[#080b0f]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface/60 px-4 py-2.5">
              {club && <ClubLogo branding={club.branding} name={club.name} size={26} />}
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13.5px] font-semibold text-ink">{tournament ? tournament.name : t('welcome.preview_idle')}</p>
                <p className="truncate text-[12px] text-ink-3">
                  {club && driver ? `${club.name} · ${t('table.table_n', { n: driver.tableNo })}` : t('welcome.preview_idle_body')}
                </p>
              </div>
              {driver && (
                <Badge tone="success" dot pulse>
                  {t('time.live')}
                </Badge>
              )}
              <Badge tone="info">
                <LuEye className="size-3" aria-hidden />
                {t('welcome.preview_observer')}
              </Badge>
            </div>
            <div className={cx('relative', small ? 'aspect-[4/5]' : 'aspect-[16/10]')}>
              {driver && club ? (
                <div className="absolute inset-0 p-2 sm:p-4">
                  <TableStage
                    view={driver.view}
                    heroSeat={null}
                    person={person}
                    turn={driver.turn}
                    theme={club.branding.tableTheme}
                    deck="four_color"
                    showBigBlinds={false}
                    lastEvent={driver.lastEvent}
                    eventCount={driver.eventCount}
                    labels={stageLabels(t, t('table.table_n', { n: driver.tableNo }), small)}
                    watermark={<ClubMark branding={club.branding} size={30} />}
                    motion
                    preview
                  />
                </div>
              ) : (
                <div className="felt-midnight absolute inset-0 flex items-center justify-center p-6">
                  <div className="pc-rail absolute inset-6 rounded-[9999px]">
                    <div className="pc-felt absolute inset-3 rounded-[9999px]" />
                  </div>
                  <p className="relative text-[13px] text-white/60">{t('welcome.preview_empty')}</p>
                </div>
              )}
            </div>
            {summary && live && (
              <dl className="grid grid-cols-3 divide-x divide-line border-t border-line text-center text-[12.5px] rtl:divide-x-reverse">
                <div className="px-2 py-2.5">
                  <dt className="text-ink-3">{t('clock.level_n', { n: summary.level })}</dt>
                  <dd className="mt-0.5 font-medium text-ink tabular-nums" dir="ltr">
                    {blindsLabel(summary)}
                  </dd>
                </div>
                <div className="px-2 py-2.5">
                  <dt className="text-ink-3">{t('clock.players')}</dt>
                  <dd className="mt-0.5 font-medium text-ink tabular-nums">
                    <span dir="ltr">{summary.left} / {summary.entrants}</span>
                  </dd>
                </div>
                <div className="px-2 py-2.5">
                  <dt className="text-ink-3">{t('clock.tables')}</dt>
                  <dd className="mt-0.5 font-medium text-ink tabular-nums">{summary.tables}</dd>
                </div>
              </dl>
            )}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">{t('welcome.preview_note')}</p>
        </div>
      </div>

      <Dialog open={legal !== null} onClose={() => setLegal(null)} title={legal === 'privacy' ? t('welcome.privacy') : t('welcome.terms')} size="md">
        <div className="space-y-3 text-[13.5px] leading-relaxed text-ink-2">
          <p>{t('legal.prototype')}</p>
          <p>{legal === 'privacy' ? t('legal.privacy_body') : t('legal.terms_body')}</p>
          <p>{t('legal.counsel')}</p>
        </div>
      </Dialog>
    </div>
  );
}
