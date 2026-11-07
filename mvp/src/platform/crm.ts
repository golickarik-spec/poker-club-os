/**
 * Club CRM service: the player database, profiles, tags, notes, segments,
 * staff assignment, invitation links, export and retention.
 *
 * Everything in `db.crm` is private to one club. This module is the only way
 * in: every function takes the actor and the club and checks the actor's
 * permission *in that club* before reading or writing, so staff of another
 * club get a `ForbiddenError`, not data. Screens never touch `db.crm` directly
 * (a test enforces that).
 */
import { variantOf } from '../engine/variants.ts';
import { leagueStandings } from './competition.ts';
import { compute, type Lifecycle, type Participation, type PlayerTournamentStats } from './analytics.ts';
import { audit, clock, crmSettings, DAY, DEFAULT_CRM_SETTINGS, ensureProfile, fail, logEvent, newId, preferredLanguage, profileKey, userOf } from './core.ts';
import { can, isActiveMember, membershipOf, requirePermission } from './permissions.ts';
import {
  type AcquisitionSource,
  type AutomationRule,
  type Club,
  type CrmEvent,
  type CrmEventType,
  type CrmNote,
  type CrmSegment,
  type CrmSettings,
  type CrmTag,
  type DB,
  type InviteLink,
  type Lang,
  type LifecycleStage,
  type MemberStatus,
  type Role,
  type SegmentRule,
  type TagColor,
  ACQUISITION_SOURCES,
  AUTOMATION_KEYS,
  TAG_COLORS,
} from './types.ts';

// ---------------------------------------------------------------------------
// Setting a club up
// ---------------------------------------------------------------------------

export const STARTER_TAGS: readonly { name: string; color: TagColor }[] = [
  { name: 'New Member', color: 'teal' },
  { name: 'Regular Player', color: 'blue' },
  { name: 'Weekend Player', color: 'violet' },
  { name: 'Tournament Enthusiast', color: 'orange' },
  { name: 'VIP Member', color: 'gold' },
  { name: 'Tournament Winner', color: 'green' },
  { name: 'Returning Player', color: 'blue' },
  { name: 'Inactive Member', color: 'slate' },
  { name: 'Needs Support', color: 'red' },
  { name: 'English Speaking', color: 'slate' },
  { name: 'Hebrew Speaking', color: 'slate' },
];

/** Name of the tag the "inactive player" automation applies. Created on demand. */
export const INACTIVE_TAG = 'Inactive Member';

export const SYSTEM_SEGMENTS = ['new_members', 'active_players', 'inactive_players', 'regulars', 'winners', 'followers', 'at_risk_7', 'at_risk_14', 'inactive_30', 'vip', 'holdem_players', 'omaha_players', 'league_players', 'referred_members'] as const;
export type SystemSegment = (typeof SYSTEM_SEGMENTS)[number];

/** The rules behind each built-in segment. They follow the club's CRM settings, so they are generated, not stored. */
export function systemRules(key: SystemSegment, settings: CrmSettings): SegmentRule[] {
  switch (key) {
    case 'new_members':
      return [
        { field: 'status', op: 'is', value: 'active' },
        { field: 'approved_days', op: 'lte', value: settings.newMemberDays },
      ];
    case 'active_players':
      return [{ field: 'played_recent', op: 'gte', value: 1, days: settings.activeDays }];
    case 'inactive_players':
      return [
        { field: 'played_total', op: 'gte', value: 1 },
        { field: 'last_played_days', op: 'gte', value: settings.inactiveDays },
      ];
    case 'regulars':
      return [{ field: 'played_recent', op: 'gte', value: 5, days: 30 }];
    case 'winners':
      return [{ field: 'wins', op: 'gte', value: 1 }];
    case 'followers':
      return [
        { field: 'follower', op: 'is', value: 'yes' },
        { field: 'status', op: 'is_not', value: 'active' },
      ];
    // v0.4 retention: members who played before and are drifting away, by how long it has been.
    case 'at_risk_7':
      return [
        { field: 'status', op: 'is', value: 'active' },
        { field: 'played_total', op: 'gte', value: 1 },
        { field: 'last_played_days', op: 'gte', value: 7 },
        { field: 'last_played_days', op: 'lte', value: 13 },
      ];
    case 'at_risk_14':
      return [
        { field: 'status', op: 'is', value: 'active' },
        { field: 'played_total', op: 'gte', value: 1 },
        { field: 'last_played_days', op: 'gte', value: 14 },
        { field: 'last_played_days', op: 'lte', value: 29 },
      ];
    case 'inactive_30':
      return [
        { field: 'status', op: 'is', value: 'active' },
        { field: 'played_total', op: 'gte', value: 1 },
        { field: 'last_played_days', op: 'gte', value: 30 },
      ];
    case 'vip':
      return [
        { field: 'status', op: 'is', value: 'active' },
        { field: 'played_total', op: 'gte', value: 12 },
        { field: 'played_recent', op: 'gte', value: 2, days: 60 },
      ];
    case 'holdem_players':
      return [{ field: 'game_family', op: 'is', value: 'holdem' }];
    case 'omaha_players':
      return [{ field: 'game_family', op: 'is', value: 'omaha' }];
    case 'league_players':
      return [{ field: 'league', op: 'is', value: 'yes' }];
    case 'referred_members':
      return [
        { field: 'status', op: 'is', value: 'active' },
        { field: 'referred', op: 'is', value: 'yes' },
      ];
  }
}

export function defaultRule(clubId: string, key: AutomationRule['key'], now: number): AutomationRule {
  return {
    clubId,
    key,
    enabled: true,
    message: 'Welcome to the club. Your membership is approved: you can now register for our tournaments. Write to us here if you need anything.',
    minutesBefore: 15,
    inactiveDays: DEFAULT_CRM_SETTINGS.inactiveDays,
    updatedAt: now,
    updatedBy: null,
  };
}

/** Create the CRM scaffolding for a club: starter tags, built-in segments, automation rules, settings. Idempotent. */
export function initClubCrm(db: DB, clubId: string, now: number = clock.now(), tags: readonly { name: string; color: TagColor }[] = STARTER_TAGS): void {
  const crm = db.crm;
  if (!crm.settings[clubId]) crm.settings[clubId] = { ...DEFAULT_CRM_SETTINGS };
  if (!crm.tags.some((t) => t.clubId === clubId)) {
    for (const tag of tags) crm.tags.push({ id: newId(db, 'tag'), clubId, name: tag.name, color: tag.color, createdAt: now });
  }
  for (const key of SYSTEM_SEGMENTS) {
    if (!crm.segments.some((s) => s.clubId === clubId && s.system === key)) {
      crm.segments.push({ id: newId(db, 'seg'), clubId, name: key, kind: 'dynamic', match: 'all', rules: [], userIds: [], system: key, createdBy: 'system', createdAt: now });
    }
  }
  for (const key of AUTOMATION_KEYS) {
    if (!crm.rules.some((r) => r.clubId === clubId && r.key === key)) crm.rules.push(defaultRule(clubId, key, now));
  }
}

// ---------------------------------------------------------------------------
// The player database
// ---------------------------------------------------------------------------

export interface PlayerRow {
  userId: string;
  name: string;
  handle: string;
  hue: number;
  isBot: boolean;
  lang: Lang;
  memberNo: number | null;
  /** Membership status; `none` for a follower or a former member. */
  status: MemberStatus | 'none';
  role: Role | null;
  following: boolean;
  requestedAt: number | null;
  /** When the membership was approved. */
  joinedAt: number | null;
  lastActiveAt: number | null;
  lastPlayedAt: number | null;
  tournaments: number;
  wins: number;
  tagIds: string[];
  assignedTo: string | null;
  lastContactedAt: number | null;
  lifecycle: LifecycleStage | null;
  /** Played within the club's "active" period. */
  active: boolean;
  source: AcquisitionSource;
}

function rowFor(db: DB, clubId: string, userId: string, lastEventAt: Map<string, number>, now: number): PlayerRow | null {
  const user = db.users[userId];
  if (!user) return null;
  const profile = db.crm.profiles[profileKey(clubId, userId)];
  const membership = membershipOf(db, userId, clubId);
  const stats = compute.playerStats(db, clubId, userId);
  const life: Lifecycle = compute.lifecycleOf(db, clubId, userId, now);
  const candidates = [membership?.status === 'active' ? membership.lastActiveAt : null, stats.lastPlayedAt, lastEventAt.get(userId) ?? null].filter((x): x is number => x !== null);
  return {
    userId,
    name: user.name,
    handle: user.handle,
    hue: user.hue,
    isBot: user.isBot,
    lang: preferredLanguage(db, userId),
    memberNo: profile?.memberNo ?? null,
    status: membership?.status ?? 'none',
    role: membership?.status === 'active' ? membership.role : null,
    following: db.follows.some((f) => f.clubId === clubId && f.userId === userId),
    requestedAt: membership?.requestedAt ?? null,
    joinedAt: membership?.joinedAt ?? null,
    lastActiveAt: candidates.length > 0 ? Math.max(...candidates) : null,
    lastPlayedAt: stats.lastPlayedAt,
    tournaments: stats.tournaments,
    wins: stats.wins,
    tagIds: profile?.tagIds ?? [],
    assignedTo: profile?.assignedTo ?? null,
    lastContactedAt: profile?.lastContactedAt ?? null,
    lifecycle: life.stage,
    active: life.active,
    source: profile?.source ?? 'unknown',
  };
}

/** Everyone the club has a record of: members in any state, followers, and people who wrote or asked to join. */
function allRows(db: DB, clubId: string, now: number = clock.now()): PlayerRow[] {
  const ids = new Set<string>();
  for (const key in db.crm.profiles) if (db.crm.profiles[key]!.clubId === clubId) ids.add(db.crm.profiles[key]!.userId);
  for (const m of db.memberships) if (m.clubId === clubId) ids.add(m.userId);
  for (const f of db.follows) if (f.clubId === clubId) ids.add(f.userId);
  const own = new Set(['followed', 'membership_requested', 'tournament_requested', 'tournament_registered', 'message_sent', 'link_opened']);
  const lastEventAt = new Map<string, number>();
  for (const e of db.crm.events) {
    if (e.clubId === clubId && own.has(e.type) && e.at > (lastEventAt.get(e.userId) ?? 0)) lastEventAt.set(e.userId, e.at);
  }
  const wrote = new Set(db.conversations.filter((c) => c.clubId === clubId).map((c) => c.userId));
  const rows: PlayerRow[] = [];
  for (const id of ids) {
    const row = rowFor(db, clubId, id, lastEventAt, now);
    if (!row) continue;
    // Opening an invitation link is counted in the acquisition report, but it is not yet a relationship with the club.
    const stranger = row.status === 'none' && !row.following && row.lifecycle === null && row.tagIds.length === 0 && !wrote.has(id);
    if (!stranger) rows.push(row);
  }
  return rows;
}

export type PlayerSort = 'joined' | 'most_active' | 'least_active' | 'tournaments' | 'wins' | 'contacted' | 'name';

export interface PlayerQuery {
  search?: string;
  statuses?: (MemberStatus | 'none')[];
  /** Every listed tag must be present. */
  tagIds?: string[];
  /** A staff user id, or `none` for unassigned. */
  assignedTo?: string;
  lifecycle?: LifecycleStage[];
  active?: boolean;
  following?: boolean;
  /** Approved within the last N days. */
  joinedWithinDays?: number;
  /** Last activity within / not within the last N days. */
  activeWithinDays?: number;
  inactiveForDays?: number;
  minTournaments?: number;
  maxTournaments?: number;
  /** Restrict to a saved segment. */
  segmentId?: string;
  /** Restrict to an explicit list (funnel drill-down). */
  userIds?: string[];
  sort?: PlayerSort;
}

const SORTS: Record<PlayerSort, (a: PlayerRow, b: PlayerRow) => number> = {
  joined: (a, b) => (b.joinedAt ?? b.requestedAt ?? 0) - (a.joinedAt ?? a.requestedAt ?? 0),
  most_active: (a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
  least_active: (a, b) => (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0),
  tournaments: (a, b) => b.tournaments - a.tournaments,
  wins: (a, b) => b.wins - a.wins || b.tournaments - a.tournaments,
  contacted: (a, b) => (b.lastContactedAt ?? 0) - (a.lastContactedAt ?? 0),
  name: (a, b) => a.name.localeCompare(b.name),
};

function applyQuery(db: DB, clubId: string, rows: PlayerRow[], q: PlayerQuery, now: number): PlayerRow[] {
  let out = rows;
  if (q.userIds) {
    const set = new Set(q.userIds);
    out = out.filter((r) => set.has(r.userId));
  }
  if (q.segmentId) {
    const set = new Set(segmentUserIds(db, clubId, q.segmentId, rows, now));
    out = out.filter((r) => set.has(r.userId));
  }
  const search = q.search?.trim().toLowerCase();
  if (search) {
    out = out.filter(
      (r) => r.name.toLowerCase().includes(search) || r.handle.toLowerCase().includes(search) || r.userId.toLowerCase() === search || (r.memberNo !== null && memberId(db.clubs[clubId]!, r.memberNo).toLowerCase().includes(search)),
    );
  }
  if (q.statuses && q.statuses.length > 0) out = out.filter((r) => q.statuses!.includes(r.status));
  if (q.tagIds && q.tagIds.length > 0) out = out.filter((r) => q.tagIds!.every((id) => r.tagIds.includes(id)));
  if (q.assignedTo) out = out.filter((r) => (q.assignedTo === 'none' ? r.assignedTo === null : r.assignedTo === q.assignedTo));
  if (q.lifecycle && q.lifecycle.length > 0) out = out.filter((r) => r.lifecycle !== null && q.lifecycle!.includes(r.lifecycle));
  if (q.active !== undefined) out = out.filter((r) => r.active === q.active);
  if (q.following !== undefined) out = out.filter((r) => r.following === q.following);
  if (q.joinedWithinDays !== undefined) out = out.filter((r) => r.joinedAt !== null && now - r.joinedAt <= q.joinedWithinDays! * DAY);
  if (q.activeWithinDays !== undefined) out = out.filter((r) => r.lastActiveAt !== null && now - r.lastActiveAt <= q.activeWithinDays! * DAY);
  if (q.inactiveForDays !== undefined) out = out.filter((r) => r.lastActiveAt === null || now - r.lastActiveAt > q.inactiveForDays! * DAY);
  if (q.minTournaments !== undefined) out = out.filter((r) => r.tournaments >= q.minTournaments!);
  if (q.maxTournaments !== undefined) out = out.filter((r) => r.tournaments <= q.maxTournaments!);
  return [...out].sort(SORTS[q.sort ?? 'most_active']);
}

/** Club-specific member id as shown to staff and the member, e.g. "MPC-0042". */
export function memberId(club: Club, memberNo: number): string {
  const prefix = club.name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return `${prefix || 'M'}-${String(memberNo).padStart(4, '0')}`;
}

export function queryPlayers(db: DB, actorId: string, clubId: string, query: PlayerQuery = {}): { rows: PlayerRow[]; total: number } {
  requirePermission(db, actorId, 'members.view', clubId);
  const now = clock.now();
  const all = allRows(db, clubId, now);
  return { rows: applyQuery(db, clubId, all, query, now), total: all.length };
}

// ---------------------------------------------------------------------------
// One player's profile
// ---------------------------------------------------------------------------

export interface TimelineItem {
  id: string;
  at: number;
  /** Message key suffix (see i18n `timeline.crm.*`). */
  type: string;
  params: Record<string, string | number>;
  actorId: string | null;
}

export interface PlayerProfile {
  row: PlayerRow;
  /** Present only when the member agreed to share it with this club. */
  email: string | null;
  demoPoints: number | null;
  stats: PlayerTournamentStats;
  history: Participation[];
  timeline: TimelineItem[];
  /** Null when the actor may not read notes. */
  notes: CrmNote[] | null;
  conversationId: string | null;
}

function timelineFor(db: DB, clubId: string, userId: string): TimelineItem[] {
  const items: TimelineItem[] = [];
  const tagName = (id: string | number | undefined): string => db.crm.tags.find((t) => t.id === id)?.name ?? '';
  for (const e of db.crm.events) {
    if (e.clubId !== clubId || e.userId !== userId) continue;
    const params = { ...e.params };
    if (e.type === 'tag_added' || e.type === 'tag_removed') params.tag = tagName(params.tagId) || String(params.tag ?? '');
    if (e.type === 'staff_assigned') params.staff = params.staffId ? (db.users[String(params.staffId)]?.name ?? '') : '';
    items.push({ id: e.id, at: e.at, type: e.type === 'staff_assigned' && !params.staffId ? 'staff_unassigned' : e.type, params, actorId: e.actorId });
  }
  for (const p of compute.playerParticipations(db, clubId, userId)) {
    items.push({ id: `p:${p.tournamentId}`, at: p.at, type: 'participated', params: { name: p.name }, actorId: null });
    if (p.completedAt !== null && p.place !== null) {
      items.push({ id: `r:${p.tournamentId}`, at: p.completedAt, type: p.place === 1 ? 'won' : 'finished', params: { name: p.name, place: p.place, entrants: p.entrants }, actorId: null });
    }
  }
  for (const batch of db.batches) {
    if (batch.clubId !== clubId || batch.kind !== 'announcement' || !batch.delivered.includes(userId)) continue;
    const a = db.announcements.find((x) => x.id === batch.refId);
    if (a) items.push({ id: `a:${batch.id}`, at: batch.at, type: 'announcement_received', params: { title: a.title }, actorId: null });
  }
  return items.sort((a, b) => b.at - a.at);
}

export function playerProfile(db: DB, actorId: string, clubId: string, userId: string): PlayerProfile {
  requirePermission(db, actorId, 'members.view', clubId);
  const row = allRows(db, clubId).find((r) => r.userId === userId) ?? fail('not_found', 'This club has no record of that player.');
  const membership = membershipOf(db, userId, clubId);
  return {
    row,
    email: membership?.shareContact ? userOf(db, userId).email : null,
    demoPoints: membership?.status === 'active' ? membership.demoPoints : null,
    stats: compute.playerStats(db, clubId, userId),
    history: [...compute.playerParticipations(db, clubId, userId)].reverse(),
    timeline: timelineFor(db, clubId, userId),
    notes: can(db, actorId, 'crm.notes', clubId) ? db.crm.notes.filter((n) => n.clubId === clubId && n.userId === userId).sort((a, b) => b.createdAt - a.createdAt) : null,
    conversationId: db.conversations.find((c) => c.clubId === clubId && c.userId === userId)?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function listTags(db: DB, actorId: string, clubId: string): (CrmTag & { members: number })[] {
  requirePermission(db, actorId, 'members.view', clubId);
  const counts = new Map<string, number>();
  for (const key in db.crm.profiles) {
    const p = db.crm.profiles[key]!;
    if (p.clubId === clubId) for (const id of p.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return db.crm.tags
    .filter((t) => t.clubId === clubId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ ...t, members: counts.get(t.id) ?? 0 }));
}

function cleanTagName(db: DB, clubId: string, name: string, exceptId?: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 1 || clean.length > 28) fail('bad_tag_name', 'A tag name needs 1 to 28 characters.');
  if (db.crm.tags.some((t) => t.clubId === clubId && t.id !== exceptId && t.name.toLowerCase() === clean.toLowerCase())) fail('tag_exists', 'This club already has a tag with that name.');
  return clean;
}

const tagOf = (db: DB, clubId: string, tagId: string): CrmTag => db.crm.tags.find((t) => t.id === tagId && t.clubId === clubId) ?? fail('not_found', 'Tag not found.');

export function createTag(db: DB, actorId: string, clubId: string, input: { name: string; color: TagColor }): CrmTag {
  requirePermission(db, actorId, 'crm.configure', clubId);
  if (!TAG_COLORS.includes(input.color)) fail('bad_color', 'Unknown tag colour.');
  if (db.crm.tags.filter((t) => t.clubId === clubId).length >= 60) fail('too_many_tags', 'A club can have up to 60 tags.');
  const tag: CrmTag = { id: newId(db, 'tag'), clubId, name: cleanTagName(db, clubId, input.name), color: input.color, createdAt: clock.now() };
  db.crm.tags.push(tag);
  audit(db, actorId, clubId, 'crm.tag_created', { tag: tag.name });
  return tag;
}

export function updateTag(db: DB, actorId: string, clubId: string, tagId: string, patch: { name?: string; color?: TagColor }): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const tag = tagOf(db, clubId, tagId);
  if (patch.name !== undefined) tag.name = cleanTagName(db, clubId, patch.name, tagId);
  if (patch.color !== undefined) {
    if (!TAG_COLORS.includes(patch.color)) fail('bad_color', 'Unknown tag colour.');
    tag.color = patch.color;
  }
  audit(db, actorId, clubId, 'crm.tag_updated', { tag: tag.name });
}

export function deleteTag(db: DB, actorId: string, clubId: string, tagId: string): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const tag = tagOf(db, clubId, tagId);
  db.crm.tags.splice(db.crm.tags.indexOf(tag), 1);
  for (const key in db.crm.profiles) {
    const p = db.crm.profiles[key]!;
    if (p.clubId === clubId) p.tagIds = p.tagIds.filter((id) => id !== tagId);
  }
  // Segment rules that pointed at the tag are dropped rather than left dangling.
  for (const s of db.crm.segments) if (s.clubId === clubId) s.rules = s.rules.filter((r) => !(r.field === 'tag' && r.value === tagId));
  audit(db, actorId, clubId, 'crm.tag_deleted', { tag: tag.name });
}

/** The people a staff action targets must already be known to this club. */
function knownPlayer(db: DB, clubId: string, userId: string): void {
  userOf(db, userId);
  const known = db.crm.profiles[profileKey(clubId, userId)] || membershipOf(db, userId, clubId) || db.follows.some((f) => f.clubId === clubId && f.userId === userId);
  if (!known) fail('not_found', 'This club has no record of that player.');
}

/** Unguarded: add a tag to one person. Used by staff actions and by automation. Returns false when it was already there. */
export function applyTag(db: DB, clubId: string, userId: string, tagId: string, actorId: string | null): boolean {
  const profile = ensureProfile(db, clubId, userId);
  if (profile.tagIds.includes(tagId)) return false;
  profile.tagIds.push(tagId);
  logEvent(db, clubId, userId, 'tag_added', actorId, { tagId });
  return true;
}

export function clearTag(db: DB, clubId: string, userId: string, tagId: string, actorId: string | null): boolean {
  const profile = db.crm.profiles[profileKey(clubId, userId)];
  if (!profile || !profile.tagIds.includes(tagId)) return false;
  profile.tagIds = profile.tagIds.filter((id) => id !== tagId);
  logEvent(db, clubId, userId, 'tag_removed', actorId, { tagId });
  return true;
}

export function addTag(db: DB, actorId: string, clubId: string, userIds: string[], tagId: string): number {
  requirePermission(db, actorId, 'crm.edit', clubId);
  tagOf(db, clubId, tagId);
  let changed = 0;
  for (const userId of userIds) {
    knownPlayer(db, clubId, userId);
    if (applyTag(db, clubId, userId, tagId, actorId)) changed++;
  }
  return changed;
}

export function removeTag(db: DB, actorId: string, clubId: string, userIds: string[], tagId: string): number {
  requirePermission(db, actorId, 'crm.edit', clubId);
  tagOf(db, clubId, tagId);
  let changed = 0;
  for (const userId of userIds) if (clearTag(db, clubId, userId, tagId, actorId)) changed++;
  return changed;
}

// ---------------------------------------------------------------------------
// Staff assignment
// ---------------------------------------------------------------------------

export function staffOf(db: DB, actorId: string, clubId: string): { userId: string; name: string; role: Role }[] {
  requirePermission(db, actorId, 'console.access', clubId);
  return db.memberships
    .filter((m) => m.clubId === clubId && m.status === 'active' && m.role !== 'player')
    .map((m) => ({ userId: m.userId, name: db.users[m.userId]?.name ?? '', role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function assignStaff(db: DB, actorId: string, clubId: string, userIds: string[], staffId: string | null): number {
  requirePermission(db, actorId, 'crm.edit', clubId);
  if (staffId !== null && !can(db, staffId, 'console.access', clubId)) fail('not_staff', 'Players can only be assigned to this club\'s staff.');
  let changed = 0;
  for (const userId of userIds) {
    knownPlayer(db, clubId, userId);
    const profile = ensureProfile(db, clubId, userId);
    if (profile.assignedTo === staffId) continue;
    profile.assignedTo = staffId;
    logEvent(db, clubId, userId, 'staff_assigned', actorId, staffId ? { staffId } : {});
    changed++;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Private notes
// ---------------------------------------------------------------------------

const noteOf = (db: DB, clubId: string, noteId: string): CrmNote => db.crm.notes.find((n) => n.id === noteId && n.clubId === clubId) ?? fail('not_found', 'Note not found.');

function cleanNote(body: string): string {
  const text = body.trim();
  if (text.length < 2) fail('bad_body', 'Write a note first.');
  return text.slice(0, 2000);
}

export function listNotes(db: DB, actorId: string, clubId: string, userId: string): CrmNote[] {
  requirePermission(db, actorId, 'crm.notes', clubId);
  return db.crm.notes.filter((n) => n.clubId === clubId && n.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

export function addNote(db: DB, actorId: string, clubId: string, userId: string, body: string): CrmNote {
  requirePermission(db, actorId, 'crm.notes', clubId);
  knownPlayer(db, clubId, userId);
  const now = clock.now();
  const note: CrmNote = { id: newId(db, 'note'), clubId, userId, authorId: actorId, body: cleanNote(body), createdAt: now, updatedAt: now, updatedBy: actorId, history: [] };
  db.crm.notes.push(note);
  logEvent(db, clubId, userId, 'note_added', actorId);
  return note;
}

export function updateNote(db: DB, actorId: string, clubId: string, noteId: string, body: string): void {
  requirePermission(db, actorId, 'crm.notes', clubId);
  const note = noteOf(db, clubId, noteId);
  const text = cleanNote(body);
  if (text === note.body) return;
  // Keep the replaced version with the person who wrote it and when.
  note.history.push({ at: note.updatedAt, editorId: note.updatedBy, body: note.body });
  if (note.history.length > 20) note.history.splice(0, note.history.length - 20);
  note.body = text;
  note.updatedAt = clock.now();
  note.updatedBy = actorId;
}

export function deleteNote(db: DB, actorId: string, clubId: string, noteId: string): void {
  requirePermission(db, actorId, 'crm.notes', clubId);
  const note = noteOf(db, clubId, noteId);
  if (note.authorId !== actorId && !can(db, actorId, 'crm.configure', clubId)) fail('not_author', 'Only the author or a manager can delete a note.');
  db.crm.notes.splice(db.crm.notes.indexOf(note), 1);
  audit(db, actorId, clubId, 'crm.note_deleted', { user: userOf(db, note.userId).name });
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

function matches(row: PlayerRow, rule: SegmentRule, db: DB, clubId: string, now: number): boolean {
  const is = (actual: string): boolean => (rule.op === 'is_not' ? actual !== String(rule.value) : actual === String(rule.value));
  const compare = (actual: number): boolean => (rule.op === 'lte' ? actual <= Number(rule.value) : rule.op === 'gte' ? actual >= Number(rule.value) : rule.op === 'is_not' ? actual !== Number(rule.value) : actual === Number(rule.value));
  switch (rule.field) {
    case 'status':
      return is(row.status);
    case 'lifecycle':
      return is(row.lifecycle ?? 'none');
    case 'active':
      return is(row.active ? 'yes' : 'no');
    case 'follower':
      return is(row.following ? 'yes' : 'no');
    case 'tag': {
      const has = row.tagIds.includes(String(rule.value));
      return rule.op === 'is_not' ? !has : has;
    }
    case 'language':
      return is(row.lang);
    case 'assigned':
      return is(row.assignedTo ?? 'none');
    case 'source':
      return is(row.source);
    case 'played_total':
      return compare(row.tournaments);
    case 'wins':
      return compare(row.wins);
    case 'played_recent': {
      const since = now - (rule.days ?? 30) * DAY;
      return compare(compute.playerParticipations(db, clubId, row.userId).filter((p) => p.at >= since).length);
    }
    case 'approved_days':
      return row.joinedAt !== null && compare(Math.floor((now - row.joinedAt) / DAY));
    case 'last_played_days':
      return row.lastPlayedAt !== null && compare(Math.floor((now - row.lastPlayedAt) / DAY));
    case 'game_family': {
      const played = compute.playerParticipations(db, clubId, row.userId).some((p) => variantOf(p.game).family === String(rule.value));
      return rule.op === 'is_not' ? !played : played;
    }
    case 'league': {
      const inLeague = db.leagues.some((l) => l.clubId === clubId && l.status === 'active' && leagueStandings(db, l).some((s) => s.userId === row.userId));
      return is(inLeague ? 'yes' : 'no');
    }
    case 'referred':
      return is(referrerFor(db, clubId, row.userId) ? 'yes' : 'no');
  }
}

const FIELDS = new Set<SegmentRule['field']>(['status', 'lifecycle', 'active', 'follower', 'tag', 'language', 'played_recent', 'played_total', 'wins', 'approved_days', 'last_played_days', 'assigned', 'source', 'game_family', 'league', 'referred']);
const NUMERIC = new Set<SegmentRule['field']>(['played_recent', 'played_total', 'wins', 'approved_days', 'last_played_days']);

function cleanRules(db: DB, clubId: string, rules: SegmentRule[]): SegmentRule[] {
  if (rules.length > 12) fail('too_many_rules', 'A segment can have up to 12 conditions.');
  return rules.map((r) => {
    if (!FIELDS.has(r.field)) fail('bad_rule', 'Unknown segment condition.');
    if (NUMERIC.has(r.field)) {
      const n = Number(r.value);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) fail('bad_rule', 'That condition needs a whole number.');
      if (r.op !== 'gte' && r.op !== 'lte') fail('bad_rule', 'Choose "at least" or "at most" for that condition.');
      return r.field === 'played_recent' ? { field: r.field, op: r.op, value: n, days: Math.min(365, Math.max(1, Math.round(r.days ?? 30))) } : { field: r.field, op: r.op, value: n };
    }
    if (r.op !== 'is' && r.op !== 'is_not') fail('bad_rule', 'Choose "is" or "is not" for that condition.');
    if (r.field === 'tag' && !db.crm.tags.some((t) => t.id === r.value && t.clubId === clubId)) fail('bad_rule', 'That tag does not exist in this club.');
    return { field: r.field, op: r.op, value: String(r.value) };
  });
}

function evaluate(db: DB, clubId: string, rules: SegmentRule[], match: 'all' | 'any', rows: PlayerRow[], now: number): string[] {
  if (rules.length === 0) return [];
  return rows.filter((row) => (match === 'all' ? rules.every((r) => matches(row, r, db, clubId, now)) : rules.some((r) => matches(row, r, db, clubId, now)))).map((r) => r.userId);
}

function segmentUserIds(db: DB, clubId: string, segmentId: string, rows: PlayerRow[], now: number): string[] {
  const s = db.crm.segments.find((x) => x.id === segmentId && x.clubId === clubId);
  if (!s) return [];
  if (s.kind === 'static') {
    const known = new Set(rows.map((r) => r.userId));
    return s.userIds.filter((id) => known.has(id));
  }
  const rules = s.system ? systemRules(s.system as SystemSegment, crmSettings(db, clubId)) : s.rules;
  return evaluate(db, clubId, rules, s.match, rows, now);
}

/** Unguarded: the people in a segment right now. For announcements and automation inside the service layer. */
export function resolveSegment(db: DB, clubId: string, segmentId: string): string[] {
  const now = clock.now();
  return segmentUserIds(db, clubId, segmentId, allRows(db, clubId, now), now);
}

export interface SegmentSummary extends CrmSegment {
  count: number;
  /** The rules actually applied (generated for built-in segments). */
  effectiveRules: SegmentRule[];
}

export function listSegments(db: DB, actorId: string, clubId: string): SegmentSummary[] {
  requirePermission(db, actorId, 'members.view', clubId);
  const now = clock.now();
  const rows = allRows(db, clubId, now);
  const settings = crmSettings(db, clubId);
  return db.crm.segments
    .filter((s) => s.clubId === clubId)
    .map((s) => ({ ...s, count: segmentUserIds(db, clubId, s.id, rows, now).length, effectiveRules: s.system ? systemRules(s.system as SystemSegment, settings) : s.rules }))
    .sort((a, b) => Number(b.system !== null) - Number(a.system !== null) || a.createdAt - b.createdAt);
}

/** Try a set of conditions without saving: how many people match, and who. */
export function previewSegment(db: DB, actorId: string, clubId: string, rules: SegmentRule[], match: 'all' | 'any'): { userIds: string[]; rows: PlayerRow[] } {
  requirePermission(db, actorId, 'members.view', clubId);
  const now = clock.now();
  const rows = allRows(db, clubId, now);
  const ids = new Set(evaluate(db, clubId, cleanRules(db, clubId, rules), match, rows, now));
  return { userIds: [...ids], rows: rows.filter((r) => ids.has(r.userId)).sort(SORTS.most_active) };
}

function cleanSegmentName(db: DB, clubId: string, name: string, exceptId?: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 48) fail('bad_name', 'A segment name needs 2 to 48 characters.');
  if (db.crm.segments.some((s) => s.clubId === clubId && s.id !== exceptId && s.system === null && s.name.toLowerCase() === clean.toLowerCase())) fail('segment_exists', 'This club already has a segment with that name.');
  return clean;
}

export function createSegment(db: DB, actorId: string, clubId: string, input: { name: string; match: 'all' | 'any'; rules: SegmentRule[] }): CrmSegment {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const rules = cleanRules(db, clubId, input.rules);
  if (rules.length === 0) fail('bad_rule', 'Add at least one condition.');
  const segment: CrmSegment = { id: newId(db, 'seg'), clubId, name: cleanSegmentName(db, clubId, input.name), kind: 'dynamic', match: input.match, rules, userIds: [], system: null, createdBy: actorId, createdAt: clock.now() };
  db.crm.segments.push(segment);
  audit(db, actorId, clubId, 'crm.segment_created', { segment: segment.name });
  return segment;
}

/** Save an explicit list of people (for example a funnel stage) as a segment. It does not change afterwards. */
export function createStaticSegment(db: DB, actorId: string, clubId: string, name: string, userIds: string[]): CrmSegment {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const known = new Set(allRows(db, clubId).map((r) => r.userId));
  const ids = [...new Set(userIds)].filter((id) => known.has(id));
  if (ids.length === 0) fail('empty_segment', 'There is nobody to save.');
  const segment: CrmSegment = { id: newId(db, 'seg'), clubId, name: cleanSegmentName(db, clubId, name), kind: 'static', match: 'all', rules: [], userIds: ids, system: null, createdBy: actorId, createdAt: clock.now() };
  db.crm.segments.push(segment);
  audit(db, actorId, clubId, 'crm.segment_created', { segment: segment.name });
  return segment;
}

const segmentOf = (db: DB, clubId: string, id: string): CrmSegment => db.crm.segments.find((s) => s.id === id && s.clubId === clubId) ?? fail('not_found', 'Segment not found.');

export function updateSegment(db: DB, actorId: string, clubId: string, segmentId: string, input: { name: string; match: 'all' | 'any'; rules: SegmentRule[] }): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const s = segmentOf(db, clubId, segmentId);
  if (s.system) fail('system_segment', 'Built-in segments follow the CRM settings and cannot be edited.');
  if (s.kind === 'static') fail('static_segment', 'A saved list cannot be turned into conditions.');
  const rules = cleanRules(db, clubId, input.rules);
  if (rules.length === 0) fail('bad_rule', 'Add at least one condition.');
  s.name = cleanSegmentName(db, clubId, input.name, s.id);
  s.match = input.match;
  s.rules = rules;
}

export function deleteSegment(db: DB, actorId: string, clubId: string, segmentId: string): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const s = segmentOf(db, clubId, segmentId);
  if (s.system) fail('system_segment', 'Built-in segments cannot be deleted.');
  db.crm.segments.splice(db.crm.segments.indexOf(s), 1);
  audit(db, actorId, clubId, 'crm.segment_deleted', { segment: s.name });
}

// ---------------------------------------------------------------------------
// Invitation links
// ---------------------------------------------------------------------------

export type LinkProblem = 'not_found' | 'revoked' | 'expired' | 'used_up';

export function linkProblem(link: InviteLink, now: number = clock.now()): LinkProblem | null {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && now >= link.expiresAt) return 'expired';
  if (link.maxUses !== null && link.uses >= link.maxUses) return 'used_up';
  return null;
}

/** Accepts a full link or just its token. */
export function tokenOf(text: string): string {
  return text.trim().split(/[/?#=]/).filter(Boolean).pop() ?? '';
}

/** Unguarded lookup of whatever a pasted link points at. Says why when the link no longer works. */
export function resolveLink(db: DB, text: string): { club: Club; link: InviteLink | null; problem: LinkProblem | null } | null {
  const token = tokenOf(text);
  if (!token) return null;
  const link = db.crm.links.find((l) => l.token === token);
  if (link) {
    const club = db.clubs[link.clubId];
    return club ? { club, link, problem: linkProblem(link) } : null;
  }
  // Every club also has one permanent, unlabelled invitation address.
  const club = Object.values(db.clubs).find((c) => c.inviteToken === token);
  return club ? { club, link: null, problem: null } : null;
}

export const linkUrl = (token: string): string => `https://join.pokerclubos.example/${token}`;

export interface LinkSummary extends InviteLink {
  /** Unique people who opened it. */
  opens: number;
  problem: LinkProblem | null;
}

export function listLinks(db: DB, actorId: string, clubId: string): LinkSummary[] {
  requirePermission(db, actorId, 'members.view', clubId);
  const opens = new Map<string, Set<string>>();
  for (const e of db.crm.events) {
    if (e.clubId !== clubId || e.type !== 'link_opened') continue;
    const id = String(e.params.linkId ?? '');
    let set = opens.get(id);
    if (!set) opens.set(id, (set = new Set()));
    set.add(e.userId);
  }
  return db.crm.links
    .filter((l) => l.clubId === clubId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((l) => ({ ...l, opens: opens.get(l.id)?.size ?? 0, problem: linkProblem(l) }));
}

export interface NewLink {
  kind: 'club' | 'tournament';
  tournamentId?: string;
  source: AcquisitionSource;
  label: string;
  /** Days until it stops working; null for no expiry. */
  expiresInDays: number | null;
  maxUses: number | null;
}

export function createLink(db: DB, actorId: string, clubId: string, input: NewLink): InviteLink {
  requirePermission(db, actorId, input.kind === 'tournament' ? 'tournaments.registrations' : 'crm.configure', clubId);
  if (!ACQUISITION_SOURCES.includes(input.source)) fail('bad_source', 'Unknown source label.');
  const label = input.label.trim().slice(0, 40);
  if (label.length < 2) fail('bad_name', 'Give the link a short label.');
  if (input.expiresInDays !== null && (!Number.isFinite(input.expiresInDays) || input.expiresInDays <= 0 || input.expiresInDays > 365)) fail('bad_expiry', 'Expiry must be between 1 and 365 days.');
  if (input.maxUses !== null && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) fail('bad_limit', 'The use limit must be a positive whole number.');
  let tournamentId: string | null = null;
  if (input.kind === 'tournament') {
    const t = db.tournaments[input.tournamentId ?? ''];
    if (!t || t.clubId !== clubId) fail('not_found', 'Tournament not found.');
    tournamentId = t!.id;
  }
  const now = clock.now();
  // Not guessable from the label: the id counter is mixed with the time.
  const token = `${input.kind === 'tournament' ? 't' : 'c'}${(db.nextId * 2654435761 + now).toString(36).slice(-7)}${Math.abs(Math.floor(now / 7)).toString(36).slice(-3)}`;
  const link: InviteLink = {
    id: newId(db, 'lnk'),
    clubId,
    token,
    kind: input.kind,
    tournamentId,
    source: input.source,
    label,
    createdBy: actorId,
    createdAt: now,
    expiresAt: input.expiresInDays === null ? null : now + input.expiresInDays * DAY,
    revokedAt: null,
    maxUses: input.maxUses,
    uses: 0,
  };
  db.crm.links.push(link);
  audit(db, actorId, clubId, 'crm.link_created', { label });
  return link;
}

export function revokeLink(db: DB, actorId: string, clubId: string, linkId: string): void {
  const link = db.crm.links.find((l) => l.id === linkId && l.clubId === clubId) ?? fail('not_found', 'Link not found.');
  requirePermission(db, actorId, link.kind === 'tournament' ? 'tournaments.registrations' : 'crm.configure', clubId);
  if (link.revokedAt === null) {
    link.revokedAt = clock.now();
    audit(db, actorId, clubId, 'crm.link_revoked', { label: link.label });
  }
}

// ---------------------------------------------------------------------------
// Settings, export, retention
// ---------------------------------------------------------------------------

export function getCrmSettings(db: DB, actorId: string, clubId: string): CrmSettings {
  requirePermission(db, actorId, 'members.view', clubId);
  return { ...crmSettings(db, clubId) };
}

export function updateCrmSettings(db: DB, actorId: string, clubId: string, patch: Partial<CrmSettings>): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const next = { ...crmSettings(db, clubId), ...patch };
  const whole = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;
  if (!whole(next.activeDays, 1, 365) || !whole(next.inactiveDays, 1, 730) || !whole(next.newMemberDays, 1, 365) || !whole(next.retentionMonths, 0, 120)) fail('bad_limit', 'Check the day counts: they must be whole numbers in range.');
  if (next.inactiveDays < next.activeDays) fail('bad_periods', 'The inactive period cannot be shorter than the active period.');
  db.crm.settings[clubId] = next;
  audit(db, actorId, clubId, 'crm.settings_updated');
}

const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  // Neutralise spreadsheet formulas and quote anything with a separator.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Member information a club may take out of the system, as CSV text. Limited
 * to what the club already sees; an email address appears only for members who
 * agreed to share it. Every export is written to the audit log.
 */
export function exportPlayers(db: DB, actorId: string, clubId: string, userIds: string[]): { csv: string; count: number } {
  requirePermission(db, actorId, 'crm.export', clubId);
  const club = db.clubs[clubId]!;
  const wanted = new Set(userIds);
  const rows = allRows(db, clubId).filter((r) => wanted.has(r.userId));
  const tagName = new Map(db.crm.tags.filter((t) => t.clubId === clubId).map((t) => [t.id, t.name]));
  const date = (ms: number | null): string => (ms === null ? '' : new Date(ms).toISOString().slice(0, 10));
  // `simulated` marks demo members so that an export is never mistaken for a list of real people.
  const lines = [['member_id', 'name', 'username', 'status', 'approved', 'last_tournament', 'tournaments', 'wins', 'tags', 'email', 'simulated'].join(',')];
  for (const r of rows) {
    const membership = membershipOf(db, r.userId, clubId);
    lines.push(
      [
        r.memberNo === null ? '' : memberId(club, r.memberNo),
        r.name,
        r.handle,
        r.status,
        date(r.joinedAt),
        date(r.lastPlayedAt),
        r.tournaments,
        r.wins,
        r.tagIds.map((id) => tagName.get(id) ?? '').filter(Boolean).join('; '),
        membership?.shareContact ? (db.users[r.userId]?.email ?? '') : '',
        r.isBot ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  audit(db, actorId, clubId, 'crm.exported', { count: rows.length });
  return { csv: lines.join('\n'), count: rows.length };
}

/** Delete activity events older than the club's retention period. Returns how many were removed. */
export function applyRetention(db: DB, actorId: string, clubId: string): number {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const months = crmSettings(db, clubId).retentionMonths;
  if (months <= 0) return 0;
  const cutoff = clock.now() - months * 30 * DAY;
  // Milestones that reports depend on are kept; everything else older than the cutoff goes.
  const keep = new Set<CrmEvent['type']>(['followed', 'membership_requested', 'membership_approved']);
  const before = db.crm.events.length;
  db.crm.events = db.crm.events.filter((e) => e.clubId !== clubId || e.at >= cutoff || keep.has(e.type));
  const removed = before - db.crm.events.length;
  audit(db, actorId, clubId, 'crm.retention_applied', { count: removed });
  return removed;
}

/**
 * Erase this club's CRM records about one person: profile, tags, assignment,
 * notes, activity events, conversation. Membership, follows and tournament
 * results are not CRM records and are untouched. Refused for current members.
 */
export function forgetPlayer(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const membership = membershipOf(db, userId, clubId);
  if (membership && membership.status !== 'rejected') fail('still_member', 'End the membership first. CRM records of a current member cannot be erased.');
  delete db.crm.profiles[profileKey(clubId, userId)];
  db.crm.notes = db.crm.notes.filter((n) => !(n.clubId === clubId && n.userId === userId));
  db.crm.events = db.crm.events.filter((e) => !(e.clubId === clubId && e.userId === userId));
  for (const s of db.crm.segments) if (s.clubId === clubId && s.kind === 'static') s.userIds = s.userIds.filter((id) => id !== userId);
  const conversations = new Set(db.conversations.filter((c) => c.clubId === clubId && c.userId === userId).map((c) => c.id));
  db.conversations = db.conversations.filter((c) => !conversations.has(c.id));
  db.messages = db.messages.filter((m) => !conversations.has(m.conversationId));
  audit(db, actorId, clubId, 'crm.player_forgotten', { user: db.users[userId]?.name ?? userId });
}

export type { Participation, PlayerTournamentStats };

// ---------------------------------------------------------------------------
// Referrals (v0.4): a member's personal invitation and what came of it
// ---------------------------------------------------------------------------

export interface ReferralStage {
  userId: string;
  name: string;
  openedAt: number;
  requestedAt: number | null;
  approvedAt: number | null;
  firstPlayedAt: number | null;
  returning: boolean;
  status: 'opened' | 'requested' | 'approved' | 'played' | 'returning' | 'rejected';
}

export interface ReferralSummary {
  links: number;
  opens: number;
  requested: number;
  approved: number;
  played: number;
  returning: number;
}

export interface ReferrerRow extends ReferralSummary {
  referrerId: string;
  name: string;
  hue: number;
  campaigns: string[];
}

/**
 * A member's personal invitation link for a club, created on first use (one per member and
 * campaign). Any approved member may have one; staff permissions are not needed. The link
 * carries the member as referrer and attributes the people who open it, and nothing else:
 * approval and tournament authorisation stay exactly as they are.
 */
export function personalLink(db: DB, userId: string, clubId: string, campaign: string | null = null): InviteLink {
  if (!isActiveMember(db, userId, clubId)) fail('not_member', 'Only approved members can invite friends with a personal link.');
  const name = (campaign ?? '').trim().slice(0, 40) || null;
  const existing = db.crm.links.find((l) => l.clubId === clubId && l.referrerId === userId && (l.campaign ?? null) === name && l.revokedAt === null);
  if (existing) return existing;
  const now = clock.now();
  const token = `r${(db.nextId * 2654435761 + now).toString(36).slice(-7)}${Math.abs(Math.floor(now / 7)).toString(36).slice(-3)}`;
  const user = db.users[userId]!;
  const link: InviteLink = {
    id: newId(db, 'lnk'),
    clubId,
    token,
    kind: 'club',
    tournamentId: null,
    source: 'friend',
    label: name ? `${user.name} · ${name}` : `${user.name}'s invitation`,
    createdBy: userId,
    createdAt: now,
    expiresAt: null,
    revokedAt: null,
    maxUses: null,
    uses: 0,
    referrerId: userId,
    campaign: name,
  };
  db.crm.links.push(link);
  return link;
}

function referralStages(db: DB, clubId: string, linkIds: Set<string>, now: number): ReferralStage[] {
  const out: ReferralStage[] = [];
  for (const p of Object.values(db.crm.profiles)) {
    if (p.clubId !== clubId || !p.linkId || !linkIds.has(p.linkId)) continue;
    const user = db.users[p.userId];
    if (!user) continue;
    const events = db.crm.events.filter((e) => e.clubId === clubId && e.userId === p.userId);
    const at = (type: CrmEventType): number | null => events.find((e) => e.type === type)?.at ?? null;
    const opened = events.find((e) => e.type === 'link_opened' && e.params.linkId === p.linkId)?.at ?? p.firstSeenAt;
    const requestedAt = at('membership_requested');
    const approvedAt = at('membership_approved');
    const rejected = at('membership_rejected') !== null && approvedAt === null;
    const plays = compute.playerParticipations(db, clubId, p.userId).map((x) => x.at).sort((a, b) => a - b);
    const firstPlayedAt = plays[0] ?? null;
    const returning = plays.length >= 2 && plays[plays.length - 1]! - plays[0]! >= 7 * DAY;
    const status: ReferralStage['status'] = rejected ? 'rejected' : returning ? 'returning' : firstPlayedAt ? 'played' : approvedAt ? 'approved' : requestedAt ? 'requested' : 'opened';
    out.push({ userId: p.userId, name: user.name, openedAt: opened, requestedAt, approvedAt, firstPlayedAt, returning, status });
  }
  void now;
  return out.sort((a, b) => b.openedAt - a.openedAt);
}

function summarise(links: number, stages: ReferralStage[]): ReferralSummary {
  return {
    links,
    opens: stages.length,
    requested: stages.filter((s) => s.requestedAt !== null).length,
    approved: stages.filter((s) => s.approvedAt !== null).length,
    played: stages.filter((s) => s.firstPlayedAt !== null).length,
    returning: stages.filter((s) => s.returning).length,
  };
}

/** The member's existing personal link for a campaign, if they already created one. */
export function myPersonalLink(db: DB, userId: string, clubId: string, campaign: string | null = null): InviteLink | null {
  const name = (campaign ?? '').trim().slice(0, 40) || null;
  return db.crm.links.find((l) => l.clubId === clubId && l.referrerId === userId && (l.campaign ?? null) === name && l.revokedAt === null) ?? null;
}

/** What a member's own invitations led to. Names of invitees appear only once they are approved members. */
export function myReferrals(db: DB, userId: string, clubId: string, now: number = clock.now()): { summary: ReferralSummary; people: ReferralStage[] } {
  const links = db.crm.links.filter((l) => l.clubId === clubId && l.referrerId === userId);
  const stages = referralStages(db, clubId, new Set(links.map((l) => l.id)), now).map((s) => (s.approvedAt ? s : { ...s, name: '' }));
  return { summary: summarise(links.length, stages), people: stages };
}

/** The club's referral dashboard: totals and one row per referring member. Staff only. */
export function referralReport(db: DB, actorId: string, clubId: string, now: number = clock.now()): { summary: ReferralSummary; referrers: ReferrerRow[]; recent: (ReferralStage & { referrerId: string })[] } {
  requirePermission(db, actorId, 'members.view', clubId);
  const links = db.crm.links.filter((l) => l.clubId === clubId && l.referrerId);
  const byReferrer = new Map<string, InviteLink[]>();
  for (const l of links) byReferrer.set(l.referrerId!, [...(byReferrer.get(l.referrerId!) ?? []), l]);
  const referrers: ReferrerRow[] = [];
  const recent: (ReferralStage & { referrerId: string })[] = [];
  for (const [referrerId, own] of byReferrer) {
    const user = db.users[referrerId];
    if (!user) continue;
    const stages = referralStages(db, clubId, new Set(own.map((l) => l.id)), now);
    referrers.push({ referrerId, name: user.name, hue: user.hue, campaigns: [...new Set(own.map((l) => l.campaign).filter((c): c is string => !!c))], ...summarise(own.length, stages) });
    for (const s of stages) recent.push({ ...s, referrerId });
  }
  referrers.sort((a, b) => b.approved - a.approved || b.opens - a.opens || a.name.localeCompare(b.name));
  recent.sort((a, b) => b.openedAt - a.openedAt);
  const all = referralStages(db, clubId, new Set(links.map((l) => l.id)), now);
  return { summary: summarise(links.length, all), referrers, recent: recent.slice(0, 50) };
}

/** Who referred this person to the club, for the CRM profile and the requests page. */
export function referrerFor(db: DB, clubId: string, userId: string): { id: string; name: string } | null {
  const profile = db.crm.profiles[profileKey(clubId, userId)];
  if (!profile?.linkId) return null;
  const link = db.crm.links.find((l) => l.id === profile.linkId);
  if (!link?.referrerId || link.referrerId === userId) return null;
  const u = db.users[link.referrerId];
  return u ? { id: u.id, name: u.name } : null;
}
