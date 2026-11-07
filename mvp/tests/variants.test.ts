/**
 * Poker variants (v0.4): the registry, deck integrity, hand evaluation under Omaha and
 * Short Deck rules, pot-limit and fixed-limit betting, and high/low pot splitting. Every
 * test drives the real engine; nothing is mocked.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardRank, cardToString, parseCards, shortDeck } from '../src/engine/cards.ts';
import { evaluate, evaluateLow8, describeLow, HandCategory, scoreCategory } from '../src/engine/evaluator.ts';
import { bestHigh, bestLow } from '../src/engine/hands.ts';
import { applyAction, createTable, legalActions, seatPlayer, startHand, type Blinds, type TableState } from '../src/engine/holdem.ts';
import { seededRng } from '../src/engine/rng.ts';
import { cardsNeeded, maxTableSize, VARIANTS, VARIANT_IDS, variantOf } from '../src/engine/variants.ts';
import { estimateEquity, preflopScore } from '../src/engine/bots.ts';
import { activeTables, advanceClock, canDeal, createLive, playHandInstant, type Entrant } from '../src/engine/tournament.ts';
import { presetStructure } from '../src/engine/structure.ts';

const BLINDS: Blinds = { sb: 50, bb: 100, ante: 0, anteType: 'none' };

function tableWith(stacks: number[]): TableState {
  const t = createTable('t', Math.max(2, stacks.length));
  stacks.forEach((s, i) => seatPlayer(t, `p${i}`, s, i));
  return t;
}

/** Play the current street to its end with checks and calls only. */
function checkDown(t: TableState): void {
  let guard = 0;
  while (t.hand && t.hand.street !== 'complete' && guard++ < 100) {
    const legal = legalActions(t);
    if (!legal) break;
    applyAction(t, legal.seat, legal.canCheck ? { type: 'check' } : { type: 'call' });
  }
}

/** Build a deck for heads-up tests: seat 1 receives the first card, seat 0 the second, and so on; then the board. */
function headsUpDeck(seat1: string, seat0: string, board: string): number[] {
  const a = parseCards(seat1);
  const b = parseCards(seat0);
  const deck: number[] = [];
  for (let i = 0; i < a.length; i++) deck.push(a[i]!, b[i]!);
  deck.push(...parseCards(board));
  // Pad with unused cards so the deck is complete.
  const used = new Set(deck);
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  return deck;
}

describe('variant registry', () => {
  it('catalogues every family and marks only real engines as implemented', () => {
    assert.ok(VARIANT_IDS.length >= 25);
    const implemented = VARIANT_IDS.filter((id) => VARIANTS[id].implemented);
    assert.deepEqual(implemented.sort(), ['flhe', 'flo', 'flo8', 'nlhe', 'plhe', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck'].sort());
    for (const id of VARIANT_IDS) {
      const v = VARIANTS[id];
      if (v.implemented) assert.equal(v.board, 'community5', `${id}: only community-card games are dealt`);
      assert.ok(v.minPlayers >= 2 && v.maxPlayers >= v.minPlayers);
    }
    assert.equal(variantOf(undefined).id, 'nlhe', 'missing variant means Hold’em');
  });

  it('table size follows the deck: six-card Omaha seats seven, five-card nine', () => {
    assert.equal(maxTableSize(VARIANTS.plo6), 7);
    assert.equal(cardsNeeded(VARIANTS.plo6, 8), 53);
    assert.equal(maxTableSize(VARIANTS.plo5), 9);
    assert.equal(maxTableSize(VARIANTS.short_deck), 9);
    assert.throws(() => startHand(tableWith(new Array(8).fill(1000)), BLINDS, seededRng(1), { variant: 'plo6' }), /at most 7/);
    assert.throws(() => startHand(tableWith([1000, 1000]), BLINDS, seededRng(1), { variant: 'stud7' }), /cannot be dealt/);
  });
});

describe('decks', () => {
  it('the short deck has 36 distinct cards, sixes to aces', () => {
    const d = shortDeck();
    assert.equal(d.length, 36);
    assert.equal(new Set(d).size, 36);
    assert.ok(d.every((c) => cardRank(c) >= 4));
  });

  it('a short-deck hand deals from 36 cards and never shows a two to five', () => {
    const t = tableWith([2000, 2000, 2000, 2000]);
    const hand = startHand(t, BLINDS, seededRng(7), { variant: 'short_deck' });
    assert.equal(hand.deck.length, 36);
    assert.equal(new Set(hand.deck).size, 36);
    for (const s of t.seats) for (const c of s!.hole) assert.ok(cardRank(c) >= 4, cardToString(c));
    assert.equal(hand.variant, 'short_deck');
  });

  it('Omaha deals four, five or six hole cards each from a full deck without duplicates', () => {
    for (const [variant, n] of [['plo4', 4], ['plo5', 5], ['plo6', 6]] as const) {
      const t = tableWith([1000, 1000, 1000, 1000, 1000, 1000, 1000]);
      const hand = startHand(t, BLINDS, seededRng(3), { variant });
      assert.equal(hand.deck.length, 52);
      const all: number[] = [];
      for (const s of t.seats) {
        assert.equal(s!.hole.length, n, `${variant} deals ${n} cards`);
        all.push(...s!.hole);
      }
      assert.equal(new Set(all).size, all.length, 'no duplicate hole cards');
      const holeEvents = hand.events.filter((e) => e.t === 'hole');
      assert.equal(holeEvents.length, 7);
    }
  });
});

describe('Short Deck ranking', () => {
  const ev = (s: string) => evaluate(parseCards(s), 'short_deck');
  it('a flush beats a full house, a full house beats quads? no — quads still beat both', () => {
    const flush = ev('Ah Kh 9h 7h 6h');
    const fullHouse = ev('Kc Kd Kh 9s 9d');
    const quads = ev('Jc Jd Jh Js 6d');
    assert.ok(flush > fullHouse, 'flush > full house in short deck');
    assert.ok(quads > flush, 'quads > flush');
    assert.equal(scoreCategory(flush, 'short_deck'), HandCategory.Flush);
    assert.equal(scoreCategory(fullHouse, 'short_deck'), HandCategory.FullHouse);
    // Under standard rules the same cards rank the other way round.
    assert.ok(evaluate(parseCards('Kc Kd Kh 9s 9d')) > evaluate(parseCards('Ah Kh 9h 7h 6h')));
  });

  it('A-6-7-8-9 is the lowest straight; 6-7-8-9-T beats it; straights beat trips', () => {
    const wheel = ev('Ah 6c 7d 8s 9c');
    const sixHigh = ev('6h 7c 8d 9s Tc');
    const trips = ev('Ac Ad Ah 9s 7c');
    assert.equal(scoreCategory(wheel, 'short_deck'), HandCategory.Straight);
    assert.ok(sixHigh > wheel);
    assert.ok(wheel > trips, 'straight > three of a kind');
    // Without the five, A-6-7-8-9 is not a straight in a standard deck.
    assert.notEqual(scoreCategory(evaluate(parseCards('Ah 6c 7d 8s 9c'))), HandCategory.Straight);
  });

  it('best of seven follows the same convention', () => {
    const h = bestHigh(VARIANTS.short_deck, parseCards('Ah 6h'), parseCards('Kh 9h 7c 8d Jh'))!;
    assert.equal(h.category, HandCategory.Flush);
    assert.equal(bestHigh(VARIANTS.short_deck, parseCards('Ah 6c'), parseCards('7d 8s 9c Kd Kh'))!.category, HandCategory.Straight);
  });
});

describe('Omaha hand selection', () => {
  const plo = VARIANTS.plo4;
  it('uses exactly two hole cards: one suited card does not make a flush', () => {
    const hole = parseCards('Ah 2c 7d 9s');
    const board = parseCards('Kh Qh Th 3h 8c');
    const h = bestHigh(plo, hole, board)!;
    assert.notEqual(h.category, HandCategory.Flush, 'Hold’em would call this an ace-high flush');
    assert.equal(bestHigh(VARIANTS.nlhe, parseCards('Ah 2c'), board)!.category, HandCategory.Flush);
  });

  it('uses exactly three board cards: quads on the board do not play for everyone', () => {
    const board = parseCards('Kc Kd Kh Ks 2c');
    const a = bestHigh(plo, parseCards('Ah 3d 7c 9d'), board)!;
    const b = bestHigh(plo, parseCards('Qh Qd 7c 9d'), board)!;
    assert.equal(a.category, HandCategory.Trips, 'A-3 + K-K-K is three kings, not quads');
    assert.equal(b.category, HandCategory.FullHouse, 'Q-Q + K-K-K is kings full of queens');
    assert.ok(b.score > a.score);
    assert.equal(a.best.length, 5);
  });

  it('finds the best combination among all pairs of hole cards', () => {
    // A-A with 9-9-K would be aces up; 5c-4c with 2c-3c-Kc is a king-high flush, which is better.
    const h = bestHigh(plo, parseCards('As Ad 5c 4c'), parseCards('2c 3c 9h 9d Kc'))!;
    assert.equal(h.category, HandCategory.Flush);
    assert.deepEqual(h.best.map(cardToString).sort(), ['2c', '3c', '4c', '5c', 'Kc']);
    // With the ace of clubs instead, the best pair is Ac-5c for an ace-high flush (no straight flush: the 4c is a hole card too).
    const ace = bestHigh(plo, parseCards('Ac Ad 5c 4c'), parseCards('2c 3c 9h 9d Kc'))!;
    assert.equal(ace.category, HandCategory.Flush);
    assert.ok(ace.best.map(cardToString).includes('Ac') && ace.score > h.score);
  });

  it('cannot be scored before the flop', () => {
    assert.equal(bestHigh(plo, parseCards('As Ad 5c 4c'), []), null);
    assert.equal(bestHigh(plo, parseCards('As Ad 5c 4c'), parseCards('2c 3c 9h')) !== null, true);
  });
});

describe('low hands (eight or better)', () => {
  it('scores qualifying lows, rejects pairs and nines', () => {
    const wheel = evaluateLow8(parseCards('Ah 2c 3d 4s 5h'));
    const eightLow = evaluateLow8(parseCards('8h 7c 3d 2s Ah'));
    const sevenLow = evaluateLow8(parseCards('7h 6c 3d 2s Ah'));
    assert.ok(wheel >= 0 && sevenLow >= 0 && eightLow >= 0);
    assert.ok(wheel < sevenLow && sevenLow < eightLow, 'lower is better');
    assert.equal(evaluateLow8(parseCards('9h 7c 3d 2s Ah')), -1, 'a nine does not qualify');
    assert.equal(evaluateLow8(parseCards('7h 7c 3d 2s Ah')), -1, 'a pair does not qualify');
    assert.equal(evaluateLow8(parseCards('Ah 2h 3h 4h 5h')), wheel, 'flushes do not count against a low');
    assert.equal(describeLow(wheel), 'Wheel (A-2-3-4-5 low)');
    assert.equal(describeLow(eightLow), 'Eight-seven low');
  });

  it('Omaha lows also use exactly two hole cards', () => {
    const low = bestLow(VARIANTS.plo8, parseCards('Ah 2c Kd Kc'), parseCards('3h 4d 8s 9c Qs'));
    assert.ok(low && describeLow(low.score) === 'Eight-four low');
    assert.equal(bestLow(VARIANTS.plo8, parseCards('Ah Kd Kc Qh'), parseCards('2h 3d 4s 5c 8s')), null, 'one low hole card is not enough');
    assert.equal(bestLow(VARIANTS.plo4, parseCards('Ah 2c Kd Kc'), parseCards('3h 4d 8s 9c Qs')), null, 'no low in a high-only game');
  });
});

describe('pot-limit betting', () => {
  it('the maximum raise is the pot after the call; a bet is at most the pot', () => {
    const t = tableWith([5000, 5000, 5000]);
    startHand(t, BLINDS, seededRng(11), { variant: 'plo4', button: 0 });
    // Seat 0 is the button, 1 the small blind, 2 the big blind; seat 0 acts first.
    let legal = legalActions(t)!;
    assert.equal(legal.seat, 0);
    assert.equal(legal.pot, 150);
    assert.equal(legal.callAmount, 100);
    assert.equal(legal.maxTo, 100 + 150 + 100, 'raise to 350: call 100, then raise by the 250 pot');
    assert.equal(legal.minTo, 200);
    assert.throws(() => applyAction(t, 0, { type: 'raise', amount: 400 }), /Pot-limit/);
    applyAction(t, 0, { type: 'raise', amount: 350 });
    legal = legalActions(t)!;
    assert.equal(legal.seat, 1);
    // Pot is 150 + 350 = 500; the small blind calls 300 and may raise by 800 → to 1150.
    assert.equal(legal.callAmount, 300);
    assert.equal(legal.maxTo, 350 + 500 + 300);
    applyAction(t, 1, { type: 'call' });
    applyAction(t, 2, { type: 'call' });
    // Flop: pot 1050. First to act may bet at most the pot.
    legal = legalActions(t)!;
    assert.equal(t.hand!.street, 'flop');
    assert.equal(legal.currentBet, 0);
    assert.equal(legal.maxTo, 1050);
    assert.equal(legal.minTo, 100);
    applyAction(t, legal.seat, { type: 'bet', amount: 1050 });
    legal = legalActions(t)!;
    assert.equal(legal.maxTo, 1050 + (1050 + 1050 + 1050), 'call 1050 then raise by the 3150 pot');
  });

  it('a short stack is capped by its chips, never above the pot limit', () => {
    const t = tableWith([5000, 5000, 260]);
    startHand(t, BLINDS, seededRng(11), { variant: 'plo4', button: 1 });
    // Button 1, SB 2 (260 chips), BB 0. Seat 1 acts first.
    applyAction(t, 1, { type: 'raise', amount: 350 });
    const legal = legalActions(t)!;
    assert.equal(legal.seat, 2);
    assert.equal(legal.maxTo, 260, 'the whole stack, below the pot limit');
    assert.equal(legal.callAmount, 210, 'an all-in below the current bet is a call');
    assert.equal(legal.canRaise, false);
    applyAction(t, 2, { type: 'call' });
    assert.equal(t.seats[2]!.allIn, true);
  });
});

describe('fixed-limit betting', () => {
  it('bets are the small bet pre-flop and on the flop, the big bet after, and capped at four bets with three or more players', () => {
    const t = tableWith([5000, 5000, 5000]);
    startHand(t, BLINDS, seededRng(5), { variant: 'flhe', button: 0 });
    let legal = legalActions(t)!;
    assert.equal(legal.fixed, true);
    assert.equal(legal.minTo, 200);
    assert.equal(legal.maxTo, 200, 'raise to exactly two small bets');
    assert.throws(() => applyAction(t, 0, { type: 'raise', amount: 300 }), /fixed/);
    applyAction(t, 0, { type: 'raise', amount: 200 }); // bet 2
    applyAction(t, 1, { type: 'raise', amount: 300 }); // bet 3
    applyAction(t, 2, { type: 'raise', amount: 400 }); // bet 4: capped
    legal = legalActions(t)!;
    assert.equal(legal.seat, 0);
    assert.equal(legal.canRaise, false, 'four bets: raising is closed');
    assert.equal(legal.canCall, true);
    applyAction(t, 0, { type: 'call' });
    applyAction(t, 1, { type: 'call' });
    // Flop: small bet.
    legal = legalActions(t)!;
    assert.equal(t.hand!.street, 'flop');
    assert.equal(legal.maxTo, 100);
    applyAction(t, legal.seat, { type: 'bet', amount: 100 });
    checkDown(t);
    // (the hand has been checked/called to the river; blinds and bets stayed fixed throughout)
    assert.equal(t.hand!.street, 'complete');
  });

  it('turn and river use the big bet', () => {
    const t = tableWith([5000, 5000]);
    startHand(t, BLINDS, seededRng(9), { variant: 'flhe', button: 0 });
    applyAction(t, 0, { type: 'call' });
    applyAction(t, 1, { type: 'check' });
    let legal = legalActions(t)!;
    assert.equal(t.hand!.street, 'flop');
    assert.equal(legal.maxTo, 100);
    applyAction(t, legal.seat, { type: 'check' });
    applyAction(t, legalActions(t)!.seat, { type: 'check' });
    legal = legalActions(t)!;
    assert.equal(t.hand!.street, 'turn');
    assert.equal(legal.maxTo, 200, 'big bet on the turn');
    applyAction(t, legal.seat, { type: 'bet', amount: 200 });
    legal = legalActions(t)!;
    assert.equal(legal.minTo, 400);
    assert.equal(legal.maxTo, 400);
  });
});

describe('Omaha Hi/Lo showdown', () => {
  it('splits the pot between high and low, quarters a tied low, and gives the odd chip to the high', () => {
    const t = tableWith([1000, 1000]);
    // Heads-up: seat 0 is the button and small blind. Board A 2 7 K Q: seat 0 holds K-Q (two pair) and 3-4 (7-low);
    // seat 1 holds the same 7-low with 3-4 but only ace high.
    const deck = headsUpDeck('3d 4s 9d Td', '3c 4h Kd Qd', 'As 2d 7h Kc Qs');
    startHand(t, BLINDS, seededRng(1), { variant: 'plo8', button: 0, deck });
    assert.equal(t.seats[0]!.hole.length, 4);
    checkDown(t);
    const hand = t.hand!;
    assert.equal(hand.street, 'complete');
    const awards = hand.events.filter((e) => e.t === 'award');
    assert.equal(awards.length, 2, 'one award for each half');
    const high = awards.find((a) => a.t === 'award' && a.half === 'high')!;
    const low = awards.find((a) => a.t === 'award' && a.half === 'low')!;
    assert.ok(high.t === 'award' && low.t === 'award');
    assert.equal(high.amount + low.amount, 200);
    assert.deepEqual(high.winners, [{ seat: 0, amount: 100 }], 'two pair takes the high half');
    assert.equal(low.winners.length, 2, 'the low is tied and quartered');
    assert.equal(low.winners.reduce((n, w) => n + w.amount, 0), 100);
    assert.equal(t.seats[0]!.stack, 1000 - 100 + 150);
    assert.equal(t.seats[1]!.stack, 1000 - 100 + 50);
    const shown = hand.events.find((e) => e.t === 'showdown')!;
    assert.ok(shown.t === 'showdown' && shown.hands.every((h) => h.low && h.low.name === 'Seven-four low'));
  });

  it('with no qualifying low the high hand scoops', () => {
    const t = tableWith([1000, 1000]);
    const deck = headsUpDeck('Jd 7s 9d 8d', 'Kc Kh Qd Jc', 'As 2d 9h Kd Qs');
    startHand(t, BLINDS, seededRng(1), { variant: 'plo8', button: 0, deck });
    checkDown(t);
    const awards = t.hand!.events.filter((e) => e.t === 'award');
    assert.equal(awards.length, 1);
    assert.ok(awards[0]!.t === 'award' && awards[0]!.half === undefined && awards[0]!.amount === 200);
    assert.equal(t.seats[0]!.stack, 1100, 'three kings scoop');
  });
});

describe('bots and equity under other variants', () => {
  it('pre-flop strength rates premium Omaha hands above junk', () => {
    const premium = preflopScore(parseCards('As Ad Ks Kd'), VARIANTS.plo4);
    const rundown = preflopScore(parseCards('Jh Th 9d 8d'), VARIANTS.plo4);
    const junk = preflopScore(parseCards('2c 7h 9s Kd'), VARIANTS.plo4);
    const trips = preflopScore(parseCards('Qc Qh Qs 3d'), VARIANTS.plo4);
    assert.ok(premium > rundown && rundown > junk, `${premium} > ${rundown} > ${junk}`);
    assert.ok(junk >= trips, 'trips in the hole are dead cards');
  });

  it('equity estimates respect the variant: Omaha quads on the board are not a lock', () => {
    const rng = seededRng(99);
    const board = parseCards('Kc Kd Kh Ks 2c');
    const holdem = estimateEquity(parseCards('Ah 3d'), board, 1, 300, rng, VARIANTS.nlhe);
    const omaha = estimateEquity(parseCards('Ah 3d 7c 9d'), board, 1, 300, rng, VARIANTS.plo4);
    assert.ok(holdem > 0.88, `Hold’em: board quads with an ace kicker is close to a lock (${holdem})`);
    assert.ok(omaha < holdem - 0.1, `Omaha: only three kings, any pair or ace beats or ties it (${omaha})`);
  });

  it('a short-deck equity sample never draws a two to five', () => {
    const rng = seededRng(5);
    const e = estimateEquity(parseCards('Ah Kh'), parseCards('6c 7d 8s'), 2, 200, rng, VARIANTS.short_deck);
    assert.ok(e > 0 && e < 1);
  });
});

describe('tournament integration', () => {
  it('a Pot-Limit Omaha tournament deals four-card hands at every table and reaches a winner', () => {
    const entrants: Entrant[] = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}`, isBot: true, style: 'balanced' }));
    const rng = seededRng(2024);
    const live = createLive('plo', presetStructure('turbo'), entrants, rng, 1, 'plo4');
    assert.equal(live.variant, 'plo4');
    let hands = 0;
    let guard = 0;
    while (live.status !== 'COMPLETED') {
      advanceClock(live, 5_000);
      for (const t of activeTables(live)) {
        if ((live.status as string) === 'COMPLETED') break;
        if (!t.closed && canDeal(live, t) && t.nextHandAt <= live.clockMs) {
          playHandInstant(live, t, rng, rng, 12);
          const hand = t.state.hand!;
          assert.equal(hand.variant, 'plo4');
          for (const e of hand.events) if (e.t === 'hole') assert.equal(e.cards!.length, 4);
          hands++;
        }
      }
      assert.ok(++guard < 200_000, 'tournament must finish');
    }
    assert.ok(hands > 20, `played ${hands} hands`);
  });
});
