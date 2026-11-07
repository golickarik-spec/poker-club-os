import type { Route } from '../app/session.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import { can, type Permission } from '../platform/permissions.ts';
import type { Club } from '../platform/types.ts';
import { EmptyState } from '../ui/core.tsx';
import { LuLock } from 'react-icons/lu';
import { Announcements } from './Announcements.tsx';
import { Audit } from './Audit.tsx';
import { Branding } from './Branding.tsx';
import { CrmAnalytics } from './crm/Analytics.tsx';
import { Automation } from './crm/Automation.tsx';
import { CrmSettings } from './crm/CrmSettings.tsx';
import { Inbox } from './crm/Inbox.tsx';
import { NotificationsCenter } from './crm/NotificationsCenter.tsx';
import { CrmOverview } from './crm/Overview.tsx';
import { PlayerProfile } from './crm/PlayerProfile.tsx';
import { Players } from './crm/Players.tsx';
import { Integrity } from '../platform-admin/Integrity.tsx';
import { Migration } from './crm/Migration.tsx';
import { Referrals } from './crm/Referrals.tsx';
import { Requests } from './crm/Requests.tsx';
import { Segments } from './crm/Segments.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Roles } from './Roles.tsx';
import { Subscription } from './Subscription.tsx';
import { Support } from './Support.tsx';
import { TournamentControl } from './TournamentControl.tsx';
import { ConsoleTournaments } from './Tournaments.tsx';
import { Wizard } from './Wizard.tsx';
import { LeagueDetail, Leagues } from './Leagues.tsx';

/**
 * Which permission each screen needs. This only decides what to show; the
 * service functions the screens call check the same permissions again, so a
 * route reached some other way still gets nothing.
 */
const REQUIRED: Partial<Record<Route['name'], Permission>> = {
  'console.wizard': 'tournaments.create',
  'console.crm': 'members.view',
  'console.crm.players': 'members.view',
  'console.crm.player': 'members.view',
  'console.crm.requests': 'members.view',
  'console.crm.segments': 'members.view',
  'console.crm.inbox': 'crm.messages',
  'console.crm.analytics': 'analytics.view',
  'console.crm.automation': 'members.view',
  'console.crm.referrals': 'members.view',
  'console.crm.import': 'crm.configure',
  'console.crm.settings': 'crm.configure',
  'console.announcements': 'announcements.publish',
  'console.branding': 'club.branding',
  'console.audit': 'audit.view',
  'console.integrity': 'audit.view',
  'console.support': 'support.manage',
  'console.subscription': 'billing.view',
};

export function ConsoleRouter({ route, club }: { route: Route; club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const needed = REQUIRED[route.name];
  if (needed && !can(db, me.id, needed, club.id)) {
    return <EmptyState icon={<LuLock />} title={t('console.no_permission.title')} body={t('console.no_permission.body')} className="mx-auto mt-10 max-w-md" />;
  }
  switch (route.name) {
    case 'console.tournaments':
      return <ConsoleTournaments club={club} />;
    case 'console.wizard':
      return <Wizard key={route.params.id ?? route.params.preset ?? route.params.startAt ?? route.params.template ?? 'new'} club={club} editId={route.params.id} presetParam={route.params.preset} startAtParam={route.params.startAt} templateParam={route.params.template} />;
    case 'console.tournament':
      return <TournamentControl club={club} tournamentId={route.params.id ?? ''} />;
    case 'console.crm':
      return <CrmOverview club={club} />;
    case 'console.crm.players':
      return <Players key={`${route.params.segmentId ?? ''}:${route.params.ids ?? ''}`} club={club} segmentParam={route.params.segmentId} idsParam={route.params.ids} />;
    case 'console.crm.player':
      return <PlayerProfile key={route.params.userId} club={club} userId={route.params.userId ?? ''} />;
    case 'console.crm.requests':
      return <Requests club={club} />;
    case 'console.crm.segments':
      return <Segments club={club} />;
    case 'console.crm.inbox':
      return <Inbox club={club} userParam={route.params.userId} conversationParam={route.params.conversationId} />;
    case 'console.crm.notifications':
      return <NotificationsCenter club={club} />;
    case 'console.crm.analytics':
      // The sidebar links straight to a tab; a different tab link remounts with that tab open.
      return <CrmAnalytics key={route.params.tab ?? ''} club={club} initialTab={route.params.tab} />;
    case 'console.leagues':
      return <Leagues club={club} />;
    case 'console.league':
      return <LeagueDetail key={route.params.id} club={club} leagueId={route.params.id ?? ''} />;
    case 'console.crm.automation':
      return <Automation club={club} />;
    case 'console.crm.referrals':
      return <Referrals club={club} />;
    case 'console.crm.import':
      return <Migration club={club} />;
    case 'console.crm.settings':
      return <CrmSettings key={club.id} club={club} />;
    case 'console.announcements':
      return <Announcements key={route.params.segmentId ?? 'all'} club={club} segmentParam={route.params.segmentId} />;
    case 'console.branding':
      return <Branding key={club.id} club={club} />;
    case 'console.roles':
      return <Roles club={club} />;
    case 'console.integrity':
      return <Integrity clubId={club.id} />;
    case 'console.audit':
      return <Audit club={club} />;
    case 'console.support':
      return <Support club={club} />;
    case 'console.subscription':
      return <Subscription club={club} />;
    default:
      return <Dashboard club={club} />;
  }
}
