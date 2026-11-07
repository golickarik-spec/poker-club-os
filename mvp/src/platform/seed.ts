/**
 * Demonstration data.
 *
 * Everything created here is fictional: three clubs, the people around them,
 * months of tournament history, CRM records, conversations, support tickets
 * and subscription records. Accounts other than the six demo identities are
 * simulated and flagged `isBot` so the UI can always disclose them. Times are
 * generated relative to "now" so the schedule always has something about to
 * start.
 *
 * The history is generated as *records*, not as chart figures: each simulated
 * person gets a journey (opened an invitation, followed, asked to join, was
 * approved, played or did not), and every past tournament gets a result with
 * its entrants. Reports are then computed from those records exactly as they
 * are for activity in the session. Seeded results carry `seeded: true`.
 */
import type { VariantId } from '../engine/variants.ts';
import { BOT_STYLES, botContext, chooseBotAction } from '../engine/bots.ts';
import { describeHand } from '../engine/evaluator.ts';
import { applyAction, createTable, handInProgress, occupiedSeats, seatPlayer, startHand } from '../engine/holdem.ts';
import { seededRng, shuffleInPlace, type Rng } from '../engine/rng.ts';
import { blindsAt, presetStructure, type PresetId } from '../engine/structure.ts';
import { redactEvent } from '../engine/view.ts';
import { compute } from './analytics.ts';
import { leagueStandings } from './competition.ts';
import { draftOf, publishAnnouncement, rankingPoints, type AnnouncementInput } from './api.ts';
import { seedScan } from './integrity.ts';
import { clock, profileKey } from './core.ts';
import { addNote, applyTag, initClubCrm } from './crm.ts';
import { sendClubMessage, sendPlayerMessage, setConversationStatus } from './messaging.ts';
import type {
  League,
  AcquisitionSource,
  BannerStyle,
  Club,
  CrmEvent,
  CrmEventType,
  DB,
  HandRecord,
  Lang,
  Membership,
  Plan,
  PlanId,
  Registration,
  Role,
  Tournament,
  TournamentResult,
  TournamentStatus,
  User,
  UserSettings,
} from './types.ts';

export const SCHEMA_VERSION = 7;

/** Human staff who also play in their own club's demo history (never Daniel, who has no club yet). */
const STAFF_PLAYERS: Record<string, string[]> = {
  c_midnight: ['u_owner'],
  c_river: ['u_dana', 'u_tm'],
  c_final: [],
};

export const DEMO_USERS = {
  newcomer: 'u_daniel',
  player: 'u_player',
  owner: 'u_owner',
  other_owner: 'u_dana',
  tournament_manager: 'u_tm',
  platform_admin: 'u_admin',
} as const;

/** Named simulated members of Midnight Poker Club used by the guided demo. */
export const CAST = { david: 'u_david', sarah: 'u_sarah', jonathan: 'u_jonathan' } as const;

export const CLUB_IDS = { midnight: 'c_midnight', river: 'c_river', final: 'c_final' } as const;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

type Preset = Exclude<PresetId, 'custom'>;

const FIRST = [
  'Noam', 'Yael', 'Eitan', 'Tamar', 'Omer', 'Shira', 'Itai', 'Lior', 'Amit', 'Dana', 'Roni', 'Gal', 'Ido', 'Yoni', 'Tal', 'Nadav', 'Hila',
  'Guy', 'Michal', 'Oren', 'Adi', 'Asaf', 'Keren', 'Uri', 'Liat', 'Erez', 'Sivan', 'Barak', 'Neta', 'Liam', 'Emma', 'Lucas', 'Sofia',
  'Mateo', 'Olivia', 'Ethan', 'Chloe', 'Hugo', 'Elena', 'Marco', 'Nina', 'Felix', 'Clara', 'Diego', 'Anna', 'Viktor', 'Ines', 'Jonas',
  'Lea', 'Pavel', 'Mila', 'Andre', 'Zoe', 'Kenji', 'Aiko', 'Ravi', 'Priya', 'Omar', 'Layla', 'Chen', 'Mei', 'Sam', 'Ruth', 'Ben', 'Ella',
  'Max', 'Ida', 'Leo', 'Eva', 'Theo', 'Iris', 'Amos', 'Naomi',
];
/** The first names up to this index are common Hebrew names; those accounts mostly use the Hebrew interface. */
const HEBREW_NAMES = 29;
const LAST = [
  'Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Dahan', 'Avraham', 'Friedman', 'Azulay', 'Shapira', 'Golan', 'Ben-David', 'Sasson',
  'Navon', 'Harel', 'Weiss', 'Romano', 'Silva', 'Novak', 'Petrov', 'Lindqvist', 'Moreau', 'Fischer', 'Tanaka', 'Kapoor', 'Haddad', 'Wang',
  'Okafor', 'Reyes', 'Marin', 'Kowalski', 'Jensen', 'Costa', 'Dubois', 'Keller', 'Vargas', 'Ivanov', 'Rossi', 'Schmidt', 'Aaltonen',
  'Nakamura', 'Bianchi', 'Molina', 'Larsen', 'Popescu', 'Hoffman', 'Sato', 'Mercer', 'Quinn', 'Segal', 'Amar', 'Tzur',
];

export const DEFAULT_SETTINGS: UserSettings = {
  lang: 'en',
  tableTheme: 'club',
  deck: 'four_color',
  animations: 'full',
  sound: false,
  showBigBlinds: false,
  confirmLargeBets: true,
  turnSeconds: 25,
  notifications: { announcements: true, reminders: true, messages: true, membership: true, registrations: true },
  privacy: { showProfile: true, showStats: true },
  highContrast: false,
  channels: {},
  responsible: { sessionReminderMin: 0, breakUntil: null, dailyMinutes: 0 },
};

export const DEFAULT_PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    model: 'fixed',
    baseFee: 100,
    perActiveFee: 0,
    includedActive: 0,
    limits: { members: 100, monthlyActive: 75, concurrentTables: 6, tournamentsPerMonth: 30, adminSeats: 3 },
    customBranding: false,
    reporting: 'basic',
    support: 'standard',
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    model: 'hybrid',
    baseFee: 300,
    perActiveFee: 1.5,
    includedActive: 150,
    limits: { members: 500, monthlyActive: 400, concurrentTables: 30, tournamentsPerMonth: 150, adminSeats: 10 },
    customBranding: true,
    reporting: 'advanced',
    support: 'priority',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    model: 'enterprise',
    baseFee: 1200,
    perActiveFee: 1,
    includedActive: 1000,
    limits: { members: 5000, monthlyActive: 4000, concurrentTables: 200, tournamentsPerMonth: 1000, adminSeats: 50 },
    customBranding: true,
    reporting: 'full',
    support: 'dedicated',
  },
};

// ---------------------------------------------------------------------------
// How a simulated person relates to one club
// ---------------------------------------------------------------------------

/** How often someone plays once they are a member. */
type PlayStyle = 'never' | 'once' | 'regular' | 'casual' | 'rare' | 'churned' | 'hero';

interface Journey {
  userId: string;
  source: AcquisitionSource;
  linkId: string | null;
  openedAt: number | null;
  followedAt: number | null;
  unfollowedAt: number | null;
  requestedAt: number | null;
  via: Membership['via'];
  outcome: 'approved' | 'rejected' | 'cancelled' | 'pending' | null;
  decidedAt: number | null;
  /** What became of an approved membership. */
  ended: { type: 'left' | 'suspended' | 'banned'; at: number } | null;
  role: Role;
  play: PlayStyle;
  /** `once` players: the earliest moment they would turn up. */
  onceAfter: number;
  playedOnce: boolean;
  churnAt: number | null;
  followNotify: boolean;
}

interface LinkSeed {
  source: AcquisitionSource;
  label: string;
  token: string;
  /** Days after the club opened that the link was made. */
  madeAfterDays?: number;
  expiredDaysAgo?: number;
  revokedDaysAgo?: number;
}

interface ClubConfig {
  club: Club;
  lifetimeDays: number;
  /** Simulated people who discover the club over its lifetime (besides the founders). */
  journeys: number;
  /** Share whose first step is following (the rest ask to join straight away). */
  followFirst: number;
  /** Share of followers who go on to ask for membership. */
  requestRate: number;
  founders: number;
  staff: Role[];
  rotation: [string, Preset, VariantId?][];
  /** Tournaments per day today; the club started with fewer. */
  perDay: number;
  flagship: string;
  links: LinkSeed[];
  sources: [AcquisitionSource, number][];
  recentPending: number;
}

const PLAY_RATE: Record<PlayStyle, number> = { never: 0, once: 0, regular: 0.66, casual: 0.26, rare: 0.07, churned: 0.4, hero: 0 };

function weighted<T>(rng: Rng, options: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of options) total += w;
  let x = rng.float() * total;
  for (const [value, w] of options) {
    x -= w;
    if (x < 0) return value;
  }
  return options[options.length - 1]![0];
}

export function createSeedDb(now: number = Date.now()): DB {
  const rng = seededRng(20261012);
  const db: DB = {
    schema: SCHEMA_VERSION,
    seededAt: now,
    users: {},
    clubs: {},
    memberships: [],
    tournaments: {},
    results: {},
    announcements: [],
    notifications: [],
    tickets: [],
    plans: structuredClone(DEFAULT_PLANS),
    invoices: [],
    audit: [],
    hands: [],
    leagues: [],
    achievements: [],
    reminders: [],
    templates: [],
    schedules: [],
    integrity: [],
    outbox: [],
    follows: [],
    conversations: [],
    messages: [],
    blocks: [],
    reports: [],
    batches: [],
    accessAttempts: [],
    crm: { profiles: {}, events: [], tags: [], notes: [], segments: [], rules: [], runs: [], links: [], settings: {}, imports: [] },
    settings: {},
    health: [
      { id: 'api', name: 'API gateway', status: 'operational', latencyMs: 42, uptime: 99.98 },
      { id: 'realtime', name: 'Real-time gateway', status: 'operational', latencyMs: 28, uptime: 99.97 },
      { id: 'tables', name: 'Table servers', status: 'operational', latencyMs: 19, uptime: 99.99 },
      { id: 'scheduler', name: 'Tournament scheduler', status: 'operational', latencyMs: 55, uptime: 99.95 },
      { id: 'db', name: 'Primary database', status: 'operational', latencyMs: 7, uptime: 99.99 },
      { id: 'rng', name: 'Shuffle service', status: 'operational', latencyMs: 3, uptime: 100 },
      { id: 'analytics', name: 'Analytics pipeline', status: 'degraded', latencyMs: 480, uptime: 99.41 },
    ],
    counters: { handsDealt: 1_284_560, tournamentsHosted: 3_412, sessionHands: 0, sessionEngineMs: 0 },
    nextId: 1000,
  };

  /** Run service functions as if it were another moment, so seeded records carry believable times. */
  const at = <T>(time: number, fn: () => T): T => {
    const real = clock.now;
    clock.now = () => time;
    try {
      return fn();
    } finally {
      clock.now = real;
    }
  };

  // ----- Demo identities -----------------------------------------------------
  const person = (id: string, name: string, handle: string, hue: number, joinedDaysAgo: number, extra: Partial<User> = {}): User => ({
    id,
    name,
    handle,
    hue,
    isBot: false,
    style: 'balanced',
    joinedAt: now - joinedDaysAgo * DAY,
    platformRole: null,
    demoIdentity: null,
    lang: 'en',
    email: `${handle}@example.com`,
    signupLinkId: null,
    ...extra,
  });
  const people: User[] = [
    person(DEMO_USERS.newcomer, 'Daniel Levy', 'daniel', 26, 2, { demoIdentity: 'newcomer' }),
    person(DEMO_USERS.player, 'Alex Morgan', 'alexm', 172, 190, { demoIdentity: 'player' }),
    person(DEMO_USERS.owner, 'Michael Katz', 'michaelk', 228, 200, { demoIdentity: 'owner' }),
    person(DEMO_USERS.other_owner, 'Dana Marin', 'danam', 152, 230, { demoIdentity: 'other_owner' }),
    person(DEMO_USERS.tournament_manager, 'Maya Shapiro', 'mayash', 318, 210, { demoIdentity: 'tournament_manager' }),
    person(DEMO_USERS.platform_admin, 'Jordan Lee', 'jordan', 40, 400, { demoIdentity: 'platform_admin', platformRole: 'platform_admin' }),
  ];
  for (const u of people) {
    db.users[u.id] = u;
    db.settings[u.id] = structuredClone(DEFAULT_SETTINGS);
  }
  // The named simulated cast of the guided demo.
  const cast: User[] = [
    person(CAST.david, 'David Stern', 'davids', 204, 14, { isBot: true, style: 'balanced' }),
    person(CAST.sarah, 'Sarah Klein', 'sarahk', 336, 150, { isBot: true, style: 'balanced' }),
    person(CAST.jonathan, 'Jonathan Reed', 'jonreed', 96, 16, { isBot: true, style: 'balanced' }),
    person('u_fowner', 'Ruth Segal', 'ruths', 44, 170, { isBot: true, style: 'balanced' }),
  ];
  for (const u of cast) db.users[u.id] = u;

  // ----- Simulated accounts ---------------------------------------------------
  const bots: User[] = [];
  const usedNames = new Set([...people, ...cast].map((p) => p.name));
  const usedHandles = new Set([...people, ...cast].map((p) => p.handle));
  while (bots.length < 500) {
    const firstIndex = rng.int(FIRST.length);
    const first = FIRST[firstIndex]!;
    const last = LAST[rng.int(LAST.length)]!;
    const name = `${first} ${last}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    let handle = `${first}${last[0]}`.toLowerCase().replace(/[^a-z]/g, '');
    if (usedHandles.has(handle)) handle = `${handle}${10 + rng.int(89)}`;
    if (usedHandles.has(handle)) continue;
    usedHandles.add(handle);
    const lang: Lang = rng.float() < (firstIndex < HEBREW_NAMES ? 0.8 : 0.08) ? 'he' : 'en';
    const u: User = {
      id: `u_b${bots.length + 1}`,
      name,
      handle,
      hue: rng.int(360),
      isBot: true,
      style: BOT_STYLES[rng.int(BOT_STYLES.length)]!,
      joinedAt: now - (220 + rng.int(200)) * DAY,
      platformRole: null,
      demoIdentity: null,
      lang,
      email: `${handle}@example.com`,
      signupLinkId: null,
    };
    bots.push(u);
    db.users[u.id] = u;
  }

  // ----- Clubs ------------------------------------------------------------
  const clubBase = { simulatedStaff: false, status: 'active' as const, suspendedReason: null, limitOverrides: {}, timezone: 'Asia/Jerusalem', demoAllowance: 10_000, nextMemberNo: 1 };
  const configs: ClubConfig[] = [
    {
      club: {
        ...clubBase,
        id: CLUB_IDS.midnight,
        code: '482913',
        inviteToken: 'midnight-482',
        name: 'Midnight Poker Club',
        tagline: 'Serious tournaments after dark.',
        description:
          'A tournament-first community. Deep structures, punctual starts and a ranking that rewards showing up week after week. Membership is by approval.',
        rules: [
          'One account per person. Shared or duplicate accounts are removed.',
          'Tournaments start on time. Late registration is shown in each lobby.',
          'Keep table chat respectful. Club staff may mute or suspend.',
          'Chips and demo points have no monetary value and cannot be transferred.',
          'Suspected collusion is reviewed by club staff and the platform integrity team.',
        ],
        branding: { accent: '#E2B35A', logo: { kind: 'glyph', glyph: 'moon' }, cover: { kind: 'pattern', pattern: 'constellation' }, tableTheme: 'midnight', titleFont: 'sans' },
        joinPolicy: 'approval',
        ownerId: DEMO_USERS.owner,
        planId: 'professional',
        createdAt: now - 182 * DAY,
        location: 'Tel Aviv',
        social: {
          instagram: { url: 'https://instagram.com/midnightpoker.example', public: true },
          telegram: { url: 'https://t.me/midnightpoker_example', public: true },
          whatsapp: { url: 'https://wa.me/0000000000', public: false },
          website: { url: 'https://midnightpoker.example/', public: true },
        },
        publicResults: true,
        publicMemberCount: true,
      },
      lifetimeDays: 182,
      journeys: 262,
      followFirst: 0.72,
      requestRate: 0.6,
      founders: 16,
      staff: ['manager', 'tournament_manager', 'support_agent', 'support_agent'],
      rotation: [
        ['Midnight Express Turbo', 'turbo'],
        ['The Midnight Main Event', 'regular'],
        ['Six-Max Sit & Go', 'sng'],
        ['Deep Stack Thursday', 'deep'],
        ['Midnight Express Turbo', 'turbo'],
        ['Six-Max Sit & Go', 'sng'],
        ['The Midnight Main Event', 'regular'],
        ['Midnight Omaha Night', 'regular', 'plo4'],
      ],
      perDay: 0.5,
      flagship: 'The Midnight Main Event',
      links: [
        { source: 'instagram', label: 'Instagram bio', token: 'mpc-instagram' },
        { source: 'whatsapp', label: 'WhatsApp community', token: 'mpc-whatsapp' },
        { source: 'telegram', label: 'Telegram channel', token: 'mpc-telegram' },
        { source: 'friend', label: 'Bring a friend', token: 'mpc-friends' },
        { source: 'website', label: 'Website button', token: 'mpc-website' },
        { source: 'facebook', label: 'Facebook page', token: 'mpc-facebook', madeAfterDays: 40 },
        { source: 'tiktok', label: 'TikTok spring clips', token: 'mpc-tiktok', madeAfterDays: 60, expiredDaysAgo: 30 },
        { source: 'other', label: 'Flyer QR, old design', token: 'mpc-flyer', madeAfterDays: 10, revokedDaysAgo: 75 },
      ],
      sources: [['instagram', 24], ['whatsapp', 18], ['telegram', 10], ['friend', 13], ['website', 5], ['facebook', 5], ['tiktok', 4], ['other', 2], ['direct', 7], ['unknown', 12]],
      recentPending: 4,
    },
    {
      club: {
        ...clubBase,
        id: CLUB_IDS.river,
        code: '731056',
        inviteToken: 'river-kings-731',
        name: 'River Kings',
        tagline: 'A tournament every day, and then another.',
        description:
          'The busiest club on the platform: daily turbos, lunch-break sit & gos and a nightly deep stack. Open to everyone: join and play in under a minute.',
        rules: [
          'Open membership: anyone with the Club ID can join.',
          'Be on time. Blinds do not wait.',
          'No abuse in chat. Three warnings lead to suspension.',
          'Chips and demo points have no monetary value and cannot be transferred.',
        ],
        branding: { accent: '#2FB37F', logo: { kind: 'glyph', glyph: 'crown' }, cover: { kind: 'pattern', pattern: 'currents' }, tableTheme: 'emerald', titleFont: 'sans' },
        joinPolicy: 'open',
        ownerId: DEMO_USERS.other_owner,
        planId: 'enterprise',
        createdAt: now - 205 * DAY,
        location: 'Haifa',
        social: { instagram: { url: 'https://instagram.com/riverkings.example', public: true }, discord: { url: 'https://discord.gg/riverkings-example', public: true } },
        publicResults: true,
        publicMemberCount: true,
      },
      lifetimeDays: 205,
      journeys: 300,
      followFirst: 0.34,
      requestRate: 0.74,
      founders: 20,
      staff: ['manager', 'manager', 'support_agent', 'support_agent', 'support_agent'],
      rotation: [
        ['River Kings Daily Turbo', 'turbo'],
        ['Lunch Break Sit & Go', 'sng'],
        ['Kings Nightly Deepstack', 'deep'],
        ['River Kings Daily Turbo', 'turbo'],
        ['Kings Hourly Turbo', 'turbo'],
        ['Kings Weekend Special', 'regular'],
        ['Omaha Six-Max Sit & Go', 'sng', 'plo4'],
      ],
      perDay: 0.5,
      flagship: 'Kings Weekend Special',
      links: [
        { source: 'instagram', label: 'Instagram', token: 'rk-instagram' },
        { source: 'telegram', label: 'Telegram', token: 'rk-telegram' },
        { source: 'friend', label: 'Referral', token: 'rk-friends' },
      ],
      sources: [['instagram', 20], ['telegram', 14], ['friend', 16], ['direct', 22], ['unknown', 28]],
      recentPending: 0,
    },
    {
      club: {
        ...clubBase,
        id: CLUB_IDS.final,
        code: '205877',
        inviteToken: 'the-final-table-205',
        name: 'The Final Table',
        tagline: 'A small room for players who study the game.',
        description:
          'Thirty-odd members, one table size, slow structures. We run fewer tournaments and take our time over each one. New members are introduced by an existing member.',
        rules: [
          'Membership by introduction and approval.',
          'Deep structures only. No turbos.',
          'Hand discussion is welcome after the tournament, not during it.',
          'Chips and demo points have no monetary value and cannot be transferred.',
        ],
        branding: { accent: '#E0485A', logo: { kind: 'glyph', glyph: 'diamond' }, cover: { kind: 'pattern', pattern: 'deco' }, tableTheme: 'burgundy', titleFont: 'serif' },
        joinPolicy: 'approval',
        simulatedStaff: true,
        ownerId: 'u_fowner',
        planId: 'starter',
        createdAt: now - 150 * DAY,
        location: 'Jerusalem',
        social: {},
        publicResults: false,
        publicMemberCount: false,
      },
      lifetimeDays: 150,
      journeys: 46,
      followFirst: 0.5,
      requestRate: 0.7,
      founders: 12,
      staff: ['manager', 'support_agent'],
      rotation: [
        ['Final Table Classic', 'regular'],
        ['Gold Room Sit & Go', 'sng'],
        ['The Long Game', 'deep'],
        ['Final Table Classic', 'regular'],
      ],
      perDay: 0.2,
      flagship: 'Final Table Classic',
      links: [{ source: 'friend', label: 'Member introduction', token: 'ft-intro' }],
      sources: [['friend', 60], ['direct', 15], ['unknown', 25]],
      recentPending: 2,
    },
  ];

  const events: Omit<CrmEvent, 'id'>[] = [];
  const event = (clubId: string, userId: string, type: CrmEventType, time: number, actorId: string | null, params: Record<string, string | number> = {}): void => {
    events.push({ clubId, userId, type, at: time, actorId, params });
  };
  /** Each account's earliest contact with any club, to keep "account created" before it. */
  const firstContact = new Map<string, number>();
  const journeysByClub: Record<string, Journey[]> = {};
  const linkIds: Record<string, Map<AcquisitionSource, string>> = {};
  let linkSeq = 0;

  const blank = (userId: string): Journey => ({
    userId,
    source: 'unknown',
    linkId: null,
    openedAt: null,
    followedAt: null,
    unfollowedAt: null,
    requestedAt: null,
    via: 'seed',
    outcome: null,
    decidedAt: null,
    ended: null,
    role: 'player',
    play: 'never',
    onceAfter: 0,
    playedOnce: false,
    churnAt: null,
    followNotify: true,
  });

  for (const cfg of configs) {
    const { club } = cfg;
    db.clubs[club.id] = club;
    initClubCrm(db, club.id, club.createdAt);
    const crng = seededRng(Number(club.code));
    const opened = club.createdAt;
    const life = cfg.lifetimeDays * DAY;

    // Invitation links with source labels.
    const sourceLink = new Map<AcquisitionSource, string>();
    for (const l of cfg.links) {
      const createdAt = opened + (l.madeAfterDays ?? 0) * DAY + HOUR;
      const id = `lnk_S${++linkSeq}`;
      db.crm.links.push({
        id,
        clubId: club.id,
        token: l.token,
        kind: 'club',
        tournamentId: null,
        source: l.source,
        label: l.label,
        createdBy: club.ownerId,
        createdAt,
        expiresAt: l.expiredDaysAgo ? now - l.expiredDaysAgo * DAY : null,
        revokedAt: l.revokedDaysAgo ? now - l.revokedDaysAgo * DAY : null,
        maxUses: null,
        uses: 0,
      });
      sourceLink.set(l.source, id);
    }
    linkIds[club.id] = sourceLink;
    const linkWindow = (source: AcquisitionSource): [number, number] => {
      const l = cfg.links.find((x) => x.source === source);
      if (!l) return [opened, now];
      const from = opened + (l.madeAfterDays ?? 0) * DAY + HOUR;
      const to = now - Math.max(l.expiredDaysAgo ?? 0, l.revokedDaysAgo ?? 0) * DAY;
      return [from, to];
    };

    const journeys: Journey[] = [];
    const pool = shuffleInPlace([...bots], seededRng(club.code.length + Number(club.code)));
    let cursor = 0;
    const nextBot = (): string => pool[cursor++ % pool.length]!.id;

    const approveAt = (j: Journey, time: number): void => {
      j.outcome = 'approved';
      j.decidedAt = time;
    };

    // Founders: the owner, the staff and the first members, all there from the first days.
    const owner = blank(club.ownerId);
    owner.role = 'owner';
    owner.via = 'owner';
    owner.requestedAt = opened;
    approveAt(owner, opened);
    journeys.push(owner);
    for (let i = 0; i < cfg.founders; i++) {
      const j = blank(nextBot());
      j.role = cfg.staff[i] ?? 'player';
      j.source = 'friend';
      j.linkId = sourceLink.get('friend') ?? null;
      j.via = 'link';
      j.requestedAt = opened + (0.2 + crng.float() * 9) * DAY;
      approveAt(j, j.requestedAt + (1 + crng.float() * 20) * HOUR);
      if (crng.float() < 0.6) j.followedAt = j.requestedAt + crng.float() * 6 * DAY;
      j.play = weighted(crng, [['regular', 45], ['casual', 35], ['rare', 12], ['churned', 8]] as const);
      if (j.role !== 'player') j.play = crng.float() < 0.5 ? 'casual' : 'rare';
      if (j.play === 'churned') j.churnAt = j.decidedAt! + (40 + crng.float() * 60) * DAY;
      journeys.push(j);
    }

    // Everyone else discovers the club over its lifetime, more of them recently than at the start.
    for (let i = 0; i < cfg.journeys; i++) {
      const j = blank(nextBot());
      j.source = weighted(crng, cfg.sources);
      let firstAt = now - life * (1 - Math.pow(crng.float(), 0.62)) + 8 * DAY * crng.float();
      firstAt = Math.min(now - 20 * MIN, Math.max(opened + 10 * DAY, firstAt));
      if (sourceLink.has(j.source)) {
        const [from, to] = linkWindow(j.source);
        if (firstAt < from || firstAt > to) {
          // The link did not exist (or no longer worked) then, so this person cannot have come through it.
          j.source = 'unknown';
        } else {
          j.linkId = sourceLink.get(j.source)!;
          j.openedAt = firstAt;
          j.via = 'link';
        }
      } else if (j.source === 'direct') j.via = 'club_id';
      else j.via = 'profile';

      const followsFirst = crng.float() < cfg.followFirst;
      if (followsFirst) {
        j.followedAt = firstAt + crng.float() * 2 * HOUR;
        j.followNotify = crng.float() < 0.78;
        if (crng.float() < cfg.requestRate) {
          const r = crng.float();
          const delay = r < 0.58 ? crng.float() * 3 * DAY : r < 0.9 ? (3 + crng.float() * 11) * DAY : (14 + crng.float() * 40) * DAY;
          j.requestedAt = j.followedAt + delay;
        }
      } else {
        j.requestedAt = firstAt + crng.float() * HOUR;
        if (crng.float() < 0.45) j.followedAt = j.requestedAt + crng.float() * 10 * DAY;
      }
      if (j.followedAt !== null && j.followedAt > now) j.followedAt = null;
      if (j.requestedAt !== null && j.requestedAt > now) j.requestedAt = null;

      if (j.requestedAt !== null) {
        if (club.joinPolicy === 'open') approveAt(j, j.requestedAt);
        else {
          const decision = j.requestedAt + (1 + crng.float() * 40) * HOUR;
          const r = crng.float();
          if (r < 0.045) {
            j.outcome = 'cancelled';
            j.decidedAt = Math.min(now - MIN, j.requestedAt + crng.float() * 20 * HOUR);
          } else if (decision > now) j.outcome = 'pending';
          else if (r < 0.15) {
            j.outcome = 'rejected';
            j.decidedAt = decision;
          } else approveAt(j, decision);
        }
      }
      if (j.outcome === 'approved') {
        j.play = weighted(crng, [['never', 22], ['once', 20], ['regular', 16], ['casual', 25], ['rare', 12], ['churned', 5]] as const);
        if (j.play === 'once') j.onceAfter = j.decidedAt! + (0.5 + crng.float() * 16) * DAY;
        if (j.play === 'churned') j.churnAt = j.decidedAt! + (18 + crng.float() * 50) * DAY;
        if (crng.float() < 0.025 && now - j.decidedAt! > 30 * DAY) j.ended = { type: 'left', at: j.decidedAt! + (20 + crng.float() * 0.6 * ((now - j.decidedAt!) / DAY - 20)) * DAY };
      }
      if (j.followedAt !== null && crng.float() < 0.07 && now - j.followedAt > 12 * DAY) j.unfollowedAt = j.followedAt + (5 + crng.float() * ((now - j.followedAt) / DAY - 6)) * DAY;
      journeys.push(j);
    }

    // A few applications from the last hours, still waiting for a decision.
    if (club.joinPolicy === 'approval') {
      for (let i = 0; i < cfg.recentPending; i++) {
        const j = blank(nextBot());
        j.source = weighted(crng, cfg.sources);
        const requestedAt = now - (25 + crng.int(420)) * MIN;
        if (sourceLink.has(j.source) && linkWindow(j.source)[1] >= requestedAt) {
          j.linkId = sourceLink.get(j.source)!;
          j.openedAt = requestedAt - (3 + crng.int(600)) * MIN;
          j.via = 'link';
        } else j.source = 'unknown';
        if (i % 2 === 0) j.followedAt = requestedAt - (1 + crng.int(48)) * HOUR;
        j.requestedAt = requestedAt;
        j.outcome = 'pending';
        journeys.push(j);
      }
    }
    journeysByClub[club.id] = journeys;
  }

  // ----- The demo identities and named cast, placed by hand -------------------------------
  const place = (clubId: string, j: Journey): Journey => {
    journeysByClub[clubId]!.push(j);
    return j;
  };
  const midnightLinks = linkIds[CLUB_IDS.midnight]!;
  {
    const alex = blank(DEMO_USERS.player);
    alex.source = 'instagram';
    alex.linkId = midnightLinks.get('instagram')!;
    alex.via = 'link';
    alex.openedAt = now - 99 * DAY;
    alex.followedAt = now - 99 * DAY + 20 * MIN;
    alex.requestedAt = now - 96 * DAY - 5 * HOUR;
    alex.outcome = 'approved';
    alex.decidedAt = now - 96 * DAY;
    alex.play = 'hero';
    place(CLUB_IDS.midnight, alex);

    const alexRiver = blank(DEMO_USERS.player);
    alexRiver.source = 'direct';
    alexRiver.via = 'club_id';
    alexRiver.requestedAt = now - 143 * DAY;
    alexRiver.outcome = 'approved';
    alexRiver.decidedAt = now - 143 * DAY;
    alexRiver.play = 'hero';
    place(CLUB_IDS.river, alexRiver);

    const maya = blank(DEMO_USERS.tournament_manager);
    maya.role = 'tournament_manager';
    maya.source = 'friend';
    maya.linkId = linkIds[CLUB_IDS.river]!.get('friend')!;
    maya.via = 'link';
    maya.requestedAt = now - 198 * DAY;
    maya.outcome = 'approved';
    maya.decidedAt = now - 198 * DAY;
    place(CLUB_IDS.river, maya);

    // David follows the club and has never asked to join.
    const david = blank(CAST.david);
    david.source = 'instagram';
    david.linkId = midnightLinks.get('instagram')!;
    david.via = 'link';
    david.openedAt = now - 12 * DAY;
    david.followedAt = now - 12 * DAY + 4 * MIN;
    place(CLUB_IDS.midnight, david);

    // Sarah is a long-standing regular.
    const sarah = blank(CAST.sarah);
    sarah.source = 'friend';
    sarah.linkId = midnightLinks.get('friend')!;
    sarah.via = 'link';
    sarah.openedAt = now - 124 * DAY;
    sarah.followedAt = now - 124 * DAY + 10 * MIN;
    sarah.requestedAt = now - 121 * DAY;
    sarah.outcome = 'approved';
    sarah.decidedAt = now - 120 * DAY;
    sarah.play = 'regular';
    place(CLUB_IDS.midnight, sarah);

    // Jonathan is an approved member who has not played and holds no tournament authorisation.
    const jonathan = blank(CAST.jonathan);
    jonathan.source = 'whatsapp';
    jonathan.linkId = midnightLinks.get('whatsapp')!;
    jonathan.via = 'link';
    jonathan.openedAt = now - 14 * DAY;
    jonathan.followedAt = now - 14 * DAY + 6 * MIN;
    jonathan.requestedAt = now - 10 * DAY;
    jonathan.outcome = 'approved';
    jonathan.decidedAt = now - 9 * DAY;
    place(CLUB_IDS.midnight, jonathan);

    // One suspended and one banned member, so those states exist in the player database.
    const members = journeysByClub[CLUB_IDS.midnight]!.filter((j) => j.outcome === 'approved' && j.role === 'player' && !j.ended && db.users[j.userId]!.isBot && j.userId !== CAST.sarah && j.userId !== CAST.jonathan && now - j.decidedAt! > 60 * DAY);
    if (members[3]) members[3].ended = { type: 'suspended', at: now - 19 * DAY };
    if (members[7]) members[7].ended = { type: 'banned', at: now - 36 * DAY };
    const riverMembers = journeysByClub[CLUB_IDS.river]!.filter((j) => j.outcome === 'approved' && j.role === 'player' && !j.ended && db.users[j.userId]!.isBot && now - j.decidedAt! > 60 * DAY);
    if (riverMembers[2]) riverMembers[2].ended = { type: 'suspended', at: now - 40 * DAY };
    if (riverMembers[5]) riverMembers[5].ended = { type: 'suspended', at: now - 11 * DAY };
  }

  // ----- Journeys become records: profiles, events, follows, memberships ---------------------
  const activeMembers: Record<string, string[]> = {};
  for (const cfg of configs) {
    const { club } = cfg;
    const journeys = journeysByClub[club.id]!;
    const mrng = seededRng(Number(club.code) + 7);
    // Several journeys can land on the same account (the pool wraps); keep the first.
    const seen = new Set<string>();
    const unique: Journey[] = [];
    for (const j of journeys) {
      if (seen.has(j.userId)) continue;
      seen.add(j.userId);
      unique.push(j);
    }
    journeysByClub[club.id] = unique;
    // Member numbers follow the order in which people were approved.
    const approved = unique.filter((j) => j.outcome === 'approved').sort((a, b) => a.decidedAt! - b.decidedAt!);
    const memberNo = new Map<string, number>();
    approved.forEach((j, i) => memberNo.set(j.userId, i + 1));
    club.nextMemberNo = approved.length + 1;
    activeMembers[club.id] = [];

    // v0.4: in the main club a few of the "friend" arrivals came through members' personal links.
    if (club.id === CLUB_IDS.midnight) {
      const friendLink = linkIds[club.id]!.get('friend');
      const referrers: { userId: string; campaign: string | null; take: number }[] = [
        { userId: DEMO_USERS.player, campaign: null, take: 4 },
        { userId: CAST.sarah, campaign: 'Thursday crew', take: 3 },
      ];
      const pool = unique.filter((j) => j.linkId === friendLink && j.openedAt !== null && !referrers.some((r) => r.userId === j.userId)).sort((a, b) => a.openedAt! - b.openedAt!);
      for (const r of referrers) {
        const mine = pool.splice(0, r.take);
        if (mine.length === 0) continue;
        const refUser = db.users[r.userId]!;
        const id = `lnk_S${++linkSeq}`;
        db.crm.links.push({
          id,
          clubId: club.id,
          token: `r${refUser.handle.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)}${r.campaign ? '-thu' : ''}`,
          kind: 'club',
          tournamentId: null,
          source: 'friend',
          label: r.campaign ? `${refUser.name} · ${r.campaign}` : `${refUser.name}'s invitation`,
          createdBy: r.userId,
          createdAt: Math.min(...mine.map((j) => j.openedAt!)) - DAY,
          expiresAt: null,
          revokedAt: null,
          maxUses: null,
          uses: mine.length,
          referrerId: r.userId,
          campaign: r.campaign,
        });
        for (const j of mine) j.linkId = id;
      }
    }

    for (const j of unique) {
      const first = Math.min(...[j.openedAt, j.followedAt, j.requestedAt].filter((x): x is number => x !== null));
      if (!Number.isFinite(first)) continue;
      firstContact.set(j.userId, Math.min(firstContact.get(j.userId) ?? Infinity, first));
      db.crm.profiles[profileKey(club.id, j.userId)] = { clubId: club.id, userId: j.userId, memberNo: memberNo.get(j.userId) ?? null, firstSeenAt: first, tagIds: [], assignedTo: null, lastContactedAt: null, source: j.source, linkId: j.linkId };
      if (j.openedAt !== null && j.linkId) {
        event(club.id, j.userId, 'link_opened', j.openedAt, j.userId, { linkId: j.linkId });
        const u = db.users[j.userId]!;
        // Roughly half of the people who arrive through a link create their account then.
        if (u.isBot && u.signupLinkId === null && mrng.float() < 0.5 && (firstContact.get(j.userId) ?? 0) === first) {
          u.signupLinkId = j.linkId;
          u.joinedAt = j.openedAt + 2 * MIN;
        }
      }
      if (j.followedAt !== null) {
        event(club.id, j.userId, 'followed', j.followedAt, j.userId);
        if (j.unfollowedAt !== null) event(club.id, j.userId, 'unfollowed', j.unfollowedAt, j.userId);
        else if (j.ended?.type !== 'banned') db.follows.push({ clubId: club.id, userId: j.userId, at: j.followedAt, notify: j.followNotify });
      }
      if (j.requestedAt === null) continue;
      event(club.id, j.userId, 'membership_requested', j.requestedAt, j.userId, { via: j.via });
      const base: Membership = {
        clubId: club.id,
        userId: j.userId,
        role: j.role,
        status: 'pending',
        requestedAt: j.requestedAt,
        joinedAt: null,
        lastActiveAt: j.requestedAt,
        demoPoints: 0,
        via: j.via,
        decidedAt: j.decidedAt,
        announcements: mrng.float() >= 0.07,
        shareContact: mrng.float() < 0.35,
      };
      if (j.outcome === 'pending') db.memberships.push(base);
      else if (j.outcome === 'cancelled') event(club.id, j.userId, 'membership_cancelled', j.decidedAt!, j.userId);
      else if (j.outcome === 'rejected') {
        event(club.id, j.userId, 'membership_rejected', j.decidedAt!, club.ownerId);
        db.memberships.push({ ...base, status: 'rejected' });
      } else if (j.outcome === 'approved') {
        event(club.id, j.userId, 'membership_approved', j.decidedAt!, club.joinPolicy === 'open' || j.role === 'owner' ? 'system' : club.ownerId, club.joinPolicy === 'open' ? { auto: 1 } : {});
        if (j.role !== 'player' && j.role !== 'owner') event(club.id, j.userId, 'role_changed', j.decidedAt! + HOUR, club.ownerId, { from: 'player', to: j.role });
        if (j.ended?.type === 'left') {
          event(club.id, j.userId, 'membership_left', j.ended.at, j.userId);
          continue;
        }
        const m: Membership = { ...base, status: 'active', joinedAt: j.decidedAt, demoPoints: 10_000 - mrng.int(30) * 100 };
        if (j.ended?.type === 'suspended') {
          event(club.id, j.userId, 'membership_suspended', j.ended.at, club.ownerId);
          m.status = 'suspended';
          m.demoPoints = 0;
        } else if (j.ended?.type === 'banned') {
          event(club.id, j.userId, 'membership_banned', j.ended.at, club.ownerId, { wasMember: 1 });
          m.status = 'banned';
          m.decidedAt = j.ended.at;
          m.demoPoints = 0;
        } else activeMembers[club.id]!.push(j.userId);
        if (!db.users[j.userId]!.isBot) {
          m.demoPoints = 10_000;
          m.announcements = true;
          m.shareContact = false;
        }
        db.memberships.push(m);
      }
    }
  }
  // An account exists before its first contact with a club.
  for (const [userId, first] of firstContact) {
    const u = db.users[userId]!;
    if (u.joinedAt > first) u.joinedAt = first - (5 + rng.int(600)) * MIN;
  }

  // ----- Tournament history, generated as results --------------------------------------------
  let tSeq = 0;
  const banners: BannerStyle[] = ['aurora', 'ember', 'tide', 'onyx', 'gilded'];
  const mkTournament = (
    clubId: string,
    name: string,
    preset: Preset,
    status: TournamentStatus,
    startAt: number,
    opts: Partial<Tournament> & { registered?: number; requested?: number; waitlisted?: number; invited?: number; hero?: boolean } = {},
  ): Tournament => {
    const structure = presetStructure(preset);
    const format = preset === 'sng' ? 'sng' : 'mtt';
    const maxPlayers = opts.maxPlayers ?? (format === 'sng' ? structure.tableSize : 90);
    const entryPoints = opts.entryPoints ?? 0;
    const regs: Registration[] = [];
    const wanted = (opts.registered ?? 0) + (opts.requested ?? 0) + (opts.waitlisted ?? 0) + (opts.invited ?? 0);
    if (wanted > 0) {
      const pool = shuffleInPlace(activeMembers[clubId]!.filter((id) => db.users[id]!.isBot && id !== CAST.jonathan), rng);
      let i = 0;
      const take = (count: number, regStatus: Registration['status'], paid: number): void => {
        for (let k = 0; k < count && i < pool.length; k++, i++) {
          regs.push({ userId: pool[i]!, status: regStatus, at: now - (30 + rng.int(600)) * MIN, pointsPaid: paid, decidedBy: regStatus === 'approved' ? db.clubs[clubId]!.ownerId : null, decidedAt: regStatus === 'approved' ? now - rng.int(300) * MIN : null, viaLinkId: null });
        }
      };
      take(opts.registered ?? 0, 'registered', entryPoints);
      take(opts.requested ?? 0, 'requested', entryPoints);
      take(opts.waitlisted ?? 0, 'waitlisted', entryPoints);
      take(opts.invited ?? 0, 'approved', 0);
    }
    if (opts.hero) regs.push({ userId: DEMO_USERS.player, status: 'registered', at: now - 3 * HOUR, pointsPaid: entryPoints });
    const { registered: _r, requested: _q, waitlisted: _w, invited: _i, hero: _h, ...rest } = opts;
    const t: Tournament = {
      id: `t_S${++tSeq}`,
      clubId,
      name,
      description: '',
      banner: banners[tSeq % banners.length]!,
      format,
      preset,
      startMode: format === 'sng' ? 'when_full' : 'scheduled',
      startAt,
      timezone: 'Asia/Jerusalem',
      registrationOpensAt: Math.min(now - HOUR, startAt - 12 * HOUR),
      minPlayers: format === 'sng' ? structure.tableSize : 6,
      maxPlayers,
      structure,
      reentry: 'none',
      visibility: 'private',
      access: 'members',
      accessCode: null,
      entryPoints,
      status,
      registrations: regs,
      createdBy: db.clubs[clubId]!.ownerId,
      createdAt: Math.min(now, startAt) - 3 * DAY,
      publishedAt: status === 'DRAFT' ? null : Math.min(now, startAt) - 2 * DAY,
      startedAt: null,
      completedAt: null,
      cancelReason: null,
      seatingUntil: null,
      simulateRegistrations: format !== 'sng',
      simulatedFill: 0.55 + rng.float() * 0.3,
      demoSpeed: 1,
      seeded: true,
      ...rest,
    };
    db.tournaments[t.id] = t;
    return t;
  };

  // Places the demo player took in each club's most recent tournaments (0 = the latest).
  const heroPlaces: Record<string, Record<number, number>> = {
    [CLUB_IDS.midnight]: { 0: 4, 1: 17, 3: 2, 4: 1, 5: 9, 7: 12, 8: 6 },
    [CLUB_IDS.river]: { 0: 11, 2: 3, 4: 27, 5: 8, 8: 1, 10: 15, 12: 5 },
  };
  const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;

  for (const cfg of configs) {
    const { club } = cfg;
    const hrng = seededRng(Number(club.code) + 99);
    const journeys = journeysByClub[club.id]!.filter((j) => j.outcome === 'approved');
    // The schedule: fewer tournaments in the club's first months, more at weekends, always in the evening.
    const schedule: { at: number; name: string; preset: Preset; game?: VariantId }[] = [];
    let turn = 0;
    for (let d = cfg.lifetimeDays - 12; d >= 1; d--) {
      const day = dayStart(now - d * DAY);
      const weekday = new Date(day + 3 * HOUR).getUTCDay();
      const weekend = weekday === 4 || weekday === 5 || weekday === 6 ? 1.45 : 0.85;
      const growth = 0.45 + 0.55 * (1 - d / cfg.lifetimeDays);
      const expected = cfg.perDay * growth * weekend;
      let count = Math.floor(expected) + (hrng.float() < expected % 1 ? 1 : 0);
      while (count-- > 0) {
        const [name, preset, game] = cfg.rotation[turn++ % cfg.rotation.length]!;
        // 19:00–22:45 local time (UTC+3), or around lunch for sit & gos.
        const hour = preset === 'sng' && hrng.float() < 0.5 ? 9 + hrng.int(3) : 16 + hrng.int(4);
        schedule.push({ at: day + hour * HOUR + hrng.int(4) * 15 * MIN, name, preset, ...(game ? { game } : {}) });
      }
    }
    schedule.sort((a, b) => a.at - b.at);

    schedule.forEach((slot, index) => {
      const fromLatest = schedule.length - 1 - index;
      const T = slot.at;
      const eligible = journeys.filter((j) => j.decidedAt! + 2 * HOUR < T && (!j.ended || j.ended.at > T) && (j.churnAt === null || j.churnAt > T));
      const factor = slot.name === cfg.flagship ? 1.5 : slot.preset === 'deep' ? 0.85 : 1;
      let entrants: string[] = [];
      if (slot.preset === 'sng') {
        const keen = eligible.filter((j) => PLAY_RATE[j.play] > 0);
        const options = keen.map((j) => [j.userId, PLAY_RATE[j.play]] as const);
        while (entrants.length < 6 && options.length > 0) {
          const pick = weighted(hrng, options);
          options.splice(options.findIndex((o) => o[0] === pick), 1);
          entrants.push(pick);
        }
        if (entrants.length < 6) return;
      } else {
        for (const j of eligible) {
          if (j.play === 'once') {
            if (!j.playedOnce && T >= j.onceAfter) {
              j.playedOnce = true;
              entrants.push(j.userId);
            }
          } else if (hrng.float() < PLAY_RATE[j.play] * factor) entrants.push(j.userId);
        }
        if (entrants.length < 6) return;
        shuffleInPlace(entrants, hrng);
        if (entrants.length > 90) entrants.length = 90;
      }
      shuffleInPlace(entrants, hrng);
      const heroPlace = heroPlaces[club.id]?.[fromLatest];
      if (heroPlace !== undefined) {
        const position = Math.min(heroPlace, entrants.length + 1);
        if (slot.preset === 'sng') entrants[Math.min(position, 6) - 1] = DEMO_USERS.player;
        else entrants.splice(position - 1, 0, DEMO_USERS.player);
      }
      // Staff play too: the club's human staff appear in some of their own club's results, so the
      // global leaderboard has more than one person on it in the demo.
      for (const staffId of STAFF_PLAYERS[club.id] ?? []) {
        if (entrants.includes(staffId) || hrng.float() >= 0.35) continue;
        // A sit & go stays six-handed: the staff member takes a bot's seat.
        if (slot.preset === 'sng') entrants[hrng.int(entrants.length)] = staffId;
        else entrants.splice(hrng.int(entrants.length + 1), 0, staffId);
      }
      const n = entrants.length;
      const structure = presetStructure(slot.preset);
      let durationMin = slot.preset === 'sng' ? 22 + hrng.int(14) : slot.preset === 'turbo' ? 70 + hrng.int(40) : slot.preset === 'deep' ? 300 + hrng.int(120) : 170 + hrng.int(80);
      durationMin = Math.max(20, Math.min(durationMin, Math.floor((now - 30 * MIN - T) / MIN)));
      const t = mkTournament(club.id, slot.name, slot.preset, 'COMPLETED', T, { maxPlayers: slot.preset === 'sng' ? 6 : 90, entryPoints: 100, simulateRegistrations: false, ...(slot.game ? { game: slot.game } : {}) });
      t.startedAt = T;
      t.completedAt = T + durationMin * MIN;
      const result: TournamentResult = {
        tournamentId: t.id,
        clubId: club.id,
        name: slot.name,
        format: t.format,
        startedAt: T,
        completedAt: t.completedAt,
        durationMin,
        entrants: n,
        hands: Math.round(durationMin * (slot.preset === 'sng' ? 1.1 : 0.9 + n / 30)),
        totalChips: n * structure.startingStack,
        levelReached: Math.max(4, Math.round(durationMin / (structure.entries[0]!.minutes + 0.4))),
        places: entrants.map((userId, i) => ({
          place: i + 1,
          userId,
          name: db.users[userId]!.name,
          isBot: db.users[userId]!.isBot,
          points: rankingPoints(n, i + 1),
          bustedBy: i === 0 ? null : entrants[hrng.int(i)]!,
          bustLevel: i === 0 ? null : Math.max(1, Math.round((1 - i / n) * (durationMin / structure.entries[0]!.minutes))),
        })),
        seeded: true,
        ...(slot.game ? { game: slot.game } : {}),
      };
      db.results[t.id] = result;
    });
  }
  // Each member's "last active" is their last tournament, or their last step towards the club.
  for (const m of db.memberships) {
    const last = compute.playerStats(db, m.clubId, m.userId).lastPlayedAt;
    if (last !== null) m.lastActiveAt = Math.max(m.lastActiveAt, last);
    else if (m.joinedAt !== null) m.lastActiveAt = m.joinedAt;
  }
  const alexMidnight = db.memberships.find((m) => m.userId === DEMO_USERS.player && m.clubId === CLUB_IDS.midnight)!;
  alexMidnight.lastActiveAt = now - 20 * HOUR;

  // ----- Leagues (v0.4): one completed season and one in progress per main club -------------
  {
    const mkLeague = (clubId: string, name: string, description: string, type: League['type'], startAt: number, endAt: number, preset: League['scoring']['preset'], bestN: number, completedAt: number | null): League => {
      const league: League = {
        id: `lg_S${++tSeq}`,
        clubId,
        name,
        description,
        cover: { kind: 'pattern', pattern: 'deco' },
        type,
        startAt,
        endAt,
        scoring: { preset, bestN, participation: 0, participationCap: 0, fieldAdjusted: false, version: 1 },
        tournamentIds: [],
        includeAll: true,
        eligibility: 'all_members',
        memberIds: [],
        visibility: 'public',
        status: completedAt ? 'completed' : 'active',
        createdBy: db.clubs[clubId]!.ownerId,
        createdAt: startAt - DAY,
        finalStandings: null,
        championId: null,
        completedAt,
      };
      db.leagues.push(league);
      if (completedAt) {
        const standings = leagueStandings(db, league);
        league.finalStandings = standings.map((r) => ({ ...r }));
        league.championId = standings[0]?.userId ?? null;
      }
      return league;
    };
    const monthAgo = now - 30 * DAY;
    mkLeague(CLUB_IDS.midnight, 'Summer Championship', 'Three months of Midnight tournaments; best eight results counted.', 'quarterly', now - 122 * DAY, monthAgo - DAY, 'position', 8, monthAgo - DAY + 6 * HOUR);
    mkLeague(CLUB_IDS.midnight, 'Autumn League', 'Every Midnight tournament this season counts. Best six results.', 'quarterly', monthAgo, now + 60 * DAY, 'performance', 6, null);
    mkLeague(CLUB_IDS.river, 'Kings Monthly', 'All River Kings tournaments this month. Finishing-position points, every result counts.', 'monthly', now - 12 * DAY, now + 18 * DAY, 'position', 0, null);
  }
  db.memberships.find((m) => m.userId === DEMO_USERS.owner)!.lastActiveAt = now - HOUR;

  // ----- Upcoming and running tournaments -----------------------------------------------------
  // Midnight Poker Club
  mkTournament(CLUB_IDS.midnight, 'Six-Max Sit & Go', 'sng', 'REGISTRATION_OPEN', now, {
    registered: 2,
    entryPoints: 100,
    banner: 'onyx',
    description: 'Six players, one table, three-minute levels. Starts the moment the last seat is taken.',
  });
  mkTournament(CLUB_IDS.midnight, 'Midnight Express Turbo', 'turbo', 'REGISTRATION_OPEN', now + 4 * MIN + 20_000, {
    registered: 21,
    maxPlayers: 54,
    entryPoints: 200,
    banner: 'aurora',
    simulatedFill: 0.62,
    description: 'Five-minute levels and a big-blind ante from level 3. Done in about ninety minutes.',
  });
  mkTournament(CLUB_IDS.midnight, 'The Midnight Main Event', 'regular', 'REGISTRATION_OPEN', now + 2 * HOUR + 10 * MIN, {
    registered: 33,
    maxPlayers: 90,
    entryPoints: 500,
    banner: 'gilded',
    simulatedFill: 0.7,
    visibility: 'public',
    description: 'The club\'s weekly flagship. 10,000 chips, ten-minute levels, late registration for six levels. Listed publicly; seats are for approved members.',
  });
  mkTournament(CLUB_IDS.midnight, 'Members\' Invitational', 'regular', 'REGISTRATION_OPEN', now + 2 * DAY + 3 * HOUR, {
    registered: 12,
    requested: 5,
    maxPlayers: 36,
    entryPoints: 300,
    access: 'approval',
    simulateRegistrations: false,
    banner: 'tide',
    description: 'Seats are confirmed by club staff. Request yours and we will let you know.',
  });
  mkTournament(CLUB_IDS.midnight, 'Final Table Qualifier', 'turbo', 'REGISTRATION_OPEN', now + DAY + 2 * HOUR, {
    registered: 18,
    waitlisted: 3,
    maxPlayers: 18,
    entryPoints: 200,
    simulateRegistrations: false,
    banner: 'ember',
    description: 'Two tables, eighteen seats. Full: new registrations join the waiting list.',
  });
  mkTournament(CLUB_IDS.midnight, 'Founders\' Table', 'deep', 'REGISTRATION_OPEN', now + 3 * DAY + 2 * HOUR, {
    registered: 3,
    invited: 4,
    maxPlayers: 9,
    minPlayers: 6,
    entryPoints: 0,
    access: 'invite',
    simulateRegistrations: false,
    banner: 'gilded',
    description: 'One table, by invitation. Only the members we invite can see or enter it.',
  });
  mkTournament(CLUB_IDS.midnight, 'Staff & Friends Turbo', 'turbo', 'REGISTRATION_OPEN', now + DAY + 6 * HOUR, {
    registered: 7,
    maxPlayers: 27,
    entryPoints: 100,
    accessCode: 'FRIENDS24',
    simulateRegistrations: false,
    banner: 'aurora',
    description: 'For members who were given tonight\'s access code.',
  });
  mkTournament(CLUB_IDS.midnight, 'Deep Stack Thursday', 'deep', 'SCHEDULED', now + DAY + 5 * HOUR, {
    maxPlayers: 64,
    entryPoints: 400,
    registrationOpensAt: now + 5 * HOUR,
    banner: 'ember',
    description: '20,000 chips and fifteen-minute levels. Bring snacks.',
  });
  // v0.4: the deep stack as a saved template and a (paused) weekly schedule to resume in the demo.
  {
    const deep = mkTournament(CLUB_IDS.midnight, 'Deep Stack Thursday', 'deep', 'DRAFT', now + 8 * DAY, { maxPlayers: 64, entryPoints: 400, banner: 'ember', description: '20,000 chips and fifteen-minute levels. Bring snacks.', simulateRegistrations: false });
    const draft = draftOf(deep);
    delete db.tournaments[deep.id];
    db.templates.push({ id: 'tpl_S1', clubId: CLUB_IDS.midnight, name: 'Thursday Deep Stack', draft: { ...draft, startAt: 0, registrationOpensAt: 0 }, createdBy: 'u_owner', createdAt: now - 20 * DAY, updatedAt: now - 20 * DAY });
    db.schedules.push({ id: 'rs_S1', clubId: CLUB_IDS.midnight, name: 'Thursday nights', templateId: 'tpl_S1', weekdays: [4], hour: 20, minute: 0, leadDays: 7, timezone: 'Asia/Jerusalem', enabled: false, createdBy: 'u_owner', createdAt: now - 20 * DAY, lastRunAt: null });
  }
  mkTournament(CLUB_IDS.midnight, 'Sunday High Noon Turbo', 'turbo', 'DRAFT', now + 4 * DAY, {
    maxPlayers: 45,
    entryPoints: 150,
    createdBy: DEMO_USERS.owner,
    banner: 'aurora',
    description: 'Draft, not visible to members yet.',
  });

  // River Kings
  const running = mkTournament(CLUB_IDS.river, 'River Kings Daily Turbo', 'turbo', 'RUNNING', now - 9 * MIN, {
    registered: 41,
    maxPlayers: 72,
    entryPoints: 100,
    banner: 'tide',
    simulateRegistrations: false,
    visibility: 'public',
    description: 'The daily. Public to watch; late registration for members is open through level 6.',
  });
  running.startedAt = now - 9 * MIN;
  mkTournament(CLUB_IDS.river, 'Lunch Break Sit & Go', 'sng', 'REGISTRATION_OPEN', now, {
    registered: 3,
    entryPoints: 50,
    banner: 'ember',
    description: 'A full six-max tournament in about twenty-five minutes.',
  });
  mkTournament(CLUB_IDS.river, 'Omaha Six-Max Sit & Go', 'sng', 'REGISTRATION_OPEN', now, {
    registered: 2,
    entryPoints: 50,
    banner: 'tide',
    game: 'plo4',
    description: 'Pot-Limit Omaha: four cards each, exactly two of them play. Starts when the table is full.',
  });
  mkTournament(CLUB_IDS.midnight, 'Short Deck Showdown', 'turbo', 'REGISTRATION_OPEN', now + 55 * MIN, {
    registered: 12,
    maxPlayers: 36,
    entryPoints: 150,
    banner: 'onyx',
    game: 'short_deck',
    simulatedFill: 0.5,
    description: 'Six-plus Hold’em on a 36-card deck. Flushes beat full houses; A-6-7-8-9 is a straight.',
  });
  mkTournament(CLUB_IDS.midnight, 'Omaha Hi/Lo Night', 'regular', 'REGISTRATION_OPEN', now + 3 * HOUR + 40 * MIN, {
    registered: 9,
    maxPlayers: 45,
    entryPoints: 200,
    banner: 'tide',
    game: 'plo8',
    simulatedFill: 0.45,
    description: 'Eight-or-better split pots. Scoop both halves to climb the ranking.',
  });
  mkTournament(CLUB_IDS.river, 'Kings Hourly Turbo', 'turbo', 'REGISTRATION_OPEN', now + 26 * MIN, {
    registered: 17,
    maxPlayers: 63,
    entryPoints: 100,
    banner: 'aurora',
    description: 'On the hour, every hour.',
  });
  mkTournament(CLUB_IDS.river, 'Kings Nightly Deepstack', 'deep', 'REGISTRATION_OPEN', now + 3 * HOUR + 30 * MIN, {
    registered: 28,
    maxPlayers: 120,
    entryPoints: 300,
    banner: 'onyx',
    simulatedFill: 0.5,
    visibility: 'public',
    description: 'The long one. Eight-handed, fifteen-minute levels, hourly breaks.',
  });
  mkTournament(CLUB_IDS.river, 'Tomorrow\'s Daily Turbo', 'turbo', 'SCHEDULED', now + DAY - 9 * MIN, {
    maxPlayers: 72,
    entryPoints: 100,
    registrationOpensAt: now + 10 * HOUR,
    banner: 'tide',
  });

  // The Final Table
  mkTournament(CLUB_IDS.final, 'Final Table Classic', 'regular', 'REGISTRATION_OPEN', now + DAY + 2 * HOUR, {
    registered: 14,
    maxPlayers: 27,
    entryPoints: 500,
    banner: 'gilded',
    simulatedFill: 0.8,
    description: 'Three tables at most. Slow levels, quiet chat.',
  });
  mkTournament(CLUB_IDS.final, 'Gold Room Sit & Go', 'sng', 'REGISTRATION_OPEN', now, {
    registered: 1,
    entryPoints: 200,
    banner: 'gilded',
  });

  const cancelled = mkTournament(CLUB_IDS.midnight, 'Late Night Hyper', 'turbo', 'CANCELLED', now - 5 * DAY, { maxPlayers: 45 });
  cancelled.cancelReason = 'Minimum number of players was not reached.';
  cancelled.completedAt = now - 5 * DAY;

  // The relationship log is complete: put it in time order before the CRM records below add to it.
  events.sort((a, b) => a.at - b.at);
  db.crm.events = events.map((e, i) => ({ id: `ev_S${i + 1}`, ...e }));

  // ----- CRM: tags, assignments, notes, conversations ---------------------------------------------
  for (const cfg of configs) {
    const clubId = cfg.club.id;
    const trng = seededRng(Number(cfg.club.code) + 31);
    const tag = (name: string): string => db.crm.tags.find((t) => t.clubId === clubId && t.name === name)!.id;
    const staff = db.memberships.filter((m) => m.clubId === clubId && m.status === 'active' && m.role !== 'player' && m.role !== 'tournament_manager').map((m) => m.userId);
    const actor = cfg.club.ownerId;
    for (const m of db.memberships) {
      if (m.clubId !== clubId || m.status !== 'active' || m.role !== 'player') continue;
      const stats = compute.playerStats(db, clubId, m.userId);
      const recent = compute.playerParticipations(db, clubId, m.userId).filter((p) => p.at >= now - 30 * DAY).length;
      const give = (name: string, time: number): void => {
        at(Math.min(now - MIN, time), () => applyTag(db, clubId, m.userId, tag(name), actor));
      };
      if (m.joinedAt !== null && now - m.joinedAt < 14 * DAY) give('New Member', m.joinedAt + 10 * MIN);
      if (recent >= 5) give('Regular Player', now - (2 + trng.int(20)) * DAY);
      if (stats.wins >= 1 && trng.float() < 0.8) give('Tournament Winner', now - (1 + trng.int(30)) * DAY);
      if (stats.tournaments >= 12 && trng.float() < 0.5) give('Tournament Enthusiast', now - (3 + trng.int(40)) * DAY);
      if (stats.tournaments >= 2 && trng.float() < 0.12) give('Weekend Player', now - (3 + trng.int(40)) * DAY);
      if (stats.tournaments >= 2 && trng.float() < 0.14) give('Returning Player', now - (3 + trng.int(60)) * DAY);
      if (trng.float() < 0.5 && m.joinedAt !== null) give(db.users[m.userId]!.lang === 'he' ? 'Hebrew Speaking' : 'English Speaking', m.joinedAt + DAY);
      if (stats.tournaments >= 20 && trng.float() < 0.4) give('VIP Member', now - (5 + trng.int(50)) * DAY);
      if (trng.float() < 0.2 && staff.length > 0 && m.joinedAt !== null) {
        const staffId = staff[trng.int(staff.length)]!;
        db.crm.profiles[profileKey(clubId, m.userId)]!.assignedTo = staffId;
        db.crm.events.push({ id: `ev_A${db.crm.events.length}`, clubId, userId: m.userId, type: 'staff_assigned', at: Math.min(now - MIN, m.joinedAt + 2 * DAY), actorId: actor, params: { staffId } });
      }
    }
  }
  {
    const clubId = CLUB_IDS.midnight;
    const tag = (name: string): string => db.crm.tags.find((t) => t.clubId === clubId && t.name === name)!.id;
    const michael = DEMO_USERS.owner;
    const support = db.memberships.find((m) => m.clubId === clubId && m.role === 'support_agent')!.userId;
    at(now - 60 * DAY, () => applyTag(db, clubId, CAST.sarah, tag('VIP Member'), michael));
    at(now - 44 * DAY, () => applyTag(db, clubId, CAST.sarah, tag('Regular Player'), michael));
    db.crm.profiles[profileKey(clubId, CAST.sarah)]!.assignedTo = michael;
    at(now - 58 * DAY, () => addNote(db, michael, clubId, CAST.sarah, 'Plays almost every Main Event and brings friends along. Ask her before changing the Thursday start time.'));
    at(now - 9 * DAY, () => addNote(db, support, clubId, CAST.sarah, 'Asked whether the deep stack could start 30 minutes later. Passed on to Michael.'));
    at(now - 8 * DAY, () => addNote(db, michael, clubId, CAST.jonathan, 'Introduced by a member of the WhatsApp group. New to tournaments: point him at the turbo first.'));
    const some = activeMembers[clubId]!.filter((id) => db.users[id]!.isBot && id !== CAST.sarah && id !== CAST.jonathan);
    at(now - 21 * DAY, () => addNote(db, michael, clubId, some[4]!, 'Reported a frozen blind timer on his phone during the turbo. Support ticket opened with the platform.'));
    at(now - 21 * DAY, () => applyTag(db, clubId, some[4]!, tag('Needs Support'), michael));
    at(now - 30 * DAY, () => addNote(db, michael, clubId, some[9]!, 'Prefers messages in Hebrew.'));

    // Conversations. Sarah's question is waiting for an answer.
    at(now - 9 * DAY - 3 * HOUR, () => sendPlayerMessage(db, CAST.sarah, clubId, 'Hi! Any chance Deep Stack Thursday could start half an hour later? A few of us come straight from work.'));
    at(now - 9 * DAY, () => sendClubMessage(db, support, clubId, CAST.sarah, 'Thanks Sarah, I have passed that on to Michael.'));
    at(now - 9 * DAY + MIN, () => sendClubMessage(db, support, clubId, CAST.sarah, 'Second request for a later Thursday start this month.', { internal: true }));
    at(now - 95 * MIN, () => sendPlayerMessage(db, CAST.sarah, clubId, 'Is the Thursday deep stack still on this week? I would like to bring two friends who are not members yet.'));

    at(now - 6 * DAY, () => sendPlayerMessage(db, CAST.david, clubId, 'Hello, how does membership work? I have been following the club for a while.'));
    at(now - 6 * DAY + 2 * HOUR, () => sendClubMessage(db, michael, clubId, CAST.david, 'Hi David. Press "Request membership" on our page and we will take it from there. Approval usually takes less than a day.'));
    at(now - 6 * DAY + 2 * HOUR + MIN, () => setConversationStatus(db, michael, db.conversations.find((c) => c.clubId === clubId && c.userId === CAST.david)!.id, 'resolved'));

    at(now - 2 * DAY, () => sendPlayerMessage(db, some[4]!, clubId, 'The timer froze again for a few seconds last night. Same phone.'));
    at(now - 2 * DAY + 40 * MIN, () => sendClubMessage(db, support, clubId, some[4]!, 'Sorry about that. We have sent the details to the platform team and will let you know.'));
    const supportThread = db.conversations.find((c) => c.clubId === clubId && c.userId === some[4])!;
    supportThread.assignedTo = support;

    // A tournament invitation link for the invitation-only event.
    const founders = Object.values(db.tournaments).find((t) => t.clubId === clubId && t.name === 'Founders\' Table')!;
    db.crm.links.push({ id: `lnk_S${++linkSeq}`, clubId, token: 'mpc-founders-table', kind: 'tournament', tournamentId: founders.id, source: 'other', label: 'Founders\' Table invitation', createdBy: michael, createdAt: now - 2 * DAY, expiresAt: now + 3 * DAY, revokedAt: null, maxUses: 6, uses: 1 });
    const viaLink = founders.registrations.find((r) => r.status === 'approved');
    if (viaLink) viaLink.viaLinkId = `lnk_S${linkSeq}`;
  }
  {
    // River Kings has its own private CRM records, which Midnight's staff must never see.
    const clubId = CLUB_IDS.river;
    const dana = DEMO_USERS.other_owner;
    const some = activeMembers[clubId]!.filter((id) => db.users[id]!.isBot);
    at(now - 12 * DAY, () => addNote(db, dana, clubId, some[3]!, 'River Kings note: asked about a private table for a birthday.'));
    at(now - 4 * DAY, () => addNote(db, dana, clubId, DEMO_USERS.player, 'River Kings note: Alex finished first in the lunch sit & go twice this month.'));
    at(now - 3 * DAY, () => sendPlayerMessage(db, some[3]!, clubId, 'Can I reserve a table for eight on Friday?'));
    at(now - 3 * DAY + HOUR, () => sendClubMessage(db, dana, clubId, some[3]!, 'We do not reserve tables, but the Friday sit & gos fill in minutes. See you there.'));
  }

  // ----- Announcements (sent through the service layer, so each has a real delivery record) ------
  const ann = (clubId: string, input: AnnouncementInput, hoursAgo: number): void => {
    const author = clubId === 'platform' ? DEMO_USERS.platform_admin : db.clubs[clubId]!.ownerId;
    const a = at(now - hoursAgo * HOUR, () => publishAnnouncement(db, author, clubId, input));
    const batch = db.batches.find((b) => b.id === a.batchId);
    if (batch) {
      // Simulated members "open" some of what they receive. Kept apart from real reads everywhere.
      const share = Math.min(0.7, 0.3 + hoursAgo / 120);
      batch.simulatedReadBy = batch.delivered.filter((id) => db.users[id]?.isBot && rng.float() < share);
    }
  };
  const regularsSegment = db.crm.segments.find((s) => s.clubId === CLUB_IDS.midnight && s.system === 'regulars')!.id;
  ann(CLUB_IDS.midnight, { kind: 'news', title: 'October ranking is live', body: 'Points from every club tournament count. Top three at the end of the month get their names on the club page.', audience: { type: 'everyone' } }, 70);
  ann(CLUB_IDS.midnight, { kind: 'community', title: 'Thank you, regulars', body: 'You played five or more of our tournaments this month. The next Members\' Invitational has a seat with your name on it.', audience: { type: 'segment', segmentId: regularsSegment } }, 46);
  ann(CLUB_IDS.midnight, { kind: 'schedule', title: 'Deep Stack moves to Thursday', body: 'By popular request the weekly deep stack moves from Wednesday to Thursday, same start time.', audience: { type: 'members' } }, 28);
  ann(CLUB_IDS.midnight, { kind: 'tournament', title: 'Main Event tonight: 90 seats', body: 'Registration is open now. Late registration runs through level 6. See you at the tables.', pinned: true, audience: { type: 'everyone' } }, 3);
  ann(CLUB_IDS.river, { kind: 'schedule', title: 'Hourly turbos now start at :00', body: 'To make the schedule easier to remember, every hourly turbo now starts on the hour.', audience: { type: 'members' } }, 100);
  ann(CLUB_IDS.river, { kind: 'news', title: 'Two hundred members', body: 'River Kings passed 200 members this season. Thank you for making the tables busy every night.', audience: { type: 'everyone' } }, 40);
  ann(CLUB_IDS.river, { kind: 'tournament', title: 'Daily Turbo is running, late registration open', body: 'Jump in through level 6. Forty-one players so far.', pinned: true, audience: { type: 'everyone' } }, 0.15);
  ann(CLUB_IDS.final, { kind: 'news', title: 'Autumn series', body: 'Four Classics over four weeks, with a combined ranking. Dates are on the calendar.', pinned: true, audience: { type: 'members' } }, 20);
  ann(CLUB_IDS.final, { kind: 'tournament', title: 'Classic, tomorrow evening', body: 'Twenty-seven seats. Fourteen taken.', audience: { type: 'members' } }, 6);
  ann('platform', { kind: 'maintenance', title: 'Scheduled maintenance: Tuesday 04:00–04:20', body: 'Tables will not be available for about twenty minutes. Tournaments scheduled across the window should be moved.' }, 12);
  // One announcement waiting to go out.
  at(now - 2 * HOUR, () =>
    publishAnnouncement(db, DEMO_USERS.owner, CLUB_IDS.midnight, { kind: 'reminder', title: 'Deep Stack Thursday: registration opens tonight', body: 'Sixty-four seats, 20,000 chips. Registration opens five hours before the first hand.', audience: { type: 'members' }, scheduledAt: now + 4 * HOUR }),
  );

  // ----- Inbox ------------------------------------------------------------------------
  const pendingName = db.users[db.memberships.find((m) => m.clubId === CLUB_IDS.midnight && m.status === 'pending')?.userId ?? '']?.name ?? 'A new applicant';
  const note = (userId: string, kind: 'membership' | 'tournament' | 'system' | 'result' | 'support', key: string, params: Record<string, string | number>, hoursAgo: number, read = false, clubId?: string, link: DB["notifications"][number]["link"] = null) => {
    db.notifications.push({ id: `n_S${db.notifications.length + 1}`, userId, at: now - hoursAgo * HOUR, kind, key, params, read, link, ...(clubId ? { clubId } : {}) });
  };
  const latestAlex = compute.playerParticipations(db, CLUB_IDS.midnight, DEMO_USERS.player).at(-1);
  if (latestAlex && latestAlex.place !== null) note(DEMO_USERS.player, 'result', 'notif.result', { name: latestAlex.name, place: latestAlex.place, entrants: latestAlex.entrants }, Math.max(1, (now - (latestAlex.completedAt ?? now)) / HOUR), true, CLUB_IDS.midnight, { name: 'results', params: { id: latestAlex.tournamentId } });
  note(DEMO_USERS.owner, 'membership', 'notif.join_request', { user: pendingName, club: 'Midnight Poker Club' }, 1, false, CLUB_IDS.midnight, { name: 'console.crm.requests', params: { clubId: CLUB_IDS.midnight } });
  note(DEMO_USERS.owner, 'support', 'notif.ticket_reply', { ref: 'PCO-1002' }, 5, false, CLUB_IDS.midnight, { name: 'console.support', params: { clubId: CLUB_IDS.midnight } });
  note(DEMO_USERS.tournament_manager, 'tournament', 'notif.running_now', { name: 'River Kings Daily Turbo' }, 0.15, false, CLUB_IDS.river);
  note(DEMO_USERS.platform_admin, 'support', 'notif.ticket_new', { ref: 'PCO-1005', club: 'River Kings' }, 2);
  db.notifications.sort((a, b) => a.at - b.at);

  // ----- Support tickets ---------------------------------------------------------------
  const ticket = (
    clubId: string,
    authorId: string,
    category: 'technical' | 'gameplay_bug' | 'feature_request' | 'account' | 'billing',
    priority: 'low' | 'normal' | 'high',
    subject: string,
    body: string,
    status: 'open' | 'in_progress' | 'waiting' | 'resolved',
    hoursAgo: number,
    reply?: string,
  ) => {
    const createdAt = now - hoursAgo * HOUR;
    const messages = [{ authorId, at: createdAt, body, staff: false }];
    if (reply) messages.push({ authorId: DEMO_USERS.platform_admin, at: createdAt + 50 * MIN, body: reply, staff: true });
    db.tickets.push({
      id: `tk_S${db.tickets.length + 1}`,
      ref: `PCO-${1000 + db.tickets.length + 1}`,
      clubId,
      authorId,
      category,
      priority,
      subject,
      status,
      createdAt,
      updatedAt: reply ? createdAt + 50 * MIN : createdAt,
      messages,
    });
  };
  ticket(CLUB_IDS.midnight, DEMO_USERS.owner, 'feature_request', 'low', 'Export final standings as a spreadsheet', 'We publish results to our members every week. A one-click export of the final standings would save us retyping them.', 'in_progress', 96, 'Thanks Michael — standings export is on the roadmap for the reporting module. I have added your club to the early-access list.');
  ticket(CLUB_IDS.midnight, DEMO_USERS.owner, 'gameplay_bug', 'normal', 'Blind level timer looked frozen for one player', 'During Tuesday\'s turbo one member reported the level countdown stopped for about ten seconds on his phone, then jumped. Other players saw it tick normally.', 'waiting', 30, 'That pattern usually means the device lost its connection and resynchronised. Could you ask the member which network they were on? The table state itself was not affected.');
  ticket(CLUB_IDS.river, DEMO_USERS.other_owner, 'technical', 'high', 'Need more concurrent tables for the weekend special', 'We expect 150+ entries on Saturday. Can our table limit be raised for the weekend?', 'resolved', 150, 'Raised to 40 concurrent tables through Monday. You can see the override on your subscription page.');
  ticket(CLUB_IDS.river, DEMO_USERS.tournament_manager, 'account', 'normal', 'Add a second tournament manager', 'Our weekday manager needs console access. Do we have a free administrator seat?', 'resolved', 60, 'You have seats available on Enterprise — your club owner can assign the role under Roles.');
  ticket(CLUB_IDS.river, DEMO_USERS.tournament_manager, 'gameplay_bug', 'normal', 'Player says he was moved tables twice in a row', 'A member was moved when table 6 broke and then again two hands later to balance. Is that expected?', 'open', 2);
  ticket(CLUB_IDS.final, 'u_fowner', 'billing', 'low', 'Question about upgrading to Professional', 'We would like our own logo on the club page. What changes if we upgrade mid-month?', 'open', 9);

  // ----- Subscriptions: demo invoices, with active players counted from the seeded tournaments ----
  for (const cfg of configs) {
    const plan = db.plans[cfg.club.planId];
    const months = compute.monthlyActive(db, cfg.club.id, 4, now);
    for (let monthsAgo = 3; monthsAgo >= 1; monthsAgo--) {
      const d = new Date(now);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - monthsAgo);
      const period = d.toISOString().slice(0, 7);
      const active = months.find((m) => m.month === period)?.players ?? 0;
      const billable = plan.model === 'fixed' ? 0 : Math.max(0, active - plan.includedActive);
      const base = plan.model === 'per_active' ? 0 : plan.baseFee;
      const usage = Math.round(billable * plan.perActiveFee * 100) / 100;
      db.invoices.push({
        id: `inv_S${db.invoices.length + 1}`,
        clubId: cfg.club.id,
        period,
        issuedAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
        planId: plan.id,
        base,
        usage,
        activePlayers: active,
        total: base + usage,
        status: monthsAgo === 1 && cfg.club.id === CLUB_IDS.final ? 'due' : 'paid',
      });
    }
  }

  // ----- Audit trail ------------------------------------------------------------------
  const aud = (actorId: string, clubId: string | null, action: string, params: Record<string, string | number>, hoursAgo: number) => {
    db.audit.push({ id: `au_S${db.audit.length + 1}`, at: now - hoursAgo * HOUR, actorId, clubId, action, params });
  };
  const recentlyApproved = journeysByClub[CLUB_IDS.midnight]!.filter((j) => j.outcome === 'approved' && j.role === 'player' && db.users[j.userId]!.isBot).sort((a, b) => b.decidedAt! - a.decidedAt!)[0];
  aud(DEMO_USERS.owner, CLUB_IDS.midnight, 'tournament.published', { name: 'The Midnight Main Event' }, 50);
  if (recentlyApproved) aud(DEMO_USERS.owner, CLUB_IDS.midnight, 'member.approved', { user: db.users[recentlyApproved.userId]!.name }, Math.max(0.5, (now - recentlyApproved.decidedAt!) / HOUR));
  aud(DEMO_USERS.owner, CLUB_IDS.midnight, 'club.branding_updated', {}, 26);
  aud(DEMO_USERS.owner, CLUB_IDS.midnight, 'tournament.cancelled', { name: 'Late Night Hyper', reason: 'Minimum number of players was not reached.' }, 120);
  aud(DEMO_USERS.owner, CLUB_IDS.midnight, 'tournament.created', { name: 'Sunday High Noon Turbo' }, 4);
  aud(DEMO_USERS.tournament_manager, CLUB_IDS.river, 'tournament.published', { name: 'River Kings Daily Turbo' }, 30);
  aud(DEMO_USERS.tournament_manager, CLUB_IDS.river, 'tournament.published', { name: 'Kings Nightly Deepstack' }, 22);
  aud(DEMO_USERS.platform_admin, null, 'tenant.limits_changed', { club: 'River Kings' }, 149);
  aud(DEMO_USERS.platform_admin, null, 'plan.updated', { plan: 'Professional' }, 300);
  db.audit.sort((a, b) => a.at - b.at);
  db.crm.events.sort((a, b) => a.at - b.at);

  // ----- Hand history for the demo player (really played by the engine) ----------------------
  db.hands.push(...seedHands(db, now));

  // ----- v0.4: integrity queue, derived from the simulated history above ----------------------
  seedScan(db, now);

  return db;
}

/** Play a short six-max session with the real engine so the hand replayer has history on first load. */
function seedHands(db: DB, now: number): HandRecord[] {
  const rng = seededRng(99);
  const structure = presetStructure('sng');
  const table = createTable('seed', 6);
  const opponents = Object.values(db.users).filter((u) => u.isBot).slice(10, 15);
  const players = [db.users[DEMO_USERS.player]!, ...opponents];
  players.forEach((u, i) => seatPlayer(table, u.id, structure.startingStack, i));
  const records: HandRecord[] = [];
  for (let h = 0; h < 16 && occupiedSeats(table).filter((s) => s.stack > 0).length >= 2; h++) {
    const hero = table.seats[0];
    if (!hero || hero.stack === 0) break;
    const blinds = blindsAt(structure, Math.floor(h / 5));
    const hand = startHand(table, blinds, rng);
    const names: HandRecord['names'] = {};
    for (const s of occupiedSeats(table)) {
      if (s.inHand) names[s.seat] = { name: db.users[s.playerId]!.name, isBot: db.users[s.playerId]!.isBot, userId: s.playerId };
    }
    while (handInProgress(table)) {
      const seat = table.seats[hand.toAct]!;
      const style = seat.playerId === DEMO_USERS.player ? 'balanced' : db.users[seat.playerId]!.style;
      applyAction(table, seat.seat, chooseBotAction(botContext(table, seat.seat), style, rng, 80));
    }
    const heroFoldedPreflop = hand.events.some((e) => e.t === 'action' && e.seat === 0 && e.type === 'fold') && hand.board.length === 0;
    const net = hand.result!.net[0] ?? 0;
    if (!heroFoldedPreflop && records.length < 6) {
      const shown = hand.events.find((e) => e.t === 'showdown');
      const heroShown = shown && shown.t === 'showdown' ? shown.hands.find((x) => x.seat === 0) : undefined;
      records.push({
        id: `h_seed_${h}`,
        userId: DEMO_USERS.player,
        tournamentId: 'seed',
        tournamentName: 'Six-Max Sit & Go',
        clubId: CLUB_IDS.midnight,
        tableNo: 1,
        handNo: hand.handNo,
        at: now - DAY - (16 - h) * 90_000,
        maxSeats: 6,
        heroSeat: 0,
        blinds,
        names,
        events: hand.events.map((e) => redactEvent(e, 0)),
        net,
        heroHand: heroShown ? heroShown.name : hand.board.length >= 3 ? describeHand([...table.seats[0]!.hole, ...hand.board]).name : null,
      });
    }
    for (const s of occupiedSeats(table)) if (s.stack === 0) table.seats[s.seat] = null;
  }
  return records;
}
