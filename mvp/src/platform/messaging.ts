/**
 * Conversations between a player and a club.
 *
 * There is one conversation per club and player. It belongs to that club: its
 * staff with the `crm.messages` permission can read and answer it, the player
 * can read everything except staff-only notes, and nobody else can open it —
 * not another club's staff, and not platform staff.
 *
 * Abuse controls: length and rate limits, no repeated identical messages, a cap
 * on unanswered messages from people who are not members, blocking in either
 * direction, and reports that go to the platform team.
 */
import { audit, clock, clubOf, DAY, ensureProfile, fail, logEvent, MIN, newId, notify, profileKey, requireActiveClub, userOf } from './core.ts';
import { can, isPlatformAdmin, membershipOf, requirePermission, requirePlatform } from './permissions.ts';
import type { AbuseReport, ChatMessage, Club, Conversation, DB, MemberStatus, MessageBlock } from './types.ts';

export const MESSAGE_LIMITS = {
  maxLength: 2000,
  perMinute: 5,
  perDay: 30,
  /** Messages a non-member may send before the club has answered. */
  unansweredFromNonMember: 3,
  staffPerMinute: 20,
};

const conversationById = (db: DB, id: string): Conversation => db.conversations.find((c) => c.id === id) ?? fail('not_found', 'Conversation not found.');

export function conversationOf(db: DB, clubId: string, userId: string): Conversation | undefined {
  return db.conversations.find((c) => c.clubId === clubId && c.userId === userId);
}

function ensureConversation(db: DB, clubId: string, userId: string, status: Conversation['status'] = 'open'): Conversation {
  let c = conversationOf(db, clubId, userId);
  if (!c) {
    const now = clock.now();
    c = { id: newId(db, 'cv'), clubId, userId, status, assignedTo: db.crm.profiles[profileKey(clubId, userId)]?.assignedTo ?? null, createdAt: now, lastMessageAt: now, unreadClub: 0, unreadPlayer: 0 };
    db.conversations.push(c);
  }
  return c;
}

function clean(body: string): string {
  const text = body.replace(/\r\n/g, '\n').trim();
  if (text.length < 1) fail('bad_body', 'Write a message first.');
  if (text.length > MESSAGE_LIMITS.maxLength) fail('too_long', `A message can have up to ${MESSAGE_LIMITS.maxLength} characters.`);
  return text;
}

const blockOf = (db: DB, clubId: string, userId: string): MessageBlock | undefined => db.blocks.find((b) => b.clubId === clubId && b.userId === userId);

function push(db: DB, c: Conversation, message: Omit<ChatMessage, 'id' | 'conversationId' | 'clubId' | 'at' | 'readAt'>): ChatMessage {
  const m: ChatMessage = { id: newId(db, 'msg'), conversationId: c.id, clubId: c.clubId, at: clock.now(), readAt: null, ...message };
  db.messages.push(m);
  if (db.messages.length > 6000) db.messages.splice(0, db.messages.length - 6000);
  c.lastMessageAt = m.at;
  return m;
}

/** Staff who should hear about a new message: the assigned person if there is one, otherwise everyone who answers messages. */
function inboxStaff(db: DB, c: Conversation): string[] {
  if (c.assignedTo && can(db, c.assignedTo, 'crm.messages', c.clubId)) return [c.assignedTo];
  return db.memberships.filter((m) => m.clubId === c.clubId && m.status === 'active' && can(db, m.userId, 'crm.messages', c.clubId)).map((m) => m.userId);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export function sendPlayerMessage(db: DB, userId: string, clubId: string, body: string): ChatMessage {
  const club = clubOf(db, clubId);
  const user = userOf(db, userId);
  requireActiveClub(club);
  const membership = membershipOf(db, userId, clubId);
  if (membership?.status === 'banned') fail('banned', 'You cannot write to this club.');
  const block = blockOf(db, clubId, userId);
  if (block?.by === 'club') fail('blocked', 'This club is not accepting messages from you.');
  if (block?.by === 'player') fail('you_blocked', 'You blocked this club. Unblock it to write to it.');
  const text = clean(body);
  const now = clock.now();
  const existing = conversationOf(db, clubId, userId);
  const mine = existing ? db.messages.filter((m) => m.conversationId === existing.id && m.from === 'player') : [];
  if (mine.filter((m) => now - m.at < MIN).length >= MESSAGE_LIMITS.perMinute) fail('rate_limited', 'You are sending messages too quickly. Wait a minute.');
  if (mine.filter((m) => now - m.at < DAY).length >= MESSAGE_LIMITS.perDay) fail('rate_limited', 'You have reached today\'s message limit for this club.');
  const last = mine[mine.length - 1];
  if (last && last.body === text && now - last.at < 10 * MIN) fail('duplicate_message', 'You already sent that message.');
  if (membership?.status !== 'active' && existing) {
    // Someone the club has not approved cannot keep writing into silence.
    const thread = db.messages.filter((m) => m.conversationId === existing.id && !m.internal);
    let unanswered = 0;
    for (let i = thread.length - 1; i >= 0 && thread[i]!.from === 'player'; i--) unanswered++;
    if (unanswered >= MESSAGE_LIMITS.unansweredFromNonMember) fail('await_reply', 'Wait for the club to answer before sending more.');
  }
  const c = ensureConversation(db, clubId, userId);
  const firstOfBurst = c.unreadClub === 0;
  const message = push(db, c, { from: 'player', authorId: userId, body: text, internal: false, automated: false });
  c.unreadClub += 1;
  c.status = 'open';
  if (membership?.status === 'active') membership.lastActiveAt = now;
  ensureProfile(db, clubId, userId);
  logEvent(db, clubId, userId, 'message_sent', userId);
  // One notification per burst of unread messages, not one per message.
  if (firstOfBurst) {
    for (const staffId of inboxStaff(db, c)) {
      notify(db, staffId, 'message', 'notif.message_from_player', { user: user.name, club: club.name }, { name: 'console.crm.inbox', params: { clubId, conversationId: c.id } }, { clubId, dedupeKey: `msg:${message.id}` });
    }
  }
  return message;
}

/** The club must already know the person: staff cannot write to arbitrary accounts. */
function requireKnown(db: DB, clubId: string, userId: string): void {
  userOf(db, userId);
  const known = db.crm.profiles[profileKey(clubId, userId)] || membershipOf(db, userId, clubId) || db.follows.some((f) => f.clubId === clubId && f.userId === userId);
  if (!known) fail('not_found', 'This club has no record of that player.');
}

export function sendClubMessage(db: DB, actorId: string, clubId: string, userId: string, body: string, options: { internal?: boolean } = {}): ChatMessage {
  requirePermission(db, actorId, 'crm.messages', clubId);
  const club = clubOf(db, clubId);
  requireKnown(db, clubId, userId);
  const internal = options.internal === true;
  const text = clean(body);
  const now = clock.now();
  if (!internal) {
    if (blockOf(db, clubId, userId)?.by === 'player') fail('blocked_by_player', 'This player has blocked messages from the club.');
    if (membershipOf(db, userId, clubId)?.status === 'banned') fail('banned', 'This player is banned. Lift the ban before writing to them.');
    const recent = db.messages.filter((m) => m.clubId === clubId && m.authorId === actorId && m.from === 'club' && !m.internal && now - m.at < MIN).length;
    if (recent >= MESSAGE_LIMITS.staffPerMinute) fail('rate_limited', 'You are sending messages too quickly. Wait a minute.');
  }
  const c = ensureConversation(db, clubId, userId);
  const firstOfBurst = c.unreadPlayer === 0;
  const message = push(db, c, { from: 'club', authorId: actorId, body: text, internal, automated: false });
  // Answering means the staff member has seen what the player wrote.
  markRead(db, c, 'club');
  if (!internal) {
    c.unreadPlayer += 1;
    ensureProfile(db, clubId, userId).lastContactedAt = now;
    logEvent(db, clubId, userId, 'message_received', actorId);
    if (firstOfBurst) notify(db, userId, 'message', 'notif.message_from_club', { club: club.name }, { name: 'messages', params: { clubId } }, { clubId, dedupeKey: `msg:${message.id}` });
  }
  return message;
}

/** A message written by an automation (for example the welcome message). Always marked as automatic. */
export function sendSystemMessage(db: DB, clubId: string, userId: string, body: string): ChatMessage | null {
  const club = db.clubs[clubId];
  if (!club || !db.users[userId]) return null;
  if (blockOf(db, clubId, userId)?.by === 'player') return null;
  const fresh = !conversationOf(db, clubId, userId);
  // A thread that only holds an automatic message does not need staff attention, so it starts resolved.
  const c = ensureConversation(db, clubId, userId, 'resolved');
  const firstOfBurst = c.unreadPlayer === 0;
  const message = push(db, c, { from: 'system', authorId: null, body: body.trim().slice(0, MESSAGE_LIMITS.maxLength), internal: false, automated: true });
  if (fresh) c.createdAt = message.at;
  c.unreadPlayer += 1;
  if (firstOfBurst) notify(db, userId, 'message', 'notif.message_from_club', { club: club.name }, { name: 'messages', params: { clubId } }, { clubId, dedupeKey: `msg:${message.id}` });
  return message;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function markRead(db: DB, c: Conversation, side: 'club' | 'player'): void {
  const now = clock.now();
  for (const m of db.messages) {
    if (m.conversationId !== c.id || m.readAt !== null || m.internal) continue;
    if (side === 'club' ? m.from === 'player' : m.from !== 'player') m.readAt = now;
  }
  if (side === 'club') c.unreadClub = 0;
  else c.unreadPlayer = 0;
}

/** Who is asking, relative to one conversation. Throws for anyone who has no business reading it. */
function sideOf(db: DB, actorId: string, c: Conversation): 'player' | 'club' {
  if (actorId === c.userId) return 'player';
  requirePermission(db, actorId, 'crm.messages', c.clubId);
  return 'club';
}

export function markConversationRead(db: DB, actorId: string, conversationId: string): void {
  const c = conversationById(db, conversationId);
  markRead(db, c, sideOf(db, actorId, c));
}

export interface Thread {
  conversation: Conversation;
  club: Pick<Club, 'id' | 'name' | 'branding' | 'status'>;
  viewer: 'player' | 'club';
  messages: ChatMessage[];
  block: MessageBlock | null;
}

export function conversationThread(db: DB, actorId: string, conversationId: string): Thread {
  const c = conversationById(db, conversationId);
  const viewer = sideOf(db, actorId, c);
  const club = clubOf(db, c.clubId);
  return {
    conversation: c,
    club: { id: club.id, name: club.name, branding: club.branding, status: club.status },
    viewer,
    // Staff-only notes never leave the club.
    messages: db.messages.filter((m) => m.conversationId === c.id && (viewer === 'club' || !m.internal)),
    block: blockOf(db, c.clubId, c.userId) ?? null,
  };
}

export interface InboxItem {
  conversation: Conversation;
  user: { id: string; name: string; handle: string; hue: number; isBot: boolean };
  membership: MemberStatus | 'none';
  following: boolean;
  last: { body: string; from: ChatMessage['from']; at: number; internal: boolean; automated: boolean } | null;
  assignedName: string | null;
  blocked: MessageBlock['by'] | null;
}

export function clubInbox(db: DB, actorId: string, clubId: string): InboxItem[] {
  requirePermission(db, actorId, 'crm.messages', clubId);
  const last = new Map<string, ChatMessage>();
  for (const m of db.messages) if (m.clubId === clubId) last.set(m.conversationId, m);
  return db.conversations
    .filter((c) => c.clubId === clubId)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .map((c) => {
      const u = db.users[c.userId];
      const m = last.get(c.id);
      return {
        conversation: c,
        user: { id: c.userId, name: u?.name ?? '', handle: u?.handle ?? '', hue: u?.hue ?? 200, isBot: u?.isBot ?? true },
        membership: membershipOf(db, c.userId, clubId)?.status ?? 'none',
        following: db.follows.some((f) => f.clubId === clubId && f.userId === c.userId),
        last: m ? { body: m.body, from: m.from, at: m.at, internal: m.internal, automated: m.automated } : null,
        assignedName: c.assignedTo ? (db.users[c.assignedTo]?.name ?? null) : null,
        blocked: blockOf(db, clubId, c.userId)?.by ?? null,
      };
    });
}

/** Unread player messages waiting in a club's inbox; 0 for anyone who does not answer messages there. */
export function inboxUnread(db: DB, actorId: string, clubId: string): number {
  if (!can(db, actorId, 'crm.messages', clubId)) return 0;
  let n = 0;
  for (const c of db.conversations) if (c.clubId === clubId) n += c.unreadClub;
  return n;
}

export interface MyConversation {
  conversation: Conversation;
  club: Pick<Club, 'id' | 'name' | 'branding' | 'status'>;
  last: { body: string; from: ChatMessage['from']; at: number; automated: boolean } | null;
}

/** A player's own conversations. */
export function myConversations(db: DB, userId: string): MyConversation[] {
  return db.conversations
    .filter((c) => c.userId === userId && db.clubs[c.clubId])
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .map((c) => {
      const club = db.clubs[c.clubId]!;
      let last: ChatMessage | undefined;
      for (const m of db.messages) if (m.conversationId === c.id && !m.internal) last = m;
      return { conversation: c, club: { id: club.id, name: club.name, branding: club.branding, status: club.status }, last: last ? { body: last.body, from: last.from, at: last.at, automated: last.automated } : null };
    });
}

export function unreadMessages(db: DB, userId: string): number {
  let n = 0;
  for (const c of db.conversations) if (c.userId === userId) n += c.unreadPlayer;
  return n;
}

// ---------------------------------------------------------------------------
// Managing a conversation
// ---------------------------------------------------------------------------

export function setConversationStatus(db: DB, actorId: string, conversationId: string, status: Conversation['status']): void {
  const c = conversationById(db, conversationId);
  requirePermission(db, actorId, 'crm.messages', c.clubId);
  c.status = status;
  if (status === 'resolved') markRead(db, c, 'club');
}

export function assignConversation(db: DB, actorId: string, conversationId: string, staffId: string | null): void {
  const c = conversationById(db, conversationId);
  requirePermission(db, actorId, 'crm.messages', c.clubId);
  if (staffId !== null && !can(db, staffId, 'crm.messages', c.clubId)) fail('not_staff', 'Conversations can only be assigned to staff who answer messages.');
  c.assignedTo = staffId;
}

export function blockPlayer(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'crm.messages', clubId);
  requireKnown(db, clubId, userId);
  if (can(db, userId, 'console.access', clubId)) fail('is_staff', 'Staff of this club cannot be blocked.');
  if (blockOf(db, clubId, userId)) return;
  db.blocks.push({ clubId, userId, by: 'club', byUserId: actorId, at: clock.now() });
  audit(db, actorId, clubId, 'crm.player_blocked', { user: userOf(db, userId).name });
}

export function unblockPlayer(db: DB, actorId: string, clubId: string, userId: string): void {
  requirePermission(db, actorId, 'crm.messages', clubId);
  const block = blockOf(db, clubId, userId);
  if (!block || block.by !== 'club') return;
  db.blocks.splice(db.blocks.indexOf(block), 1);
  audit(db, actorId, clubId, 'crm.player_unblocked', { user: userOf(db, userId).name });
}

/** A player stops a club from writing to them. */
export function blockClub(db: DB, userId: string, clubId: string): void {
  clubOf(db, clubId);
  const existing = blockOf(db, clubId, userId);
  if (existing) return;
  db.blocks.push({ clubId, userId, by: 'player', byUserId: userId, at: clock.now() });
}

export function unblockClub(db: DB, userId: string, clubId: string): void {
  const block = blockOf(db, clubId, userId);
  if (block && block.by === 'player') db.blocks.splice(db.blocks.indexOf(block), 1);
}

export function reportConversation(db: DB, actorId: string, conversationId: string, reason: string): AbuseReport {
  const c = conversationById(db, conversationId);
  const side = sideOf(db, actorId, c);
  const text = reason.trim();
  if (text.length < 5) fail('bad_body', 'Say briefly what is wrong.');
  if (db.reports.some((r) => r.conversationId === c.id && r.reporterId === actorId && r.status === 'open')) fail('already_reported', 'You already reported this conversation. The platform team will review it.');
  const report: AbuseReport = { id: newId(db, 'rp'), clubId: c.clubId, conversationId: c.id, reporterId: actorId, side, reason: text.slice(0, 500), at: clock.now(), status: 'open' };
  db.reports.push(report);
  if (side === 'club') audit(db, actorId, c.clubId, 'crm.conversation_reported', { user: userOf(db, c.userId).name });
  for (const id in db.users) {
    if (isPlatformAdmin(db, id)) notify(db, id, 'support', 'notif.abuse_report', { club: clubOf(db, c.clubId).name }, { name: 'platform.support' }, { dedupeKey: `rp:${report.id}` });
  }
  return report;
}

export interface ReportView {
  report: AbuseReport;
  clubName: string;
  reporterName: string;
  /** The other party: the player when staff reported, the club when a player did. */
  aboutName: string;
}

/**
 * Reports for the platform team. They see who reported whom and the reason
 * given. They do not get the conversation itself: a club's messages stay with
 * the club.
 */
export function listReports(db: DB, actorId: string): ReportView[] {
  requirePlatform(db, actorId);
  return [...db.reports]
    .sort((a, b) => b.at - a.at)
    .map((report) => {
      const club = db.clubs[report.clubId];
      const c = db.conversations.find((x) => x.id === report.conversationId);
      const player = c ? (db.users[c.userId]?.name ?? '') : '';
      return { report, clubName: club?.name ?? '', reporterName: db.users[report.reporterId]?.name ?? '', aboutName: report.side === 'club' ? player : (club?.name ?? '') };
    });
}

export function reviewReport(db: DB, actorId: string, reportId: string): void {
  requirePlatform(db, actorId);
  const report = db.reports.find((r) => r.id === reportId) ?? fail('not_found', 'Report not found.');
  report.status = 'reviewed';
  audit(db, actorId, null, 'platform.report_reviewed', { club: db.clubs[report.clubId]?.name ?? '' });
}
