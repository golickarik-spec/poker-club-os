/**
 * Notification channels (v0.4), provider-agnostic. The in-app channel is the only one that
 * really delivers in this prototype. Email, SMS, WhatsApp and push go through a demo adapter
 * that writes to an outbox and marks every message `simulated`; nothing is sent, and the UI
 * says so. A production deployment registers real adapters here (server-side, with the
 * provider secrets in server configuration, never in this bundle).
 */
import { clock, newId } from './core.ts';
import type { DB, NotificationChannel, OutboxMessage } from './types.ts';

export const CHANNELS: readonly NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];

export interface ChannelAdapter {
  id: NotificationChannel;
  /** True when messages through this adapter actually reach people. */
  real: boolean;
  send(db: DB, msg: Omit<OutboxMessage, 'id' | 'status' | 'at'>): OutboxMessage['status'];
}

/** In-app: the notification row is written by `notify`; the adapter only reports it. */
const inApp: ChannelAdapter = { id: 'in_app', real: true, send: () => 'delivered' };

/** Demo adapter for external channels: records the intent, never claims delivery. */
const demo = (id: NotificationChannel): ChannelAdapter => ({ id, real: false, send: () => 'simulated' });

const registry = new Map<NotificationChannel, ChannelAdapter>([
  ['in_app', inApp],
  ['email', demo('email')],
  ['sms', demo('sms')],
  ['whatsapp', demo('whatsapp')],
  ['push', demo('push')],
]);

export function adapterFor(channel: NotificationChannel): ChannelAdapter {
  return registry.get(channel)!;
}

/** Production hook: replace a demo adapter with a real one. */
export function registerAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.id, adapter);
}

/** Which extra channels this person turned on (in-app is always on). */
export function enabledChannels(db: DB, userId: string): NotificationChannel[] {
  const prefs = db.settings[userId]?.channels;
  if (!prefs) return [];
  return CHANNELS.filter((c) => c !== 'in_app' && prefs[c]);
}

/** Fans one in-app notification out to the person's other channels through their adapters. */
export function fanOut(db: DB, userId: string, key: string, params: Record<string, string | number>, clubId: string | null): OutboxMessage[] {
  const out: OutboxMessage[] = [];
  for (const channel of enabledChannels(db, userId)) {
    const adapter = adapterFor(channel);
    const base = { channel, userId, key, params, clubId, simulatedBy: adapter.real ? null : 'demo_adapter' as const };
    const status = adapter.send(db, base);
    const msg: OutboxMessage = { id: newId(db, 'ob'), at: clock.now(), status, ...base };
    db.outbox.push(msg);
    out.push(msg);
  }
  if (db.outbox.length > 500) db.outbox.splice(0, db.outbox.length - 500);
  return out;
}

export function outboxFor(db: DB, clubId: string | null): OutboxMessage[] {
  return db.outbox.filter((m) => clubId === null || m.clubId === clubId).sort((a, b) => b.at - a.at);
}

/** Honest totals per channel: delivered only ever counts the in-app channel. */
export function channelSummary(db: DB, clubId: string | null): Record<NotificationChannel, { simulated: number; delivered: number; real: boolean }> {
  const out = Object.fromEntries(CHANNELS.map((c) => [c, { simulated: 0, delivered: 0, real: adapterFor(c).real }])) as Record<NotificationChannel, { simulated: number; delivered: number; real: boolean }>;
  for (const m of outboxFor(db, clubId)) {
    if (m.status === 'delivered') out[m.channel].delivered++;
    else out[m.channel].simulated++;
  }
  out.in_app.delivered = db.notifications.filter((n) => clubId === null || n.clubId === clubId).length;
  return out;
}
