import type { Route } from '../app/session.ts';
import { Billing } from './Billing.tsx';
import { ClubDetail, Clubs } from './Clubs.tsx';
import { Health } from './Health.tsx';
import { Integrity } from './Integrity.tsx';
import { Overview } from './Overview.tsx';
import { Plans } from './Plans.tsx';
import { PlatformSupport } from './Support.tsx';

export function PlatformRouter({ route }: { route: Route }) {
  switch (route.name) {
    case 'platform.clubs':
      return <Clubs />;
    case 'platform.club':
      return <ClubDetail key={route.params.clubId} clubId={route.params.clubId ?? ''} />;
    case 'platform.plans':
      return <Plans />;
    case 'platform.billing':
      return <Billing />;
    case 'platform.health':
      return <Health />;
    case 'platform.support':
      return <PlatformSupport />;
    case 'platform.integrity':
      return <Integrity />;
    default:
      return <Overview />;
  }
}
