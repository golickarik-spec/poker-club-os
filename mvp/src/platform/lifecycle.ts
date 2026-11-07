/**
 * Tournament lifecycle state machine.
 *
 *   DRAFT ──publish──▶ SCHEDULED ──▶ REGISTRATION_OPEN ⇄ REGISTRATION_CLOSED
 *                                          │                    │
 *                                          └──────▶ SEATING ◀───┘
 *                                                     │
 *                                                  RUNNING ⇄ PAUSED
 *                                                     │
 *                                                 COMPLETED
 *
 * Every state before COMPLETED can go to CANCELLED. COMPLETED and CANCELLED
 * are terminal: a finished tournament can be duplicated, never restarted.
 */
import { DomainError, type TournamentStatus } from './types.ts';

export const TRANSITIONS: Record<TournamentStatus, readonly TournamentStatus[]> = {
  DRAFT: ['SCHEDULED', 'REGISTRATION_OPEN', 'CANCELLED'],
  SCHEDULED: ['REGISTRATION_OPEN', 'DRAFT', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'SEATING', 'CANCELLED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'SEATING', 'CANCELLED'],
  SEATING: ['RUNNING', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const canTransition = (from: TournamentStatus, to: TournamentStatus): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: TournamentStatus, to: TournamentStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('bad_transition', `A tournament cannot go from ${from} to ${to}.`);
  }
}

export const isTerminal = (status: TournamentStatus): boolean => status === 'COMPLETED' || status === 'CANCELLED';
export const isLive = (status: TournamentStatus): boolean => status === 'SEATING' || status === 'RUNNING' || status === 'PAUSED';
export const isUpcoming = (status: TournamentStatus): boolean =>
  status === 'SCHEDULED' || status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED';
/** States in which staff may still edit the configuration. */
export const isEditable = (status: TournamentStatus): boolean => status === 'DRAFT' || status === 'SCHEDULED';
