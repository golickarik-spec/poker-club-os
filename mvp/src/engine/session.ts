/**
 * Authoritative command handling for a table.
 *
 * Every player command carries the hand number, the action sequence number the
 * client last saw, and a client-generated action id. That gives three
 * guarantees regardless of transport:
 *
 *  - a command for a previous hand is rejected (`wrong_hand`);
 *  - a command based on stale state is rejected (`stale`);
 *  - a command delivered twice (retry after a dropped connection, double tap)
 *    is acknowledged once and applied once (`duplicate: true`).
 *
 * In the prototype this runs in the browser next to the UI. It contains no UI
 * or timer code, so the same module can sit behind a WebSocket on a server.
 */
import { ActionError, applyAction, type ActionErrorCode, type PlayerAction, type TableState } from './holdem.ts';

export interface ActionCommand {
  seat: number;
  handNo: number;
  seq: number;
  actionId: string;
  action: PlayerAction;
}

export type CommandResult =
  | { ok: true; duplicate: boolean; seq: number }
  | { ok: false; code: ActionErrorCode | 'stale' | 'wrong_hand'; message: string };

export function submitCommand(table: TableState, cmd: ActionCommand): CommandResult {
  const hand = table.hand;
  if (!hand || hand.handNo !== cmd.handNo) {
    return { ok: false, code: 'wrong_hand', message: 'That hand is no longer in progress' };
  }
  if (Object.prototype.hasOwnProperty.call(hand.applied, cmd.actionId)) {
    return { ok: true, duplicate: true, seq: hand.seq };
  }
  if (hand.street === 'complete') {
    return { ok: false, code: 'no_hand', message: 'The hand is over' };
  }
  if (cmd.seq !== hand.seq) {
    return { ok: false, code: 'stale', message: 'The table has moved on since this action was sent' };
  }
  try {
    applyAction(table, cmd.seat, cmd.action);
  } catch (err) {
    if (err instanceof ActionError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
  hand.applied[cmd.actionId] = cmd.seq;
  return { ok: true, duplicate: false, seq: hand.seq };
}

let counter = 0;
/** Client-side unique id for an action. */
export function newActionId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
