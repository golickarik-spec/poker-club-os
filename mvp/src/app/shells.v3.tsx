/**
 * Application shells, v3 design.
 *
 * Players get a horizontal top bar (a game client, not an admin tool) and a bottom tab bar on
 * phones. Staff get a grouped sidebar with a club switcher and automatic breadcrumbs. The v2
 * shells live untouched in shells.tsx; App.tsx picks one through shell-select.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuActivity,
  LuBell,
  LuBuilding2,
  LuChartColumn,
  LuChartNoAxesCombined,
  LuCheck,
  LuCalendarDays,
  LuChevronDown,
  LuChevronRight,
  LuCreditCard,
  LuExternalLink,
  LuFilter,
  LuHistory,
  LuHouse,
  LuKeyRound,
  LuLayers,
  LuLayoutDashboard,
  LuLifeBuoy,
  LuMail,
  LuMedal,
  LuMegaphone,
  LuMenu,
  LuMessagesSquare,
  LuPalette,
  LuRadio,
  LuReceipt,
  LuScrollText,
  LuSettings,
  LuShieldCheck,
  LuSlidersHorizontal,
  LuTrophy,
  LuUser,
  LuUsers,
} from 'react-icons/lu';
import { inboxUnread, listReports, unreadMessages } from '../platform/messaging.ts';
import { can, isPlatformAdmin, staffClubs, type Permission } from '../platform/permissions.ts';
import { pendingMemberCount, unreadCount } from '../platform/selectors.ts';
import type { Club, DB, User } from '../platform/types.ts';
import { cx, IconButton } from '../ui/core.tsx';
import { accentStyle, Avatar, ClubLogo, ClubName, Wordmark } from '../ui/identity.tsx';
import { Dialog, Menu, MenuItem } from '../ui/overlay.tsx';
import { go, useDb, useMe, useT, type T } from './hooks.ts';
import type { Route, RouteName } from './session.ts';

export { DemoBar, IDENTITIES, identityContext, LanguageToggle, setLanguage } from './shells.tsx';

// ----- Navigation model --------------------------------------------------------------------

interface NavItem {
  route: RouteName;
  params?: Record<string, string>;
  label: string;
  icon: ReactNode;
  badge?: number;
  /** Routes that should also light this item up. */
  also?: RouteName[];
  /** A live dot: something is happening behind this item right now. */
  live?: boolean;
  /** Not built yet: shown, marked, and not a link. */
  planned?: boolean;
  /** Nothing behind it right now (no running tournament): dimmed, never active, with a hint. */
  idle?: string;
  /** Stable id for tests when the route alone is ambiguous. */
  id?: string;
}

interface NavGroup {
  heading?: string;
  items: NavItem[];
}

const isActive = (item: NavItem, route: Route): boolean => {
  if (item.idle) return false;
  if (item.route !== route.name && !(item.also?.includes(route.name) ?? false)) return false;
  // Analytics tabs are separate entries on the same route: match on the tab parameter too.
  if (item.params?.tab !== undefined || route.params.tab !== undefined) return (item.params?.tab ?? 'funnel') === (route.params.tab ?? 'funnel');
  return true;
};

function Badge({ n, tone = 'accent' }: { n: number; tone?: 'accent' | 'danger' }) {
  if (n <= 0) return null;
  return <span className={cx('flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums', tone === 'danger' ? 'bg-danger text-white' : 'bg-accent text-accent-ink')}>{n}</span>;
}

// ----- Shared header controls ---------------------------------------------------------------

function NotificationsButton({ db, me, className }: { db: DB; me: User; className?: string }) {
  const t = useT();
  const count = unreadCount(db, me.id);
  return (
    <button
      type="button"
      onClick={() => go('notifications')}
      aria-label={t('nav.notifications_n', { n: count })}
      data-testid="nav-notifications"
      className={cx('relative inline-flex size-10 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-raised hover:text-ink', className)}
    >
      <LuBell className="size-5" aria-hidden />
      {count > 0 && <span className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-surface">{count}</span>}
    </button>
  );
}

function MessagesButton({ db, me }: { db: DB; me: User }) {
  const t = useT();
  const count = unreadMessages(db, me.id);
  return (
    <button
      type="button"
      onClick={() => go('messages')}
      aria-label={t('nav.messages_n', { n: count })}
      data-testid="nav-messages-button"
      className="relative inline-flex size-10 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-raised hover:text-ink"
    >
      <LuMail className="size-5" aria-hidden />
      {count > 0 && <span className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink tabular-nums ring-2 ring-surface">{count}</span>}
    </button>
  );
}

function Main({ children, routeKey, width = 'max-w-[1240px]', className }: { children: ReactNode; routeKey: string; width?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [routeKey]);
  return (
    <main ref={ref} className={cx('min-h-0 min-w-0 flex-1 overflow-y-auto', className)} id="main">
      <div key={routeKey} className={cx('mx-auto animate-fade px-4 pt-5 pb-12 sm:px-6 lg:px-8', width)}>
        {children}
      </div>
    </main>
  );
}

// ----- Player shell ------------------------------------------------------------------------

export function PlayerShell({ children, route }: { children: ReactNode; route: Route }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const items: NavItem[] = [
    { route: 'home', label: t('nav.home'), icon: <LuHouse /> },
    { route: 'tournaments', label: t('nav.tournaments'), icon: <LuTrophy />, also: ['tournament', 'results'] },
    { route: 'clubs', label: t('nav.my_clubs'), icon: <LuUsers />, also: ['club'] },
    { route: 'rankings', label: t('nav.rankings'), icon: <LuMedal />, also: ['league'] },
    { route: 'calendar', label: t('nav.calendar'), icon: <LuCalendarDays /> },
    { route: 'messages', label: t('nav.messages'), icon: <LuMail />, badge: unreadMessages(db, me.id) },
    { route: 'profile', label: t('nav.profile'), icon: <LuUser />, also: ['hands', 'settings'] },
  ];
  const tabs = items.filter((i) => i.route !== 'messages' && i.route !== 'calendar');
  const staffOf = staffClubs(db, me.id);
  const routeKey = route.name + JSON.stringify(route.params);
  const immersive = route.name === 'tournament' || route.name === 'club';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <header className="product-scope relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line/70 bg-surface/85 px-3 backdrop-blur-md sm:px-5">
        <button type="button" onClick={() => go('home')} className="me-2 shrink-0 rounded-control p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={t('nav.home')}>
          <span className="hidden md:inline-flex"><Wordmark /></span>
          <span className="md:hidden"><Wordmark compact /></span>
        </button>
        <nav className="hidden h-full min-w-0 flex-1 items-stretch gap-0.5 lg:flex" aria-label={t('nav.main')}>
          {items.map((item) => {
            const active = isActive(item, route);
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => go(item.route)}
                aria-current={active ? 'page' : undefined}
                data-testid={`nav-${item.route}`}
                className={cx(
                  'relative flex items-center gap-1.5 px-3 text-[13.5px] font-medium transition-colors',
                  active ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  'after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:transition-[background-color] after:content-[""]',
                  active ? 'after:bg-accent' : 'after:bg-transparent hover:after:bg-line-strong',
                )}
              >
                {item.label}
                {item.badge !== undefined && <Badge n={item.badge} />}
              </button>
            );
          })}
        </nav>
        <span className="min-w-0 flex-1 lg:hidden" />
        <div className="flex shrink-0 items-center gap-0.5">
          {staffOf.length > 0 && (
            <button
              type="button"
              onClick={() => go('console.home', { clubId: staffOf[0]! })}
              data-testid="nav-console.home"
              className="me-1 hidden h-9 items-center gap-1.5 rounded-control border border-line-strong/70 bg-raised/60 px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-raised hover:text-ink sm:inline-flex"
            >
              <LuLayoutDashboard className="size-4" aria-hidden />
              {t('nav.open_console')}
            </button>
          )}
          {isPlatformAdmin(db, me.id) && (
            <button type="button" onClick={() => go('platform.home')} className="me-1 hidden h-9 items-center gap-1.5 rounded-control border border-line-strong/70 bg-raised/60 px-2.5 text-[12.5px] font-medium text-ink-2 hover:text-ink sm:inline-flex">
              <LuShieldCheck className="size-4" aria-hidden />
              {t('platform.title')}
            </button>
          )}
          <span className="lg:hidden">
            <MessagesButton db={db} me={me} />
          </span>
          <NotificationsButton db={db} me={me} />
          <IconButton label={t('nav.settings')} onClick={() => go('settings')} data-testid="nav-settings" className="hidden lg:inline-flex">
            <LuSettings className="size-5" aria-hidden />
          </IconButton>
          <Menu
            width="w-56"
            trigger={(props) => (
              <button type="button" {...props} className="ms-1 flex items-center gap-2 rounded-full p-0.5 hover:bg-raised lg:pe-2" aria-label={t('nav.menu')} data-testid="nav-more">
                <Avatar user={me} size={30} />
                <span className="hidden max-w-[160px] truncate text-[13px] font-medium text-ink lg:inline">{me.name}</span>
                <LuChevronDown className="hidden size-3.5 text-ink-3 lg:inline" aria-hidden />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="px-2.5 pt-1.5 pb-2">
                  <p className="truncate text-[13px] font-medium text-ink">{me.name}</p>
                  <p className="truncate text-[11.5px] text-ink-3">{me.email}</p>
                </div>
                <MenuItem icon={<LuUser />} onClick={() => { close(); go('profile'); }}>
                  <span data-testid="nav-profile-menu">{t('nav.profile')}</span>
                </MenuItem>
                <MenuItem icon={<LuHistory />} onClick={() => { close(); go('hands'); }}>
                  <span data-testid="nav-hands">{t('nav.hands')}</span>
                </MenuItem>
                <MenuItem icon={<LuCalendarDays />} onClick={() => { close(); go('calendar'); }}>
                  <span data-testid="nav-calendar">{t('nav.calendar')}</span>
                </MenuItem>
                <MenuItem icon={<LuSettings />} onClick={() => { close(); go('settings'); }}>
                  <span data-testid="nav-settings-menu">{t('nav.settings')}</span>
                </MenuItem>
                {staffOf.length > 0 && (
                  <MenuItem icon={<LuLayoutDashboard />} onClick={() => { close(); go('console.home', { clubId: staffOf[0]! }); }}>
                    {t('nav.open_console')}
                  </MenuItem>
                )}
                {staffOf.length > 1 && (
                  <MenuItem icon={<LuBuilding2 />} onClick={() => { close(); go('staff'); }}>
                    <span data-testid="nav-staff-overview">{t('nav.staff_overview')}</span>
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      </header>

      <Main routeKey={routeKey} width={immersive ? 'max-w-[1240px]' : 'max-w-[1240px]'}>{children}</Main>

      {/* Bottom tab bar on phones */}
      <nav className="product-scope grid shrink-0 grid-cols-5 border-t border-line/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden" aria-label={t('nav.main')}>
        {tabs.map((item) => {
          const active = isActive(item, route);
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => go(item.route)}
              aria-current={active ? 'page' : undefined}
              data-testid={`tab-${item.route}`}
              className={cx('relative flex h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors', active ? 'text-accent' : 'text-ink-3')}
            >
              <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors [&>svg]:size-5', active && 'bg-accent/12')}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ----- Staff shell (club console and platform) ---------------------------------------------------

function NavLink({ item, current, onNavigate }: { item: NavItem; current: Route; onNavigate?: () => void }) {
  const t = useT();
  const active = isActive(item, current);
  if (item.planned) {
    return (
      <span className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-[13.5px] text-ink-3/70" aria-disabled="true" title={t('nav.planned_hint')} data-testid={`nav-planned-${item.route}`}>
        <span className="shrink-0 [&>svg]:size-[17px]">{item.icon}</span>
        <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
        <span className="rounded-chip border border-line-strong/70 px-1.5 py-px text-[10px] font-medium text-ink-3">{t('nav.planned')}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        go(item.route, item.params ?? {});
        onNavigate?.();
      }}
      aria-current={active ? 'page' : undefined}
      title={item.idle}
      data-testid={item.id ?? `nav-${item.route}${item.params?.tab ? `.${item.params.tab}` : ''}`}
      className={cx(
        'group relative flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-[13.5px] font-medium transition-colors',
        active ? 'bg-accent/[0.11] text-ink' : item.idle ? 'text-ink-3 hover:bg-raised hover:text-ink-2' : 'text-ink-2 hover:bg-raised hover:text-ink',
        active && 'before:absolute before:inset-y-2 before:-start-2.5 before:w-[3px] before:rounded-full before:bg-accent before:content-[""]',
      )}
    >
      <span className={cx('shrink-0 [&>svg]:size-[17px]', active ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')}>{item.icon}</span>
      <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
      {item.live && <span className="size-1.5 animate-pulse-dot rounded-full bg-success" aria-hidden />}
      {item.badge !== undefined && <Badge n={item.badge} />}
    </button>
  );
}

function StaffShell({
  route,
  header,
  groups,
  children,
  navLabel,
  style,
  trail,
  accentTop,
  subnav,
}: {
  route: Route;
  header: ReactNode;
  groups: NavGroup[];
  children: ReactNode;
  navLabel: string;
  style?: Record<string, string>;
  /** Breadcrumb root(s) shown above every page, e.g. the club. */
  trail: { label: ReactNode; onClick?: () => void }[];
  accentTop?: boolean;
  /** Secondary navigation for the current area, shown under the trail. */
  subnav?: NavItem[];
}) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [drawer, setDrawer] = useState(false);
  const routeKey = route.name + JSON.stringify(route.params);
  const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, heading: g.heading })));
  const active = all.find((i) => isActive(i, route)) ?? all.find((i) => i.route === route.name);
  const nav = (onNavigate?: () => void) => (
    <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 py-3" aria-label={navLabel}>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.heading && <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-[0.02em] text-ink-3">{g.heading}</p>}
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <NavLink key={item.route + (item.params?.tab ?? '')} item={item} current={route} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
  const crumbs = [...trail, ...(active?.heading ? [{ label: active.heading }] : []), ...(active ? [{ label: active.label, onClick: () => go(active.route, active.params ?? {}) }] : [])];
  return (
    <div className="flex min-h-0 flex-1" style={style}>
      <aside className={cx('product-scope hidden w-[252px] shrink-0 flex-col border-e border-line/70 bg-surface lg:flex', accentTop && 'border-t-2 border-t-accent')}>
        {header}
        {nav()}
        <div className="flex items-center gap-2.5 border-t border-line/70 px-3 py-2.5">
          <Avatar user={me} size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-medium text-ink">{me.name}</p>
            <p className="truncate text-[11.5px] text-ink-3">{t(`identity.${me.demoIdentity ?? 'player'}.role`)}</p>
          </div>
          <NotificationsButton db={db} me={me} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="product-scope flex h-12 shrink-0 items-center gap-1 border-b border-line/70 bg-surface/80 px-2 backdrop-blur-md lg:hidden">
          <IconButton label={t('nav.menu')} onClick={() => setDrawer(true)} data-testid="staff-menu">
            <LuMenu className="size-5" aria-hidden />
          </IconButton>
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{active?.label ?? ''}</p>
          <NotificationsButton db={db} me={me} />
        </header>
        {/* Context trail: where you are, on every page */}
        <div className="product-scope hidden h-10 shrink-0 items-center gap-1 border-b border-line/50 px-6 text-[12.5px] text-ink-3 lg:flex" data-testid="context-trail">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <LuChevronRight className="size-3 shrink-0 flip-rtl text-ink-3/60" aria-hidden />}
              {c.onClick && i < crumbs.length - 1 ? (
                <button type="button" onClick={c.onClick} className="max-w-[28ch] truncate hover:text-ink">
                  {c.label}
                </button>
              ) : (
                <span className={cx('max-w-[32ch] truncate', i === crumbs.length - 1 && 'font-medium text-ink-2')}>{c.label}</span>
              )}
            </span>
          ))}
        </div>
        {subnav && subnav.length > 0 && (
          <div className="product-scope flex h-11 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-line/70 bg-surface/60 px-3 lg:px-6" role="navigation" aria-label={active?.heading ?? navLabel} data-testid="subnav">
            {subnav.map((item) => {
              const on = isActive(item, route);
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => go(item.route, item.params ?? {})}
                  aria-current={on ? 'page' : undefined}
                  data-testid={`nav-${item.route}`}
                  className={cx(
                    'relative flex shrink-0 items-center gap-1.5 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                    on ? 'text-ink' : 'text-ink-2 hover:text-ink',
                    'after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:content-[""]',
                    on ? 'after:bg-accent' : 'after:bg-transparent',
                  )}
                >
                  {item.label}
                  {item.badge !== undefined && <Badge n={item.badge} />}
                </button>
              );
            })}
          </div>
        )}
        <Main routeKey={routeKey} width="max-w-[1360px]">
          {children}
        </Main>
      </div>
      <Dialog open={drawer} onClose={() => setDrawer(false)} title={navLabel} size="sm">
        <div className="product-scope -mx-3">
          {header}
          {nav(() => setDrawer(false))}
        </div>
      </Dialog>
    </div>
  );
}

/** The club switcher at the top of the console sidebar. One club: just the identity. Several: a menu. */
function ClubSwitcher({ db, me, club, t }: { db: DB; me: User; club: Club; t: T }) {
  const clubs = staffClubs(db, me.id).map((id) => db.clubs[id]!).filter(Boolean);
  const plan = db.plans[club.planId];
  const identity = (
    <>
      <ClubLogo branding={club.branding} name={club.name} size={38} />
      <span className="min-w-0 flex-1 text-start leading-tight">
        <span className="block truncate text-[14px] font-semibold text-ink">
          <ClubName club={club} />
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
          {t('console.title')} · {plan.name}
        </span>
      </span>
    </>
  );
  return (
    <div className="border-b border-line/70 p-2.5">
      <Menu
        width="w-64"
        trigger={(p) => (
          <button type="button" {...p} className="flex w-full items-center gap-2.5 rounded-inner p-1.5 text-start transition-colors hover:bg-raised" data-testid="club-switcher">
            {identity}
            <LuChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />
          </button>
        )}
      >
        {(close) => (
          <>
            {clubs.length > 1 && <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-ink-3">{t('console.switch_club')}</p>}
            {clubs.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                data-testid={`switch-club-${c.id}`}
                onClick={() => {
                  close();
                  go('console.home', { clubId: c.id });
                }}
                className={cx('flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-start hover:bg-raised-2', c.id === club.id && 'bg-raised-2')}
              >
                <ClubLogo branding={c.branding} name={c.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{c.name}</span>
                {c.id === club.id && <LuCheck className="size-4 shrink-0 text-accent" aria-hidden />}
              </button>
            ))}
            <div className="my-1.5 border-t border-line" />
            {clubs.length > 1 && (
              <MenuItem
                icon={<LuBuilding2 />}
                onClick={() => {
                  close();
                  go('staff');
                }}
              >
                {t('nav.staff_overview')}
              </MenuItem>
            )}
            <MenuItem
              icon={<LuExternalLink />}
              onClick={() => {
                close();
                go('club', { clubId: club.id });
              }}
            >
              {t('console.view_club_page')}
            </MenuItem>
            <MenuItem
              icon={<LuHouse />}
              onClick={() => {
                close();
                go('home');
              }}
            >
              {t('nav.player_app')}
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  );
}

export function consoleGroups(db: DB, t: T, me: User, club: Club): NavGroup[] {
  const p = { clubId: club.id };
  const allow = (perm: Permission) => can(db, me.id, perm, club.id);
  const liveTournament = Object.values(db.tournaments).find((x) => x.clubId === club.id && (x.status === 'RUNNING' || x.status === 'PAUSED' || x.status === 'SEATING'));
  const keep = (items: (NavItem | null | false)[]): NavItem[] => items.filter((x): x is NavItem => !!x);
  return [
    { items: [{ route: 'console.home', params: p, label: t('console.nav.home'), icon: <LuLayoutDashboard /> }] },
    {
      heading: t('console.nav.group.operations'),
      items: keep([
        { route: 'console.tournaments', params: p, label: t('console.nav.tournaments'), icon: <LuTrophy />, also: ['console.wizard'] },
        liveTournament
          ? { route: 'console.tournament', params: { ...p, id: liveTournament.id }, label: t('console.nav.live'), icon: <LuRadio />, live: true, id: 'nav-live' }
          : { route: 'console.tournaments', params: p, label: t('console.nav.live'), icon: <LuRadio />, idle: t('console.nav.live_none'), id: 'nav-live' },
        { route: 'console.leagues', params: p, label: t('console.nav.leagues'), icon: <LuMedal />, also: ['console.league'] },
      ]),
    },
    {
      heading: t('console.nav.group.community'),
      items: keep([
        allow('members.view') && { route: 'console.crm.players', params: p, label: t('console.nav.members'), icon: <LuUsers />, also: ['console.crm.player', 'console.crm.requests'], badge: allow('members.approve') ? pendingMemberCount(db, club.id) : 0 },
        allow('members.view') && { route: 'console.crm', params: p, label: t('console.nav.crm'), icon: <LuSlidersHorizontal />, also: ['console.crm.segments', 'console.crm.automation', 'console.crm.notifications', 'console.crm.referrals', 'console.crm.import', 'console.crm.settings'] },
        allow('crm.messages') && { route: 'console.crm.inbox', params: p, label: t('console.nav.inbox'), icon: <LuMessagesSquare />, badge: inboxUnread(db, me.id, club.id) },
        allow('announcements.publish') && { route: 'console.announcements', params: p, label: t('console.nav.announcements'), icon: <LuMegaphone /> },
      ]),
    },
    {
      heading: t('console.nav.group.analytics'),
      items: keep([
        allow('analytics.view') && { route: 'console.crm.analytics', params: { ...p, tab: 'engagement' }, label: t('console.nav.club_analytics'), icon: <LuChartColumn /> },
        allow('analytics.view') && { route: 'console.crm.analytics', params: { ...p, tab: 'retention' }, label: t('console.nav.retention'), icon: <LuChartNoAxesCombined /> },
        allow('analytics.view') && { route: 'console.crm.analytics', params: { ...p, tab: 'funnel' }, label: t('console.nav.funnel'), icon: <LuFilter /> },
      ]),
    },
    {
      heading: t('console.nav.group.settings'),
      items: keep([
        allow('club.branding') && { route: 'console.branding', params: p, label: t('console.nav.branding'), icon: <LuPalette /> },
        { route: 'console.roles', params: p, label: t('console.nav.roles'), icon: <LuKeyRound /> },
        allow('crm.configure') && { route: 'console.crm.settings', params: p, label: t('console.nav.club_settings'), icon: <LuSettings /> },
        allow('audit.view') && { route: 'console.audit', params: p, label: t('console.nav.audit'), icon: <LuScrollText /> },
        allow('audit.view') && { route: 'console.integrity', params: p, label: t('console.nav.integrity'), icon: <LuShieldCheck /> },
        allow('billing.view') && { route: 'console.subscription', params: p, label: t('console.nav.subscription'), icon: <LuCreditCard /> },
        allow('support.manage') && { route: 'console.support', params: p, label: t('console.nav.support'), icon: <LuLifeBuoy /> },
      ]),
    },
  ];
}

const COMMUNITY_ROUTES = new Set<RouteName>(['console.crm', 'console.crm.players', 'console.crm.player', 'console.crm.requests', 'console.crm.segments', 'console.crm.inbox', 'console.crm.notifications', 'console.crm.automation', 'console.crm.referrals', 'console.crm.import', 'console.crm.settings', 'console.announcements', 'console.crm.analytics']);

/** The CRM pages share one secondary navigation, so none of them loses a way in. */
export function consoleSubnav(db: DB, t: T, me: User, club: Club, route: Route): NavItem[] {
  if (!COMMUNITY_ROUTES.has(route.name)) return [];
  const p = { clubId: club.id };
  const allow = (perm: Permission) => can(db, me.id, perm, club.id);
  const items: (NavItem | false)[] = [
    allow('members.view') && { route: 'console.crm', params: p, label: t('console.nav.crm_overview'), icon: null },
    allow('members.view') && { route: 'console.crm.players', params: p, label: t('console.nav.players'), icon: null, also: ['console.crm.player'] },
    allow('members.view') && { route: 'console.crm.requests', params: p, label: t('console.nav.requests'), icon: null, badge: allow('members.approve') ? pendingMemberCount(db, club.id) : undefined },
    allow('members.view') && { route: 'console.crm.segments', params: p, label: t('console.nav.segments'), icon: null },
    allow('crm.messages') && { route: 'console.crm.inbox', params: p, label: t('console.nav.inbox'), icon: null, badge: inboxUnread(db, me.id, club.id) },
    allow('announcements.publish') && { route: 'console.announcements', params: p, label: t('console.nav.announcements'), icon: null },
    allow('analytics.view') && { route: 'console.crm.analytics', params: p, label: t('crm.analytics.title'), icon: null },
    allow('members.view') && { route: 'console.crm.notifications', params: p, label: t('console.nav.notifications'), icon: null },
    allow('members.view') && { route: 'console.crm.automation', params: p, label: t('console.nav.automation'), icon: null },
    allow('members.view') && { route: 'console.crm.referrals', params: p, label: t('console.nav.referrals'), icon: null },
    allow('crm.configure') && { route: 'console.crm.settings', params: p, label: t('console.nav.crm_settings'), icon: null, also: ['console.crm.import'] },
  ];
  return items.filter((x): x is NavItem => !!x);
}

export function ConsoleShell({ children, route, club }: { children: ReactNode; route: Route; club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  return (
    <StaffShell
      route={route}
      header={<ClubSwitcher db={db} me={me} club={club} t={t} />}
      groups={consoleGroups(db, t, me, club)}
      navLabel={t('console.title')}
      style={accentStyle(club.branding.accent)}
      trail={[{ label: club.name, onClick: () => go('console.home', { clubId: club.id }) }]}
      accentTop
      subnav={consoleSubnav(db, t, me, club, route)}
    >
      {children}
    </StaffShell>
  );
}

export function PlatformShell({ children, route }: { children: ReactNode; route: Route }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const openTickets = db.tickets.filter((x) => x.status === 'open').length + (isPlatformAdmin(db, me.id) ? listReports(db, me.id).filter((r) => r.report.status === 'open').length : 0);
  const header = (
    <div className="border-b border-line/70 px-4 py-3.5">
      <Wordmark />
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
        <LuShieldCheck className="size-3.5" aria-hidden />
        {t('platform.title')}
      </p>
    </div>
  );
  const groups: NavGroup[] = [
    { items: [{ route: 'platform.home', label: t('platform.nav.home'), icon: <LuLayoutDashboard /> }] },
    {
      heading: t('platform.nav.group.tenants'),
      items: [
        { route: 'platform.clubs', label: t('platform.nav.clubs'), icon: <LuBuilding2 />, also: ['platform.club'] },
        { route: 'platform.plans', label: t('platform.nav.plans'), icon: <LuLayers /> },
        { route: 'platform.billing', label: t('platform.nav.billing'), icon: <LuReceipt /> },
      ],
    },
    {
      heading: t('platform.nav.group.operations'),
      items: [
        { route: 'platform.health', label: t('platform.nav.health'), icon: <LuActivity /> },
        { route: 'platform.support', label: t('platform.nav.support'), icon: <LuLifeBuoy />, badge: openTickets },
        { route: 'platform.integrity', label: t('platform.nav.integrity'), icon: <LuShieldCheck /> },
      ],
    },
  ];
  return (
    <StaffShell route={route} header={header} groups={groups} navLabel={t('platform.title')} trail={[{ label: t('platform.title'), onClick: () => go('platform.home') }]}>
      {children}
    </StaffShell>
  );
}

// Kept for parity with the v2 module's exports.
