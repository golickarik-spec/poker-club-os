/**
 * Read-side helpers: derived views over the database used by the UI. Pure
 * functions, no mutation. Anything that changes data lives in `api.ts`.
 */
import { announcementsFor, canViewTournament, registeredCount, registrationOf } from './api.ts';
import { isLive } from './lifecycle.ts';
import { membershipOf } from './permissions.ts';
import type { Announcement, Club, DB, Follow, Membership, Tournament, TournamentResult } from './types.ts';

export function userClubs(db: DB, userId: string): { club: Club; membership: Membership }[] {
  return db.memberships
    .filter((m) => m.userId === userId && (m.status === 'active' || m.status === 'pending'))
    .map((m) => ({ club: db.clubs[m.clubId]!, membership: m }))
    .filter((x) => x.club)
    .sort((a, b) => Number(b.membership.status === 'active') - Number(a.membership.status === 'active') || a.club.name.localeCompare(b.club.name));
}

/** Clubs a person follows without being a member of them. */
export function followedClubs(db: DB, userId: string): { club: Club; follow: Follow }[] {
  return db.follows
    .filter((f) => f.userId === userId && db.clubs[f.clubId])
    .filter((f) => {
      const m = membershipOf(db, userId, f.clubId);
      return !m || (m.status !== 'active' && m.status !== 'pending');
    })
    .map((f) => ({ club: db.clubs[f.clubId]!, follow: f }))
    .sort((a, b) => a.club.name.localeCompare(b.club.name));
}

export function activeClubIds(db: DB, userId: string): string[] {
  return db.memberships.filter((m) => m.userId === userId && m.status === 'active').map((m) => m.clubId);
}

/** Clubs whose public or member content belongs in a person's own feed: the ones they belong to or follow. */
export function feedClubIds(db: DB, userId: string): string[] {
  return [...new Set([...activeClubIds(db, userId), ...db.follows.filter((f) => f.userId === userId).map((f) => f.clubId)])];
}

export function memberCount(db: DB, clubId: string): number {
  let n = 0;
  for (const m of db.memberships) if (m.clubId === clubId && m.status === 'active') n++;
  return n;
}

export function clubTournaments(db: DB, clubId: string): Tournament[] {
  return Object.values(db.tournaments).filter((t) => t.clubId === clubId);
}

/** May this person see the tournament in a schedule? Drafts never appear in player schedules. */
export function visibleTo(db: DB, t: Tournament, userId: string): boolean {
  return t.status !== 'DRAFT' && canViewTournament(db, userId, t);
}

const statusOrder = (t: Tournament): number => (isLive(t.status) ? 0 : t.status === 'REGISTRATION_OPEN' || t.status === 'REGISTRATION_CLOSED' ? 1 : t.status === 'SCHEDULED' ? 2 : 3);

/** Running first, then upcoming by start time, then finished (most recent first). */
export function scheduleOrder(a: Tournament, b: Tournament): number {
  const oa = statusOrder(a);
  const ob = statusOrder(b);
  if (oa !== ob) return oa - ob;
  if (oa === 3) return (b.completedAt ?? b.startAt) - (a.completedAt ?? a.startAt);
  const ka = a.startMode === 'when_full' ? Number.MAX_SAFE_INTEGER / 2 : a.startAt;
  const kb = b.startMode === 'when_full' ? Number.MAX_SAFE_INTEGER / 2 : b.startAt;
  return ka - kb;
}

/** A person's schedule: tournaments they may see, from the clubs they belong to or follow. */
export function tournamentsForUser(db: DB, userId: string): Tournament[] {
  const clubs = new Set(feedClubIds(db, userId));
  return Object.values(db.tournaments)
    .filter((t) => clubs.has(t.clubId) && visibleTo(db, t, userId))
    .sort(scheduleOrder);
}

/**
 * What one person can do about one tournament right now.
 *
 *  registered / requested / waitlisted   they hold that place
 *  invited          authorised by staff or an invitation; can take the seat now
 *  invited_waiting  authorised, registration is not open yet
 *  revoked          staff withdrew their place
 *  invite_only      by invitation, and they have none
 *  can_register / can_request / can_waitlist / can_late_register / can_late_request
 */
export type RegistrationState =
  | 'not_member'
  | 'club_suspended'
  | 'registered'
  | 'requested'
  | 'waitlisted'
  | 'invited'
  | 'invited_waiting'
  | 'revoked'
  | 'invite_only'
  | 'can_register'
  | 'can_request'
  | 'can_waitlist'
  | 'can_late_register'
  | 'can_late_request'
  | 'full'
  | 'not_open_yet'
  | 'closed'
  | 'finished';

export function registrationState(db: DB, t: Tournament, userId: string, lateRegistrationOpen: boolean): RegistrationState {
  const club = db.clubs[t.clubId];
  const reg = registrationOf(t, userId);
  if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return 'finished';
  if (reg?.status === 'registered') return 'registered';
  if (reg?.status === 'requested') return 'requested';
  if (reg?.status === 'waitlisted') return 'waitlisted';
  if (!club || club.status !== 'active') return 'club_suspended';
  const m = membershipOf(db, userId, t.clubId);
  if (!m || m.status !== 'active') return 'not_member';
  if (reg?.status === 'cancelled' && reg.cancelledBy === 'staff') return 'revoked';
  const authorised = reg?.status === 'approved';
  const late = (t.status === 'RUNNING' || t.status === 'PAUSED') && lateRegistrationOpen;
  const full = registeredCount(t) >= t.maxPlayers;
  if (authorised) {
    if (t.status === 'REGISTRATION_OPEN') return 'invited';
    if (late) return full ? 'full' : 'invited';
    return t.status === 'SCHEDULED' ? 'invited_waiting' : 'closed';
  }
  if (t.access === 'invite') return 'invite_only';
  if (t.status === 'SCHEDULED') return 'not_open_yet';
  if (t.status === 'REGISTRATION_OPEN') {
    if (t.access === 'approval') return 'can_request';
    if (full) return t.startMode === 'when_full' ? 'full' : 'can_waitlist';
    return 'can_register';
  }
  if (late) {
    if (t.access === 'approval') return 'can_late_request';
    return full ? 'full' : 'can_late_register';
  }
  return 'closed';
}

/** Does registering need the tournament's access code from this person? (The code itself is never sent to a screen.) */
export function needsAccessCode(t: Tournament, userId: string): boolean {
  return t.accessCode !== null && registrationOf(t, userId)?.status !== 'approved';
}

/** The people who played, or are due to: registrations while it is live or upcoming, the result afterwards. */
export function entrantIds(db: DB, t: Tournament): string[] {
  const seated = t.registrations.filter((r) => r.status === 'registered').map((r) => r.userId);
  if (seated.length > 0) return seated;
  return db.results[t.id]?.places.map((p) => p.userId) ?? [];
}

// ----- Results and statistics --------------------------------------------------------------

export function resultsFor(db: DB, filter: { clubId?: string; userId?: string }): TournamentResult[] {
  return Object.values(db.results)
    .filter((r) => (!filter.clubId || r.clubId === filter.clubId) && (!filter.userId || r.places.some((p) => p.userId === filter.userId)))
    .sort((a, b) => b.completedAt - a.completedAt);
}

export interface PlayerStats {
  tournaments: number;
  wins: number;
  finalTables: number;
  /** Mean finishing position. */
  averageFinish: number;
  /** Mean finish as a share of the field (0 = always first, 1 = always last). */
  averagePercentile: number;
  points: number;
  best: { place: number; entrants: number; name: string } | null;
  recent: { tournamentId: string; name: string; clubId: string; completedAt: number; place: number; entrants: number; points: number; seeded: boolean }[];
}

export function playerStats(db: DB, userId: string, clubId?: string): PlayerStats {
  const list = resultsFor(db, { userId, clubId });
  const stats: PlayerStats = { tournaments: 0, wins: 0, finalTables: 0, averageFinish: 0, averagePercentile: 0, points: 0, best: null, recent: [] };
  let sumPlace = 0;
  let sumPct = 0;
  for (const r of list) {
    const mine = r.places.find((p) => p.userId === userId);
    if (!mine) continue;
    stats.tournaments += 1;
    if (mine.place === 1) stats.wins += 1;
    // A final table only means something when there was more than one table to begin with.
    if (r.entrants > 9 && mine.place <= 9) stats.finalTables += 1;
    stats.points += mine.points;
    sumPlace += mine.place;
    sumPct += r.entrants > 1 ? (mine.place - 1) / (r.entrants - 1) : 0;
    if (!stats.best || mine.place / r.entrants < stats.best.place / stats.best.entrants) stats.best = { place: mine.place, entrants: r.entrants, name: r.name };
    stats.recent.push({ tournamentId: r.tournamentId, name: r.name, clubId: r.clubId, completedAt: r.completedAt, place: mine.place, entrants: r.entrants, points: mine.points, seeded: r.seeded });
  }
  if (stats.tournaments > 0) {
    stats.averageFinish = sumPlace / stats.tournaments;
    stats.averagePercentile = sumPct / stats.tournaments;
  }
  return stats;
}

export interface RankingRow {
  userId: string;
  name: string;
  isBot: boolean;
  hue: number;
  points: number;
  played: number;
  wins: number;
  best: number;
}

/** Club ranking: ranking points summed over the club's completed tournaments. */
export function clubRanking(db: DB, clubId: string, sinceMs = 0): RankingRow[] {
  const rows = new Map<string, RankingRow>();
  for (const r of Object.values(db.results)) {
    if (r.clubId !== clubId || r.completedAt < sinceMs) continue;
    for (const p of r.places) {
      const u = db.users[p.userId];
      let row = rows.get(p.userId);
      if (!row) {
        row = { userId: p.userId, name: u?.name ?? p.name, isBot: u?.isBot ?? p.isBot, hue: u?.hue ?? 200, points: 0, played: 0, wins: 0, best: p.place };
        rows.set(p.userId, row);
      }
      row.points += p.points;
      row.played += 1;
      if (p.place === 1) row.wins += 1;
      row.best = Math.min(row.best, p.place);
    }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
}

export function unreadCount(db: DB, userId: string): number {
  let n = 0;
  for (const x of db.notifications) if (x.userId === userId && !x.read) n++;
  return n;
}

/** Announcements this person may read from these clubs. Audience rules are applied by the service layer. */
export function clubAnnouncements(db: DB, userId: string, clubIds: string[]): Announcement[] {
  return announcementsFor(db, userId, clubIds);
}

export function pendingMemberCount(db: DB, clubId: string): number {
  let n = 0;
  for (const m of db.memberships) if (m.clubId === clubId && m.status === 'pending') n++;
  return n;
}
