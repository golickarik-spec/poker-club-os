/**
 * Session: who is signed in (one of the demo identities), the current route and
 * language. Routing is in-memory — the app never depends on the URL, which keeps
 * it working inside embedded previews.
 */
import { staffClubs } from '../platform/permissions.ts';
import { CLUB_IDS, DEMO_USERS } from '../platform/seed.ts';
import { readStorage, removeStorage, writeStorage } from '../platform/store.ts';
import type { DB, DemoIdentity, Lang } from '../platform/types.ts';

export type RouteName =
  | 'welcome'
  | 'home'
  | 'tournaments'
  | 'clubs'
  | 'club'
  | 'tournament'
  | 'table'
  | 'spectate'
  | 'results'
  | 'profile'
  | 'hands'
  | 'settings'
  | 'notifications'
  | 'messages'
  | 'rankings'
  | 'calendar'
  | 'club.new'
  | 'staff'
  | 'league'
  | 'console.home'
  | 'console.leagues'
  | 'console.league'
  | 'console.tournaments'
  | 'console.wizard'
  | 'console.tournament'
  | 'console.crm'
  | 'console.crm.players'
  | 'console.crm.player'
  | 'console.crm.requests'
  | 'console.crm.segments'
  | 'console.crm.inbox'
  | 'console.crm.notifications'
  | 'console.crm.analytics'
  | 'console.crm.automation'
  | 'console.crm.referrals'
  | 'console.crm.import'
  | 'console.crm.settings'
  | 'console.announcements'
  | 'console.branding'
  | 'console.roles'
  | 'console.audit'
  | 'console.integrity'
  | 'console.support'
  | 'console.subscription'
  | 'platform.home'
  | 'platform.clubs'
  | 'platform.club'
  | 'platform.plans'
  | 'platform.billing'
  | 'platform.health'
  | 'platform.support'
  | 'platform.integrity';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

export type Environment = 'welcome' | 'player' | 'console' | 'platform';

export const environmentOf = (route: Route): Environment =>
  route.name === 'welcome' ? 'welcome' : route.name.startsWith('console.') ? 'console' : route.name.startsWith('platform.') ? 'platform' : 'player';

export interface SessionState {
  userId: string | null;
  lang: Lang;
  route: Route;
  history: Route[];
}

const KEY = 'pcos.session.v3';
type Listener = () => void;

export function homeRouteFor(db: DB, userId: string): Route {
  const user = db.users[userId];
  if (user?.platformRole === 'platform_admin') return { name: 'platform.home', params: {} };
  const staff = staffClubs(db, userId);
  if (staff.length > 0 && user?.demoIdentity !== 'player') return { name: 'console.home', params: { clubId: staff[0]! } };
  return { name: 'home', params: {} };
}

export const IDENTITY_USER: Record<DemoIdentity, string> = DEMO_USERS;
export const DEFAULT_CONSOLE_CLUB = CLUB_IDS.midnight;

export class Session {
  state: SessionState;
  version = 0;
  private listeners = new Set<Listener>();

  constructor(persist = true) {
    const saved = persist ? readStorage<SessionState>(KEY) : null;
    this.state = saved && saved.route && typeof saved.route.name === 'string' ? { ...saved, history: saved.history ?? [] } : { userId: null, lang: 'en', route: { name: 'welcome', params: {} }, history: [] };
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = (): number => this.version;

  private commit(): void {
    this.version += 1;
    writeStorage(KEY, this.state);
    for (const l of this.listeners) l();
  }

  navigate(name: RouteName, params: Record<string, string> = {}, options: { replace?: boolean } = {}): void {
    const next: Route = { name, params };
    const current = this.state.route;
    if (current.name === name && JSON.stringify(current.params) === JSON.stringify(params)) return;
    const history = options.replace ? this.state.history : [...this.state.history, current].slice(-30);
    this.state = { ...this.state, route: next, history };
    this.commit();
  }

  back(fallback: RouteName = 'home', params: Record<string, string> = {}): void {
    const history = [...this.state.history];
    const previous = history.pop();
    if (previous && previous.name !== 'welcome') {
      this.state = { ...this.state, route: previous, history };
      this.commit();
    } else {
      this.navigate(fallback, params, { replace: true });
    }
  }

  signIn(db: DB, userId: string): void {
    this.state = { ...this.state, userId, route: homeRouteFor(db, userId), history: [] };
    this.commit();
  }

  signOut(): void {
    this.state = { ...this.state, userId: null, route: { name: 'welcome', params: {} }, history: [] };
    this.commit();
  }

  setLang(lang: Lang): void {
    this.state = { ...this.state, lang };
    this.commit();
  }

  reset(): void {
    removeStorage(KEY);
    this.state = { userId: null, lang: this.state.lang, route: { name: 'welcome', params: {} }, history: [] };
    this.commit();
  }
}
