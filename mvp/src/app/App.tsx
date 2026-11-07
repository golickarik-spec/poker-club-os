import { Component, useEffect, type ReactNode } from 'react';
import { LuLock, LuTriangleAlert } from 'react-icons/lu';
import { ConsoleRouter } from '../console/ConsoleRouter.tsx';
import { dirOf } from '../i18n/index.ts';
import { can, isPlatformAdmin } from '../platform/permissions.ts';
import { ForbiddenError } from '../platform/types.ts';
import { PlatformRouter } from '../platform-admin/PlatformRouter.tsx';
import { ClubPage } from '../player/ClubPage.tsx';
import { Clubs } from '../player/Clubs.tsx';
import { Hands } from '../player/Hands.tsx';
import { Lobby } from '../player/Lobby.tsx';
import { Messages } from '../player/Messages.tsx';
import { Notifications } from '../player/Notifications.tsx';
import { Profile } from '../player/Profile.tsx';
import { Results } from '../player/Results.tsx';
import { Settings } from '../player/Settings.tsx';
import { Tournaments } from '../player/Tournaments.tsx';
import { Welcome } from '../player/Welcome.tsx';
import { SpectatorScreen } from '../table/SpectatorScreen.tsx';
import { TableScreen } from '../table/TableScreen.tsx';
import { Button, cx, EmptyState } from '../ui/core.tsx';
import { accentStyle } from '../ui/identity.tsx';
import { Toaster } from '../ui/overlay.tsx';
import { resetDemo, session } from './context.ts';
import { go, useDb, useMe, useSession, useSettings, useT } from './hooks.ts';
import { environmentOf, homeRouteFor, type Route } from './session.ts';
import { ConsoleShell, DemoBar, Home, PlatformShell, PlayerShell } from './variants.ts';
import { Rankings } from '../player/Rankings.tsx';
import { Calendar } from '../player/Calendar.tsx';
import { ClubWizard } from '../player/ClubWizard.tsx';
import { StaffOverview } from '../player/StaffOverview.tsx';
import { LeaguePage } from '../player/LeaguePage.tsx';

class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void; title: string; body: string; action: string; denied: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error(error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    // The service layer refused a read: this person may not see what the screen asked for.
    if (this.state.error instanceof ForbiddenError) return this.props.denied;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<LuTriangleAlert />}
          title={this.props.title}
          body={`${this.props.body} (${this.state.error.message})`}
          action={
            <Button
              variant="primary"
              onClick={() => {
                this.props.onReset();
                this.setState({ error: null });
              }}
            >
              {this.props.action}
            </Button>
          }
          className="max-w-md"
        />
      </div>
    );
  }
}

function NoAccess() {
  const t = useT();
  const db = useDb();
  const me = useMe();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={<LuLock />}
        title={t('access.denied.title')}
        body={t('access.denied.body')}
        action={
          <Button variant="primary" onClick={() => (me ? session.signIn(db, me.id) : session.signOut())}>
            {t('access.denied.action')}
          </Button>
        }
        className="max-w-md"
      />
    </div>
  );
}

/** The club whose colours the current screen should wear, if any. */
function scopeClubId(route: Route, tournaments: Record<string, { clubId: string }>, leagues: { id: string; clubId: string }[]): string | null {
  if (route.params.clubId) return route.params.clubId;
  if ((route.name === 'tournament' || route.name === 'table' || route.name === 'spectate' || route.name === 'results' || route.name === 'console.tournament' || route.name === 'console.wizard') && route.params.id) {
    return tournaments[route.params.id]?.clubId ?? null;
  }
  if (route.name === 'league' && route.params.id) return leagues.find((l) => l.id === route.params.id)?.clubId ?? null;
  return null;
}

function PlayerRoutes({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'tournaments':
      return <Tournaments />;
    case 'clubs':
      return <Clubs />;
    case 'club':
      return <ClubPage clubId={route.params.clubId ?? ''} />;
    case 'tournament':
      return <Lobby tournamentId={route.params.id ?? ''} />;
    case 'results':
      return <Results tournamentId={route.params.id ?? ''} />;
    case 'profile':
      return <Profile key={route.params.tab ?? ''} initialTab={route.params.tab} />;
    case 'hands':
      return <Hands />;
    case 'settings':
      return <Settings />;
    case 'notifications':
      return <Notifications />;
    case 'messages':
      return <Messages clubId={route.params.clubId ?? null} />;
    case 'calendar':
      return <Calendar />;
    case 'club.new':
      return <ClubWizard />;
    case 'staff':
      return <StaffOverview />;
    case 'rankings':
      return <Rankings key={route.params.tab ?? ''} initialTab={route.params.tab} />;
    case 'league':
      return <LeaguePage leagueId={route.params.id ?? ''} />;
    default:
      return <Home />;
  }
}

export function App() {
  const db = useDb();
  const { route, lang, userId } = useSession();
  const me = useMe();
  const settings = useSettings();
  const t = useT();
  const env = me ? environmentOf(route) : 'welcome';

  // Signed-out visitors and stale routes land on the welcome screen.
  useEffect(() => {
    if (!me && route.name !== 'welcome') session.signOut();
    if (me && route.name === 'welcome') {
      const home = homeRouteFor(db, me.id);
      go(home.name, home.params, { replace: true });
    }
  }, [me, route.name, db]);

  const clubId = scopeClubId(route, db.tournaments, db.leagues);
  const club = clubId ? db.clubs[clubId] : undefined;

  let body: ReactNode;
  if (env === 'welcome' || !me) {
    body = <Welcome />;
  } else if (route.name === 'table') {
    body = <TableScreen tournamentId={route.params.id ?? ''} tableNo={route.params.table ? Number(route.params.table) : null} />;
  } else if (route.name === 'spectate') {
    body = <SpectatorScreen tournamentId={route.params.id ?? ''} tableNo={route.params.table ? Number(route.params.table) : null} delayParam={route.params.delay} modeParam={route.params.mode} />;
  } else if (env === 'console') {
    body = club && can(db, me.id, 'console.access', club.id) ? (
      <ConsoleShell route={route} club={club}>
        <ConsoleRouter route={route} club={club} />
      </ConsoleShell>
    ) : club && club.status === 'suspended' && db.memberships.some((m) => m.clubId === club.id && m.userId === me.id && m.role !== 'player' && m.status === 'active') ? (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<LuLock />} title={t('console.suspended.title')} body={t('console.suspended.body', { reason: club.suspendedReason ?? '—' })} className="max-w-md" />
      </div>
    ) : (
      <NoAccess />
    );
  } else if (env === 'platform') {
    body = isPlatformAdmin(db, me.id) ? (
      <PlatformShell route={route}>
        <PlatformRouter route={route} />
      </PlatformShell>
    ) : (
      <NoAccess />
    );
  } else {
    body = (
      <PlayerShell route={route}>
        <PlayerRoutes route={route} />
      </PlayerShell>
    );
  }

  const showDemoBar = env !== 'welcome' && route.name !== 'table' && route.name !== 'spectate';

  return (
    <div
      lang={lang}
      dir={dirOf(lang)}
      className={cx('relative flex h-full flex-col overflow-hidden bg-bg text-ink', settings.animations === 'reduced' && 'reduce-motion', settings.highContrast && 'high-contrast')}
      style={club && env !== 'platform' ? accentStyle(club.branding.accent) : undefined}
      data-env={env}
      data-route={route.name}
      data-user={userId ?? ''}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[70] focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        {t('common.skip_to_content')}
      </a>
      {showDemoBar && <DemoBar />}
      <ErrorBoundary key={route.name + (route.params.clubId ?? '') + (userId ?? '')} onReset={resetDemo} title={t('error.title')} body={t('error.body')} action={t('demo.reset')} denied={<NoAccess />}>
        {body}
      </ErrorBoundary>
      <Toaster />
      <div id="overlay-root" />
    </div>
  );
}
