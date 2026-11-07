/**
 * Service layer — the prototype's "backend".
 *
 * Every state change in the product goes through one of these functions (or
 * the CRM, messaging and automation modules beside it). Each one (1)
 * authorises the actor against the target club, (2) validates the request
 * against business rules and plan limits, (3) mutates the database, and (4)
 * writes an audit entry, CRM events and notifications.
 *
 * The functions take the database explicitly and have no UI or timer
 * dependencies, so they are unit-tested directly and would move to a server
 * unchanged (replace the in-memory `DB` with SQL transactions). In this
 * prototype they run in the browser tab: they are the checks that count, but
 * they are not enforced across a network.
 */
import { estimateDurationMinutes, validateStructure, type PresetId, type TournamentStructure } from '../engine/structure.ts';
import { compute } from './analytics.ts';
import * as automation from './automation.ts';
import { audit, clock, clubOf, deliver, ensureProfile, fail, logEvent, MIN, newId, notify, profileKey, requireActiveClub, SYSTEM, tournamentOf, userOf } from './core.ts';
import { claimImport } from './migration.ts';
import { initClubCrm, linkProblem, resolveLink, resolveSegment } from './crm.ts';
import { assertTransition, isEditable, isTerminal, isUpcoming } from './lifecycle.ts';
import { can, canAssignRole, isActiveMember, isPlatformAdmin, membershipOf, requirePermission, requirePlatform, ROLE_RANK } from './permissions.ts';
import {
  SOCIAL_KEYS,
  DEFAULT_TABLE_BRANDING,
  TABLE_LOGO_LIMITS,
  MAX_TABLE_PRESETS,
  type TableBranding,
  type TableColors,
  type TablePreset,
  type AcquisitionSource,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementKind,
  type BannerStyle,
  type Club,
  type ClubBranding,
  type DB,
  type DeliveryBatch,
  type Follow,
  type InviteLink,
  type Invoice,
  type Membership,
  type Plan,
  type PlanId,
  type PlanLimits,
  type Registration,
  type Role,
  type SocialKey,
  type SocialLink,
  type SupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type Tournament,
  type TournamentAccess,
  type TournamentResult,
  type TournamentVisibility,
  type User,
  type UserSettings,
} from './types.ts';
import { isHex } from './color.ts';
import { award, evaluateAchievements } from './competition.ts';
import { DEFAULT_VARIANT, maxTableSize, VARIANTS, variantOf, type VariantId } from '../engine/variants.ts';

export { clock, newId, notify, SYSTEM };

// ---------------------------------------------------------------------------
// Plans and usage
// ---------------------------------------------------------------------------

export function effectiveLimits(db: DB, club: Club): PlanLimits {
  return { ...db.plans[club.planId].limits, ...club.limitOverrides };
}

export interface ClubUsage {
  members: number;
  pending: number;
  /** Unique people who played in one of the club's tournaments in the last 30 days. Counted from tournament records. */
  monthlyActive: number;
  /** Tables opened by the tournaments running right now (seated players ÷ table size). */
  concurrentTables: number;
  tournamentsThisMonth: number;
  adminSeats: number;
}

const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

export function clubUsage(db: DB, clubId: string): ClubUsage {
  let members = 0;
  let pending = 0;
  let adminSeats = 0;
  for (const m of db.memberships) {
    if (m.clubId !== clubId) continue;
    if (m.status === 'active') {
      members++;
      if (m.role !== 'player') adminSeats++;
    } else if (m.status === 'pending') pending++;
  }
  const month = monthKey(clock.now());
  let tournamentsThisMonth = 0;
  let concurrentTables = 0;
  for (const id in db.tournaments) {
    const t = db.tournaments[id]!;
    if (t.clubId !== clubId) continue;
    if (t.status !== 'DRAFT' && t.status !== 'CANCELLED' && monthKey(t.startAt) === month) tournamentsThisMonth++;
    if (t.status === 'RUNNING' || t.status === 'PAUSED' || t.status === 'SEATING') concurrentTables += Math.ceil(registeredCount(t) / Math.max(2, t.structure.tableSize));
  }
  return { members, pending, monthlyActive: compute.activePlayerIds(db, clubId, 30).size, concurrentTables, tournamentsThisMonth, adminSeats };
}

/** What the current period would cost under the club's plan. Placeholder amounts — not real pricing. */
export function invoicePreview(db: DB, clubId: string): Pick<Invoice, 'base' | 'usage' | 'total' | 'activePlayers'> {
  const club = clubOf(db, clubId);
  const plan = db.plans[club.planId];
  const active = clubUsage(db, clubId).monthlyActive;
  const billable = plan.model === 'fixed' ? 0 : Math.max(0, active - plan.includedActive);
  const base = plan.model === 'per_active' ? 0 : plan.baseFee;
  const usage = Math.round(billable * plan.perActiveFee * 100) / 100;
  return { base, usage, total: Math.round((base + usage) * 100) / 100, activePlayers: active };
}

// ---------------------------------------------------------------------------
// Finding a club, invitation links
// ---------------------------------------------------------------------------

export function findClubByCode(db: DB, code: string): Club | undefined {
  const digits = code.replace(/\D/g, '');
  if (digits.length === 0) return undefined;
  return Object.values(db.clubs).find((c) => c.code === digits);
}

/** Accepts a full invitation link or just its token. Expired, revoked and used-up links find nothing. */
export function findClubByInvite(db: DB, text: string): Club | undefined {
  const found = resolveLink(db, text);
  return found && !found.problem ? found.club : undefined;
}

export function inviteLink(club: Club): string {
  return `https://join.pokerclubos.example/${club.inviteToken}`;
}

export interface OpenedInvite {
  club: Club;
  link: InviteLink | null;
  /** Set when the link was a tournament invitation. */
  tournamentId: string | null;
  /** What happened to a tournament invitation: authorised now, or why not yet. */
  tournament: 'authorised' | 'needs_membership' | 'not_available' | null;
}

/**
 * A signed-in person opened an invitation link. Records the visit for
 * attribution (once per person, link and day) and, for a tournament
 * invitation, authorises an approved member for that tournament.
 */
export function openInvite(db: DB, userId: string, text: string): OpenedInvite {
  userOf(db, userId);
  const found = resolveLink(db, text) ?? fail('invite_not_found', 'That invitation was not found. Check the link or ask the club for a new one.');
  if (found.problem === 'expired') fail('invite_expired', 'This invitation has expired. Ask the club for a new one.');
  if (found.problem === 'revoked') fail('invite_revoked', 'This invitation was withdrawn by the club.');
  if (found.problem === 'used_up') fail('invite_used_up', 'This invitation has been used the maximum number of times.');
  const { club, link } = found;
  requireActiveClub(club);
  const now = clock.now();
  const linkId = link?.id ?? '';
  const today = Math.floor(now / 86_400_000);
  // A member opening their own invitation is not a referral and is not counted.
  const selfReferral = !!link?.referrerId && link.referrerId === userId;
  const seen = selfReferral || db.crm.events.some((e) => e.clubId === club.id && e.userId === userId && e.type === 'link_opened' && e.params.linkId === linkId && Math.floor(e.at / 86_400_000) === today);
  ensureProfile(db, club.id, userId, link && link.kind === 'club' && !selfReferral ? { source: link.source, linkId: link.id } : undefined);
  if (!seen) logEvent(db, club.id, userId, 'link_opened', userId, { linkId });
  const out: OpenedInvite = { club, link, tournamentId: link?.kind === 'tournament' ? link.tournamentId : null, tournament: null };
  if (link?.kind === 'tournament' && link.tournamentId) {
    const t = db.tournaments[link.tournamentId];
    if (!t || isTerminal(t.status) || t.status === 'DRAFT') out.tournament = 'not_available';
    else if (!isActiveMember(db, userId, club.id)) out.tournament = 'needs_membership';
    else {
      authoriseByLink(db, userId, t, link);
      out.tournament = 'authorised';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Following a club
// ---------------------------------------------------------------------------

export const followOf = (db: DB, userId: string, clubId: string): Follow | undefined => db.follows.find((f) => f.userId === userId && f.clubId === clubId);

export function followerCount(db: DB, clubId: string): number {
  let n = 0;
  for (const f of db.follows) if (f.clubId === clubId) n++;
  return n;
}

/**
 * Follow a club. Following is its own relationship: it never grants membership
 * or access to private tournaments. `notify` is the person's consent to
 * receive the club's public announcements; it can be switched off at any time.
 */
export function followClub(db: DB, userId: string, clubId: string, options: { notify?: boolean; linkToken?: string } = {}): Follow {
  const club = clubOf(db, clubId);
  userOf(db, userId);
  requireActiveClub(club);
  if (membershipOf(db, userId, clubId)?.status === 'banned') fail('banned', 'You cannot follow this club.');
  const existing = followOf(db, userId, clubId);
  if (existing) return existing;
  const now = clock.now();
  const follow: Follow = { clubId, userId, at: now, notify: options.notify ?? true };
  db.follows.push(follow);
  ensureProfile(db, clubId, userId, attributionFor(db, clubId, 'profile', options.linkToken));
  logEvent(db, clubId, userId, 'followed', userId);
  return follow;
}

export function unfollowClub(db: DB, userId: string, clubId: string): void {
  const follow = followOf(db, userId, clubId);
  if (!follow) return;
  db.follows.splice(db.follows.indexOf(follow), 1);
  logEvent(db, clubId, userId, 'unfollowed', userId);
}

export function setFollowNotify(db: DB, userId: string, clubId: string, on: boolean): void {
  const follow = followOf(db, userId, clubId) ?? fail('not_following', 'You are not following this club.');
  follow.notify = on;
}

// ---------------------------------------------------------------------------
// Joining and managing membership
// ---------------------------------------------------------------------------

/**
 * Where a person came from, when it is actually known: a labelled invitation
 * link, or the Club ID / QR code (which are handed out directly). Everything
 * else is left as "unknown" rather than guessed.
 */
function attributionFor(db: DB, clubId: string, via: Membership['via'], linkToken?: string): { source: AcquisitionSource; linkId: string | null } | undefined {
  if (linkToken) {
    const found = resolveLink(db, linkToken);
    if (found && found.club.id === clubId && found.link && found.link.kind === 'club' && !found.problem) return { source: found.link.source, linkId: found.link.id };
  }
  if (via === 'club_id' || via === 'qr') return { source: 'direct', linkId: null };
  return undefined;
}

function assignMemberNumber(db: DB, club: Club, userId: string): void {
  const profile = ensureProfile(db, club.id, userId);
  if (profile.memberNo === null) {
    profile.memberNo = club.nextMemberNo;
    club.nextMemberNo += 1;
  }
}

export interface JoinOptions {
  /** The invitation link the person arrived through, if any. */
  linkToken?: string;
  /** Consent to show their contact address to this club's staff. */
  shareContact?: boolean;
  /** Receive this club's announcements (default on; can be changed later). */
  announcements?: boolean;
}

export function requestJoin(db: DB, userId: string, clubId: string, via: Membership['via'], options: JoinOptions = {}): Membership {
  const club = clubOf(db, clubId);
  const user = userOf(db, userId);
  requireActiveClub(club);
  const existing = membershipOf(db, userId, clubId);
  if (existing) {
    if (existing.status === 'active') fail('already_member', 'You are already a member of this club.');
    if (existing.status === 'pending') fail('already_pending', 'Your request is already waiting for approval.');
    if (existing.status === 'suspended') fail('suspended', 'Your membership of this club is suspended.');
    if (existing.status === 'banned') fail('banned', 'This club is not accepting a membership request from you.');
  }
  const usage = clubUsage(db, clubId);
  if (usage.members >= effectiveLimits(db, club).members) fail('club_full', 'This club has reached its member limit.');

  const now = clock.now();
  const open = club.joinPolicy === 'open';
  const membership: Membership = existing ?? {
    clubId,
    userId,
    role: 'player',
    status: 'pending',
    requestedAt: now,
    joinedAt: null,
    lastActiveAt: now,
    demoPoints: 0,
    via,
    decidedAt: null,
    announcements: true,
    shareContact: false,
  };
  membership.role = 'player';
  membership.status = open ? 'active' : 'pending';
  membership.requestedAt = now;
  membership.lastActiveAt = now;
  membership.via = via;
  membership.decidedAt = null;
  if (options.shareContact !== undefined) membership.shareContact = options.shareContact;
  if (options.announcements !== undefined) membership.announcements = options.announcements;
  if (!existing) db.memberships.push(membership);
  ensureProfile(db, clubId, userId, attributionFor(db, clubId, via, options.linkToken));
  logEvent(db, clubId, userId, 'membership_requested', userId, { via });

  if (open) {
    membership.joinedAt = now;
    membership.decidedAt = now;
    membership.demoPoints = club.demoAllowance;
    assignMemberNumber(db, club, userId);
    logEvent(db, clubId, userId, 'membership_approved', SYSTEM, { auto: 1 });
    audit(db, userId, clubId, 'member.joined', { user: user.name });
    notify(db, userId, 'membership', 'notif.joined', { club: club.name }, { name: 'club', params: { clubId } }, { clubId, dedupeKey: `joined:${clubId}:${now}` });
    automation.onMembershipApproved(db, clubId, userId, now);
  } else {
    audit(db, userId, clubId, 'member.requested', { user: user.name });
    automation.onMembershipRequested(db, clubId, userId, now);
  }
  return membership;
}

export function cancelJoinRequest(db: DB, userId: string, clubId: string): void {
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'pending') fail('no_request', 'There is no pending request to cancel.');
  db.memberships.splice(db.memberships.indexOf(m!), 1);
  // The membership row goes; the club's record of the request stays in its event log.
  logEvent(db, clubId, userId, 'membership_cancelled', userId);
  audit(db, userId, clubId, 'member.request_cancelled', { user: userOf(db, userId).name });
}

/** Refund and remove a user's places in tournaments that have not started. */
function dropUpcomingRegistrations(db: DB, userId: string, clubId: string): void {
  for (const id in db.tournaments) {
    const t = db.tournaments[id]!;
    if (t.clubId !== clubId || !isUpcoming(t.status)) continue;
    const index = t.registrations.findIndex((r) => r.userId === userId);
    if (index >= 0) {
      refund(db, t, t.registrations[index]!);
      t.registrations.splice(index, 1);
      promoteFromWaitlist(db, t);
    }
  }
}

export function leaveClub(db: DB, userId: string, clubId: string): void {
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'active') fail('not_member', 'You are not a member of this club.');
  if (m!.role === 'owner') fail('owner_cannot_leave', 'The club owner cannot leave the club.');
  dropUpcomingRegistrations(db, userId, clubId);
  db.memberships.splice(db.memberships.indexOf(m!), 1);
  logEvent(db, clubId, userId, 'membership_left', userId);
  audit(db, userId, clubId, 'member.left', { user: userOf(db, userId).name });
}

export function approveMember(db: DB, actorId: string, clubId: string, userId: string): void {
  const club = clubOf(db, clubId);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'members.approve', clubId);
  else requireActiveClub(club);
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'pending') fail('not_pending', 'This request is no longer pending.');
  if (clubUsage(db, clubId).members >= effectiveLimits(db, club).members) fail('club_full', 'The club has reached its plan\'s member limit.');
  const now = clock.now();
  m!.status = 'active';
  m!.joinedAt = now;
  m!.decidedAt = now;
  m!.demoPoints = club.demoAllowance;
  assignMemberNumber(db, club, userId);
  claimImport(db, clubId, userId); // v0.4: an imported record with this email comes along
  logEvent(db, clubId, userId, 'membership_approved', actorId);
  audit(db, actorId, clubId, 'member.approved', { user: userOf(db, userId).name });
  notify(db, userId, 'membership', 'notif.approved', { club: club.name }, { name: 'club', params: { clubId } }, { clubId, dedupeKey: `approved:${clubId}:${m!.requestedAt}` });
  automation.onMembershipApproved(db, clubId, userId, now);
  // Referral recognition: the member who invited this person earns the milestones (non-monetary).
  const referrer = referrerOf(db, clubId, userId);
  if (referrer) {
    const approved = approvedReferrals(db, clubId, referrer).length;
    if (approved >= 1) award(db, referrer, 'referral_first', { clubId }, now);
    if (approved >= 5) award(db, referrer, 'referral_five', { clubId }, now);
  }
}

/** The member whose personal invitation first brought this person to the club, if any. */
export function referrerOf(db: DB, clubId: string, userId: string): string | null {
  const profile = db.crm.profiles[profileKey(clubId, userId)];
  if (!profile?.linkId) return null;
  const link = db.crm.links.find((l) => l.id === profile.linkId);
  return link?.referrerId && link.referrerId !== userId ? link.referrerId : null;
}

/** People a member referred who are now approved members. */
export function approvedReferrals(db: DB, clubId: string, referrerId: string): string[] {
  const linkIds = new Set(db.crm.links.filter((l) => l.clubId === clubId && l.referrerId === referrerId).map((l) => l.id));
  const out: string[] = [];
  for (const p of Object.values(db.crm.profiles)) {
    if (p.clubId !== clubId || !p.linkId || !linkIds.has(p.linkId)) continue;
    const m = membershipOf(db, p.userId, clubId);
    if (m && m.status === 'active') out.push(p.userId);
  }
  return out;
}

export function rejectMember(db: DB, actorId: string, clubId: string, userId: string): void {
  const club = clubOf(db, clubId);
  requirePermission(db, actorId, 'members.approve', clubId);
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'pending') fail('not_pending', 'This request is no longer pending.');
  m!.status = 'rejected';
  m!.decidedAt = clock.now();
  logEvent(db, clubId, userId, 'membership_rejected', actorId);
  audit(db, actorId, clubId, 'member.rejected', { user: userOf(db, userId).name });
  notify(db, userId, 'membership', 'notif.rejected', { club: club.name }, null, { clubId, dedupeKey: `rejected:${clubId}:${m!.requestedAt}` });
}

export function suspendMember(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'members.suspend', clubId);
  if (actorId === userId) fail('self', 'You cannot suspend yourself.');
  const actor = membershipOf(db, actorId, clubId)!;
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'active') fail('not_active', 'Only an active member can be suspended.');
  if (ROLE_RANK[m!.role] >= ROLE_RANK[actor.role]) fail('rank', 'You can only suspend members with a lower role than your own.');
  m!.status = 'suspended';
  dropUpcomingRegistrations(db, userId, clubId);
  logEvent(db, clubId, userId, 'membership_suspended', actorId);
  audit(db, actorId, clubId, 'member.suspended', { user: userOf(db, userId).name });
  notify(db, userId, 'membership', 'notif.suspended', { club: clubOf(db, clubId).name }, null, { clubId });
}

export function reinstateMember(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'members.suspend', clubId);
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'suspended') fail('not_suspended', 'This member is not suspended.');
  m!.status = 'active';
  logEvent(db, clubId, userId, 'membership_reinstated', actorId);
  audit(db, actorId, clubId, 'member.reinstated', { user: userOf(db, userId).name });
  notify(db, userId, 'membership', 'notif.reinstated', { club: clubOf(db, clubId).name }, { name: 'club', params: { clubId } }, { clubId });
}

/**
 * Ban a person from the club: they lose membership and any upcoming seats, and
 * cannot ask to join, follow or write to the club until the ban is lifted.
 * Works on members, applicants and people who only follow or wrote in.
 */
export function banMember(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'members.suspend', clubId);
  if (actorId === userId) fail('self', 'You cannot ban yourself.');
  const club = clubOf(db, clubId);
  const user = userOf(db, userId);
  const actor = membershipOf(db, actorId, clubId)!;
  let m = membershipOf(db, userId, clubId);
  if (m?.status === 'banned') fail('already_banned', 'This person is already banned.');
  if (m && m.status === 'active' && ROLE_RANK[m.role] >= ROLE_RANK[actor.role]) fail('rank', 'You can only ban members with a lower role than your own.');
  const known = m || db.crm.profiles[profileKey(clubId, userId)] || followOf(db, userId, clubId);
  if (!known) fail('not_found', 'This club has no record of that player.');
  const wasMember = m?.status === 'active' ? 1 : 0;
  const now = clock.now();
  if (!m) {
    m = { clubId, userId, role: 'player', status: 'banned', requestedAt: now, joinedAt: null, lastActiveAt: now, demoPoints: 0, via: 'profile', decidedAt: now, announcements: false, shareContact: false };
    db.memberships.push(m);
  }
  m.status = 'banned';
  m.role = 'player';
  m.decidedAt = now;
  dropUpcomingRegistrations(db, userId, clubId);
  const follow = followOf(db, userId, clubId);
  if (follow) db.follows.splice(db.follows.indexOf(follow), 1);
  logEvent(db, clubId, userId, 'membership_banned', actorId, { wasMember });
  audit(db, actorId, clubId, 'member.banned', { user: user.name });
  notify(db, userId, 'membership', 'notif.banned', { club: club.name }, null, { clubId });
}

/** Lift a ban. The person is not a member afterwards; they may ask to join again. */
export function unbanMember(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'members.suspend', clubId);
  const m = membershipOf(db, userId, clubId);
  if (!m || m.status !== 'banned') fail('not_banned', 'This person is not banned.');
  db.memberships.splice(db.memberships.indexOf(m!), 1);
  logEvent(db, clubId, userId, 'membership_unbanned', actorId);
  audit(db, actorId, clubId, 'member.unbanned', { user: userOf(db, userId).name });
}

export function setMemberRole(db: DB, actorId: string, clubId: string, userId: string, role: Role): void {
  requirePermission(db, actorId, 'members.assign_roles', clubId);
  if (!canAssignRole(db, actorId, clubId, userId, role)) {
    fail('role_not_allowed', 'You can only assign roles below your own, and never to yourself.');
  }
  const club = clubOf(db, clubId);
  const m = membershipOf(db, userId, clubId)!;
  if (m.role === 'player' && role !== 'player' && clubUsage(db, clubId).adminSeats >= effectiveLimits(db, club).adminSeats) {
    fail('admin_seats', 'All administrator seats on this plan are in use.');
  }
  const from = m.role;
  if (from === role) return;
  m.role = role;
  logEvent(db, clubId, userId, 'role_changed', actorId, { from, to: role });
  audit(db, actorId, clubId, 'member.role_changed', { user: userOf(db, userId).name, from, to: role });
  notify(db, userId, 'membership', 'notif.role_changed', { club: club.name, role }, { name: 'club', params: { clubId } }, { clubId });
}

/** A member's own switches for one club: its announcements, and whether its staff may see their contact address. */
export function setMemberPreferences(db: DB, userId: string, clubId: string, patch: { announcements?: boolean; shareContact?: boolean }): void {
  const m = membershipOf(db, userId, clubId);
  if (!m || (m.status !== 'active' && m.status !== 'pending')) fail('not_member', 'You are not a member of this club.');
  if (patch.announcements !== undefined) m!.announcements = patch.announcements;
  if (patch.shareContact !== undefined) m!.shareContact = patch.shareContact;
}

/** Staff and their roles, for the roles screen. */
export function listStaff(db: DB, actorId: string, clubId: string): { user: User; membership: Membership }[] {
  requirePermission(db, actorId, 'members.view', clubId);
  return db.memberships.filter((m) => m.clubId === clubId && m.status === 'active' && m.role !== 'player').map((m) => ({ user: db.users[m.userId]!, membership: m }));
}

/** Approved members who could be given a staff role. */
export function listApprovedMembers(db: DB, actorId: string, clubId: string): { user: User; membership: Membership }[] {
  requirePermission(db, actorId, 'members.view', clubId);
  return db.memberships.filter((m) => m.clubId === clubId && m.status === 'active').map((m) => ({ user: db.users[m.userId]!, membership: m }));
}

// ---------------------------------------------------------------------------
// Club profile, social links, branding
// ---------------------------------------------------------------------------

const SOCIAL_HOSTS: Record<SocialKey, RegExp | null> = {
  instagram: /(^|\.)instagram\.com$/,
  telegram: /(^|\.)(t\.me|telegram\.me|telegram\.org)$/,
  whatsapp: /(^|\.)(wa\.me|whatsapp\.com)$/,
  tiktok: /(^|\.)tiktok\.com$/,
  facebook: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/,
  discord: /(^|\.)(discord\.gg|discord\.com)$/,
  x: /(^|\.)(x\.com|twitter\.com)$/,
  website: null,
};

export type SocialProblem = 'bad_url' | 'not_https' | 'wrong_site';

/** Tidy a social link and say what is wrong with it, if anything. A bare "instagram.com/club" gets https:// added. */
export function checkSocialUrl(key: SocialKey, input: string): { url: string; problem: SocialProblem | null } {
  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { url: raw, problem: 'bad_url' };
  }
  if (parsed.protocol !== 'https:') return { url: raw, problem: 'not_https' };
  if (!parsed.hostname.includes('.') || parsed.username || parsed.password) return { url: raw, problem: 'bad_url' };
  const host = SOCIAL_HOSTS[key];
  if (host && !host.test(parsed.hostname.toLowerCase())) return { url: raw, problem: 'wrong_site' };
  return { url: parsed.toString().slice(0, 200), problem: null };
}

export interface ClubProfilePatch {
  name?: string;
  tagline?: string;
  description?: string;
  rules?: string[];
  joinPolicy?: Club['joinPolicy'];
  location?: string;
  timezone?: string;
  /** Every platform the club wants to keep. An empty address removes the link. */
  social?: Partial<Record<SocialKey, SocialLink>>;
  publicResults?: boolean;
  publicMemberCount?: boolean;
}

export function updateClubProfile(db: DB, actorId: string, clubId: string, patch: ClubProfilePatch): void {
  requirePermission(db, actorId, 'club.edit_profile', clubId);
  const club = clubOf(db, clubId);
  // Validate everything before changing anything.
  let name: string | undefined;
  if (patch.name !== undefined) {
    name = patch.name.trim();
    if (name.length < 3 || name.length > 40) fail('bad_name', 'Club name must be 3–40 characters.');
  }
  let social: Club['social'] | undefined;
  if (patch.social !== undefined) {
    social = {};
    for (const key of SOCIAL_KEYS) {
      const link = patch.social[key];
      if (!link || !link.url.trim()) continue;
      const checked = checkSocialUrl(key, link.url);
      if (checked.problem) fail('bad_social_url', `The ${key} link is not valid (${checked.problem}).`);
      social[key] = { url: checked.url, public: link.public !== false };
    }
  }
  if (patch.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: patch.timezone });
    } catch {
      fail('bad_timezone', 'Unknown time zone.');
    }
  }
  if (name !== undefined) club.name = name;
  if (patch.tagline !== undefined) club.tagline = patch.tagline.trim().slice(0, 80);
  if (patch.description !== undefined) club.description = patch.description.trim().slice(0, 600);
  if (patch.rules !== undefined) club.rules = patch.rules.map((r) => r.trim()).filter(Boolean).slice(0, 12);
  if (patch.joinPolicy !== undefined) club.joinPolicy = patch.joinPolicy;
  if (patch.location !== undefined) club.location = patch.location.trim().slice(0, 60);
  if (patch.timezone !== undefined) club.timezone = patch.timezone;
  if (social !== undefined) club.social = social;
  if (patch.publicResults !== undefined) club.publicResults = patch.publicResults;
  if (patch.publicMemberCount !== undefined) club.publicMemberCount = patch.publicMemberCount;
  audit(db, actorId, clubId, 'club.profile_updated');
}

export function updateBranding(db: DB, actorId: string, clubId: string, branding: ClubBranding): void {
  requirePermission(db, actorId, 'club.branding', clubId);
  const club = clubOf(db, clubId);
  if (!/^#[0-9a-fA-F]{6}$/.test(branding.accent)) fail('bad_color', 'Accent colour must be a six-digit hex value.');
  const usesImage = branding.logo.kind === 'image' || branding.cover.kind === 'image';
  if (usesImage && !db.plans[club.planId].customBranding) {
    fail('plan_feature', 'Uploading your own logo and cover is part of the Professional plan and above.');
  }
  if (branding.logo.kind === 'monogram') {
    const text = branding.logo.text.trim().slice(0, 3).toUpperCase();
    if (!text) fail('bad_monogram', 'A monogram needs 1–3 characters.');
    branding = { ...branding, logo: { kind: 'monogram', text } };
  }
  club.branding = branding;
  audit(db, actorId, clubId, 'club.branding_updated');
}

/** Keep a felt + rail colour pair under a name, so the wizard can offer it for every tournament. */
export function saveTablePreset(db: DB, actorId: string, clubId: string, preset: { name: string; colors: TableColors }): TablePreset {
  requirePermission(db, actorId, 'club.branding', clubId);
  const club = clubOf(db, clubId);
  const name = preset.name.trim().slice(0, 40);
  if (!name) fail('bad_preset', 'A table scheme needs a name.');
  if (!isHex(preset.colors.felt) || !isHex(preset.colors.rail)) fail('bad_color', 'Felt and rail colours must be six-digit hex values.');
  const presets = club.branding.tablePresets ?? [];
  const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.colors = { ...preset.colors };
    audit(db, actorId, clubId, 'club.branding_updated', { preset: name });
    return existing;
  }
  if (presets.length >= MAX_TABLE_PRESETS) fail('limit', `A club keeps up to ${MAX_TABLE_PRESETS} table schemes.`);
  const created: TablePreset = { id: newId(db, 'tp'), name, colors: { ...preset.colors } };
  club.branding = { ...club.branding, tablePresets: [...presets, created] };
  audit(db, actorId, clubId, 'club.branding_updated', { preset: name });
  return created;
}

export function deleteTablePreset(db: DB, actorId: string, clubId: string, presetId: string): void {
  requirePermission(db, actorId, 'club.branding', clubId);
  const club = clubOf(db, clubId);
  club.branding = { ...club.branding, tablePresets: (club.branding.tablePresets ?? []).filter((p) => p.id !== presetId) };
  audit(db, actorId, clubId, 'club.branding_updated');
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export interface AnnouncementInput {
  kind: AnnouncementKind;
  title: string;
  body: string;
  pinned?: boolean;
  audience?: AnnouncementAudience;
  /** Publish at this time instead of now. */
  scheduledAt?: number | null;
  /** Optional picture as a data URL. */
  image?: string | null;
  /** Also send an in-app notification (default true). */
  notify?: boolean;
}

/** Who an announcement is for right now, and who among them has switched the club's updates off. */
function resolveAudience(db: DB, a: Announcement): { userIds: string[]; clubOptOut: (userId: string) => boolean } {
  const clubId = a.clubId;
  const members = new Map<string, Membership>();
  for (const m of db.memberships) if (m.clubId === clubId) members.set(m.userId, m);
  const follows = new Map<string, Follow>();
  for (const f of db.follows) if (f.clubId === clubId) follows.set(f.userId, f);
  const activeMembers = (): string[] => [...members.values()].filter((m) => m.status === 'active').map((m) => m.userId);
  const followers = (): string[] => [...follows.keys()].filter((id) => members.get(id)?.status !== 'banned');
  // An approved member's own switch for this club decides; for everyone else it is the follow switch.
  // Someone with neither relationship has not agreed to hear from the club.
  const clubOptOut = (userId: string): boolean => {
    const m = members.get(userId);
    if (m?.status === 'active') return !m.announcements;
    const f = follows.get(userId);
    return f ? !f.notify : true;
  };
  let userIds: string[];
  switch (a.audience.type) {
    case 'members':
      userIds = activeMembers();
      break;
    case 'followers':
      userIds = followers();
      break;
    case 'everyone':
      userIds = [...new Set([...activeMembers(), ...followers()])];
      break;
    case 'segment':
      userIds = a.audience.segmentId ? resolveSegment(db, clubId, a.audience.segmentId).filter((id) => members.get(id)?.status !== 'banned') : [];
      break;
    case 'tournament': {
      const t = a.audience.tournamentId ? db.tournaments[a.audience.tournamentId] : undefined;
      userIds = t ? t.registrations.filter((r) => r.status === 'registered' || r.status === 'requested' || r.status === 'waitlisted' || r.status === 'approved').map((r) => r.userId) : [];
      // News about a tournament someone is entered in is operational, not promotional.
      return { userIds: userIds.filter((id) => id !== a.authorId), clubOptOut: () => false };
    }
  }
  return { userIds: userIds.filter((id) => id !== a.authorId), clubOptOut };
}

function sendAnnouncement(db: DB, a: Announcement): void {
  const club = clubOf(db, a.clubId);
  const { userIds, clubOptOut } = resolveAudience(db, a);
  if (a.audience.type === 'segment' || a.audience.type === 'tournament') a.targetIds = userIds;
  if (!a.notify) return;
  const batch = deliver(
    db,
    {
      clubId: a.clubId,
      kind: 'announcement',
      refId: a.id,
      notificationKind: a.audience.type === 'tournament' ? 'tournament' : 'announcement',
      key: 'notif.announcement',
      params: { club: club.name, title: a.title },
      link: { name: 'club', params: { clubId: a.clubId } },
      dedupePrefix: `an:${a.id}`,
    },
    userIds,
    clubOptOut,
  );
  a.batchId = batch.id;
}

export function publishAnnouncement(db: DB, actorId: string, clubId: string, input: AnnouncementInput): Announcement {
  if (clubId === 'platform') requirePlatform(db, actorId);
  else requirePermission(db, actorId, 'announcements.publish', clubId);
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) fail('bad_title', 'Give the announcement a title.');
  if (body.length < 3) fail('bad_body', 'Write a message for your members.');
  const now = clock.now();
  const audience: AnnouncementAudience = clubId === 'platform' ? { type: 'everyone' } : (input.audience ?? { type: 'members' });
  if (clubId !== 'platform') {
    if (audience.type === 'segment' && !db.crm.segments.some((s) => s.id === audience.segmentId && s.clubId === clubId)) fail('bad_audience', 'Choose one of this club\'s segments.');
    if (audience.type === 'tournament' && db.tournaments[audience.tournamentId ?? '']?.clubId !== clubId) fail('bad_audience', 'Choose one of this club\'s tournaments.');
  }
  const image = input.image ?? null;
  if (image !== null) {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(image)) fail('bad_image', 'The picture must be a PNG, JPEG, WebP or GIF.');
    if (image.length > 400_000) fail('image_too_large', 'The picture is too large. Use one under 300 KB.');
  }
  const scheduledAt = input.scheduledAt ?? null;
  if (scheduledAt !== null && clubId === 'platform') fail('bad_schedule', 'Platform notices are sent immediately.');
  if (scheduledAt !== null && scheduledAt <= now + 5_000) fail('bad_schedule', 'Choose a time in the future, or publish now.');
  const a: Announcement = {
    id: newId(db, 'an'),
    clubId,
    kind: input.kind,
    title: title.slice(0, 90),
    body: body.slice(0, 800),
    at: scheduledAt ?? now,
    authorId: actorId,
    pinned: input.pinned ?? false,
    audience,
    status: scheduledAt === null ? 'published' : 'scheduled',
    scheduledAt,
    image,
    notify: input.notify !== false,
    batchId: null,
  };
  db.announcements.push(a);
  if (clubId === 'platform') {
    audit(db, actorId, null, 'platform.announcement', { title: a.title });
    for (const id in db.users) notify(db, id, 'system', 'notif.platform_notice', { title: a.title });
    return a;
  }
  if (a.status === 'published') {
    sendAnnouncement(db, a);
    audit(db, actorId, clubId, 'announcement.published', { title: a.title, audience: audience.type });
  } else {
    audit(db, actorId, clubId, 'announcement.scheduled', { title: a.title, audience: audience.type });
  }
  return a;
}

/** Send every scheduled announcement whose time has come. Called by the runtime's timer. */
export function publishDueAnnouncements(db: DB, now: number = clock.now()): number {
  let sent = 0;
  for (const a of db.announcements) {
    if (a.status !== 'scheduled' || a.scheduledAt === null || a.scheduledAt > now) continue;
    const club = db.clubs[a.clubId];
    if (!club || club.status !== 'active') continue;
    a.status = 'published';
    a.at = now;
    sendAnnouncement(db, a);
    audit(db, SYSTEM, a.clubId, 'announcement.published', { title: a.title, audience: a.audience.type });
    sent++;
  }
  return sent;
}

export function deleteAnnouncement(db: DB, actorId: string, announcementId: string): void {
  const index = db.announcements.findIndex((a) => a.id === announcementId);
  if (index < 0) fail('not_found', 'Announcement not found.');
  const a = db.announcements[index]!;
  if (a.clubId === 'platform') requirePlatform(db, actorId);
  else requirePermission(db, actorId, 'announcements.publish', a.clubId);
  db.announcements.splice(index, 1);
  if (a.batchId) db.batches = db.batches.filter((b) => b.id !== a.batchId);
  audit(db, actorId, a.clubId === 'platform' ? null : a.clubId, 'announcement.deleted', { title: a.title });
}

/** May this person read this announcement? Scheduled ones are staff-only until they go out. */
export function canReadAnnouncement(db: DB, userId: string, a: Announcement): boolean {
  if (a.clubId === 'platform') return true;
  if (can(db, userId, 'console.access', a.clubId)) return true;
  if (a.status !== 'published') return false;
  switch (a.audience.type) {
    case 'everyone':
    case 'followers':
      return true; // public: shown on the club's profile
    case 'members':
      return isActiveMember(db, userId, a.clubId);
    case 'segment':
    case 'tournament':
      return a.targetIds?.includes(userId) ?? false;
  }
}

/** The announcements a person may read from the given clubs, pinned first, newest first. */
export function announcementsFor(db: DB, userId: string, clubIds: string[]): Announcement[] {
  const set = new Set(clubIds);
  return db.announcements
    .filter((a) => set.has(a.clubId) && a.status === 'published' && canReadAnnouncement(db, userId, a))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
}

export interface AnnouncementStats {
  announcement: Announcement;
  /** Null when it was posted without notifications or has not gone out yet. */
  delivery: Pick<DeliveryBatch, 'eligible' | 'optedOut' | 'errors'> & { delivered: number; read: number; simulatedRead: number; simulatedDelivered: number } | null;
}

/** A club's announcements with their delivery figures, for staff. Every number comes from the delivery record. */
export function clubAnnouncementLog(db: DB, actorId: string, clubId: string): AnnouncementStats[] {
  requirePermission(db, actorId, 'console.access', clubId);
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  return db.announcements
    .filter((a) => a.clubId === clubId)
    .sort((a, b) => Number(b.status === 'scheduled') - Number(a.status === 'scheduled') || b.at - a.at)
    .map((announcement) => {
      const b = announcement.batchId ? batches.get(announcement.batchId) : undefined;
      return {
        announcement,
        delivery: b
          ? {
              eligible: b.eligible,
              optedOut: b.optedOut,
              errors: b.errors,
              delivered: b.delivered.length,
              read: b.readBy.length,
              simulatedRead: b.simulatedReadBy.length,
              simulatedDelivered: b.delivered.filter((id) => db.users[id]?.isBot).length,
            }
          : null,
      };
    });
}

export interface DeliveryLogRow {
  id: string;
  kind: DeliveryBatch['kind'];
  at: number;
  /** What was sent: an announcement's title or a tournament's name. */
  subject: string;
  eligible: number;
  delivered: number;
  optedOut: number;
  errors: number;
  read: number;
  simulatedRead: number;
}

/** Everything the club has sent to groups of people (announcements, reminders, new-tournament notices), newest first. */
export function clubDeliveryLog(db: DB, actorId: string, clubId: string): DeliveryLogRow[] {
  requirePermission(db, actorId, 'console.access', clubId);
  return db.batches
    .filter((b) => b.clubId === clubId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 60)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      at: b.at,
      subject: b.kind === 'announcement' ? (db.announcements.find((a) => a.id === b.refId)?.title ?? '') : (db.tournaments[b.refId]?.name ?? ''),
      eligible: b.eligible,
      delivered: b.delivered.length,
      optedOut: b.optedOut,
      errors: b.errors,
      read: b.readBy.length,
      simulatedRead: b.simulatedReadBy.length,
    }));
}

/** How many people an audience would reach right now, before anything is sent. */
export function audiencePreview(db: DB, actorId: string, clubId: string, audience: AnnouncementAudience): { eligible: number; reachable: number } {
  requirePermission(db, actorId, 'announcements.publish', clubId);
  const probe: Announcement = { id: '', clubId, kind: 'news', title: '', body: '', at: 0, authorId: actorId, pinned: false, audience, status: 'published', scheduledAt: null, image: null, notify: true, batchId: null };
  const { userIds, clubOptOut } = resolveAudience(db, probe);
  return { eligible: userIds.length, reachable: userIds.filter((id) => !clubOptOut(id)).length };
}

// ---------------------------------------------------------------------------
// Tournaments: configuration
// ---------------------------------------------------------------------------

export interface TournamentDraft {
  name: string;
  description: string;
  banner: BannerStyle;
  format: 'mtt' | 'sng';
  /** v0.4: the poker game. Optional so older callers default to Hold'em. */
  game?: VariantId;
  preset: PresetId;
  startMode: Tournament['startMode'];
  startAt: number;
  timezone: string;
  registrationOpensAt: number;
  minPlayers: number;
  maxPlayers: number;
  structure: TournamentStructure;
  visibility: TournamentVisibility;
  access: TournamentAccess;
  accessCode: string | null;
  entryPoints: number;
  simulateRegistrations: boolean;
  simulatedFill: number;
  demoSpeed: number;
  /** v0.3: what the felt shows. Optional so older drafts and callers still validate. */
  tableBranding?: TableBranding;
}

export type DraftProblem =
  | 'name_required'
  | 'name_too_long'
  | 'bad_capacity'
  | 'min_above_max'
  | 'start_in_past'
  | 'registration_after_start'
  | 'bad_entry'
  | 'bad_access_code'
  | 'bad_table_logo'
  | 'bad_table_colors'
  | 'game_not_available'
  | 'game_table_size'
  | `structure.${string}`;

const normalizeCode = (code: string): string => code.trim().toUpperCase();

export function validateDraft(draft: TournamentDraft, now = clock.now()): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const name = draft.name.trim();
  if (name.length < 3) problems.push('name_required');
  if (name.length > 60) problems.push('name_too_long');
  if (!Number.isInteger(draft.maxPlayers) || draft.maxPlayers < 2 || draft.maxPlayers > 500) problems.push('bad_capacity');
  if (!Number.isInteger(draft.minPlayers) || draft.minPlayers < 2) problems.push('bad_capacity');
  if (draft.minPlayers > draft.maxPlayers) problems.push('min_above_max');
  if (draft.startMode === 'scheduled') {
    if (draft.startAt <= now) problems.push('start_in_past');
    if (draft.registrationOpensAt > draft.startAt) problems.push('registration_after_start');
  }
  if (!Number.isInteger(draft.entryPoints) || draft.entryPoints < 0 || draft.entryPoints > 100000) problems.push('bad_entry');
  if (draft.accessCode !== null && !/^[A-Za-z0-9]{4,12}$/.test(draft.accessCode.trim())) problems.push('bad_access_code');
  for (const p of validateStructure(draft.structure)) problems.push(`structure.${p}`);
  if (draft.game !== undefined) {
    const rules = variantOf(draft.game);
    if (!VARIANTS[draft.game] || !rules.implemented) problems.push('game_not_available');
    else if (draft.structure.tableSize > maxTableSize(rules)) problems.push('game_table_size');
  }
  if (draft.tableBranding) {
    const b = draft.tableBranding;
    if (b.source === 'custom' && b.logoDataUrl && (!b.logoDataUrl.startsWith('data:image/') || b.logoDataUrl.length > TABLE_LOGO_LIMITS.maxBytes * 1.37)) problems.push('bad_table_logo');
    if (!(b.opacity >= TABLE_LOGO_LIMITS.opacity.min && b.opacity <= TABLE_LOGO_LIMITS.opacity.max) || !(b.scale >= TABLE_LOGO_LIMITS.scale.min && b.scale <= TABLE_LOGO_LIMITS.scale.max)) problems.push('bad_table_logo');
    if (b.theme === 'custom' && !(b.colors && isHex(b.colors.felt) && isHex(b.colors.rail))) problems.push('bad_table_colors');
  }
  return [...new Set(problems)];
}

const cleanDraft = (draft: TournamentDraft): Partial<Tournament> => ({
  name: draft.name.trim(),
  description: draft.description.trim().slice(0, 500),
  structure: structuredClone(draft.structure),
  accessCode: draft.accessCode === null || draft.accessCode.trim() === '' ? null : normalizeCode(draft.accessCode),
  // Stored normalised, with a custom logo only when one was actually uploaded.
  tableBranding: draft.tableBranding ? { ...draft.tableBranding, logoDataUrl: draft.tableBranding.source === 'custom' ? draft.tableBranding.logoDataUrl : null } : undefined,
});

export function createTournament(db: DB, actorId: string, clubId: string, draft: TournamentDraft): Tournament {
  requirePermission(db, actorId, 'tournaments.create', clubId);
  const problems = validateDraft(draft).filter((p) => p !== 'start_in_past'); // a draft may be saved before a time is chosen
  if (problems.length > 0) fail('invalid', `The tournament has problems: ${problems.join(', ')}.`);
  const now = clock.now();
  const t: Tournament = {
    id: newId(db, 't'),
    clubId,
    ...draft,
    ...cleanDraft(draft),
    reentry: 'none',
    status: 'DRAFT',
    registrations: [],
    createdBy: actorId,
    createdAt: now,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    cancelReason: null,
    seatingUntil: null,
    seeded: false,
  } as Tournament;
  db.tournaments[t.id] = t;
  audit(db, actorId, clubId, 'tournament.created', { name: t.name });
  return t;
}

export function updateTournament(db: DB, actorId: string, id: string, draft: TournamentDraft): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.edit', t.clubId);
  if (!isEditable(t.status)) {
    fail('not_editable', 'Only drafts and scheduled tournaments can be edited. Duplicate it to make a new one.');
  }
  const problems = validateDraft(draft).filter((p) => (t.status === 'DRAFT' && p === 'start_in_past' ? false : true));
  if (problems.length > 0) fail('invalid', `The tournament has problems: ${problems.join(', ')}.`);
  const startBefore = t.startAt;
  Object.assign(t, draft, cleanDraft(draft));
  audit(db, actorId, t.clubId, 'tournament.updated', { name: t.name });
  // A published tournament that moves: everyone who already has a place or an authorisation in it is told once.
  if (t.status !== 'DRAFT' && t.startAt !== startBefore) {
    for (const r of t.registrations) {
      if (HOLDS_PLACE.has(r.status)) notify(db, r.userId, 'tournament', 'notif.rescheduled', { name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `moved:${t.id}:${t.startAt}` });
    }
  }
}

export function draftOf(t: Tournament): TournamentDraft {
  return {
    name: t.name,
    description: t.description,
    banner: t.banner,
    format: t.format,
    preset: t.preset,
    startMode: t.startMode,
    startAt: t.startAt,
    timezone: t.timezone,
    registrationOpensAt: t.registrationOpensAt,
    minPlayers: t.minPlayers,
    maxPlayers: t.maxPlayers,
    structure: structuredClone(t.structure),
    visibility: t.visibility,
    access: t.access,
    accessCode: t.accessCode,
    entryPoints: t.entryPoints,
    simulateRegistrations: t.simulateRegistrations,
    simulatedFill: t.simulatedFill,
    demoSpeed: t.demoSpeed,
    game: t.game ?? DEFAULT_VARIANT,
    tableBranding: t.tableBranding ? { ...t.tableBranding } : { ...DEFAULT_TABLE_BRANDING },
  };
}

export function duplicateTournament(db: DB, actorId: string, id: string): Tournament {
  const source = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.create', source.clubId);
  const now = clock.now();
  const draft = draftOf(source);
  draft.name = `${source.name} (copy)`.slice(0, 60);
  // Keep the time of day, move to the next day that is still in the future.
  let startAt = source.startAt;
  while (startAt <= now + 10 * 60_000) startAt += 24 * 3600_000;
  draft.startAt = startAt;
  draft.registrationOpensAt = now;
  const copy = createTournament(db, actorId, source.clubId, draft);
  audit(db, actorId, source.clubId, 'tournament.duplicated', { name: source.name });
  return copy;
}

export function deleteDraft(db: DB, actorId: string, id: string): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.edit', t.clubId);
  if (t.status !== 'DRAFT') fail('not_draft', 'Only a draft can be deleted. Cancel a published tournament instead.');
  delete db.tournaments[id];
  audit(db, actorId, t.clubId, 'tournament.draft_deleted', { name: t.name });
}

export function publishTournament(db: DB, actorId: string, id: string, options: { announce?: boolean } = {}): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.create', t.clubId);
  const club = clubOf(db, t.clubId);
  const now = clock.now();
  const problems = validateDraft(draftOf(t), now);
  if (problems.length > 0) fail('invalid', `Fix these before publishing: ${problems.join(', ')}.`);
  const usage = clubUsage(db, t.clubId);
  if (usage.tournamentsThisMonth >= effectiveLimits(db, club).tournamentsPerMonth) {
    fail('plan_limit', 'This club has used all the tournaments included in its plan this month.');
  }
  const next = t.registrationOpensAt <= now ? 'REGISTRATION_OPEN' : 'SCHEDULED';
  assertTransition(t.status, next);
  t.status = next;
  t.publishedAt = now;
  audit(db, actorId, t.clubId, 'tournament.published', { name: t.name });
  // An invitation-only tournament is announced to nobody: the people invited hear about it individually.
  if (t.access === 'invite' && t.visibility === 'private') return;
  if (options.announce) {
    // Posted on the club page only; the tournament notification below is the one people receive.
    db.announcements.push({
      id: newId(db, 'an'),
      clubId: t.clubId,
      kind: 'tournament',
      title: t.name,
      body: t.description || t.name,
      at: now,
      authorId: actorId,
      pinned: false,
      tournamentId: t.id,
      audience: { type: t.visibility === 'public' ? 'everyone' : 'members' },
      status: 'published',
      scheduledAt: null,
      image: null,
      notify: false,
      batchId: null,
    });
  }
  for (const m of db.memberships) {
    if (m.clubId === t.clubId && m.status === 'active' && m.userId !== actorId) {
      notify(db, m.userId, 'tournament', 'notif.tournament_published', { club: club.name, name: t.name }, { name: 'tournament', params: { id: t.id } }, { clubId: t.clubId, dedupeKey: `pub:${t.id}` });
    }
  }
  automation.onTournamentPublished(db, t);
}

export function unpublishTournament(db: DB, actorId: string, id: string): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.edit', t.clubId);
  assertTransition(t.status, 'DRAFT');
  t.status = 'DRAFT';
  t.publishedAt = null;
  audit(db, actorId, t.clubId, 'tournament.unpublished', { name: t.name });
}

/** Scheduler transition: a scheduled tournament's registration window has arrived. */
export function openRegistration(db: DB, actorId: string, id: string): void {
  const t = tournamentOf(db, id);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  assertTransition(t.status, 'REGISTRATION_OPEN');
  t.status = 'REGISTRATION_OPEN';
  audit(db, actorId, t.clubId, 'tournament.registration_opened', { name: t.name });
}

export function closeRegistration(db: DB, actorId: string, id: string): void {
  const t = tournamentOf(db, id);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  assertTransition(t.status, 'REGISTRATION_CLOSED');
  t.status = 'REGISTRATION_CLOSED';
  audit(db, actorId, t.clubId, 'tournament.registration_closed', { name: t.name });
}

// ---------------------------------------------------------------------------
// Tournaments: who may see and watch
// ---------------------------------------------------------------------------

export const registrationOf = (t: Tournament, userId: string): Registration | undefined => t.registrations.find((r) => r.userId === userId);

const HOLDS_PLACE = new Set<Registration['status']>(['requested', 'approved', 'registered', 'waitlisted']);

/**
 * May this person open the tournament's lobby?
 *  - staff of the club: always
 *  - a public tournament: anyone, once it is published
 *  - a private tournament: approved members; for an invitation-only one, only the people invited
 *  - anyone who holds a place in it
 */
export function canViewTournament(db: DB, userId: string, t: Tournament): boolean {
  if (can(db, userId, 'console.access', t.clubId)) return true;
  if (t.status === 'DRAFT') return false;
  const mine = registrationOf(t, userId);
  if (mine && HOLDS_PLACE.has(mine.status)) return true;
  if (t.visibility === 'public') return true;
  if (!isActiveMember(db, userId, t.clubId)) return false;
  return t.access !== 'invite';
}

/**
 * May this person see who is playing and watch the tables? Stricter than
 * viewing the lobby. A public tournament is public to watch. A private one
 * opens for the club's staff, the players in it, and approved members who can
 * see it. `userId` is null when nobody is signed in. Checked by the runtime
 * before a table is opened, not only by the screen.
 */
export function canWatchTournament(db: DB, userId: string | null, t: Tournament): boolean {
  if (t.status === 'DRAFT') return false;
  if (t.visibility === 'public') return true;
  if (userId === null) return false;
  if (can(db, userId, 'console.access', t.clubId)) return true;
  if (registrationOf(t, userId)?.status === 'registered') return true;
  return isActiveMember(db, userId, t.clubId) && canViewTournament(db, userId, t);
}

// ---------------------------------------------------------------------------
// Tournaments: registration
// ---------------------------------------------------------------------------

export const registeredCount = (t: Tournament): number => t.registrations.filter((r) => r.status === 'registered').length;
export const requestedCount = (t: Tournament): number => t.registrations.filter((r) => r.status === 'requested').length;
export const waitlistedCount = (t: Tournament): number => t.registrations.filter((r) => r.status === 'waitlisted').length;

function refund(db: DB, t: Tournament, r: Registration): void {
  if (r.pointsPaid <= 0) return;
  const m = membershipOf(db, r.userId, t.clubId);
  if (m) m.demoPoints += r.pointsPaid;
  r.pointsPaid = 0;
}

const tournamentLink = (t: Tournament) => ({ name: 'tournament', params: { id: t.id } });

/** Give free seats to the people who have waited longest. */
function promoteFromWaitlist(db: DB, t: Tournament): number {
  if (!isUpcoming(t.status)) return 0;
  let promoted = 0;
  const waiting = t.registrations.filter((r) => r.status === 'waitlisted').sort((a, b) => a.at - b.at);
  for (const r of waiting) {
    if (registeredCount(t) >= t.maxPlayers) break;
    r.status = 'registered';
    promoted++;
    logEvent(db, t.clubId, r.userId, 'tournament_registered', SYSTEM, { name: t.name, from: 'waitlist' });
    notify(db, r.userId, 'registration', 'notif.waitlist_promoted', { name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `wl:${t.id}:${r.at}` });
  }
  return promoted;
}

const ACCESS_CODE_LIMIT = { failures: 5, windowMs: 10 * MIN };

/** Check an access code with a limit on wrong guesses. A correct code is necessary, never sufficient. */
function checkAccessCode(db: DB, t: Tournament, userId: string, code: string | undefined): void {
  if (!t.accessCode) return;
  const now = clock.now();
  const recentFailures = db.accessAttempts.filter((a) => a.tournamentId === t.id && a.userId === userId && !a.ok && now - a.at < ACCESS_CODE_LIMIT.windowMs);
  if (recentFailures.length >= ACCESS_CODE_LIMIT.failures) {
    const wait = Math.max(1, Math.ceil((recentFailures[0]!.at + ACCESS_CODE_LIMIT.windowMs - now) / MIN));
    fail('code_locked', `Too many wrong codes. Try again in ${wait} minutes.`);
  }
  if (code === undefined || code.trim() === '') fail('code_required', 'This tournament needs an access code.');
  const ok = normalizeCode(code!) === t.accessCode;
  db.accessAttempts.push({ tournamentId: t.id, userId, at: now, ok });
  if (db.accessAttempts.length > 500) db.accessAttempts.splice(0, db.accessAttempts.length - 500);
  if (!ok) {
    if (recentFailures.length + 1 >= ACCESS_CODE_LIMIT.failures) audit(db, userId, t.clubId, 'registration.code_locked', { user: userOf(db, userId).name, name: t.name });
    fail('bad_code', 'That access code is not right.');
  }
}

export interface RegisterOptions {
  /** Supplied by the tournament runtime: the tournament is running but still accepting late entries. */
  lateRegistrationOpen?: boolean;
  /** The tournament's access code, when it has one. */
  code?: string;
}

/**
 * Ask for a place in a tournament. The checks, in order:
 *  1. the club is active and the person is an approved member of it;
 *  2. registration is open (or late registration is, during play);
 *  3. they do not already hold a place, and staff have not withdrawn one;
 *  4. the tournament's own access rule: open to members, by staff approval, or by invitation;
 *  5. the access code, if the tournament has one;
 *  6. demo points and capacity.
 * An access code or an invitation link never replaces step 1.
 */
export function registerForTournament(db: DB, userId: string, id: string, options: RegisterOptions = {}): Registration {
  const t = tournamentOf(db, id);
  const club = clubOf(db, t.clubId);
  requireActiveClub(club);
  const member = membershipOf(db, userId, t.clubId);
  if (!member || member.status !== 'active') fail('members_only', 'Only approved members of the club can register for its tournaments.');
  if (onBreak(db, userId)) fail('on_break', 'You set yourself a break from play; it has not ended yet.');
  const late = (t.status === 'RUNNING' || t.status === 'PAUSED') && options.lateRegistrationOpen === true;
  if (t.status !== 'REGISTRATION_OPEN' && !late) fail('registration_closed', 'Registration is not open for this tournament.');
  const existing = registrationOf(t, userId);
  if (existing) {
    if (existing.status === 'registered') fail('already_registered', 'You are already registered.');
    if (existing.status === 'requested') fail('already_requested', 'Your request is waiting for the club.');
    if (existing.status === 'waitlisted') fail('already_waitlisted', 'You are already on the waiting list.');
    if (existing.status === 'cancelled' && existing.cancelledBy === 'staff') fail('revoked', 'The club withdrew your place in this tournament.');
  }
  // Staff (or a valid invitation) already authorised this person for this tournament.
  const authorised = existing?.status === 'approved';
  if (!authorised) {
    if (t.access === 'invite') fail('invite_only', 'This tournament is by invitation only.');
    checkAccessCode(db, t, userId, options.code);
  }
  const due = Math.max(0, t.entryPoints - (existing?.pointsPaid ?? 0));
  if (member!.demoPoints < due) {
    fail('insufficient_points', `You need ${t.entryPoints} demo points to enter and have ${member!.demoPoints}.`);
  }
  const full = registeredCount(t) >= t.maxPlayers;
  let status: Registration['status'];
  if (!authorised && t.access === 'approval') status = 'requested';
  else if (full) {
    // A tournament that starts when it fills, or is already running, has no waiting list.
    if (late || t.startMode === 'when_full') fail('full', 'This tournament is full.');
    status = 'waitlisted';
  } else status = 'registered';

  const now = clock.now();
  member!.demoPoints -= due;
  member!.lastActiveAt = now;
  const registration: Registration = { userId, status, at: existing?.status === 'approved' ? existing.at : now, pointsPaid: (existing?.pointsPaid ?? 0) + due, decidedBy: existing?.decidedBy ?? null, decidedAt: existing?.decidedAt ?? null, viaLinkId: existing?.viaLinkId ?? null };
  if (existing) t.registrations.splice(t.registrations.indexOf(existing), 1);
  t.registrations.push(registration);
  if (status === 'requested') {
    logEvent(db, t.clubId, userId, 'tournament_requested', userId, { name: t.name });
    for (const m of db.memberships) {
      if (m.clubId === t.clubId && m.status === 'active' && can(db, m.userId, 'tournaments.registrations', t.clubId)) {
        notify(db, m.userId, 'registration', 'notif.registration_request', { user: userOf(db, userId).name, name: t.name }, { name: 'console.tournament', params: { clubId: t.clubId, id: t.id } }, { clubId: t.clubId, dedupeKey: `rr:${t.id}:${userId}:${now}` });
      }
    }
  } else if (status === 'waitlisted') {
    logEvent(db, t.clubId, userId, 'tournament_waitlisted', userId, { name: t.name });
    notify(db, userId, 'registration', 'notif.waitlisted', { name: t.name }, tournamentLink(t), { clubId: t.clubId });
  } else {
    logEvent(db, t.clubId, userId, 'tournament_registered', userId, { name: t.name });
    notify(db, userId, 'registration', 'notif.registered', { name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `reg:${t.id}:${now}` });
  }
  return registration;
}

export function unregisterFromTournament(db: DB, userId: string, id: string): void {
  const t = tournamentOf(db, id);
  const r = registrationOf(t, userId);
  if (!r || !HOLDS_PLACE.has(r.status)) fail('not_registered', 'You are not registered for this tournament.');
  if (!isUpcoming(t.status)) fail('too_late', 'It is too late to unregister: seating has started.');
  refund(db, t, r!);
  t.registrations.splice(t.registrations.indexOf(r!), 1);
  logEvent(db, t.clubId, userId, 'tournament_unregistered', userId, { name: t.name });
  promoteFromWaitlist(db, t);
}

function decide(r: Registration, actorId: string): void {
  r.decidedBy = actorId;
  r.decidedAt = clock.now();
}

export function approveRegistration(db: DB, actorId: string, id: string, userId: string): void {
  const t = tournamentOf(db, id);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  const r = registrationOf(t, userId);
  if (!r || r.status !== 'requested') fail('not_pending', 'This registration is not waiting for approval.');
  if (!isActiveMember(db, userId, t.clubId)) fail('not_member', 'Only approved members can be given a seat.');
  if (isTerminal(t.status)) fail('already_finished', 'This tournament has already finished.');
  decide(r!, actorId);
  const user = userOf(db, userId);
  if (!isUpcoming(t.status)) {
    // Play has started: the player is authorised and takes the seat through late registration.
    r!.status = 'approved';
    notify(db, userId, 'registration', 'notif.registration_authorised', { name: t.name }, tournamentLink(t), { clubId: t.clubId });
  } else if (registeredCount(t) >= t.maxPlayers) {
    r!.status = 'waitlisted';
    logEvent(db, t.clubId, userId, 'tournament_waitlisted', actorId, { name: t.name });
    notify(db, userId, 'registration', 'notif.registration_waitlisted', { name: t.name }, tournamentLink(t), { clubId: t.clubId });
  } else {
    r!.status = 'registered';
    notify(db, userId, 'registration', 'notif.registration_approved', { name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `ra:${t.id}:${r!.at}` });
  }
  logEvent(db, t.clubId, userId, 'tournament_approved', actorId, { name: t.name });
  audit(db, actorId, t.clubId, 'registration.approved', { user: user.name, name: t.name });
}

export function rejectRegistration(db: DB, actorId: string, id: string, userId: string): void {
  const t = tournamentOf(db, id);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  const r = registrationOf(t, userId);
  if (!r || r.status !== 'requested') fail('not_pending', 'This registration is not waiting for approval.');
  refund(db, t, r!);
  r!.status = 'rejected';
  decide(r!, actorId);
  logEvent(db, t.clubId, userId, 'tournament_rejected', actorId, { name: t.name });
  audit(db, actorId, t.clubId, 'registration.rejected', { user: userOf(db, userId).name, name: t.name });
  notify(db, userId, 'registration', 'notif.registration_rejected', { name: t.name }, null, { clubId: t.clubId });
}

/**
 * Withdraw a person's place or authorisation before play starts. Their demo
 * points are returned, the next person on the waiting list is seated, and they
 * cannot register again unless staff authorise them.
 */
export function revokeRegistration(db: DB, actorId: string, id: string, userId: string): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  const r = registrationOf(t, userId);
  if (!r || !HOLDS_PLACE.has(r.status)) fail('not_registered', 'This player does not hold a place in this tournament.');
  if (r!.status === 'registered' && !isUpcoming(t.status)) fail('too_late', 'A seated player cannot be removed after seating has started.');
  if (isTerminal(t.status)) fail('already_finished', 'This tournament has already finished.');
  refund(db, t, r!);
  r!.status = 'cancelled';
  r!.cancelledBy = 'staff';
  decide(r!, actorId);
  logEvent(db, t.clubId, userId, 'tournament_revoked', actorId, { name: t.name });
  audit(db, actorId, t.clubId, 'registration.revoked', { user: userOf(db, userId).name, name: t.name });
  notify(db, userId, 'registration', 'notif.registration_revoked', { name: t.name }, null, { clubId: t.clubId });
  promoteFromWaitlist(db, t);
}

/**
 * Authorise one approved member for this tournament: an individual invitation
 * to an invitation-only event, a seat without the approval step, or the way
 * back in for someone whose place was withdrawn. They still take the seat
 * themselves.
 */
export function authorizePlayer(db: DB, actorId: string, id: string, userId: string): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  if (isTerminal(t.status) || t.status === 'DRAFT') fail('not_available', 'Publish the tournament before inviting players.');
  if (!isActiveMember(db, userId, t.clubId)) fail('not_member', 'Only approved members of the club can be invited to its tournaments.');
  const existing = registrationOf(t, userId);
  if (existing && (existing.status === 'registered' || existing.status === 'approved' || existing.status === 'waitlisted')) fail('already_registered', 'This player already has a place.');
  const now = clock.now();
  const r: Registration = { userId, status: 'approved', at: now, pointsPaid: existing?.pointsPaid ?? 0, decidedBy: actorId, decidedAt: now, viaLinkId: null };
  if (existing) t.registrations.splice(t.registrations.indexOf(existing), 1);
  t.registrations.push(r);
  logEvent(db, t.clubId, userId, 'tournament_approved', actorId, { name: t.name, invited: 1 });
  audit(db, actorId, t.clubId, 'registration.invited', { user: userOf(db, userId).name, name: t.name });
  notify(db, userId, 'registration', 'notif.tournament_invited', { club: clubOf(db, t.clubId).name, name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `inv:${t.id}:${now}` });
}

/** An approved member opened a valid tournament invitation link. */
function authoriseByLink(db: DB, userId: string, t: Tournament, link: InviteLink): void {
  const existing = registrationOf(t, userId);
  if (existing) {
    if (existing.status === 'cancelled' && existing.cancelledBy === 'staff') fail('revoked', 'The club withdrew your place in this tournament.');
    if (HOLDS_PLACE.has(existing.status) && existing.status !== 'requested') return; // nothing more to do, and the link is not used up
  }
  if (linkProblem(link)) fail('invite_expired', 'This invitation can no longer be used.');
  const now = clock.now();
  const r: Registration = { userId, status: 'approved', at: now, pointsPaid: existing?.pointsPaid ?? 0, decidedBy: link.createdBy, decidedAt: now, viaLinkId: link.id };
  if (existing) t.registrations.splice(t.registrations.indexOf(existing), 1);
  t.registrations.push(r);
  link.uses += 1;
  logEvent(db, t.clubId, userId, 'tournament_approved', SYSTEM, { name: t.name, link: link.label });
}

/** Staff seat someone from the waiting list by hand. Capacity still applies. */
export function promoteWaitlisted(db: DB, actorId: string, id: string, userId: string): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.registrations', t.clubId);
  const r = registrationOf(t, userId);
  if (!r || r.status !== 'waitlisted') fail('not_waitlisted', 'This player is not on the waiting list.');
  if (!isUpcoming(t.status)) fail('too_late', 'Seating has started.');
  if (registeredCount(t) >= t.maxPlayers) fail('full', 'The tournament is full. Free a seat or raise the capacity first.');
  r!.status = 'registered';
  decide(r!, actorId);
  logEvent(db, t.clubId, userId, 'tournament_registered', actorId, { name: t.name, from: 'waitlist' });
  notify(db, userId, 'registration', 'notif.waitlist_promoted', { name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `wl:${t.id}:${r!.at}` });
}

// ---------------------------------------------------------------------------
// Tournaments: running
// ---------------------------------------------------------------------------

export const SEATING_MS = 6_000;

/** Close registration and start the seating draw. */
export function beginSeating(db: DB, actorId: string, id: string): void {
  const t = tournamentOf(db, id);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'tournaments.run', t.clubId);
  requireActiveClub(clubOf(db, t.clubId));
  assertTransition(t.status, 'SEATING');
  const players = registeredCount(t);
  if (players < Math.max(2, t.minPlayers)) {
    fail('not_enough_players', `At least ${Math.max(2, t.minPlayers)} registered players are needed to start (there are ${players}).`);
  }
  // Requests nobody decided and the waiting list are released, with their demo points.
  for (const r of t.registrations) {
    if (r.status === 'requested') {
      refund(db, t, r);
      r.status = 'rejected';
      notify(db, r.userId, 'registration', 'notif.registration_released', { name: t.name }, null, { clubId: t.clubId });
    } else if (r.status === 'waitlisted') {
      refund(db, t, r);
      r.status = 'cancelled';
      notify(db, r.userId, 'registration', 'notif.waitlist_released', { name: t.name }, null, { clubId: t.clubId });
    }
  }
  const now = clock.now();
  t.status = 'SEATING';
  t.startedAt = now;
  t.seatingUntil = now + SEATING_MS;
  audit(db, actorId, t.clubId, 'tournament.seating', { name: t.name, players });
  for (const r of t.registrations) {
    if (r.status === 'registered') notify(db, r.userId, 'tournament', 'notif.seating', { name: t.name }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `seat:${t.id}` });
  }
}

export function markRunning(db: DB, id: string): void {
  const t = tournamentOf(db, id);
  assertTransition(t.status, 'RUNNING');
  t.status = 'RUNNING';
  audit(db, SYSTEM, t.clubId, 'tournament.started', { name: t.name });
}

export function setPaused(db: DB, actorId: string, id: string, paused: boolean): void {
  const t = tournamentOf(db, id);
  requirePermission(db, actorId, 'tournaments.run', t.clubId);
  const next = paused ? 'PAUSED' : 'RUNNING';
  assertTransition(t.status, next);
  t.status = next;
  audit(db, actorId, t.clubId, paused ? 'tournament.paused' : 'tournament.resumed', { name: t.name });
}

export function cancelTournament(db: DB, actorId: string, id: string, reason: string): void {
  const t = tournamentOf(db, id);
  if (actorId !== SYSTEM) requirePermission(db, actorId, 'tournaments.cancel', t.clubId);
  if (isTerminal(t.status)) fail('already_finished', 'This tournament has already finished.');
  assertTransition(t.status, 'CANCELLED');
  for (const r of t.registrations) {
    refund(db, t, r);
    if (HOLDS_PLACE.has(r.status)) {
      notify(db, r.userId, 'tournament', 'notif.cancelled', { name: t.name, reason: reason || '—' }, tournamentLink(t), { clubId: t.clubId, dedupeKey: `cancel:${t.id}` });
    }
  }
  t.status = 'CANCELLED';
  t.cancelReason = reason.trim().slice(0, 200) || null;
  t.completedAt = clock.now();
  audit(db, actorId, t.clubId, 'tournament.cancelled', { name: t.name, reason: t.cancelReason ?? '' });
}

/** Club ranking points for a finishing place. A leaderboard score only. */
export function rankingPoints(entrants: number, place: number): number {
  return Math.max(1, Math.round(10 * Math.sqrt(entrants / place)));
}

export function completeTournament(db: DB, id: string, result: TournamentResult): void {
  const t = tournamentOf(db, id);
  assertTransition(t.status, 'COMPLETED');
  t.status = 'COMPLETED';
  t.completedAt = result.completedAt;
  // Anyone who was authorised but never sat down gets their demo points back.
  for (const r of t.registrations) if (r.status !== 'registered') refund(db, t, r);
  result.game = t.game ?? DEFAULT_VARIANT;
  db.results[id] = result;
  db.counters.tournamentsHosted += 1;
  // Competition: achievements earned by this result (bots never earn any).
  for (const p of result.places) if (!p.isBot) evaluateAchievements(db, p.userId, result.completedAt);
  audit(db, SYSTEM, t.clubId, 'tournament.completed', { name: t.name, winner: result.places[0]?.name ?? '' });
  for (const p of result.places) {
    const m = membershipOf(db, p.userId, t.clubId);
    if (m) m.lastActiveAt = Math.max(m.lastActiveAt, result.completedAt);
    notify(db, p.userId, 'result', 'notif.result', { name: t.name, place: p.place, entrants: result.entrants }, { name: 'results', params: { id: t.id } }, { clubId: t.clubId, dedupeKey: `result:${t.id}` });
  }
}

// ---------------------------------------------------------------------------
// A club's page, as one person is allowed to see it
// ---------------------------------------------------------------------------

export interface ClubView {
  club: Club;
  /** The viewer's relationship with the club. */
  membership: Membership | null;
  following: Follow | null;
  isStaff: boolean;
  followers: number;
  /** Null when the club keeps its member count private and the viewer is not a member. */
  members: number | null;
  /** Links the club has made public. */
  social: { key: SocialKey; url: string }[];
  tournaments: Tournament[];
  announcements: Announcement[];
  /** Finished tournaments and the ranking: members always, others only if the club publishes results. */
  showResults: boolean;
  /** The club's private tournaments exist but are hidden from this viewer. */
  hasPrivateSchedule: boolean;
}

export function clubView(db: DB, viewerId: string, clubId: string): ClubView {
  const club = clubOf(db, clubId);
  const membership = membershipOf(db, viewerId, clubId) ?? null;
  const member = membership?.status === 'active';
  const all = Object.values(db.tournaments).filter((t) => t.clubId === clubId);
  const tournaments = all.filter((t) => t.status !== 'DRAFT' && canViewTournament(db, viewerId, t));
  let members = 0;
  for (const m of db.memberships) if (m.clubId === clubId && m.status === 'active') members++;
  return {
    club,
    membership,
    following: followOf(db, viewerId, clubId) ?? null,
    isStaff: can(db, viewerId, 'console.access', clubId),
    followers: followerCount(db, clubId),
    members: member || club.publicMemberCount ? members : null,
    social: SOCIAL_KEYS.filter((key) => club.social[key]?.public).map((key) => ({ key, url: club.social[key]!.url })),
    tournaments,
    announcements: announcementsFor(db, viewerId, [clubId]),
    showResults: member || club.publicResults,
    hasPrivateSchedule: !member && all.some((t) => t.status !== 'DRAFT' && !isTerminal(t.status) && t.visibility === 'private'),
  };
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export function createTicket(
  db: DB,
  actorId: string,
  clubId: string,
  input: { category: TicketCategory; priority: TicketPriority; subject: string; body: string },
): SupportTicket {
  requirePermission(db, actorId, 'support.manage', clubId);
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 4) fail('bad_subject', 'Describe the issue in a few words.');
  if (body.length < 10) fail('bad_body', 'Add a few details so support can help.');
  const now = clock.now();
  const ticket: SupportTicket = {
    id: newId(db, 'tk'),
    ref: `PCO-${1000 + db.tickets.length + 1}`,
    clubId,
    authorId: actorId,
    category: input.category,
    priority: input.priority,
    subject: subject.slice(0, 100),
    status: 'open',
    createdAt: now,
    updatedAt: now,
    messages: [{ authorId: actorId, at: now, body: body.slice(0, 2000), staff: false }],
  };
  db.tickets.push(ticket);
  audit(db, actorId, clubId, 'support.ticket_created', { ref: ticket.ref });
  for (const id in db.users) {
    if (isPlatformAdmin(db, id)) notify(db, id, 'support', 'notif.ticket_new', { ref: ticket.ref, club: clubOf(db, clubId).name }, { name: 'platform.support' });
  }
  return ticket;
}

function ticketOf(db: DB, id: string): SupportTicket {
  return db.tickets.find((t) => t.id === id) ?? fail('not_found', 'Ticket not found.');
}

export function replyToTicket(db: DB, actorId: string, ticketId: string, body: string): void {
  const ticket = ticketOf(db, ticketId);
  const staff = isPlatformAdmin(db, actorId);
  if (!staff) requirePermission(db, actorId, 'support.manage', ticket.clubId);
  const text = body.trim();
  if (text.length < 2) fail('bad_body', 'Write a reply first.');
  const now = clock.now();
  ticket.messages.push({ authorId: actorId, at: now, body: text.slice(0, 2000), staff });
  ticket.updatedAt = now;
  if (staff) {
    if (ticket.status === 'open') ticket.status = 'in_progress';
    notify(db, ticket.authorId, 'support', 'notif.ticket_reply', { ref: ticket.ref }, { name: 'console.support', params: { clubId: ticket.clubId } }, { clubId: ticket.clubId });
  } else if (ticket.status === 'waiting' || ticket.status === 'resolved') {
    ticket.status = 'open';
  }
}

export function setTicketStatus(db: DB, actorId: string, ticketId: string, status: TicketStatus): void {
  const ticket = ticketOf(db, ticketId);
  if (!isPlatformAdmin(db, actorId)) {
    requirePermission(db, actorId, 'support.manage', ticket.clubId);
    if (status !== 'resolved' && status !== 'open') fail('forbidden_status', 'Club staff can only close or reopen a ticket.');
  }
  ticket.status = status;
  ticket.updatedAt = clock.now();
  audit(db, actorId, isPlatformAdmin(db, actorId) ? null : ticket.clubId, 'support.ticket_status', { ref: ticket.ref, status });
}

// ---------------------------------------------------------------------------
// Platform administration (tenants and subscriptions)
// ---------------------------------------------------------------------------

export interface NewTenant {
  clubName: string;
  ownerName: string;
  planId: PlanId;
  joinPolicy: Club['joinPolicy'];
  accent: string;
}

export interface ClubSetup {
  accent: string;
  joinPolicy: Club['joinPolicy'];
  planId: PlanId;
  tagline?: string;
  location?: string;
  timezone?: string;
  logo?: ClubBranding['logo'];
  cover?: ClubBranding['cover'];
  titleFont?: ClubBranding['titleFont'];
}

/** The club record and its owner's membership, shared by platform provisioning and self-service creation. */
function buildClub(db: DB, name: string, ownerId: string, input: ClubSetup, now: number): Club {
  let code = '';
  do {
    code = String(100000 + ((db.nextId * 7919 + Object.keys(db.clubs).length * 104729) % 900000));
    db.nextId += 1;
  } while (Object.values(db.clubs).some((c) => c.code === code));
  const club: Club = {
    id: newId(db, 'c'),
    code,
    inviteToken: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${code.slice(0, 3)}`,
    name,
    tagline: (input.tagline ?? '').trim().slice(0, 80),
    description: '',
    rules: [],
    branding: {
      accent: input.accent,
      logo: input.logo ?? { kind: 'monogram', text: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() },
      cover: input.cover ?? { kind: 'pattern', pattern: 'grid' },
      tableTheme: 'midnight',
      titleFont: input.titleFont ?? 'sans',
    },
    joinPolicy: input.joinPolicy,
    simulatedStaff: false,
    status: 'active',
    suspendedReason: null,
    ownerId,
    planId: input.planId,
    limitOverrides: {},
    createdAt: now,
    timezone: input.timezone ?? 'Asia/Jerusalem',
    demoAllowance: 10000,
    location: (input.location ?? '').trim().slice(0, 60),
    social: {},
    publicResults: false,
    publicMemberCount: true,
    nextMemberNo: 1,
  };
  db.clubs[club.id] = club;
  db.memberships.push({
    clubId: club.id,
    userId: ownerId,
    role: 'owner',
    status: 'active',
    requestedAt: now,
    joinedAt: now,
    lastActiveAt: now,
    demoPoints: club.demoAllowance,
    via: 'owner',
    decidedAt: now,
    announcements: true,
    shareContact: false,
  });
  return club;
}

/**
 * v0.4: anyone signed in can open a club of their own and becomes its owner. Plan is Starter
 * (demo allowance; no payment anywhere). A person may own up to three clubs in the prototype.
 */
export function createClub(db: DB, actorId: string, input: { name: string } & Omit<ClubSetup, 'planId'>): Club {
  const actor = userOf(db, actorId);
  const name = input.name.trim();
  if (name.length < 3 || name.length > 40) fail('bad_name', 'Club name must be 3–40 characters.');
  if (Object.values(db.clubs).some((c) => c.name.toLowerCase() === name.toLowerCase())) fail('duplicate', 'A club with this name already exists.');
  if (!/^#[0-9a-fA-F]{6}$/.test(input.accent)) fail('bad_color', 'Accent colour must be a six-digit hex value.');
  if (Object.values(db.clubs).filter((c) => c.ownerId === actorId).length >= 3) fail('club_limit', 'You already own three clubs.');
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch {
      fail('bad_timezone', 'Unknown timezone.');
    }
  }
  const now = clock.now();
  const club = buildClub(db, name, actor.id, { ...input, planId: 'starter' }, now);
  initClubCrm(db, club.id, now);
  assignMemberNumber(db, club, actor.id);
  logEvent(db, club.id, actor.id, 'membership_approved', SYSTEM, { auto: 1 });
  audit(db, actor.id, club.id, 'club.created', { club: club.name });
  return club;
}

export function createTenant(db: DB, actorId: string, input: NewTenant): Club {
  requirePlatform(db, actorId);
  const name = input.clubName.trim();
  const ownerName = input.ownerName.trim();
  if (name.length < 3 || name.length > 40) fail('bad_name', 'Club name must be 3–40 characters.');
  if (ownerName.length < 2) fail('bad_owner', 'Enter the owner\'s name.');
  if (Object.values(db.clubs).some((c) => c.name.toLowerCase() === name.toLowerCase())) fail('duplicate', 'A club with this name already exists.');
  if (!/^#[0-9a-fA-F]{6}$/.test(input.accent)) fail('bad_color', 'Accent colour must be a six-digit hex value.');
  const now = clock.now();
  const handle = ownerName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) || 'owner';
  const owner: User = {
    id: newId(db, 'u'),
    name: ownerName,
    handle,
    hue: (name.length * 47) % 360,
    isBot: true, // a placeholder account: nobody is signed in as this person in the demo
    style: 'balanced',
    joinedAt: now,
    platformRole: null,
    demoIdentity: null,
    lang: 'en',
    email: `${handle}@example.com`,
    signupLinkId: null,
  };
  db.users[owner.id] = owner;
  const club = buildClub(db, name, owner.id, { accent: input.accent, joinPolicy: input.joinPolicy, planId: input.planId }, now);
  initClubCrm(db, club.id, now);
  assignMemberNumber(db, club, owner.id);
  logEvent(db, club.id, owner.id, 'membership_approved', SYSTEM, { auto: 1 });
  audit(db, actorId, null, 'tenant.created', { club: club.name, plan: input.planId });
  return club;
}

export function setTenantPlan(db: DB, actorId: string, clubId: string, planId: PlanId): void {
  requirePlatform(db, actorId);
  const club = clubOf(db, clubId);
  if (!db.plans[planId]) fail('not_found', 'Plan not found.');
  const from = club.planId;
  club.planId = planId;
  audit(db, actorId, null, 'tenant.plan_changed', { club: club.name, from, to: planId });
  notify(db, club.ownerId, 'system', 'notif.plan_changed', { club: club.name, plan: db.plans[planId].name }, null, { clubId: club.id });
}

export function setTenantLimits(db: DB, actorId: string, clubId: string, overrides: Partial<PlanLimits>): void {
  requirePlatform(db, actorId);
  const club = clubOf(db, clubId);
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) fail('bad_limit', `Limit "${key}" must be a positive whole number.`);
  }
  club.limitOverrides = { ...overrides };
  audit(db, actorId, null, 'tenant.limits_changed', { club: club.name });
}

export function suspendTenant(db: DB, actorId: string, clubId: string, reason: string): void {
  requirePlatform(db, actorId);
  const club = clubOf(db, clubId);
  if (club.status === 'suspended') fail('already_suspended', 'This club is already suspended.');
  club.status = 'suspended';
  club.suspendedReason = reason.trim().slice(0, 200) || null;
  audit(db, actorId, null, 'tenant.suspended', { club: club.name, reason: club.suspendedReason ?? '' });
  notify(db, club.ownerId, 'system', 'notif.tenant_suspended', { club: club.name }, null, { clubId: club.id });
}

export function restoreTenant(db: DB, actorId: string, clubId: string): void {
  requirePlatform(db, actorId);
  const club = clubOf(db, clubId);
  if (club.status === 'active') fail('not_suspended', 'This club is not suspended.');
  club.status = 'active';
  club.suspendedReason = null;
  audit(db, actorId, null, 'tenant.restored', { club: club.name });
  notify(db, club.ownerId, 'system', 'notif.tenant_restored', { club: club.name }, null, { clubId: club.id });
}

export function updatePlan(db: DB, actorId: string, planId: PlanId, patch: Partial<Omit<Plan, 'id'>>): void {
  requirePlatform(db, actorId);
  const plan = db.plans[planId] ?? fail('not_found', 'Plan not found.');
  const next: Plan = { ...plan, ...patch, limits: { ...plan.limits, ...(patch.limits ?? {}) }, id: plan.id };
  if (next.baseFee < 0 || next.perActiveFee < 0 || next.includedActive < 0) fail('bad_price', 'Amounts cannot be negative.');
  for (const [key, value] of Object.entries(next.limits)) {
    if (!Number.isInteger(value) || value < 1) fail('bad_limit', `Limit "${key}" must be a positive whole number.`);
  }
  if (!next.name.trim()) fail('bad_name', 'A plan needs a name.');
  db.plans[planId] = next;
  audit(db, actorId, null, 'plan.updated', { plan: next.name });
}

// ---------------------------------------------------------------------------
// Personal settings and inbox
// ---------------------------------------------------------------------------

/** v0.4 responsible play: a self-set break blocks new registrations until it ends. */
export function onBreak(db: DB, userId: string, now: number = clock.now()): boolean {
  const until = db.settings[userId]?.responsible?.breakUntil ?? null;
  return until !== null && until > now;
}

/** Starts (days > 0) or ends (days = 0) a break. Ending early is allowed: this is a nudge, not a lock. */
export function setBreak(db: DB, userId: string, days: number): void {
  if (!Number.isFinite(days) || days < 0 || days > 365) fail('bad_limit', 'A break is between one day and a year.');
  const current = db.settings[userId] ?? fail('not_found', 'Settings not found.');
  const responsible = current.responsible ?? { sessionReminderMin: 0, breakUntil: null, dailyMinutes: 0 };
  db.settings[userId] = { ...current, responsible: { ...responsible, breakUntil: days === 0 ? null : clock.now() + days * 86_400_000 } };
  audit(db, userId, null, days === 0 ? 'play.break_ended' : 'play.break_started', { days });
}

export function updateSettings(db: DB, userId: string, patch: Partial<UserSettings>): void {
  const current = db.settings[userId] ?? fail('not_found', 'Settings not found.');
  db.settings[userId] = { ...current, ...patch, notifications: { ...current.notifications, ...(patch.notifications ?? {}) }, channels: { ...(current.channels ?? {}), ...(patch.channels ?? {}) }, responsible: { ...(current.responsible ?? { sessionReminderMin: 0, breakUntil: null, dailyMinutes: 0 }), ...(patch.responsible ?? {}) } };
}

export function updateProfile(db: DB, userId: string, patch: { name?: string; handle?: string; hue?: number }): void {
  const user = userOf(db, userId);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 2 || name.length > 30) fail('bad_name', 'Display name must be 2–30 characters.');
    user.name = name;
  }
  if (patch.handle !== undefined) {
    const handle = patch.handle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,16}$/.test(handle)) fail('bad_handle', 'Username: 3–16 letters, numbers or underscores.');
    if (Object.values(db.users).some((u) => u.id !== userId && u.handle === handle)) fail('handle_taken', 'That username is taken.');
    user.handle = handle;
  }
  if (patch.hue !== undefined) user.hue = ((Math.round(patch.hue) % 360) + 360) % 360;
}

/** Opening a notification also records the read on the delivery it belongs to. */
function recordRead(db: DB, userId: string, batchId: string | undefined): void {
  if (!batchId) return;
  const batch = db.batches.find((b) => b.id === batchId);
  if (batch && !batch.readBy.includes(userId)) batch.readBy.push(userId);
}

export function markNotificationRead(db: DB, userId: string, id: string): void {
  const n = db.notifications.find((x) => x.id === id && x.userId === userId);
  if (!n || n.read) return;
  n.read = true;
  recordRead(db, userId, n.batchId);
}

export function markAllNotificationsRead(db: DB, userId: string): void {
  for (const n of db.notifications) {
    if (n.userId !== userId || n.read) continue;
    n.read = true;
    recordRead(db, userId, n.batchId);
  }
}

export { estimateDurationMinutes, isActiveMember };
