/**
 * Role-based access control and tenant isolation.
 *
 * Every mutation in `api.ts` calls `requirePermission` (or `requirePlatform`)
 * before touching data. The UI also hides controls a user cannot use, but that
 * is a convenience: the checks here are the ones that count, and they are what
 * the tests exercise. On a real backend this module runs server-side.
 *
 * Rules:
 *  - Permissions are granted by an *active* membership in the *same* club.
 *    Being an owner of Club A grants nothing in Club B.
 *  - A suspended club (tenant) grants no club permissions to anyone.
 *  - Platform staff administer tenants and subscriptions. They are not club
 *    staff and cannot, for example, approve a club's members.
 */
import { ForbiddenError, type DB, type Membership, type Role } from './types.ts';

export type Permission =
  | 'console.access'
  | 'club.edit_profile'
  | 'club.branding'
  | 'members.view'
  | 'members.approve'
  | 'members.suspend'
  | 'members.assign_roles'
  | 'tournaments.create'
  | 'tournaments.edit'
  | 'tournaments.run'
  | 'tournaments.cancel'
  | 'tournaments.registrations'
  | 'announcements.publish'
  | 'analytics.view'
  | 'audit.view'
  | 'support.manage'
  | 'billing.view'
  | 'crm.edit'
  | 'crm.notes'
  | 'crm.messages'
  | 'crm.configure'
  | 'crm.export';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'console.access',
  'club.edit_profile',
  'club.branding',
  'members.view',
  'members.approve',
  'members.suspend',
  'members.assign_roles',
  'tournaments.create',
  'tournaments.edit',
  'tournaments.run',
  'tournaments.cancel',
  'tournaments.registrations',
  'announcements.publish',
  'analytics.view',
  'audit.view',
  'support.manage',
  'billing.view',
  'crm.edit',
  'crm.notes',
  'crm.messages',
  'crm.configure',
  'crm.export',
];

const TOURNAMENT_OPS: Permission[] = [
  'tournaments.create',
  'tournaments.edit',
  'tournaments.run',
  'tournaments.cancel',
  'tournaments.registrations',
];

/**
 * What each role may do.
 *
 *  - owner:              everything in their own club
 *  - manager:            player management, communication and reporting; not the subscription
 *  - tournament_manager: tournaments and their registrations; can look players up, but has no
 *                        notes, inbox, tagging or CRM settings
 *  - support_agent:      talks to players and keeps notes; cannot approve, tag, export or configure
 *  - player:             nothing in the console
 *
 * `members.view` is the permission behind the CRM player database and profiles;
 * `analytics.view` is the one behind the funnel, retention and other reports.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => p !== 'billing.view'),
  tournament_manager: ['console.access', 'members.view', ...TOURNAMENT_OPS, 'announcements.publish', 'analytics.view', 'support.manage'],
  support_agent: ['console.access', 'members.view', 'crm.notes', 'crm.messages'],
  player: [],
};

/** Higher number = more authority. Used to stop staff from promoting above themselves. */
export const ROLE_RANK: Record<Role, number> = { owner: 4, manager: 3, tournament_manager: 2, support_agent: 1, player: 0 };

export function membershipOf(db: DB, userId: string, clubId: string): Membership | undefined {
  return db.memberships.find((m) => m.userId === userId && m.clubId === clubId);
}

export function activeRole(db: DB, userId: string, clubId: string): Role | null {
  const m = membershipOf(db, userId, clubId);
  return m && m.status === 'active' ? m.role : null;
}

export function can(db: DB, userId: string, permission: Permission, clubId: string): boolean {
  const club = db.clubs[clubId];
  if (!club || club.status !== 'active') return false;
  const role = activeRole(db, userId, clubId);
  return role !== null && ROLE_PERMISSIONS[role].includes(permission);
}

export function requirePermission(db: DB, userId: string, permission: Permission, clubId: string): void {
  if (!can(db, userId, permission, clubId)) throw new ForbiddenError(permission);
}

export function isPlatformAdmin(db: DB, userId: string): boolean {
  return db.users[userId]?.platformRole === 'platform_admin';
}

export function requirePlatform(db: DB, userId: string): void {
  if (!isPlatformAdmin(db, userId)) throw new ForbiddenError('platform.admin');
}

export function isActiveMember(db: DB, userId: string, clubId: string): boolean {
  return activeRole(db, userId, clubId) !== null;
}

/** Clubs where the user has console access. */
export function staffClubs(db: DB, userId: string): string[] {
  return db.memberships
    .filter((m) => m.userId === userId && m.status === 'active' && can(db, userId, 'console.access', m.clubId))
    .map((m) => m.clubId);
}

/** May `actor` change `target`'s role to `next`? */
export function canAssignRole(db: DB, actorId: string, clubId: string, targetId: string, next: Role): boolean {
  if (!can(db, actorId, 'members.assign_roles', clubId)) return false;
  if (actorId === targetId) return false;
  const actorRole = activeRole(db, actorId, clubId)!;
  const target = membershipOf(db, targetId, clubId);
  if (!target || target.status !== 'active') return false;
  if (next === 'owner' || target.role === 'owner') return false; // ownership transfer is a separate, unbuilt flow
  // You may only hand out and take away roles below your own.
  return ROLE_RANK[next] < ROLE_RANK[actorRole] && ROLE_RANK[target.role] < ROLE_RANK[actorRole];
}
