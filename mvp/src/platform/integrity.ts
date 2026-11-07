/**
 * Integrity cases (v0.4). Signals are computed from the club's tournament history — who busted
 * whom, who finishes together, who wins far more than a field of that size would suggest — and
 * kept as cases that a person reviews. Everything here is derived from SIMULATED demo play and
 * is labelled as such in the UI; a signal is a reason to look, never a verdict. Nothing here
 * suspends, bans or changes anyone's standing.
 */
import { audit, clock, fail } from './core.ts';
import { can, isPlatformAdmin, requirePermission, requirePlatform } from './permissions.ts';
import type { DB, IntegrityCase, IntegritySignal } from './types.ts';

const MIN_SHARED = 4;

interface PairStat {
  a: string;
  b: string;
  shared: number;
  /** Times one busted the other, either direction. */
  busts: number;
  expectedBusts: number;
  /** Tournaments where both finished in the top three. */
  topTogether: number;
  expectedTopTogether: number;
  tournamentIds: string[];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface ScanHit {
  key: string;
  accounts: string[];
  tournamentIds: string[];
  signals: IntegritySignal[];
}

/** Signals for one club from its completed results. Pure. */
export function scanClub(db: DB, clubId: string): ScanHit[] {
  const results = Object.values(db.results).filter((r) => r.clubId === clubId && r.entrants >= 6);
  const pairs = new Map<string, PairStat>();
  const wins = new Map<string, { played: number; wins: number; expected: number; tournamentIds: string[] }>();
  for (const r of results) {
    const ids = r.places.map((p) => p.userId);
    const n = r.entrants;
    for (const p of r.places) {
      const w = wins.get(p.userId) ?? { played: 0, wins: 0, expected: 0, tournamentIds: [] };
      w.played++;
      w.expected += 1 / n;
      w.tournamentIds.push(r.tournamentId);
      if (p.place === 1) w.wins++;
      wins.set(p.userId, w);
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i]!, ids[j]!);
        const s = pairs.get(key) ?? { a: ids[i]!, b: ids[j]!, shared: 0, busts: 0, expectedBusts: 0, topTogether: 0, expectedTopTogether: 0, tournamentIds: [] };
        s.shared++;
        s.tournamentIds.push(r.tournamentId);
        // Each elimination has (n−1) possible authors, so two given players bust each other roughly 2/(n−1) times per tournament.
        s.expectedBusts += 2 / Math.max(1, n - 1);
        s.expectedTopTogether += (3 / n) * (2 / Math.max(1, n - 1));
        const pa = r.places[i]!;
        const pb = r.places[j]!;
        if (pa.bustedBy === pb.userId || pb.bustedBy === pa.userId) s.busts++;
        if (pa.place <= 3 && pb.place <= 3) s.topTogether++;
        pairs.set(key, s);
      }
    }
  }
  const hits: ScanHit[] = [];
  for (const [key, s] of pairs) {
    if (s.shared < MIN_SHARED) continue;
    const signals: IntegritySignal[] = [];
    if (s.busts >= 4 && s.busts >= s.expectedBusts * 3.5) {
      signals.push({ type: 'bust_pattern', strength: Math.min(0.95, 0.4 + (s.busts - s.expectedBusts * 3.5) / 6), detail: { busts: s.busts, expected: Math.round(s.expectedBusts * 10) / 10, shared: s.shared } });
    }
    if (s.topTogether >= 4 && s.topTogether >= s.expectedTopTogether * 5) {
      signals.push({ type: 'co_finish', strength: Math.min(0.9, 0.35 + s.topTogether / 10), detail: { together: s.topTogether, expected: Math.round(s.expectedTopTogether * 10) / 10, shared: s.shared } });
    }
    if (signals.length > 0) hits.push({ key, accounts: [s.a, s.b], tournamentIds: s.tournamentIds, signals });
  }
  for (const [id, w] of wins) {
    if (w.played < 8) continue;
    if (w.wins >= 4 && w.wins >= w.expected * 4) {
      hits.push({ key: id, accounts: [id], tournamentIds: w.tournamentIds, signals: [{ type: 'win_rate', strength: Math.min(0.9, 0.3 + w.wins / Math.max(1, w.expected) / 20), detail: { wins: w.wins, expected: Math.round(w.expected * 10) / 10, played: w.played } }] });
    }
  }
  return hits;
}

const scoreOf = (signals: IntegritySignal[]): number => Math.round((1 - signals.reduce((p, s) => p * (1 - s.strength), 1)) * 100);

/**
 * Runs the scan for one club (or every club) and upserts cases: new signals open a case, an
 * existing open case is refreshed, a case that was cleared stays cleared unless the signals
 * grow stronger. Returns the number of cases created or updated.
 */
export function runScan(db: DB, actorId: string, clubId: string | null): number {
  if (clubId) requirePermission(db, actorId, 'audit.view', clubId);
  else requirePlatform(db, actorId);
  const now = clock.now();
  let touched = 0;
  const clubIds = clubId ? [clubId] : Object.keys(db.clubs);
  for (const cid of clubIds) {
    for (const hit of scanClub(db, cid)) {
      const score = scoreOf(hit.signals);
      const existing = db.integrity.find((c) => c.clubId === cid && c.key === hit.key);
      if (existing) {
        if (existing.status === 'cleared' && score <= existing.score) continue;
        existing.signals = hit.signals;
        existing.score = score;
        existing.tournamentIds = hit.tournamentIds;
        existing.updatedAt = now;
        if (existing.status === 'cleared') existing.status = 'new';
      } else {
        db.integrity.push({ id: `IC-${String(db.integrity.length + 1).padStart(4, '0')}`, key: hit.key, clubId: cid, accounts: hit.accounts, signals: hit.signals, score, tournamentIds: hit.tournamentIds, status: 'new', notes: [], createdAt: now, updatedAt: now, source: 'simulated_scan' });
      }
      touched++;
    }
  }
  audit(db, actorId, clubId, 'integrity.scanned', { count: touched });
  return touched;
}

export function listCases(db: DB, actorId: string, clubId: string | null): IntegrityCase[] {
  if (clubId) requirePermission(db, actorId, 'audit.view', clubId);
  else requirePlatform(db, actorId);
  return db.integrity.filter((c) => clubId === null || c.clubId === clubId).sort((a, b) => order(a.status) - order(b.status) || b.score - a.score);
}

const order = (s: IntegrityCase['status']): number => ({ new: 0, reviewing: 1, escalated: 2, cleared: 3 })[s];

export function setCaseStatus(db: DB, actorId: string, caseId: string, status: IntegrityCase['status'], note = ''): IntegrityCase {
  const c = db.integrity.find((x) => x.id === caseId);
  if (!c) return fail('not_found', 'Case not found.');
  if (!(isPlatformAdmin(db, actorId) || can(db, actorId, 'audit.view', c.clubId))) fail('forbidden', 'Your role does not allow that.');
  const now = clock.now();
  c.status = status;
  c.updatedAt = now;
  c.notes.push({ at: now, by: actorId, status, text: note.trim().slice(0, 500) });
  audit(db, actorId, c.clubId, 'integrity.case_updated', { id: c.id, status });
  return c;
}

/** Seeds a scan once so the demo queue is not empty. Called from the seed. */
export function seedScan(db: DB, now: number): void {
  for (const cid of Object.keys(db.clubs)) {
    for (const hit of scanClub(db, cid)) {
      db.integrity.push({ id: `IC-${String(db.integrity.length + 1).padStart(4, '0')}`, key: hit.key, clubId: cid, accounts: hit.accounts, signals: hit.signals, score: scoreOf(hit.signals), tournamentIds: hit.tournamentIds, status: 'new', notes: [], createdAt: now - 86_400_000, updatedAt: now - 86_400_000, source: 'simulated_scan' });
    }
  }
}
