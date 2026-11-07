/**
 * Blind structures and tournament presets.
 */
import type { AnteType, Blinds } from './holdem.ts';

export type StructureEntry =
  | { kind: 'level'; sb: number; bb: number; ante: number; minutes: number }
  | { kind: 'break'; minutes: number };

export interface TournamentStructure {
  startingStack: number;
  /** Seats per table, 2–9. */
  tableSize: number;
  anteType: AnteType;
  entries: StructureEntry[];
  /** Late registration stays open through this level number (0 = closes when play starts). */
  lateRegLevels: number;
}

export type PresetId = 'turbo' | 'regular' | 'deep' | 'sng' | 'custom';

/** Small-blind ladders (the big blind is always double). */
const LADDERS = {
  slow: [
    10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000,
    5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000, 120000, 150000, 200000,
  ],
  standard: [
    10, 15, 25, 50, 75, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000,
    30000, 40000, 50000, 60000, 80000, 100000, 150000, 200000,
  ],
  fast: [
    10, 15, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000, 15000, 20000, 30000, 40000,
    60000, 80000, 100000, 150000, 200000,
  ],
} as const;

export type Pace = keyof typeof LADDERS;

export interface StructureOptions {
  startingStack: number;
  tableSize: number;
  levelMinutes: number;
  /** Small blind of the first level. */
  startSb: number;
  levels: number;
  /** How quickly the blinds climb from level to level. */
  pace: Pace;
  anteType: AnteType;
  /** First level number that carries an ante (ignored when anteType is 'none'). */
  anteFromLevel: number;
  /** Insert a break after every N levels (0 = no breaks). */
  breakEvery: number;
  breakMinutes: number;
  lateRegLevels: number;
}

export function buildStructure(o: StructureOptions): TournamentStructure {
  const ladder: readonly number[] = LADDERS[o.pace];
  let start = ladder.findIndex((sb) => sb >= o.startSb);
  if (start < 0) start = 0;
  const entries: StructureEntry[] = [];
  for (let i = 0; i < o.levels; i++) {
    const sb = ladder[start + i] ?? ladder[ladder.length - 1]! * 2 ** (start + i - ladder.length + 1);
    const bb = sb * 2;
    const levelNo = i + 1;
    const hasAnte = o.anteType !== 'none' && levelNo >= o.anteFromLevel;
    const ante = !hasAnte ? 0 : o.anteType === 'bb' ? bb : Math.max(1, roundNice(bb / 8));
    entries.push({ kind: 'level', sb, bb, ante, minutes: o.levelMinutes });
    if (o.breakEvery > 0 && levelNo % o.breakEvery === 0 && levelNo < o.levels) {
      entries.push({ kind: 'break', minutes: o.breakMinutes });
    }
  }
  return {
    startingStack: o.startingStack,
    tableSize: o.tableSize,
    anteType: o.anteType,
    entries,
    lateRegLevels: o.lateRegLevels,
  };
}

function roundNice(x: number): number {
  if (x <= 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(x));
  const n = x / mag;
  const nice = n < 1.5 ? 1 : n < 2.25 ? 2 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10;
  return Math.max(1, Math.round(nice * mag));
}

export const PRESET_OPTIONS: Record<Exclude<PresetId, 'custom'>, StructureOptions> = {
  turbo: {
    startingStack: 5000,
    tableSize: 9,
    levelMinutes: 5,
    startSb: 25,
    levels: 24,
    pace: 'fast',
    anteType: 'bb',
    anteFromLevel: 3,
    breakEvery: 10,
    breakMinutes: 5,
    lateRegLevels: 6,
  },
  regular: {
    startingStack: 10000,
    tableSize: 9,
    levelMinutes: 10,
    startSb: 25,
    levels: 28,
    pace: 'standard',
    anteType: 'bb',
    anteFromLevel: 4,
    breakEvery: 6,
    breakMinutes: 5,
    lateRegLevels: 6,
  },
  deep: {
    startingStack: 20000,
    tableSize: 8,
    levelMinutes: 15,
    startSb: 25,
    levels: 30,
    pace: 'standard',
    anteType: 'bb',
    anteFromLevel: 5,
    breakEvery: 4,
    breakMinutes: 10,
    lateRegLevels: 8,
  },
  sng: {
    startingStack: 1500,
    tableSize: 6,
    levelMinutes: 3,
    startSb: 10,
    levels: 20,
    pace: 'fast',
    anteType: 'none',
    anteFromLevel: 1,
    breakEvery: 0,
    breakMinutes: 0,
    lateRegLevels: 0,
  },
};

export function presetStructure(preset: PresetId): TournamentStructure {
  return buildStructure(PRESET_OPTIONS[preset === 'custom' ? 'regular' : preset]);
}

/** The entry at an index; beyond the configured list the last level keeps growing by half each time. */
export function entryAt(structure: TournamentStructure, index: number): StructureEntry {
  const entries = structure.entries;
  if (index < entries.length) return entries[index]!;
  let last: StructureEntry | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.kind === 'level') {
      last = entries[i];
      break;
    }
  }
  if (!last || last.kind !== 'level') throw new Error('Structure has no levels');
  const factor = 1.5 ** (index - entries.length + 1);
  const sb = roundNice(last.sb * factor);
  const bb = sb * 2;
  const ante = last.ante === 0 ? 0 : structure.anteType === 'bb' ? bb : roundNice(bb / 8);
  return { kind: 'level', sb, bb, ante, minutes: last.minutes };
}

/** Level number (1-based, breaks do not count) at or before an entry index. */
export function levelNumberAt(structure: TournamentStructure, index: number): number {
  let n = 0;
  for (let i = 0; i <= index; i++) if (entryAt(structure, i).kind === 'level') n++;
  return Math.max(1, n);
}

/** Blinds in force for a hand dealt at this entry index (a break uses the level that follows it). */
export function blindsAt(structure: TournamentStructure, index: number): Blinds {
  let i = index;
  let entry = entryAt(structure, i);
  while (entry.kind !== 'level') entry = entryAt(structure, ++i);
  return { sb: entry.sb, bb: entry.bb, ante: entry.ante, anteType: entry.ante > 0 ? structure.anteType : 'none' };
}

/**
 * Rough duration: a tournament usually finishes around the level where the big
 * blind reaches one-twentieth of all chips in play. Returns minutes, or null
 * when there is not enough information for a meaningful estimate.
 */
export function estimateDurationMinutes(structure: TournamentStructure, players: number): number | null {
  if (players < 2 || structure.entries.length === 0) return null;
  const totalChips = players * structure.startingStack;
  let minutes = 0;
  for (let i = 0; i < structure.entries.length + 40; i++) {
    const entry = entryAt(structure, i);
    minutes += entry.minutes;
    if (entry.kind === 'level' && entry.bb >= totalChips / 20) return Math.round(minutes);
  }
  return null;
}

export type StructureProblem =
  | 'no_levels'
  | 'bad_stack'
  | 'bad_table_size'
  | 'bad_blinds'
  | 'blinds_decrease'
  | 'bad_duration'
  | 'starts_with_break'
  | 'shallow_start';

export function validateStructure(structure: TournamentStructure): StructureProblem[] {
  const problems = new Set<StructureProblem>();
  const levels = structure.entries.filter((e) => e.kind === 'level');
  if (levels.length === 0) problems.add('no_levels');
  if (!Number.isInteger(structure.startingStack) || structure.startingStack < 100) problems.add('bad_stack');
  if (!Number.isInteger(structure.tableSize) || structure.tableSize < 2 || structure.tableSize > 9) problems.add('bad_table_size');
  if (structure.entries[0]?.kind === 'break') problems.add('starts_with_break');
  let previousBb = 0;
  for (const e of structure.entries) {
    if (!(e.minutes > 0) || e.minutes > 240) problems.add('bad_duration');
    if (e.kind !== 'level') continue;
    if (!Number.isInteger(e.sb) || !Number.isInteger(e.bb) || !Number.isInteger(e.ante)) problems.add('bad_blinds');
    if (e.bb <= 0 || e.sb <= 0 || e.sb > e.bb || e.ante < 0) problems.add('bad_blinds');
    if (e.bb < previousBb) problems.add('blinds_decrease');
    previousBb = e.bb;
  }
  const first = levels[0];
  if (first && first.kind === 'level' && structure.startingStack < first.bb * 10) problems.add('shallow_start');
  return [...problems];
}
