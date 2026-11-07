/**
 * Main-pot / side-pot construction.
 *
 * Input is every player's total live contribution for the hand (folded players
 * included: their chips stay in the middle) plus any dead money (for example a
 * big-blind ante). Output is an ordered list of pots, main pot first, each with
 * the seats eligible to win it.
 */
export interface Contribution {
  seat: number;
  committed: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  eligible: number[];
}

export function buildPots(contributions: readonly Contribution[], deadMoney = 0): Pot[] {
  const live = contributions.filter((c) => !c.folded);
  if (live.length === 0) return [];

  const levels = [...new Set(live.map((c) => c.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  let dead = deadMoney;

  for (const level of levels) {
    let amount = 0;
    for (const c of contributions) {
      amount += Math.min(c.committed, level) - Math.min(c.committed, previous);
    }
    const eligible = live.filter((c) => c.committed >= level).map((c) => c.seat);
    // Dead money sits at the bottom of the main pot: everyone still in is eligible for it.
    if (dead > 0) {
      amount += dead;
      dead = 0;
    }
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && sameSeats(last.eligible, eligible)) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    previous = level;
  }

  // Chips committed above the highest live level can only come from folded
  // players; they belong to the last pot.
  let overflow = 0;
  for (const c of contributions) overflow += Math.max(0, c.committed - previous);
  if (overflow > 0) {
    const last = pots[pots.length - 1];
    if (last) last.amount += overflow;
    else pots.push({ amount: overflow, eligible: live.map((c) => c.seat) });
  }
  return pots;
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const potTotal = (pots: readonly Pot[]): number => pots.reduce((sum, p) => sum + p.amount, 0);
