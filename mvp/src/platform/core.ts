/**
 * Primitives shared by every service module: the clock, ids, the audit log,
 * in-app notifications, and the CRM's profile and event records.
 *
 * Nothing here checks permissions. These are building blocks for `api.ts`,
 * `crm.ts`, `messaging.ts`, `automation.ts` and `analytics.ts`, which do.
 */
import { fanOut } from './channels.ts';
import {
  DomainError,
  PREF_FOR_KIND,
  type AcquisitionSource,
  type Club,
  type CrmEvent,
  type CrmEventType,
  type CrmProfile,
  type CrmSettings,
  type DB,
  type DeliveryBatch,
  type Lang,
  type NotificationKind,
  type NotificationPref,
  type RouteRef,
  type Tournament,
  type User,
} from './types.ts';

/** Injectable clock so tests can control time. */
export const clock = { now: (): number => Date.now() };

/** Actor id used for automatic transitions (scheduler, simulated activity, automations). Bypasses role checks, never tenant checks. */
export const SYSTEM = 'system';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};

export function newId(db: DB, prefix: string): string {
  db.nextId += 1;
  return `${prefix}_${db.nextId.toString(36)}`;
}

export function audit(db: DB, actorId: string, clubId: string | null, action: string, params: Record<string, string | number> = {}): void {
  db.audit.push({ id: newId(db, 'au'), at: clock.now(), actorId, clubId, action, params });
  if (db.audit.length > 800) db.audit.splice(0, db.audit.length - 800);
}

export const clubOf = (db: DB, clubId: string): Club => db.clubs[clubId] ?? fail('not_found', 'Club not found.');
export const tournamentOf = (db: DB, id: string): Tournament => db.tournaments[id] ?? fail('not_found', 'Tournament not found.');
export const userOf = (db: DB, id: string): User => db.users[id] ?? fail('not_found', 'User not found.');

export function requireActiveClub(club: Club): void {
  if (club.status !== 'active') fail('club_suspended', 'This club is suspended. Contact platform support.');
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * What happened to one notification:
 *  - delivered: it is in the person's in-app inbox
 *  - opted_out: their preferences switch this kind off, so nothing was sent
 *  - duplicate: the same event had already produced a notification
 *  - no_user:   the account does not exist
 */
export type NotifyOutcome = 'delivered' | 'opted_out' | 'duplicate' | 'no_user';

export interface NotifyExtra {
  clubId?: string;
  batchId?: string;
  /** Identifies the triggering event. Only one notification per person is ever created for a key. */
  dedupeKey?: string;
}

export function notificationEnabled(db: DB, userId: string, kind: NotificationKind): boolean {
  const pref: NotificationPref | null = PREF_FOR_KIND[kind];
  if (pref === null) return true;
  const prefs = db.settings[userId]?.notifications;
  return prefs ? prefs[pref] !== false : true;
}

export function notify(
  db: DB,
  userId: string,
  kind: NotificationKind,
  key: string,
  params: Record<string, string | number> = {},
  link: RouteRef | null = null,
  extra: NotifyExtra = {},
): NotifyOutcome {
  const user = db.users[userId];
  if (!user) return 'no_user';
  if (!notificationEnabled(db, userId, kind)) return 'opted_out';
  // Simulated members have an inbox in principle, but nobody reads it, so no row is stored for them.
  if (user.isBot) return 'delivered';
  if (extra.dedupeKey && db.notifications.some((n) => n.userId === userId && n.dedupeKey === extra.dedupeKey)) return 'duplicate';
  db.notifications.push({ id: newId(db, 'n'), userId, at: clock.now(), kind, key, params, read: false, link, ...extra });
  if (db.notifications.length > 600) db.notifications.splice(0, db.notifications.length - 600);
  fanOut(db, userId, key, params, extra.clubId ?? null);
  return 'delivered';
}

/**
 * Send one thing to many people and keep the record of what happened.
 * `clubOptOut` is the club-level switch (a member who muted this club, a
 * follower who turned updates off); the person's own notification preferences
 * are checked by `notify`. Counts in the record are what was actually done.
 */
export function deliver(
  db: DB,
  spec: { clubId: string; kind: DeliveryBatch['kind']; refId: string; notificationKind: NotificationKind; key: string; params: Record<string, string | number>; link: RouteRef | null; dedupePrefix: string },
  userIds: string[],
  clubOptOut: (userId: string) => boolean = () => false,
): DeliveryBatch {
  const batch: DeliveryBatch = { id: newId(db, 'bt'), clubId: spec.clubId, kind: spec.kind, refId: spec.refId, at: clock.now(), eligible: 0, delivered: [], optedOut: 0, errors: 0, readBy: [], simulatedReadBy: [] };
  for (const userId of new Set(userIds)) {
    if (!db.users[userId]) continue;
    batch.eligible++;
    if (clubOptOut(userId)) {
      batch.optedOut++;
      continue;
    }
    const outcome = notify(db, userId, spec.notificationKind, spec.key, spec.params, spec.link, { clubId: spec.clubId, batchId: batch.id, dedupeKey: `${spec.dedupePrefix}:${userId}` });
    if (outcome === 'delivered') batch.delivered.push(userId);
    else if (outcome === 'opted_out') batch.optedOut++;
  }
  db.batches.push(batch);
  if (db.batches.length > 400) db.batches.splice(0, db.batches.length - 400);
  return batch;
}

// ---------------------------------------------------------------------------
// CRM records
// ---------------------------------------------------------------------------

export const profileKey = (clubId: string, userId: string): string => `${clubId}:${userId}`;

export const DEFAULT_CRM_SETTINGS: CrmSettings = { activeDays: 30, inactiveDays: 45, newMemberDays: 14, retentionMonths: 0 };

export function crmSettings(db: DB, clubId: string): CrmSettings {
  return db.crm.settings[clubId] ?? DEFAULT_CRM_SETTINGS;
}

/** The club's record of a person, created on first contact. First-touch attribution: a source is only set once. */
export function ensureProfile(db: DB, clubId: string, userId: string, attribution?: { source: AcquisitionSource; linkId: string | null }): CrmProfile {
  const key = profileKey(clubId, userId);
  let profile = db.crm.profiles[key];
  if (!profile) {
    profile = { clubId, userId, memberNo: null, firstSeenAt: clock.now(), tagIds: [], assignedTo: null, lastContactedAt: null, source: 'unknown', linkId: null };
    db.crm.profiles[key] = profile;
  }
  if (attribution && profile.source === 'unknown') {
    profile.source = attribution.source;
    profile.linkId = attribution.linkId;
  }
  return profile;
}

export function logEvent(
  db: DB,
  clubId: string,
  userId: string,
  type: CrmEventType,
  actorId: string | null,
  params: Record<string, string | number> = {},
  at: number = clock.now(),
): CrmEvent {
  ensureProfile(db, clubId, userId);
  const event: CrmEvent = { id: newId(db, 'ev'), clubId, userId, type, at, actorId, params };
  db.crm.events.push(event);
  if (db.crm.events.length > 12_000) db.crm.events.splice(0, db.crm.events.length - 12_000);
  return event;
}

/** A signed-in person's own language setting, otherwise the language on their account. */
export function preferredLanguage(db: DB, userId: string): Lang {
  return db.settings[userId]?.lang ?? db.users[userId]?.lang ?? 'en';
}

export function isFollowing(db: DB, userId: string, clubId: string): boolean {
  return db.follows.some((f) => f.userId === userId && f.clubId === clubId);
}
