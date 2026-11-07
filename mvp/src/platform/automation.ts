/**
 * Club automations: five rules a club can switch on or off.
 *
 *   welcome             send a message when a membership is approved
 *   reminder            remind registered players shortly before a tournament
 *   new_tournament      tell followers who asked for updates about a new public tournament
 *   membership_request  tell staff when someone asks to join
 *   inactive            tag members who have stopped playing
 *
 * Every execution is written to the run history with what it did. A trigger
 * that already ran is not run again (`dedupeKey`), and an error in one rule is
 * recorded on its run instead of stopping the caller.
 *
 * In the prototype the time-based rules are evaluated by the tournament runtime
 * in the browser tab, so they only fire while the tab is open.
 */
import { compute } from './analytics.ts';
import { runPersonalReminders } from './calendar.ts';
import { runInactivityAlerts } from './retention.ts';
import { runSchedules } from './scheduling.ts';
import { applyTag, clearTag, INACTIVE_TAG, defaultRule } from './crm.ts';
import { audit, clock, crmSettings, DAY, DEFAULT_CRM_SETTINGS, deliver, fail, MIN, newId, notify } from './core.ts';
import { sendSystemMessage } from './messaging.ts';
import { can, requirePermission } from './permissions.ts';
import type { AutomationKey, AutomationRule, AutomationRun, DB, Tournament } from './types.ts';

function ruleOf(db: DB, clubId: string, key: AutomationKey): AutomationRule {
  let rule = db.crm.rules.find((r) => r.clubId === clubId && r.key === key);
  if (!rule) {
    rule = defaultRule(clubId, key, clock.now());
    db.crm.rules.push(rule);
  }
  return rule;
}

const alreadyRan = (db: DB, dedupeKey: string): boolean => db.crm.runs.some((r) => r.dedupeKey === dedupeKey);

function record(db: DB, run: Omit<AutomationRun, 'id' | 'at'>): AutomationRun {
  const full: AutomationRun = { id: newId(db, 'run'), at: clock.now(), ...run };
  db.crm.runs.push(full);
  if (db.crm.runs.length > 1500) db.crm.runs.splice(0, db.crm.runs.length - 1500);
  return full;
}

/** Run one rule's work, turning an unexpected failure into an `error` entry in the history. */
function attempt(db: DB, clubId: string, key: AutomationKey, trigger: AutomationRun['trigger'], dedupeKey: string, work: () => Pick<AutomationRun, 'targets' | 'delivered' | 'skipped' | 'detail'>): AutomationRun | null {
  const club = db.clubs[clubId];
  if (!club || club.status !== 'active') return null;
  if (!ruleOf(db, clubId, key).enabled) return null;
  if (alreadyRan(db, dedupeKey)) return null;
  try {
    const outcome = work();
    return record(db, { clubId, key, trigger, dedupeKey, status: outcome.targets === 0 ? 'nothing_to_do' : 'ok', ...outcome });
  } catch (err) {
    return record(db, { clubId, key, trigger, dedupeKey, status: 'error', targets: 0, delivered: 0, skipped: 0, detail: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Triggers called by the service layer
// ---------------------------------------------------------------------------

/** A: welcome message. */
export function onMembershipApproved(db: DB, clubId: string, userId: string, approvedAt: number): void {
  const name = db.users[userId]?.name ?? '';
  attempt(db, clubId, 'welcome', { key: 'automation.trigger.approved', params: { user: name } }, `welcome:${clubId}:${userId}:${approvedAt}`, () => {
    const text = ruleOf(db, clubId, 'welcome').message.trim();
    if (!text) return { targets: 1, delivered: 0, skipped: 1, detail: 'empty_message' };
    const sent = sendSystemMessage(db, clubId, userId, text);
    return { targets: 1, delivered: sent ? 1 : 0, skipped: sent ? 0 : 1, detail: sent ? '' : 'blocked_by_player' };
  });
}

/** D: tell the people who decide on requests. */
export function onMembershipRequested(db: DB, clubId: string, userId: string, requestedAt: number): void {
  const user = db.users[userId];
  const club = db.clubs[clubId];
  if (!user || !club) return;
  attempt(db, clubId, 'membership_request', { key: 'automation.trigger.requested', params: { user: user.name } }, `req:${clubId}:${userId}:${requestedAt}`, () => {
    let targets = 0;
    let delivered = 0;
    for (const m of db.memberships) {
      if (m.clubId !== clubId || m.status !== 'active' || !can(db, m.userId, 'members.approve', clubId)) continue;
      targets++;
      const outcome = notify(db, m.userId, 'membership', 'notif.join_request', { user: user.name, club: club.name }, { name: 'console.crm.requests', params: { clubId } }, { clubId, dedupeKey: `req:${clubId}:${userId}:${requestedAt}` });
      if (outcome === 'delivered') delivered++;
    }
    return { targets, delivered, skipped: targets - delivered, detail: '' };
  });
}

/** Followers who asked for a club's updates and are not already members (members hear about tournaments anyway). */
function optedInFollowers(db: DB, clubId: string): string[] {
  const members = new Set(db.memberships.filter((m) => m.clubId === clubId && (m.status === 'active' || m.status === 'banned')).map((m) => m.userId));
  return db.follows.filter((f) => f.clubId === clubId && f.notify && !members.has(f.userId)).map((f) => f.userId);
}

/** C: a public tournament was published. Private tournaments are never announced to followers. */
export function onTournamentPublished(db: DB, t: Tournament): void {
  if (t.visibility !== 'public') return;
  const club = db.clubs[t.clubId];
  if (!club) return;
  attempt(db, t.clubId, 'new_tournament', { key: 'automation.trigger.published', params: { name: t.name } }, `pub:${t.id}`, () => {
    const audience = optedInFollowers(db, t.clubId);
    const batch = deliver(
      db,
      { clubId: t.clubId, kind: 'tournament', refId: t.id, notificationKind: 'announcement', key: 'notif.new_public_tournament', params: { club: club.name, name: t.name }, link: { name: 'tournament', params: { id: t.id } }, dedupePrefix: `pub:${t.id}` },
      audience,
    );
    return { targets: batch.eligible, delivered: batch.delivered.length, skipped: batch.optedOut, detail: '' };
  });
}

// ---------------------------------------------------------------------------
// Time-based rules
// ---------------------------------------------------------------------------

/** B: reminders for tournaments about to start. */
function runReminders(db: DB, now: number): boolean {
  let changed = false;
  for (const id in db.tournaments) {
    const t = db.tournaments[id]!;
    if (t.startMode !== 'scheduled' || (t.status !== 'REGISTRATION_OPEN' && t.status !== 'REGISTRATION_CLOSED')) continue;
    const rule = db.crm.rules.find((r) => r.clubId === t.clubId && r.key === 'reminder');
    const minutesBefore = rule?.minutesBefore ?? 15;
    if (now < t.startAt - minutesBefore * MIN || now >= t.startAt) continue;
    const run = attempt(db, t.clubId, 'reminder', { key: 'automation.trigger.starting', params: { name: t.name } }, `rem:${t.id}:${t.startAt}`, () => {
      const players = t.registrations.filter((r) => r.status === 'registered').map((r) => r.userId);
      const minutes = Math.max(1, Math.ceil((t.startAt - now) / MIN));
      const batch = deliver(
        db,
        { clubId: t.clubId, kind: 'reminder', refId: t.id, notificationKind: 'reminder', key: 'notif.starting_soon', params: { name: t.name, minutes }, link: { name: 'tournament', params: { id: t.id } }, dedupePrefix: `rem:${t.id}:${t.startAt}` },
        players,
      );
      return { targets: batch.eligible, delivered: batch.delivered.length, skipped: batch.optedOut, detail: '' };
    });
    if (run) changed = true;
  }
  return changed;
}

/** One definition of an inactive member, shared with the overview figure. */
const inactiveMembers = (db: DB, clubId: string, now: number): string[] => compute.inactiveMemberIds(db, clubId, now);

function inactiveTagId(db: DB, clubId: string, create: boolean): string | null {
  const existing = db.crm.tags.find((t) => t.clubId === clubId && t.name === INACTIVE_TAG);
  if (existing) return existing.id;
  if (!create) return null;
  const tag = { id: newId(db, 'tag'), clubId, name: INACTIVE_TAG, color: 'slate' as const, createdAt: clock.now() };
  db.crm.tags.push(tag);
  return tag.id;
}

/**
 * E: keep the "Inactive Member" tag in step with who has actually stopped
 * playing. It only tags; it never writes to players. The club decides what to
 * do with the list (for example an announcement to that segment).
 */
function runInactive(db: DB, clubId: string, now: number, dedupeKey: string): AutomationRun | null {
  return attempt(db, clubId, 'inactive', { key: 'automation.trigger.daily', params: { days: crmSettings(db, clubId).inactiveDays } }, dedupeKey, () => {
    const inactive = inactiveMembers(db, clubId, now);
    const tagId = inactiveTagId(db, clubId, inactive.length > 0);
    if (!tagId) return { targets: 0, delivered: 0, skipped: 0, detail: '' };
    let tagged = 0;
    for (const userId of inactive) if (applyTag(db, clubId, userId, tagId, null)) tagged++;
    const still = new Set(inactive);
    let cleared = 0;
    for (const key in db.crm.profiles) {
      const p = db.crm.profiles[key]!;
      if (p.clubId === clubId && p.tagIds.includes(tagId) && !still.has(p.userId) && clearTag(db, clubId, p.userId, tagId, null)) cleared++;
    }
    return { targets: inactive.length, delivered: tagged, skipped: inactive.length - tagged, detail: cleared > 0 ? `cleared:${cleared}` : '' };
  });
}

const dayKey = (ms: number): number => Math.floor(ms / DAY);

/** Called by the runtime on its timer. Returns true when anything changed. */
export function tick(db: DB, now: number = clock.now()): boolean {
  let changed = runReminders(db, now);
  if (runPersonalReminders(db, now)) changed = true;
  if (runInactivityAlerts(db, now)) changed = true;
  if (runSchedules(db, now) > 0) changed = true;
  for (const clubId in db.clubs) {
    if (runInactive(db, clubId, now, `inactive:${clubId}:${dayKey(now)}`)) changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// What the console calls
// ---------------------------------------------------------------------------

export interface RuleView extends AutomationRule {
  /** The inactive period comes from the club's CRM settings, so there is one definition of "inactive". */
  inactiveDays: number;
  lastRun: AutomationRun | null;
  runs: number;
}

export function listRules(db: DB, actorId: string, clubId: string): RuleView[] {
  requirePermission(db, actorId, 'members.view', clubId);
  const settings = crmSettings(db, clubId);
  return (['welcome', 'reminder', 'new_tournament', 'membership_request', 'inactive'] as AutomationKey[]).map((key) => {
    const rule = ruleOf(db, clubId, key);
    const runs = db.crm.runs.filter((r) => r.clubId === clubId && r.key === key);
    return { ...rule, inactiveDays: settings.inactiveDays, lastRun: runs[runs.length - 1] ?? null, runs: runs.length };
  });
}

export function listRuns(db: DB, actorId: string, clubId: string, key?: AutomationKey): AutomationRun[] {
  requirePermission(db, actorId, 'members.view', clubId);
  return db.crm.runs.filter((r) => r.clubId === clubId && (!key || r.key === key)).sort((a, b) => b.at - a.at).slice(0, 80);
}

export function updateRule(db: DB, actorId: string, clubId: string, key: AutomationKey, patch: { enabled?: boolean; message?: string; minutesBefore?: number; inactiveDays?: number }): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const rule = ruleOf(db, clubId, key);
  if (patch.message !== undefined) {
    const text = patch.message.trim();
    if (key === 'welcome' && (text.length < 5 || text.length > 600)) fail('bad_body', 'The welcome message needs 5 to 600 characters.');
    rule.message = text;
  }
  if (patch.minutesBefore !== undefined) {
    if (!Number.isInteger(patch.minutesBefore) || patch.minutesBefore < 1 || patch.minutesBefore > 180) fail('bad_limit', 'Send the reminder 1 to 180 minutes before the start.');
    rule.minutesBefore = patch.minutesBefore;
  }
  if (patch.inactiveDays !== undefined) {
    const current = db.crm.settings[clubId] ?? { ...DEFAULT_CRM_SETTINGS };
    if (!Number.isInteger(patch.inactiveDays) || patch.inactiveDays < current.activeDays || patch.inactiveDays > 730) fail('bad_periods', `The inactive period must be between ${current.activeDays} and 730 days.`);
    db.crm.settings[clubId] = { ...current, inactiveDays: patch.inactiveDays };
  }
  if (patch.enabled !== undefined) rule.enabled = patch.enabled;
  rule.updatedAt = clock.now();
  rule.updatedBy = actorId;
  audit(db, actorId, clubId, 'crm.automation_updated', { rule: key, enabled: rule.enabled ? 'on' : 'off' });
}

export interface RulePreview {
  /** How many people the rule would reach if it ran now. */
  audience: number;
  /** Names of a few of them. */
  sample: string[];
  /** The tournament a reminder would be about, when there is one coming up. */
  tournament: { name: string; startAt: number } | null;
  /** The text players would receive, for rules that send text. */
  text: string | null;
}

/** What a rule would do right now, without doing it. */
export function previewRule(db: DB, actorId: string, clubId: string, key: AutomationKey): RulePreview {
  requirePermission(db, actorId, 'members.view', clubId);
  const now = clock.now();
  const names = (ids: string[]): string[] => ids.slice(0, 5).map((id) => db.users[id]?.name ?? '');
  const out: RulePreview = { audience: 0, sample: [], tournament: null, text: null };
  let ids: string[] = [];
  switch (key) {
    case 'welcome':
      // The next people to get it are the ones waiting for a decision.
      ids = db.memberships.filter((m) => m.clubId === clubId && m.status === 'pending').map((m) => m.userId);
      out.text = ruleOf(db, clubId, 'welcome').message;
      break;
    case 'reminder': {
      const next = Object.values(db.tournaments)
        .filter((t) => t.clubId === clubId && t.startMode === 'scheduled' && (t.status === 'REGISTRATION_OPEN' || t.status === 'REGISTRATION_CLOSED') && t.startAt > now)
        .sort((a, b) => a.startAt - b.startAt)[0];
      if (next) {
        out.tournament = { name: next.name, startAt: next.startAt };
        ids = next.registrations.filter((r) => r.status === 'registered').map((r) => r.userId);
      }
      break;
    }
    case 'new_tournament':
      ids = optedInFollowers(db, clubId);
      break;
    case 'membership_request':
      ids = db.memberships.filter((m) => m.clubId === clubId && m.status === 'active' && can(db, m.userId, 'members.approve', clubId)).map((m) => m.userId);
      break;
    case 'inactive':
      ids = inactiveMembers(db, clubId, now);
      break;
  }
  out.audience = ids.length;
  out.sample = names(ids);
  return out;
}

/** Run the inactive-player check now instead of waiting for the daily pass. */
export function runInactiveNow(db: DB, actorId: string, clubId: string): AutomationRun {
  requirePermission(db, actorId, 'crm.configure', clubId);
  if (!ruleOf(db, clubId, 'inactive').enabled) fail('rule_off', 'Switch the rule on first.');
  const now = clock.now();
  return runInactive(db, clubId, now, `inactive:${clubId}:manual:${now}:${db.nextId}`) ?? fail('club_suspended', 'This club is suspended.');
}
