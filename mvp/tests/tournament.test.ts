import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handInProgress, occupiedSeats } from '../src/engine/holdem.ts';
import { seededRng } from '../src/engine/rng.ts';
import { blindsAt, buildStructure, entryAt, estimateDurationMinutes, levelNumberAt, presetStructure, validateStructure, PRESET_OPTIONS } from '../src/engine/structure.ts';
import {
  activeTables,
  addLateEntrant,
  advanceClock,
  canDeal,
  chipsInPlay,
  createLive,
  currentBlinds,
  currentLevelNumber,
  dealHand,
  isOnBreak,
  lateRegistrationOpen,
  pause,
  playHandInstant,
  remainingPlayers,
  results,
  resume,
  settleHand,
  standings,
  stepAutomaticAction,
  tableByNo,
  type Entrant,
  type TournamentLive,
} from '../src/engine/tournament.ts';
import { BOT_STYLES } from '../src/engine/bots.ts';

const entrants = (n: number, firstHuman = false): Entrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, isBot: !(firstHuman && i === 0), style: BOT_STYLES[i % BOT_STYLES.length]! }));

function assertInvariants(live: TournamentLive) {
  assert.equal(chipsInPlay(live), live.totalChips, 'chips conserved');
  const tables = activeTables(live);
  const seated = tables.flatMap((t) => occupiedSeats(t.state).map((s) => s.playerId));
  assert.equal(new Set(seated).size, seated.length, 'nobody is seated twice');
  assert.equal(seated.length, remainingPlayers(live), 'every remaining player has a seat');
  for (const id of seated) assert.equal(live.players[id]!.status, 'active');
}

function assertBalanced(live: TournamentLive) {
  const tables = activeTables(live);
  if (live.status === 'COMPLETED') return;
  const sizes = tables.map((t) => occupiedSeats(t.state).length);
  assert.equal(tables.length, Math.ceil(remainingPlayers(live) / live.structure.tableSize), `table count for ${remainingPlayers(live)} players`);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `tables balanced: ${sizes.join(',')}`);
}

/** Run a bots-only tournament to completion on the simulated clock. */
const done = (live: TournamentLive): boolean => live.status === 'COMPLETED';

function runToCompletion(live: TournamentLive, seed: number, onHand?: () => void) {
  const rng = seededRng(seed);
  let guard = 0;
  while (live.status !== 'COMPLETED') {
    advanceClock(live, 5_000);
    for (const t of activeTables(live)) {
      if (done(live)) break;
      if (!t.closed && canDeal(live, t) && t.nextHandAt <= live.clockMs) {
        playHandInstant(live, t, rng, rng, 12);
        assertInvariants(live);
        assertBalanced(live);
        onHand?.();
      }
    }
    assert.ok(++guard < 200_000, 'tournament must finish');
  }
}

describe('blind structures', () => {
  it('presets are valid, increasing, and use the configured antes and breaks', () => {
    for (const preset of ['turbo', 'regular', 'deep', 'sng'] as const) {
      const s = presetStructure(preset);
      assert.deepEqual(validateStructure(s), [], preset);
      const levels = s.entries.filter((e) => e.kind === 'level');
      assert.equal(levels.length, PRESET_OPTIONS[preset].levels);
      for (let i = 1; i < levels.length; i++) {
        const a = levels[i - 1]!;
        const b = levels[i]!;
        assert.ok(a.kind === 'level' && b.kind === 'level' && b.bb > a.bb);
      }
    }
    const regular = presetStructure('regular');
    assert.deepEqual(blindsAt(regular, 0), { sb: 25, bb: 50, ante: 0, anteType: 'none' });
    assert.deepEqual(blindsAt(regular, 3), { sb: 100, bb: 200, ante: 200, anteType: 'bb' });
    assert.equal(regular.entries[6]!.kind, 'break');
    assert.equal(levelNumberAt(regular, 6), 6);
    assert.equal(levelNumberAt(regular, 7), 7);
  });

  it('keeps producing bigger levels past the end of the configured list', () => {
    const s = presetStructure('sng');
    const last = s.entries[s.entries.length - 1]!;
    const beyond = entryAt(s, s.entries.length + 2);
    assert.ok(last.kind === 'level' && beyond.kind === 'level' && beyond.bb > last.bb);
  });

  it('flags invalid custom structures', () => {
    const s = buildStructure({ ...PRESET_OPTIONS.regular, levels: 4 });
    s.entries[2] = { kind: 'level', sb: 10, bb: 20, ante: 0, minutes: 10 };
    assert.ok(validateStructure(s).includes('blinds_decrease'));
    s.entries = [];
    assert.ok(validateStructure(s).includes('no_levels'));
    const shallow = buildStructure({ ...PRESET_OPTIONS.regular, startingStack: 300 });
    assert.ok(validateStructure(shallow).includes('shallow_start'));
  });

  it('estimates a plausible duration', () => {
    const minutes = estimateDurationMinutes(presetStructure('regular'), 45)!;
    assert.ok(minutes > 120 && minutes <= 300, `regular 45 players ≈ ${minutes} min`);
    assert.equal(estimateDurationMinutes(presetStructure('regular'), 1), null);
  });
});

describe('seating draw', () => {
  it('seats everyone exactly once on evenly sized tables', () => {
    for (const n of [2, 6, 9, 10, 17, 45, 100]) {
      const live = createLive('t', presetStructure('regular'), entrants(n), seededRng(n));
      assertInvariants(live);
      assertBalanced(live);
      assert.equal(live.totalChips, n * 10000);
      assert.equal(live.finalTable, n <= 9);
    }
  });

  it('rejects fewer than two players or duplicates', () => {
    assert.throws(() => createLive('t', presetStructure('sng'), entrants(1), seededRng(1)));
    assert.throws(() => createLive('t', presetStructure('sng'), [...entrants(2), entrants(1)[0]!], seededRng(1)));
  });
});

describe('blind clock', () => {
  it('advances levels and breaks on the injected clock', () => {
    const live = createLive('t', presetStructure('regular'), entrants(18), seededRng(1));
    assert.equal(currentLevelNumber(live), 1);
    advanceClock(live, 10 * 60_000 - 1);
    assert.equal(currentLevelNumber(live), 1);
    advanceClock(live, 1);
    assert.equal(currentLevelNumber(live), 2);
    assert.deepEqual(currentBlinds(live), { sb: 50, bb: 100, ante: 0, anteType: 'none' });
    advanceClock(live, 50 * 60_000); // through level 6 into the break
    assert.equal(isOnBreak(live), true);
    assert.equal(canDeal(live, live.tables[0]!), false, 'no hands are dealt during a break');
    advanceClock(live, 5 * 60_000);
    assert.equal(isOnBreak(live), false);
    assert.equal(currentLevelNumber(live), 7);
    assert.equal(live.timeline.filter((e) => e.type === 'level').length, 7);
  });

  it('closes late registration after the configured level', () => {
    const live = createLive('t', presetStructure('turbo'), entrants(12), seededRng(1));
    assert.equal(lateRegistrationOpen(live), true);
    advanceClock(live, 6 * 5 * 60_000 - 1);
    assert.equal(lateRegistrationOpen(live), true);
    advanceClock(live, 1);
    assert.equal(lateRegistrationOpen(live), false);
    assert.throws(() => addLateEntrant(live, { id: 'late', name: 'Late', isBot: true, style: 'balanced' }, seededRng(2)), /closed/);
  });
});

describe('pause and resume', () => {
  it('a paused tournament stops the clock and deals no new hands', () => {
    const live = createLive('t', presetStructure('turbo'), entrants(12), seededRng(1));
    const rng = seededRng(3);
    advanceClock(live, 10_000);
    playHandInstant(live, live.tables[0]!, rng, rng, 10);
    const clock = live.clockMs;
    pause(live);
    assert.equal(live.status, 'PAUSED');
    advanceClock(live, 60_000);
    assert.equal(live.clockMs, clock, 'clock is frozen');
    assert.equal(canDeal(live, live.tables[0]!), false);
    assert.throws(() => dealHand(live, live.tables[0]!, rng));
    assert.throws(() => pause(live));
    resume(live);
    assert.equal(canDeal(live, live.tables[0]!), true);
    assert.throws(() => resume(live));
  });

  it('a hand already in progress can finish while paused', () => {
    const live = createLive('t', presetStructure('sng'), entrants(6), seededRng(1));
    const rng = seededRng(4);
    const t = live.tables[0]!;
    t.driven = true;
    dealHand(live, t, rng);
    pause(live);
    while (handInProgress(t.state)) assert.equal(stepAutomaticAction(live, t, rng, 10), true);
    settleHand(live, t, rng);
    assert.equal(chipsInPlay(live), live.totalChips);
    assert.equal(canDeal(live, t), false);
  });
});

describe('full tournaments', () => {
  it('a 45-player multi-table tournament balances, consolidates and produces a single winner', () => {
    const live = createLive('mtt', presetStructure('turbo'), entrants(45), seededRng(10));
    assert.equal(activeTables(live).length, 5);
    let sawFinalTable = false;
    runToCompletion(live, 11, () => {
      if (live.finalTable) sawFinalTable = true;
    });
    assert.ok(sawFinalTable);
    const rows = results(live);
    assert.equal(rows.length, 45);
    assert.deepEqual(rows.map((r) => r.place), Array.from({ length: 45 }, (_, i) => i + 1), 'places 1..45 exactly once');
    const winner = standings(live)[0]!;
    assert.equal(winner.stack, live.totalChips, 'the winner holds every chip');
    assert.equal(live.eliminations.length, 44);
    assert.ok(live.timeline.some((e) => e.type === 'table_closed'));
    assert.ok(live.timeline.some((e) => e.type === 'move'));
    assert.ok(live.timeline.some((e) => e.type === 'final_table'));
    assert.equal(live.timeline.filter((e) => e.type === 'complete').length, 1);
    assert.ok(currentLevelNumber(live) > 3, 'blinds went up');
  });

  it('tournaments of many sizes and table sizes all complete cleanly', () => {
    const cases: [number, 'turbo' | 'regular' | 'deep' | 'sng'][] = [
      [2, 'sng'],
      [6, 'sng'],
      [9, 'turbo'],
      [10, 'turbo'],
      [19, 'turbo'],
      [27, 'sng'],
      [64, 'turbo'],
      [23, 'deep'],
    ];
    for (const [n, preset] of cases) {
      const live = createLive(`t${n}`, presetStructure(preset), entrants(n), seededRng(n * 7));
      runToCompletion(live, n * 13);
      assert.equal(results(live).length, n);
      assert.equal(new Set(results(live).map((r) => r.place)).size, n);
    }
  });

  it('late entrants get a seat, a full starting stack, and the tables stay balanced', () => {
    const live = createLive('late', presetStructure('turbo'), entrants(18), seededRng(5));
    const rng = seededRng(6);
    advanceClock(live, 60_000);
    for (const t of activeTables(live)) playHandInstant(live, t, rng, rng, 10);
    for (let i = 0; i < 5; i++) {
      const no = addLateEntrant(live, { id: `late${i}`, name: `Late ${i}`, isBot: true, style: 'balanced' }, rng);
      assert.ok(tableByNo(live, no));
      assertInvariants(live);
      assertBalanced(live);
    }
    assert.equal(live.entrants, 23);
    assert.equal(live.totalChips, 23 * 5000);
    assert.throws(() => addLateEntrant(live, { id: 'late0', name: 'dup', isBot: true, style: 'balanced' }, rng), /Already/);
    runToCompletion(live, 8);
    assert.equal(results(live).length, 23);
  });

  it('never moves a player out of a table that is in the middle of a hand', () => {
    // Table 1 is "driven" (a human is watching): it is advanced one action at a time
    // while the other tables play whole hands around it.
    const live = createLive('driven', presetStructure('turbo'), entrants(27, true), seededRng(21));
    const rng = seededRng(22);
    const heroTableNo = live.players['p0']!.tableNo!;
    let guard = 0;
    while (live.status !== 'COMPLETED') {
      advanceClock(live, 4_000);
      const hero = live.players['p0']!;
      for (const t of activeTables(live)) {
        if (done(live)) break;
        t.driven = hero.status === 'active' && hero.tableNo === t.no;
        if (t.driven) {
          if (!handInProgress(t.state) && canDeal(live, t)) dealHand(live, t, rng);
          // one action per tick; the "human" plays check/call
          if (handInProgress(t.state)) {
            if (!stepAutomaticAction(live, t, rng, 10)) {
              const seat = t.state.hand!.toAct;
              hero.away = true; // let the engine auto-act for the human in this test
              stepAutomaticAction(live, t, rng, 10);
              hero.away = false;
              assert.equal(t.state.seats[seat]!.playerId, 'p0');
            }
            if (!handInProgress(t.state)) settleHand(live, t, rng);
          }
        } else if (canDeal(live, t) && t.nextHandAt <= live.clockMs) {
          playHandInstant(live, t, rng, rng, 10);
        }
        assertInvariants(live);
      }
      assert.ok(++guard < 400_000);
    }
    assert.ok(heroTableNo >= 1);
    assert.equal(results(live).length, 27);
    assert.equal(standings(live)[0]!.stack, live.totalChips);
  });

  it('players eliminated on the same hand are ranked by their stack at the start of it', () => {
    // Force it: tiny stacks against one big stack on a single table and look for a double bust.
    let found = false;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const live = createLive('db', presetStructure('sng'), entrants(6), seededRng(seed));
      const rng = seededRng(seed + 1000);
      for (let h = 0; h < 200 && live.status !== 'COMPLETED' && !found; h++) {
        advanceClock(live, 60_000);
        const t = activeTables(live)[0]!;
        if (!canDeal(live, t)) continue;
        const before = live.eliminations.length;
        const startStacks = new Map(occupiedSeats(t.state).map((s) => [s.playerId, s.stack]));
        playHandInstant(live, t, rng, rng, 8);
        const busts = live.eliminations.slice(before);
        if (busts.length >= 2) {
          found = true;
          const sorted = [...busts].sort((a, b) => a.place - b.place);
          for (let i = 1; i < sorted.length; i++) {
            assert.ok(startStacks.get(sorted[i - 1]!.playerId)! >= startStacks.get(sorted[i]!.playerId)!, 'bigger starting stack finishes higher');
          }
        }
      }
    }
    assert.ok(found, 'a double elimination occurred in the search');
  });
});
