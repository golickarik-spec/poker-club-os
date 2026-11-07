/**
 * Domain model shared by the three applications (player, club console,
 * platform administration). Everything here is plain JSON so the whole
 * database can be persisted and restored.
 *
 * In the prototype this "database" lives in the browser. The shape is the one
 * a relational backend would use: clubs are tenants, and every club-scoped
 * record carries a `clubId`.
 */
import type { TournamentDraft } from './api.ts';
import type { BotStyle } from '../engine/bots.ts';
import type { HandEvent, Blinds } from '../engine/holdem.ts';
import type { VariantId } from '../engine/variants.ts';
import type { PresetId, TournamentStructure } from '../engine/structure.ts';

export type Lang = 'en' | 'he';

// ----- People -----------------------------------------------------------------

export type PlatformRole = 'platform_admin';
export type DemoIdentity = 'newcomer' | 'player' | 'owner' | 'other_owner' | 'tournament_manager' | 'platform_admin';

export interface User {
  id: string;
  name: string;
  handle: string;
  /** Avatar hue, 0–359. */
  hue: number;
  /** Simulated member. Always disclosed in the UI. */
  isBot: boolean;
  style: BotStyle;
  joinedAt: number;
  platformRole: PlatformRole | null;
  demoIdentity: DemoIdentity | null;
  /** Preferred language. A signed-in person's own setting (`UserSettings.lang`) takes precedence. */
  lang: Lang;
  /** Fictional contact address. Shown to a club's staff only when the member agreed to share it with that club. */
  email: string;
  /** Invitation link the account was created through, when known (attribution). */
  signupLinkId: string | null;
}

export type Role = 'owner' | 'manager' | 'tournament_manager' | 'support_agent' | 'player';
export const ROLES: readonly Role[] = ['owner', 'manager', 'tournament_manager', 'support_agent', 'player'];
/**
 * Club-level membership. `active` is what the product calls an approved member.
 * No row at all means "not a member". Approval is the club's own decision about
 * who may play; it is not identity verification.
 */
export type MemberStatus = 'active' | 'pending' | 'suspended' | 'rejected' | 'banned';

export interface Membership {
  clubId: string;
  userId: string;
  role: Role;
  status: MemberStatus;
  requestedAt: number;
  joinedAt: number | null;
  lastActiveAt: number;
  /** Non-redeemable demonstration points. No monetary value. */
  demoPoints: number;
  via: 'link' | 'club_id' | 'qr' | 'seed' | 'owner' | 'profile';
  /** When staff approved or declined the request (null while pending). */
  decidedAt: number | null;
  /** The member receives this club's announcements. */
  announcements: boolean;
  /** The member agreed to show their contact details to this club's staff. */
  shareContact: boolean;
}

/** A person following a club. Following never grants membership or tournament access. */
export interface Follow {
  clubId: string;
  userId: string;
  at: number;
  /** Opted in to this club's public announcements and tournament news. */
  notify: boolean;
}

// ----- Clubs (tenants) ----------------------------------------------------------

export type TableThemeId = 'midnight' | 'emerald' | 'royal' | 'burgundy' | 'graphite';
export type CoverPattern = 'constellation' | 'currents' | 'deco' | 'felt' | 'grid';
export type LogoGlyph = 'spade' | 'crown' | 'diamond' | 'club' | 'heart' | 'star' | 'moon' | 'wave';

export interface ClubBranding {
  accent: string;
  logo: { kind: 'glyph'; glyph: LogoGlyph } | { kind: 'monogram'; text: string } | { kind: 'image'; dataUrl: string };
  cover: { kind: 'pattern'; pattern: CoverPattern } | { kind: 'image'; dataUrl: string };
  tableTheme: TableThemeId;
  titleFont: 'sans' | 'serif';
  /** v0.3: the club's own saved table colour schemes, offered in the tournament wizard. */
  tablePresets?: TablePreset[];
}

/** A named felt + rail colour pair a club keeps for its tournaments. */
export interface TablePreset {
  id: string;
  name: string;
  colors: TableColors;
}

/** Free table colours: the felt cloth and the rail; everything else is derived. */
export interface TableColors {
  felt: string;
  rail: string;
}

export interface Club {
  id: string;
  /** Six-digit Club ID players type to join. */
  code: string;
  inviteToken: string;
  name: string;
  tagline: string;
  description: string;
  rules: string[];
  branding: ClubBranding;
  joinPolicy: 'open' | 'approval';
  /** Demo helper: simulated club staff approve join requests after a short delay. */
  simulatedStaff: boolean;
  status: 'active' | 'suspended';
  suspendedReason: string | null;
  ownerId: string;
  planId: PlanId;
  /** Per-tenant overrides of plan limits. */
  limitOverrides: Partial<PlanLimits>;
  createdAt: number;
  timezone: string;
  /** Points every member is topped back up to (demo allowance). */
  demoAllowance: number;
  /** Public location line, e.g. a city. Empty when the club does not show one. */
  location: string;
  social: Partial<Record<SocialKey, SocialLink>>;
  /** Show finished tournaments and the ranking on the public profile. */
  publicResults: boolean;
  /** Show the member count on the public profile. */
  publicMemberCount: boolean;
  /** Next club-specific member number to hand out. */
  nextMemberNo: number;
}

export type SocialKey = 'instagram' | 'telegram' | 'whatsapp' | 'tiktok' | 'facebook' | 'discord' | 'x' | 'website';
export const SOCIAL_KEYS: readonly SocialKey[] = ['instagram', 'telegram', 'whatsapp', 'tiktok', 'facebook', 'discord', 'x', 'website'];
export interface SocialLink {
  url: string;
  /** Shown on the public club profile. */
  public: boolean;
}

export type AnnouncementKind = 'tournament' | 'reminder' | 'schedule' | 'news' | 'community' | 'format' | 'maintenance';

/**
 * Who an announcement is for.
 *  - everyone:   approved members and followers; shown on the public profile
 *  - followers:  people who follow the club; shown on the public profile
 *  - members:    approved members only
 *  - segment:    the members of a CRM segment at the moment of sending
 *  - tournament: players registered for one tournament
 */
export interface AnnouncementAudience {
  type: 'everyone' | 'followers' | 'members' | 'segment' | 'tournament';
  segmentId?: string;
  tournamentId?: string;
}

export interface Announcement {
  id: string;
  /** Club id, or 'platform' for system-wide notices. */
  clubId: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  at: number;
  authorId: string;
  pinned: boolean;
  /** Set when the announcement was posted while publishing a tournament. */
  tournamentId?: string;
  audience: AnnouncementAudience;
  status: 'published' | 'scheduled';
  /** When a scheduled announcement goes out. */
  scheduledAt: number | null;
  /** Optional picture (data URL). */
  image: string | null;
  /** Send an in-app notification to the audience as well as posting it. */
  notify: boolean;
  /** Delivery record created when it was sent. */
  batchId: string | null;
  /** For segment and tournament audiences: the people it was addressed to when it went out. */
  targetIds?: string[];
}

/**
 * One send of something to many people: who was eligible, who actually got an
 * in-app notification, who had opted out, and who has read it. Announcement
 * figures are computed from this record and never estimated.
 */
export interface DeliveryBatch {
  id: string;
  clubId: string;
  kind: 'announcement' | 'reminder' | 'tournament' | 'welcome';
  refId: string;
  at: number;
  /** People in the audience when it was sent. */
  eligible: number;
  /** User ids whose in-app inbox received it. */
  delivered: string[];
  /** In the audience but opted out (notification preference or club opt-out). */
  optedOut: number;
  /** Failed deliveries. In-app delivery cannot fail in the prototype, so this stays 0. */
  errors: number;
  /** People who opened it. */
  readBy: string[];
  /** Simulated members marked as having read it by the demo's simulated activity. Always shown separately. */
  simulatedReadBy: string[];
}

// ----- Tournaments ---------------------------------------------------------------

export type TournamentStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'SEATING'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * A person's standing in one tournament. No row means "not registered".
 *  - requested:  asked for a seat; waiting for staff (holds no seat)
 *  - approved:   authorised by staff or by an invitation, seat not yet taken up
 *  - registered: holds a seat
 *  - waitlisted: authorised, but the tournament is full
 *  - rejected:   request declined
 *  - cancelled:  seat given up by the player, or revoked by staff (`cancelledBy`)
 */
export type RegistrationStatus = 'requested' | 'approved' | 'registered' | 'waitlisted' | 'rejected' | 'cancelled';

export interface Registration {
  userId: string;
  status: RegistrationStatus;
  at: number;
  /** Demo points charged (refunded on unregister / cancel / reject). */
  pointsPaid: number;
  decidedBy?: string | null;
  decidedAt?: number | null;
  cancelledBy?: 'player' | 'staff';
  /** Invitation link that authorised this person, if any. */
  viaLinkId?: string | null;
}

/** Who may see a tournament: approved members only, or anyone looking at the club's public profile. */
export type TournamentVisibility = 'private' | 'public';
/**
 * Who may take a seat. Every mode requires an approved club membership first.
 *  - members:  any approved member
 *  - approval: an approved member whose request staff accepted for this tournament
 *  - invite:   an approved member staff invited, or who holds a valid invitation link
 */
export type TournamentAccess = 'members' | 'approval' | 'invite';

export type BannerStyle = 'aurora' | 'ember' | 'tide' | 'onyx' | 'gilded';

export interface Tournament {
  id: string;
  clubId: string;
  name: string;
  description: string;
  banner: BannerStyle;
  format: 'mtt' | 'sng';
  /** The poker game dealt (v0.4). Absent on tournaments created earlier: No-Limit Texas Hold'em. */
  game?: VariantId;
  preset: PresetId;
  /** scheduled: starts at `startAt`. when_full: starts when the last seat fills. manual: staff press Start. */
  startMode: 'scheduled' | 'when_full' | 'manual';
  startAt: number;
  timezone: string;
  registrationOpensAt: number;
  minPlayers: number;
  maxPlayers: number;
  structure: TournamentStructure;
  /** 'none' is the only operational option; the others are shown as planned. */
  reentry: 'none';
  visibility: TournamentVisibility;
  access: TournamentAccess;
  /** Optional extra access code. It never replaces the membership and access checks. */
  accessCode: string | null;
  /** Entry requirement in demo points (0 = free). */
  entryPoints: number;
  status: TournamentStatus;
  /** v0.4: the recurring schedule that published it, if any. */
  scheduleId?: string;
  registrations: Registration[];
  createdBy: string;
  createdAt: number;
  publishedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  cancelReason: string | null;
  /** Wall-clock time at which the seating draw finishes and play starts. */
  seatingUntil: number | null;
  /** Demo helper: simulated members register over time. */
  simulateRegistrations: boolean;
  /** Share of seats simulated members aim to fill (0–1). */
  simulatedFill: number;
  /** Demo clock multiplier applied when the tournament starts. */
  demoSpeed: number;
  /** Seeded history rather than something played in this session. */
  seeded: boolean;
  /**
   * Table branding for this tournament (v0.3). Absent on older tournaments, which then show
   * the club's logo on the club's default felt — the same as `{ source: 'club' }`.
   */
  tableBranding?: TableBranding;
}

/** What players see in the centre of the felt. Opacity and scale are clamped by `TABLE_LOGO_LIMITS`. */
export interface TableBranding {
  /** club: the club's current logo. custom: the image below. hidden: no logo. */
  source: 'club' | 'custom' | 'hidden';
  /** Data URL of the tournament's own logo; only read when source is 'custom'. */
  logoDataUrl: string | null;
  /** 0.04–0.35; kept low so the mark never competes with cards and chips. */
  opacity: number;
  /** 0.5–1.4 × the default logo size. */
  scale: number;
  /** Felt and rail for this event: a built-in theme, the club default, a club preset, or free colours. */
  theme: TableThemeId | 'club' | 'custom' | `preset:${string}`;
  /** The free colours, read when theme is 'custom'. */
  colors?: TableColors;
}

export const TABLE_LOGO_LIMITS = { opacity: { min: 0.04, max: 0.35, default: 0.16 }, scale: { min: 0.5, max: 1.4, default: 1 }, maxBytes: 512 * 1024 } as const;

export const DEFAULT_TABLE_BRANDING: TableBranding = { source: 'club', logoDataUrl: null, opacity: TABLE_LOGO_LIMITS.opacity.default, scale: TABLE_LOGO_LIMITS.scale.default, theme: 'club' };
export const MAX_TABLE_PRESETS = 8;

export interface ResultPlace {
  place: number;
  userId: string;
  name: string;
  isBot: boolean;
  /** Club ranking points. A leaderboard score only — no monetary value. */
  points: number;
  bustedBy: string | null;
  bustLevel: number | null;
}

export interface TournamentResult {
  tournamentId: string;
  clubId: string;
  name: string;
  format: 'mtt' | 'sng';
  startedAt: number;
  completedAt: number;
  /** Tournament-clock duration in minutes. */
  durationMin: number;
  entrants: number;
  hands: number;
  totalChips: number;
  levelReached: number;
  places: ResultPlace[];
  /** True when the result was generated as demo history instead of being played by the engine. */
  seeded: boolean;
  /** v0.4: the poker game (absent on older records: Hold'em). */
  game?: VariantId;
  /** v0.4: set by staff after review; an invalidated result counts for nothing. */
  invalidated?: { at: number; by: string; reason: string } | null;
}

// ----- Competition (v0.4): leagues, seasons, achievements ---------------------------------

export type LeagueType = 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'custom' | 'series';
export type LeagueStatus = 'draft' | 'active' | 'completed' | 'archived';
export type LeagueScoringPreset = 'position' | 'performance' | 'wins_and_tables';

/** How a league turns finishes into points. Stored with the league and versioned: editing creates a new version. */
export interface LeagueScoring {
  preset: LeagueScoringPreset;
  /** Count only each player's best N results (0 = all). */
  bestN: number;
  /** Points for turning up at all, added per tournament (0 = none). */
  participation: number;
  /** Most tournaments that can earn participation points (0 = unlimited). */
  participationCap: number;
  /** Scale points by field size (performance preset always does). */
  fieldAdjusted: boolean;
  version: number;
}

export interface LeagueStandingRow {
  userId: string;
  name: string;
  isBot: boolean;
  hue: number;
  points: number;
  played: number;
  wins: number;
  finalTables: number;
  /** Counted results after the best-N rule. */
  counted: number;
  rank: number;
  /** Rank before the most recent counted tournament (null when new). */
  previousRank: number | null;
}

export interface League {
  id: string;
  clubId: string;
  name: string;
  description: string;
  cover: { kind: 'pattern'; pattern: CoverPattern } | { kind: 'image'; dataUrl: string };
  type: LeagueType;
  startAt: number;
  endAt: number;
  scoring: LeagueScoring;
  /** Tournaments explicitly assigned; with `includeAll`, every completed club tournament in the window counts too. */
  tournamentIds: string[];
  includeAll: boolean;
  eligibility: 'all_members' | 'selected';
  memberIds: string[];
  visibility: 'members' | 'public';
  status: LeagueStatus;
  createdBy: string;
  createdAt: number;
  /** Frozen when the season completes; never recalculated afterwards. */
  finalStandings: LeagueStandingRow[] | null;
  championId: string | null;
  completedAt: number | null;
}

export type AchievementKey =
  | 'first_tournament'
  | 'first_final_table'
  | 'first_win'
  | 'five_wins'
  | 'ten_final_tables'
  | 'season_champion'
  | 'club_champion'
  | 'multi_variant'
  | 'returning'
  | 'league_top10'
  | 'referral_first'
  | 'referral_five';

export type IntegritySignalType = 'bust_pattern' | 'co_finish' | 'win_rate';
export interface IntegritySignal {
  type: IntegritySignalType;
  /** 0–1. */
  strength: number;
  detail: Record<string, number>;
}
export type IntegrityStatus = 'new' | 'reviewing' | 'cleared' | 'escalated';
export interface IntegrityCase {
  id: string;
  /** Pair key or user id; one case per subject and club. */
  key: string;
  clubId: string;
  accounts: string[];
  signals: IntegritySignal[];
  score: number;
  tournamentIds: string[];
  status: IntegrityStatus;
  notes: { at: number; by: string; status: IntegrityStatus; text: string }[];
  createdAt: number;
  updatedAt: number;
  source: 'simulated_scan';
}

/** A saved tournament draft a club starts new tournaments from. */
export interface TournamentTemplate {
  id: string;
  clubId: string;
  name: string;
  /** A full draft with startAt / registrationOpensAt zeroed; the wizard fills them in. */
  draft: TournamentDraft;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** Publishes a tournament from a template on chosen weekdays at a club-local time. */
export interface RecurringSchedule {
  id: string;
  clubId: string;
  name: string;
  templateId: string;
  /** Club-local weekdays, 0 = Sunday. */
  weekdays: number[];
  hour: number;
  minute: number;
  leadDays: number;
  timezone: string;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  lastRunAt: number | null;
}

/** A person's own "remind me" for one tournament, delivered as an in-app notification. */
export interface PersonalReminder {
  id: string;
  userId: string;
  tournamentId: string;
  minutesBefore: number;
  /** The start the reminder was set against; follows a reschedule. */
  startAt: number;
  sentAt: number | null;
}

export interface AchievementAward {
  id: string;
  userId: string;
  key: AchievementKey;
  awardedAt: number;
  /** What earned it: a tournament, league or club. */
  source: { tournamentId?: string; leagueId?: string; clubId?: string };
}

export type PlayerTier = 'rookie' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master' | 'legend';

// ----- Communication ----------------------------------------------------------------

export type RouteRef = { name: string; params?: Record<string, string> };

export interface Notification {
  id: string;
  userId: string;
  at: number;
  kind: NotificationKind;
  /** Message key (see i18n `notif.*`) and its parameters, so notifications follow the reader's language. */
  key: string;
  params: Record<string, string | number>;
  read: boolean;
  link: RouteRef | null;
  /** The club the event belongs to, when there is one. */
  clubId?: string;
  /** Delivery record this notification is part of (announcements, reminders). */
  batchId?: string;
  /** Identifies the event that caused it; a second notification with the same key is not created. */
  dedupeKey?: string;
}

export type NotificationKind = 'membership' | 'tournament' | 'registration' | 'reminder' | 'announcement' | 'message' | 'system' | 'result' | 'support';

/** Which preference switch governs each kind of notification. `null` cannot be switched off. */
export type NotificationPref = 'announcements' | 'reminders' | 'messages' | 'membership' | 'registrations';
export const NOTIFICATION_PREFS: readonly NotificationPref[] = ['announcements', 'reminders', 'messages', 'membership', 'registrations'];
export const PREF_FOR_KIND: Record<NotificationKind, NotificationPref | null> = {
  announcement: 'announcements',
  reminder: 'reminders',
  message: 'messages',
  membership: 'membership',
  registration: 'registrations',
  tournament: 'registrations',
  result: 'registrations',
  system: null,
  support: null,
};

// ----- Club ↔ player messaging ----------------------------------------------------------

/** One conversation per club and player. Scoped to that club: no other club can read it. */
export interface Conversation {
  id: string;
  clubId: string;
  userId: string;
  status: 'open' | 'resolved';
  assignedTo: string | null;
  createdAt: number;
  lastMessageAt: number;
  /** Messages from the player the club has not read. */
  unreadClub: number;
  /** Messages from the club the player has not read. */
  unreadPlayer: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  clubId: string;
  from: 'player' | 'club' | 'system';
  authorId: string | null;
  body: string;
  at: number;
  /** Staff-only note inside the thread. Never delivered to the player. */
  internal: boolean;
  /** Sent by an automation rather than typed by a person. */
  automated: boolean;
  readAt: number | null;
}

export interface MessageBlock {
  clubId: string;
  userId: string;
  /** Who put the block in place. */
  by: 'club' | 'player';
  byUserId: string;
  at: number;
}

export interface AbuseReport {
  id: string;
  clubId: string;
  conversationId: string;
  reporterId: string;
  side: 'player' | 'club';
  reason: string;
  at: number;
  status: 'open' | 'reviewed';
}

export type TicketCategory = 'technical' | 'gameplay_bug' | 'feature_request' | 'account' | 'billing';
export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved';
export type TicketPriority = 'low' | 'normal' | 'high';

export interface SupportTicket {
  id: string;
  ref: string;
  clubId: string;
  authorId: string;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
  messages: { authorId: string; at: number; body: string; staff: boolean }[];
}

export interface AuditEntry {
  id: string;
  at: number;
  actorId: string;
  /** null for platform-level actions. */
  clubId: string | null;
  /** Action code (see i18n `audit.*`). */
  action: string;
  params: Record<string, string | number>;
}

// ----- Subscriptions (software rental between the platform and a club) -------------------

export type PlanId = 'starter' | 'professional' | 'enterprise';

export interface PlanLimits {
  members: number;
  monthlyActive: number;
  concurrentTables: number;
  tournamentsPerMonth: number;
  adminSeats: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  model: 'fixed' | 'per_active' | 'hybrid' | 'enterprise';
  /** Placeholder amounts in an unnamed currency. Not real prices. */
  baseFee: number;
  perActiveFee: number;
  includedActive: number;
  limits: PlanLimits;
  customBranding: boolean;
  reporting: 'basic' | 'advanced' | 'full';
  support: 'standard' | 'priority' | 'dedicated';
}

export interface Invoice {
  id: string;
  clubId: string;
  /** YYYY-MM */
  period: string;
  issuedAt: number;
  planId: PlanId;
  base: number;
  usage: number;
  activePlayers: number;
  total: number;
  status: 'paid' | 'due' | 'draft';
}

// ----- CRM (private to each club) -------------------------------------------------------

export type AcquisitionSource = 'instagram' | 'telegram' | 'whatsapp' | 'facebook' | 'tiktok' | 'friend' | 'website' | 'direct' | 'other' | 'unknown';
export const ACQUISITION_SOURCES: readonly AcquisitionSource[] = ['instagram', 'telegram', 'whatsapp', 'facebook', 'tiktok', 'friend', 'website', 'direct', 'other', 'unknown'];

/**
 * An invitation link. A club link carries a source label for attribution. A
 * tournament link authorises approved members to register for one invitation-only
 * tournament. Links can expire, be revoked, and be limited to a number of uses.
 */
export interface InviteLink {
  id: string;
  clubId: string;
  token: string;
  kind: 'club' | 'tournament';
  tournamentId: string | null;
  source: AcquisitionSource;
  label: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  maxUses: number | null;
  /** Times the link authorised someone (tournament links). */
  uses: number;
  /** v0.4: a member's personal invitation. The club sees who referred whom; the link never bypasses approval. */
  referrerId?: string | null;
  campaign?: string | null;
}

/**
 * The club's own record of a person: created the first time they follow,
 * request membership, open an invitation or write to the club. Survives the
 * person leaving, so history and the member number are kept.
 */
export interface CrmProfile {
  clubId: string;
  userId: string;
  /** Club-specific member number, assigned on first approval. */
  memberNo: number | null;
  firstSeenAt: number;
  tagIds: string[];
  assignedTo: string | null;
  /** Last time staff wrote to this person. */
  lastContactedAt: number | null;
  source: AcquisitionSource;
  linkId: string | null;
}

export type CrmEventType =
  | 'link_opened'
  | 'followed'
  | 'unfollowed'
  | 'membership_requested'
  | 'membership_cancelled'
  | 'membership_approved'
  | 'membership_rejected'
  | 'membership_suspended'
  | 'membership_reinstated'
  | 'membership_banned'
  | 'membership_unbanned'
  | 'membership_left'
  | 'role_changed'
  | 'tag_added'
  | 'tag_removed'
  | 'staff_assigned'
  | 'note_added'
  | 'tournament_requested'
  | 'tournament_registered'
  | 'tournament_approved'
  | 'tournament_rejected'
  | 'tournament_revoked'
  | 'tournament_waitlisted'
  | 'tournament_unregistered'
  | 'message_sent'
  | 'message_received';

/**
 * Append-only log of relationship events with their timestamps. Funnels and
 * timelines read from here. Tournament participation is deliberately not
 * logged: it is read from tournament records so it cannot drift from them.
 */
export interface CrmEvent {
  id: string;
  clubId: string;
  userId: string;
  type: CrmEventType;
  at: number;
  actorId: string | null;
  params: Record<string, string | number>;
}

export interface CrmTag {
  id: string;
  clubId: string;
  name: string;
  /** One of the tag palette keys. */
  color: TagColor;
  createdAt: number;
}
export type TagColor = 'slate' | 'blue' | 'teal' | 'green' | 'gold' | 'orange' | 'red' | 'violet' | 'pink';
export const TAG_COLORS: readonly TagColor[] = ['slate', 'blue', 'teal', 'green', 'gold', 'orange', 'red', 'violet', 'pink'];

export interface CrmNote {
  id: string;
  clubId: string;
  userId: string;
  authorId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Who wrote the current text. */
  updatedBy: string;
  /** Earlier versions, oldest first: the text, who wrote it and when. */
  history: { at: number; editorId: string; body: string }[];
}

export type LifecycleStage = 'new_follower' | 'interested' | 'approved' | 'first_time' | 'returning' | 'inactive';
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = ['new_follower', 'interested', 'approved', 'first_time', 'returning', 'inactive'];

export type SegmentField =
  | 'status'
  | 'lifecycle'
  | 'active'
  | 'follower'
  | 'tag'
  | 'language'
  | 'played_recent'
  | 'played_total'
  | 'wins'
  | 'approved_days'
  | 'last_played_days'
  | 'assigned'
  | 'source'
  /** v0.4: played at least one tournament of this poker family (holdem / omaha / …). */
  | 'game_family'
  /** v0.4: has a result counted in an active league season (yes / no). */
  | 'league'
  /** v0.4: arrived through a member's personal invitation (yes / no). */
  | 'referred';
export type SegmentOp = 'is' | 'is_not' | 'gte' | 'lte';

export interface SegmentRule {
  field: SegmentField;
  op: SegmentOp;
  value: string | number;
  /** Look-back period in days, for `played_recent`. */
  days?: number;
}

export interface CrmSegment {
  id: string;
  clubId: string;
  name: string;
  /** Dynamic segments are re-evaluated every time; a static one is a saved list of people. */
  kind: 'dynamic' | 'static';
  match: 'all' | 'any';
  rules: SegmentRule[];
  userIds: string[];
  /** Built-in segment key, or null for one the club made. */
  system: string | null;
  createdBy: string;
  createdAt: number;
}

export type AutomationKey = 'welcome' | 'reminder' | 'new_tournament' | 'membership_request' | 'inactive';
export const AUTOMATION_KEYS: readonly AutomationKey[] = ['welcome', 'reminder', 'new_tournament', 'membership_request', 'inactive'];

export interface AutomationRule {
  clubId: string;
  key: AutomationKey;
  enabled: boolean;
  /** welcome: the message text. */
  message: string;
  /** reminder: minutes before the start. */
  minutesBefore: number;
  /** inactive: days without playing. */
  inactiveDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface AutomationRun {
  id: string;
  clubId: string;
  key: AutomationKey;
  at: number;
  /** What set it off, as a message key with parameters. */
  trigger: { key: string; params: Record<string, string | number> };
  targets: number;
  delivered: number;
  skipped: number;
  status: 'ok' | 'nothing_to_do' | 'error';
  detail: string;
  /** One run per trigger: a second run with the same key is not started. */
  dedupeKey: string;
}

export interface CrmSettings {
  /** A player counts as active when they played within this many days. */
  activeDays: number;
  /** A player who has played before counts as inactive after this many days without playing. */
  inactiveDays: number;
  /** "New member" means approved within this many days. */
  newMemberDays: number;
  /** Activity events older than this many months are deleted (0 keeps everything). */
  retentionMonths: number;
}

export interface CrmStore {
  profiles: Record<string, CrmProfile>;
  events: CrmEvent[];
  tags: CrmTag[];
  notes: CrmNote[];
  segments: CrmSegment[];
  rules: AutomationRule[];
  runs: AutomationRun[];
  links: InviteLink[];
  settings: Record<string, CrmSettings>;
  /** v0.4: records brought in by the migration assistant; never accounts. */
  imports: ImportedRecord[];
}

/** One row of a club's imported member list, waiting for (or attached to) a real person. */
export interface ImportedRecord {
  id: string;
  clubId: string;
  batchId: string;
  name: string;
  email: string | null;
  memberNo: number | null;
  joinedAt: number | null;
  tags: string[];
  note: string | null;
  phone: string | null;
  status: 'unclaimed' | 'claimed';
  claimedBy: string | null;
  claimedAt: number | null;
  importedAt: number;
  importedBy: string;
  file: string;
}

// ----- Hand history -------------------------------------------------------------------

export interface HandRecord {
  id: string;
  userId: string;
  tournamentId: string;
  tournamentName: string;
  clubId: string;
  tableNo: number;
  handNo: number;
  at: number;
  maxSeats: number;
  heroSeat: number;
  blinds: Blinds;
  /** Seat → display name at the time of the hand. */
  names: Record<number, { name: string; isBot: boolean; userId: string }>;
  /** Events as the player was entitled to see them (opponents' cards only if shown). */
  events: HandEvent[];
  net: number;
  /** Short result label, e.g. "Pair of Kings". */
  heroHand: string | null;
}

// ----- Per-user preferences ---------------------------------------------------------------

export type DeckTheme = 'classic' | 'four_color';

export interface UserSettings {
  lang: Lang;
  tableTheme: TableThemeId | 'club';
  deck: DeckTheme;
  animations: 'full' | 'reduced';
  sound: boolean;
  showBigBlinds: boolean;
  confirmLargeBets: boolean;
  turnSeconds: number;
  notifications: Record<NotificationPref, boolean>;
  privacy: { showProfile: boolean; showStats: boolean };
  highContrast: boolean;
  /** v0.4: extra delivery channels (demo adapters; nothing is really sent in the prototype). */
  channels?: Partial<Record<NotificationChannel, boolean>>;
  /** v0.4 responsible play: a reminder every N minutes at the table (0 = off) and a self-set break. */
  responsible?: { sessionReminderMin: number; breakUntil: number | null; dailyMinutes: number };
}

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push';

/** A message handed to a channel adapter. In the prototype every non-in-app message is simulated. */
export interface OutboxMessage {
  id: string;
  at: number;
  channel: NotificationChannel;
  userId: string;
  key: string;
  params: Record<string, string | number>;
  clubId: string | null;
  status: 'delivered' | 'simulated' | 'failed';
  simulatedBy: 'demo_adapter' | null;
}

// ----- Platform ----------------------------------------------------------------------

export interface HealthService {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'down';
  latencyMs: number;
  uptime: number;
}

export interface DB {
  schema: number;
  seededAt: number;
  users: Record<string, User>;
  clubs: Record<string, Club>;
  memberships: Membership[];
  tournaments: Record<string, Tournament>;
  results: Record<string, TournamentResult>;
  announcements: Announcement[];
  notifications: Notification[];
  tickets: SupportTicket[];
  plans: Record<PlanId, Plan>;
  invoices: Invoice[];
  audit: AuditEntry[];
  hands: HandRecord[];
  /** v0.4 competition. */
  leagues: League[];
  achievements: AchievementAward[];
  reminders: PersonalReminder[];
  /** v0.4 scheduling. */
  templates: TournamentTemplate[];
  schedules: RecurringSchedule[];
  /** v0.4 integrity cases, derived from simulated history. */
  integrity: IntegrityCase[];
  /** v0.4 channel outbox (simulated external deliveries). */
  outbox: OutboxMessage[];
  follows: Follow[];
  conversations: Conversation[];
  messages: ChatMessage[];
  blocks: MessageBlock[];
  reports: AbuseReport[];
  batches: DeliveryBatch[];
  /** Failed and successful access-code attempts, for rate limiting. */
  accessAttempts: { tournamentId: string; userId: string; at: number; ok: boolean }[];
  /**
   * Each club's private CRM records. Application code outside `src/platform`
   * never reads this directly; it goes through `crm.ts`, which checks the
   * actor's permission in that club.
   */
  crm: CrmStore;
  settings: Record<string, UserSettings>;
  health: HealthService[];
  /** Lifetime counters shown on the platform overview (seeded demo figures plus this session). */
  counters: { handsDealt: number; tournamentsHosted: number; sessionHands: number; sessionEngineMs: number };
  nextId: number;
}

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(public permission: string) {
    super('forbidden', `You do not have permission to do that (${permission}).`);
    this.name = 'ForbiddenError';
  }
}
