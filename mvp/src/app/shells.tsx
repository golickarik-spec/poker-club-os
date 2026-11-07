import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuActivity,
  LuBell,
  LuBuilding2,
  LuCalendarDays,
  LuChartColumn,
  LuCheck,
  LuChevronDown,
  LuCreditCard,
  LuHistory,
  LuHouse,
  LuKeyRound,
  LuLayers,
  LuLayoutDashboard,
  LuLifeBuoy,
  LuLogOut,
  LuMail,
  LuMegaphone,
  LuMenu,
  LuMessagesSquare,
  LuPalette,
  LuReceipt,
  LuRotateCcw,
  LuScrollText,
  LuSettings,
  LuShieldCheck,
  LuSlidersHorizontal,
  LuTags,
  LuTrophy,
  LuUser,
  LuUserPlus,
  LuUsers,
  LuShare2,
  LuWorkflow,
} from 'react-icons/lu';
import { LANGUAGES } from '../i18n/index.ts';
import * as api from '../platform/api.ts';
import { inboxUnread, listReports, unreadMessages } from '../platform/messaging.ts';
import { can, isPlatformAdmin, staffClubs, type Permission } from '../platform/permissions.ts';
import { DEMO_USERS } from '../platform/seed.ts';
import { pendingMemberCount, unreadCount } from '../platform/selectors.ts';
import type { Club, DB, DemoIdentity, User } from '../platform/types.ts';
import { Badge, cx, IconButton } from '../ui/core.tsx';
import { accentStyle, Avatar, ClubLogo, ClubName, Wordmark } from '../ui/identity.tsx';
import { ConfirmDialog, Dialog, Menu, MenuItem } from '../ui/overlay.tsx';
import { act, resetDemo, session, store } from './context.ts';
import { go, useDb, useMe, useSession, useT, type T } from './hooks.ts';
import type { Route, RouteName } from './session.ts';

// ----- Demo bar ---------------------------------------------------------------------------

export const IDENTITIES: DemoIdentity[] = ['newcomer', 'player', 'owner', 'other_owner', 'tournament_manager', 'platform_admin'];

export function identityContext(db: DB, t: T, identity: DemoIdentity): string {
  if (identity === 'platform_admin') return t('identity.platform_admin.where');
  if (identity === 'player') return t('identity.player.where');
  if (identity === 'newcomer') return t('identity.newcomer.where');
  const clubId = staffClubs(db, DEMO_USERS[identity])[0];
  return clubId ? (db.clubs[clubId]?.name ?? '') : '';
}

export function setLanguage(lang: 'en' | 'he'): void {
  session.setLang(lang);
  const id = session.state.userId;
  if (id && store.db.settings[id]) {
    api.updateSettings(store.db, id, { lang });
    store.touch();
  }
}

export function LanguageToggle({ className }: { className?: string }) {
  const { lang } = useSession();
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('settings.language')} className={cx('inline-flex rounded-control border border-line bg-bg p-0.5', className)}>
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={lang === l.id}
          lang={l.id}
          data-testid={`lang-${l.id}`}
          onClick={() => setLanguage(l.id)}
          className={cx('h-6 rounded-chip px-2 text-[12px] font-medium transition-colors', lang === l.id ? 'bg-raised-2 text-ink' : 'text-ink-3 hover:text-ink')}
        >
          {l.id === 'en' ? 'EN' : 'עב'}
        </button>
      ))}
    </div>
  );
}

export function DemoBar() {
  const t = useT();
  const db = useDb();
  const me = useMe();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-[#0e141b] px-2 text-[12px] sm:px-4" data-testid="demo-bar">
      <Badge tone="warning" className="h-5">
        {t('demo.badge')}
      </Badge>
      <p className="min-w-0 flex-1 truncate text-ink-3">
        <span className="hidden md:inline">{t('demo.long')}</span>
        <span className="md:hidden">{t('demo.short')}</span>
      </p>
      <LanguageToggle />
      {me && (
        <Menu
          width="w-72"
          trigger={(p) => (
            <button
              type="button"
              {...p}
              data-testid="role-switcher"
              className="flex h-7 items-center gap-1.5 rounded-control border border-line-strong/70 bg-raised ps-1 pe-1.5 text-[12px] font-medium text-ink hover:bg-raised-2"
            >
              <Avatar user={me} size={20} />
              <span className="hidden max-w-[150px] truncate sm:inline">{t(`identity.${me.demoIdentity ?? 'player'}.role`)}</span>
              <LuChevronDown className="size-3.5 text-ink-3" aria-hidden />
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-ink-3">{t('demo.switch_role')}</p>
              {IDENTITIES.map((identity) => {
                const user = db.users[DEMO_USERS[identity]]!;
                const active = me.id === user.id;
                return (
                  <button
                    key={identity}
                    type="button"
                    role="menuitem"
                    data-testid={`role-${identity}`}
                    onClick={() => {
                      close();
                      session.signIn(db, user.id);
                    }}
                    className={cx('flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-start hover:bg-raised-2', active && 'bg-raised-2')}
                  >
                    <Avatar user={user} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{t(`identity.${identity}.role`)}</span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {user.name} · {identityContext(db, t, identity)}
                      </span>
                    </span>
                    {active && <LuCheck className="size-4 shrink-0 text-accent" aria-hidden />}
                  </button>
                );
              })}
              <div className="my-1.5 border-t border-line" />
              <MenuItem
                icon={<LuRotateCcw />}
                onClick={() => {
                  close();
                  setConfirmReset(true);
                }}
              >
                {t('demo.reset')}
              </MenuItem>
              <MenuItem
                icon={<LuLogOut className="flip-rtl" />}
                onClick={() => {
                  close();
                  session.signOut();
                }}
              >
                {t('demo.sign_out')}
              </MenuItem>
            </>
          )}
        </Menu>
      )}
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={resetDemo} title={t('demo.reset_title')} body={t('demo.reset_body')} confirmLabel={t('demo.reset')} danger />
    </div>
  );
}

// ----- Navigation building blocks ------------------------------------------------------------

interface NavItem {
  route: RouteName;
  params?: Record<string, string>;
  label: string;
  icon: ReactNode;
  badge?: number;
  /** Routes that should also light this item up. */
  also?: RouteName[];
}

type NavEntry = NavItem | 'divider' | { heading: string };
const isNavItem = (x: NavEntry): x is NavItem => x !== 'divider' && !('heading' in x);

function NavLink({ item, current, collapsed }: { item: NavItem; current: Route; collapsed?: boolean }) {
  const active = current.name === item.route || (item.also?.includes(current.name) ?? false);
  return (
    <button
      type="button"
      onClick={() => go(item.route, item.params ?? {})}
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${item.route}`}
      title={collapsed ? item.label : undefined}
      className={cx(
        'group flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-[13.5px] font-medium transition-colors',
        active ? 'bg-accent/12 text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink',
      )}
    >
      <span className={cx('shrink-0 [&>svg]:size-[17px]', active ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')}>{item.icon}</span>
      <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink tabular-nums">{item.badge}</span>}
    </button>
  );
}

function Main({ children, routeKey, wide }: { children: ReactNode; routeKey: string; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [routeKey]);
  return (
    <main ref={ref} className="min-h-0 min-w-0 flex-1 overflow-y-auto" id="main">
      <div key={routeKey} className={cx('mx-auto animate-fade px-4 pt-5 pb-10 sm:px-6 lg:px-8', wide ? 'max-w-[1320px]' : 'max-w-[1180px]')}>
        {children}
      </div>
    </main>
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
      className="relative inline-flex size-10 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink"
    >
      <LuMail className="size-5" aria-hidden />
      {count > 0 && <span className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink tabular-nums">{count}</span>}
    </button>
  );
}

function NotificationsButton({ db, me }: { db: DB; me: User }) {
  const t = useT();
  const count = unreadCount(db, me.id);
  return (
    <button
      type="button"
      onClick={() => go('notifications')}
      aria-label={t('nav.notifications_n', { n: count })}
      data-testid="nav-notifications"
      className="relative inline-flex size-10 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink"
    >
      <LuBell className="size-5" aria-hidden />
      {count > 0 && <span className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular-nums">{count}</span>}
    </button>
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
    { route: 'clubs', label: t('nav.clubs'), icon: <LuUsers />, also: ['club'] },
    { route: 'profile', label: t('nav.profile'), icon: <LuUser /> },
  ];
  const secondary: NavItem[] = [
    { route: 'messages', label: t('nav.messages'), icon: <LuMail />, badge: unreadMessages(db, me.id) },
    { route: 'hands', label: t('nav.hands'), icon: <LuHistory /> },
    { route: 'calendar', label: t('nav.calendar'), icon: <LuCalendarDays /> },
    { route: 'settings', label: t('nav.settings'), icon: <LuSettings /> },
  ];
  const staffOf = staffClubs(db, me.id);
  const routeKey = route.name + JSON.stringify(route.params);
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-[232px] shrink-0 flex-col border-e border-line bg-surface/50 lg:flex">
        <div className="flex h-14 items-center px-4">
          <Wordmark />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2" aria-label={t('nav.main')}>
          {items.map((item) => (
            <NavLink key={item.route} item={item} current={route} />
          ))}
          <div className="my-2 border-t border-line" />
          {secondary.map((item) => (
            <NavLink key={item.route} item={item} current={route} />
          ))}
          {(staffOf.length > 0 || isPlatformAdmin(db, me.id)) && (
            <>
              <div className="my-2 border-t border-line" />
              {staffOf.map((clubId) => (
                <NavLink key={clubId} item={{ route: 'console.home', params: { clubId }, label: t('nav.open_console'), icon: <LuLayoutDashboard /> }} current={route} />
              ))}
            </>
          )}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-3 py-3">
          <Avatar user={me} size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-medium text-ink">{me.name}</p>
            <p className="truncate text-[12px] text-ink-3" dir="ltr">
              @{me.handle}
            </p>
          </div>
          <NotificationsButton db={db} me={me} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3 lg:hidden">
          <Wordmark />
          <span className="flex items-center">
            <MessagesButton db={db} me={me} />
            <NotificationsButton db={db} me={me} />
          </span>
        </header>
        <Main routeKey={routeKey}>{children}</Main>
        <nav className="grid shrink-0 grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label={t('nav.main')}>
          {items.map((item) => {
            const active = route.name === item.route || (item.also?.includes(route.name) ?? false);
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => go(item.route)}
                aria-current={active ? 'page' : undefined}
                data-testid={`tab-${item.route}`}
                className={cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-accent' : 'text-ink-3')}
              >
                <span className="[&>svg]:size-5">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

// ----- Staff shells (club console and platform) ---------------------------------------------------

function StaffShell({
  route,
  header,
  items,
  children,
  footer,
  navLabel,
  style,
}: {
  route: Route;
  header: ReactNode;
  items: NavEntry[];
  children: ReactNode;
  footer?: ReactNode;
  navLabel: string;
  style?: Record<string, string>;
}) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [drawer, setDrawer] = useState(false);
  const routeKey = route.name + JSON.stringify(route.params);
  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2" aria-label={navLabel}>
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={`d${i}`} className="my-2 border-t border-line" />
        ) : !isNavItem(item) ? (
          <p key={`h${i}`} className="px-2.5 pt-3 pb-1 text-[11.5px] font-medium text-ink-3">
            {item.heading}
          </p>
        ) : (
          <div key={item.route + (item.params?.clubId ?? '')} onClick={() => setDrawer(false)}>
            <NavLink item={item} current={route} />
          </div>
        ),
      )}
    </nav>
  );
  const active = items.find((i): i is NavItem => isNavItem(i) && (i.route === route.name || (i.also?.includes(route.name) ?? false)));
  return (
    <div className="flex min-h-0 flex-1" style={style}>
      <aside className="hidden w-[244px] shrink-0 flex-col border-e border-line bg-surface/50 lg:flex">
        {header}
        {nav}
        {footer}
        <div className="flex items-center gap-2.5 border-t border-line px-3 py-3">
          <Avatar user={me} size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-medium text-ink">{me.name}</p>
            <p className="truncate text-[12px] text-ink-3">{t(`identity.${me.demoIdentity ?? 'player'}.role`)}</p>
          </div>
          <NotificationsButton db={db} me={me} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2 lg:hidden">
          <IconButton label={t('nav.menu')} onClick={() => setDrawer(true)} data-testid="staff-menu">
            <LuMenu className="size-5" aria-hidden />
          </IconButton>
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{active?.label ?? ''}</p>
          <NotificationsButton db={db} me={me} />
        </header>
        <Main routeKey={routeKey} wide>
          {children}
        </Main>
      </div>
      <Dialog open={drawer} onClose={() => setDrawer(false)} title={navLabel} size="sm">
        <div className="-mx-3">
          {header}
          {nav}
        </div>
      </Dialog>
    </div>
  );
}

export function consoleNav(db: DB, t: T, me: User, club: Club): NavEntry[] {
  const p = { clubId: club.id };
  const allow = (perm: Permission) => can(db, me.id, perm, club.id);
  const crm: (NavItem | null)[] = [
    allow('members.view') ? { route: 'console.crm', params: p, label: t('console.nav.crm_overview'), icon: <LuUsers /> } : null,
    allow('members.view') ? { route: 'console.crm.players', params: p, label: t('console.nav.players'), icon: <LuUser />, also: ['console.crm.player'] } : null,
    allow('members.view') ? { route: 'console.crm.requests', params: p, label: t('console.nav.requests'), icon: <LuUserPlus />, badge: allow('members.approve') ? pendingMemberCount(db, club.id) : 0 } : null,
    allow('members.view') ? { route: 'console.crm.segments', params: p, label: t('console.nav.segments'), icon: <LuTags /> } : null,
    allow('crm.messages') ? { route: 'console.crm.inbox', params: p, label: t('console.nav.inbox'), icon: <LuMessagesSquare />, badge: inboxUnread(db, me.id, club.id) } : null,
    allow('announcements.publish') ? { route: 'console.announcements', params: p, label: t('console.nav.announcements'), icon: <LuMegaphone /> } : null,
    { route: 'console.crm.notifications', params: p, label: t('console.nav.notifications'), icon: <LuBell /> },
    allow('analytics.view') ? { route: 'console.crm.analytics', params: p, label: t('console.nav.analytics'), icon: <LuChartColumn /> } : null,
    allow('members.view') ? { route: 'console.crm.automation', params: p, label: t('console.nav.automation'), icon: <LuWorkflow /> } : null,
    allow('members.view') ? { route: 'console.crm.referrals', params: p, label: t('console.nav.referrals'), icon: <LuShare2 /> } : null,
    allow('crm.configure') ? { route: 'console.crm.settings', params: p, label: t('console.nav.crm_settings'), icon: <LuSlidersHorizontal />, also: ['console.crm.import'] } : null,
  ];
  const items: (NavEntry | null)[] = [
    { route: 'console.home', params: p, label: t('console.nav.home'), icon: <LuLayoutDashboard /> },
    { route: 'console.tournaments', params: p, label: t('console.nav.tournaments'), icon: <LuTrophy />, also: ['console.wizard', 'console.tournament'] },
    { heading: t('console.nav.group.crm') },
    ...crm,
    { heading: t('console.nav.group.club') },
    allow('club.branding') ? { route: 'console.branding', params: p, label: t('console.nav.branding'), icon: <LuPalette /> } : null,
    { route: 'console.roles', params: p, label: t('console.nav.roles'), icon: <LuKeyRound /> },
    allow('audit.view') ? { route: 'console.audit', params: p, label: t('console.nav.audit'), icon: <LuScrollText /> } : null,
    allow('audit.view') ? { route: 'console.integrity', params: p, label: t('console.nav.integrity'), icon: <LuShieldCheck /> } : null,
    allow('billing.view') ? { route: 'console.subscription', params: p, label: t('console.nav.subscription'), icon: <LuCreditCard /> } : null,
    allow('support.manage') ? { route: 'console.support', params: p, label: t('console.nav.support'), icon: <LuLifeBuoy /> } : null,
  ];
  return items.filter((x): x is NavEntry => x !== null);
}

export function ConsoleShell({ children, route, club }: { children: ReactNode; route: Route; club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const plan = db.plans[club.planId];
  const header = (
    <div className="border-b border-line px-3 py-3">
      <div className="flex items-center gap-2.5">
        <ClubLogo branding={club.branding} name={club.name} size={38} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold text-ink">
            <ClubName club={club} />
          </p>
          <p className="mt-0.5 truncate text-[12px] text-ink-3">
            {t('console.title')} · {plan.name}
          </p>
        </div>
      </div>
    </div>
  );
  return (
    <StaffShell
      route={route}
      header={header}
      items={consoleNav(db, t, me, club)}
      navLabel={t('console.title')}
      style={accentStyle(club.branding.accent)}
      footer={
        <button
          type="button"
          onClick={() => go('club', { clubId: club.id })}
          className="mx-2.5 mb-2 flex h-9 items-center gap-2 rounded-control border border-line px-2.5 text-[12.5px] text-ink-2 hover:bg-raised hover:text-ink"
        >
          <LuUsers className="size-4" aria-hidden />
          {t('console.view_club_page')}
        </button>
      }
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
    <div className="border-b border-line px-3 py-3">
      <Wordmark />
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
        <LuShieldCheck className="size-3.5" aria-hidden />
        {t('platform.title')}
      </p>
    </div>
  );
  const items: NavEntry[] = [
    { route: 'platform.home', label: t('platform.nav.home'), icon: <LuLayoutDashboard /> },
    { route: 'platform.clubs', label: t('platform.nav.clubs'), icon: <LuBuilding2 />, also: ['platform.club'] },
    { route: 'platform.plans', label: t('platform.nav.plans'), icon: <LuLayers /> },
    { route: 'platform.billing', label: t('platform.nav.billing'), icon: <LuReceipt /> },
    'divider',
    { route: 'platform.health', label: t('platform.nav.health'), icon: <LuActivity /> },
    { route: 'platform.support', label: t('platform.nav.support'), icon: <LuLifeBuoy />, badge: openTickets },
    { route: 'platform.integrity', label: t('platform.nav.integrity'), icon: <LuShieldCheck /> },
  ];
  return (
    <StaffShell route={route} header={header} items={items} navLabel={t('platform.title')}>
      {children}
    </StaffShell>
  );
}

export { act };
