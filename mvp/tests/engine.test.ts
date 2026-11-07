import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardToString, freshDeck, parseCards, shuffledDeck, type Card } from '../src/engine/cards.ts';
import { bestFive, describeHand, evaluate, HandCategory, scoreCategory } from '../src/engine/evaluator.ts';
import {
  ActionError,
  applyAction,
  applyAutoAction,
  chipsOnTable,
  createTable,
  handInProgress,
  legalActions,
  occupiedSeats,
  seatPlayer,
  startHand,
  unseatPlayer,
  type Blinds,
  type HandEvent,
  type PlayerAction,
  type TableState,
} from '../src/engine/holdem.ts';
import { buildPots, potTotal } from '../src/engine/pots.ts';
import { cryptoRng, seededRng, type Rng } from '../src/engine/rng.ts';
import { newActionId, submitCommand } from '../src/engine/session.ts';
import { applyEvent, baseView, redactedEvents, viewOf } from '../src/engine/view.ts';
import { BOT_STYLES, botContext, chenScore, chooseBotAction, estimateEquity } from '../src/engine/bots.ts';

const BLINDS: Blinds = { sb: 50, bb: 100, ante: 0, anteType: 'none' };

/** Build a table with the given stacks in seats 0..n-1. */
function tableWith(stacks: number[], maxSeats = Math.max(2, stacks.length)): TableState {
  const t = createTable('t', maxSeats);
  stacks.forEach((stack, i) => seatPlayer(t, `p${i}`, stack, i));
  return t;
}

/**
 * Build a deck that deals specific hole cards and board. `holes[i]` belongs to
 * the i-th player in dealing order (first seat left of the button first).
 */
function riggedDeck(holes: string[], board: string): Card[] {
  const hs = holes.map((h) => parseCards(h));
  const first = hs.map((h) => h[0]!);
  const second = hs.map((h) => h[1]!);
  const used = [...first, ...second, ...parseCards(board)];
  const rest = freshDeck().filter((c) => !used.includes(c));
  return [...used, ...rest];
}

const act = (t: TableState, seat: number, type: PlayerAction['type'], amount?: number) => applyAction(t, seat, { type, amount });
const events = (t: TableState, kind: HandEvent['t']) => t.hand!.events.filter((e) => e.t === kind);

describe('deck', () => {
  it('has 52 unique cards and a shuffle keeps exactly the same set', () => {
    const deck = shuffledDeck(cryptoRng());
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck).size, 52);
    assert.deepEqual([...deck].sort((a, b) => a - b), freshDeck());
  });

  it('never deals the same card twice in a hand', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 300; i++) {
      const t = tableWith([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 9);
      startHand(t, BLINDS, rng);
      while (handInProgress(t)) {
        const l = legalActions(t)!;
        applyAction(t, l.seat, l.canCheck ? { type: 'check' } : { type: 'call' });
      }
      const dealt = [...occupiedSeats(t).flatMap((s) => s.hole), ...t.hand!.board];
      assert.equal(dealt.length, 9 * 2 + 5);
      assert.equal(new Set(dealt).size, dealt.length);
    }
  });

  it('crypto rng integers are in range and roughly uniform', () => {
    const rng = cryptoRng();
    const counts = new Array(52).fill(0);
    for (let i = 0; i < 52_000; i++) counts[rng.int(52)]++;
    for (const c of counts) assert.ok(c > 800 && c < 1200, `count ${c} far from 1000`);
  });
});

describe('hand evaluator', () => {
  const ev = (s: string) => evaluate(parseCards(s));

  it('ranks the categories in order', () => {
    const hands = [
      'Ah Kd 9c 7s 3h', // high card
      '2h 2d 9c 7s 3h', // pair
      '2h 2d 9c 9s 3h', // two pair
      '2h 2d 2c 7s 3h', // trips
      '5h 4d 3c 2s Ah', // wheel
      'Kh 9h 7h 4h 2h', // flush
      '2h 2d 2c 3s 3h', // full house
      '2h 2d 2c 2s 3h', // quads
      '5h 4h 3h 2h Ah', // steel wheel
    ];
    const scores = hands.map(ev);
    for (let i = 1; i < scores.length; i++) assert.ok(scores[i]! > scores[i - 1]!, `${hands[i]} should beat ${hands[i - 1]}`);
    assert.deepEqual(scores.map((s) => scoreCategory(s)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('breaks ties with kickers and detects exact ties', () => {
    assert.ok(ev('Ah Kd 9c 7s 3h') > ev('Ah Qd Jc Ts 8h'));
    assert.ok(ev('Ah Ad Kc 7s 3h') > ev('As Ac Qc Js 9h'));
    assert.ok(ev('Kh Kd 7c 7s Ah') > ev('Ks Kc 7d 7h Qh'));
    assert.ok(ev('6h 5d 4c 3s 2h') > ev('5h 4d 3c 2s Ah'), 'six-high straight beats the wheel');
    assert.ok(ev('Ah Kh Qh Jh Th') > ev('Kd Qd Jd Td 9d'));
    assert.ok(ev('3h 3d 3c Ks Kh') > ev('2h 2d 2c As Ah'), 'full house compares trips first');
    assert.equal(ev('Ah Kd 9c 7s 3h'), ev('As Kc 9d 7h 3d'));
  });

  it('counts every 5-card hand category exactly (all 2,598,960 hands)', () => {
    const counts = new Array(9).fill(0);
    const h: Card[] = [0, 0, 0, 0, 0];
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              h[0] = a;
              h[1] = b;
              h[2] = c;
              h[3] = d;
              h[4] = e;
              counts[evaluate(h) >> 20]++;
            }
    assert.deepEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  });

  it('7-card evaluation equals the best of all 21 five-card subsets', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 20_000; i++) {
      const seven = shuffledDeck(rng).slice(0, 7);
      let best = 0;
      for (let x = 0; x < 7; x++)
        for (let y = x + 1; y < 7; y++) {
          const five = seven.filter((_, k) => k !== x && k !== y);
          best = Math.max(best, evaluate(five));
        }
      assert.equal(evaluate(seven), best, seven.map(cardToString).join(' '));
      assert.equal(evaluate(bestFive(seven)), best);
    }
  });

  it('describes hands in words', () => {
    assert.equal(describeHand(parseCards('Kh Kd Kc 7s 7h 2d 3c')).name, 'Full House, Kings full of Sevens');
    assert.equal(describeHand(parseCards('Ah Kh Qh Jh Th 2d 3c')).name, 'Royal Flush');
    assert.equal(describeHand(parseCards('Ah Kd 9c 7s 3h 2d 4c')).category, HandCategory.HighCard);
  });
});

describe('side pots', () => {
  it('builds main and side pots for three different all-in sizes', () => {
    const pots = buildPots([
      { seat: 0, committed: 100, folded: false },
      { seat: 1, committed: 300, folded: false },
      { seat: 2, committed: 700, folded: false },
      { seat: 3, committed: 700, folded: false },
    ]);
    assert.deepEqual(pots, [
      { amount: 400, eligible: [0, 1, 2, 3] },
      { amount: 600, eligible: [1, 2, 3] },
      { amount: 800, eligible: [2, 3] },
    ]);
    assert.equal(potTotal(pots), 1800);
  });

  it('keeps folded chips in the pot but not in the eligible list', () => {
    const pots = buildPots([
      { seat: 0, committed: 200, folded: true },
      { seat: 1, committed: 100, folded: false },
      { seat: 2, committed: 400, folded: false },
      { seat: 3, committed: 400, folded: false },
    ]);
    assert.deepEqual(pots, [
      { amount: 400, eligible: [1, 2, 3] },
      { amount: 700, eligible: [2, 3] },
    ]);
  });

  it('puts dead money (big-blind ante) at the bottom of the main pot', () => {
    const pots = buildPots(
      [
        { seat: 0, committed: 0, folded: false }, // all-in for the ante only
        { seat: 1, committed: 200, folded: false },
        { seat: 2, committed: 200, folded: false },
      ],
      100,
    );
    assert.deepEqual(pots, [
      { amount: 100, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
  });
});

describe('action order and blinds', () => {
  it('three-handed: SB and BB are left of the button, UTG acts first pre-flop, SB first post-flop', () => {
    const t = tableWith([1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0 });
    assert.equal(hand.sbSeat, 1);
    assert.equal(hand.bbSeat, 2);
    assert.equal(hand.toAct, 0, 'button is under the gun three-handed');
    act(t, 0, 'call');
    assert.equal(hand.toAct, 1);
    act(t, 1, 'call');
    assert.equal(hand.toAct, 2, 'big blind gets the option');
    assert.equal(legalActions(t)!.canCheck, true);
    assert.equal(legalActions(t)!.canRaise, true);
    act(t, 2, 'check');
    assert.equal(hand.street, 'flop');
    assert.equal(hand.toAct, 1, 'small blind acts first after the flop');
  });

  it('heads-up: the button posts the small blind and acts first pre-flop, last post-flop', () => {
    const t = tableWith([1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(1), { button: 1 });
    assert.equal(hand.sbSeat, 1);
    assert.equal(hand.bbSeat, 0);
    assert.equal(hand.toAct, 1);
    act(t, 1, 'call');
    assert.equal(hand.toAct, 0, 'big blind option');
    act(t, 0, 'check');
    assert.equal(hand.street, 'flop');
    assert.equal(hand.toAct, 0, 'big blind acts first post-flop heads-up');
  });

  it('the big blind may raise when everyone limps', () => {
    const t = tableWith([1000, 1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(3), { button: 0 });
    act(t, 3, 'call');
    act(t, 0, 'call');
    act(t, 1, 'call');
    assert.equal(hand.toAct, 2);
    act(t, 2, 'raise', 400);
    assert.equal(hand.toAct, 3, 'action reopens after the big blind raises');
    assert.equal(hand.street, 'preflop');
  });

  it('moves the button one occupied seat per hand, skipping empty seats', () => {
    const t = createTable('t', 6);
    seatPlayer(t, 'a', 1000, 0);
    seatPlayer(t, 'b', 1000, 2);
    seatPlayer(t, 'c', 1000, 5);
    const rng = seededRng(5);
    const buttons: number[] = [];
    startHand(t, BLINDS, rng, { button: 0 });
    for (let i = 0; i < 4; i++) {
      while (handInProgress(t)) applyAutoAction(t);
      buttons.push(startHand(t, BLINDS, rng).button);
    }
    assert.deepEqual(buttons, [2, 5, 0, 2]);
  });

  it('posts classic antes from every player and a big-blind ante from the big blind only', () => {
    const t = tableWith([1000, 1000, 1000]);
    startHand(t, { sb: 50, bb: 100, ante: 10, anteType: 'classic' }, seededRng(1), { button: 0 });
    assert.equal(events(t, 'post').filter((e) => e.t === 'post' && e.kind === 'ante').length, 3);
    assert.equal(legalActions(t)!.pot, 180);

    const t2 = tableWith([1000, 1000, 1000]);
    const hand2 = startHand(t2, { sb: 50, bb: 100, ante: 100, anteType: 'bb' }, seededRng(1), { button: 0 });
    assert.equal(hand2.deadMoney, 100);
    assert.equal(t2.seats[2]!.stack, 800);
    assert.equal(legalActions(t2)!.pot, 250);
    assert.equal(chipsOnTable(t2), 3000);
  });
});

describe('legal betting', () => {
  it('enforces the minimum raise and tracks the last full raise size', () => {
    const t = tableWith([5000, 5000, 5000]);
    startHand(t, BLINDS, seededRng(1), { button: 0 });
    let l = legalActions(t)!;
    assert.equal(l.callAmount, 100);
    assert.equal(l.minTo, 200);
    assert.equal(l.maxTo, 5000);
    assert.throws(() => act(t, 0, 'raise', 150), (e: unknown) => e instanceof ActionError && e.code === 'below_minimum');
    act(t, 0, 'raise', 350); // raise by 250
    l = legalActions(t)!;
    assert.equal(l.callAmount, 300);
    assert.equal(l.minTo, 600, 'min re-raise is the previous raise size on top');
    assert.throws(() => act(t, 1, 'raise', 599));
    act(t, 1, 'raise', 600);
    assert.equal(legalActions(t)!.minTo, 850);
  });

  it('rejects actions out of turn, checks facing a bet, and bets above the stack', () => {
    const t = tableWith([1000, 1000, 1000]);
    startHand(t, BLINDS, seededRng(1), { button: 0 });
    assert.throws(() => act(t, 1, 'call'), (e: unknown) => e instanceof ActionError && e.code === 'not_your_turn');
    assert.throws(() => act(t, 0, 'check'), (e: unknown) => e instanceof ActionError && e.code === 'illegal_action');
    assert.throws(() => act(t, 0, 'raise', 1001), (e: unknown) => e instanceof ActionError && e.code === 'above_stack');
    assert.throws(() => act(t, 0, 'raise', 250.5), (e: unknown) => e instanceof ActionError && e.code === 'bad_amount');
  });

  it('a short all-in raise does not reopen betting for a player who already acted', () => {
    // Seats: 0 = button, 1 = SB, 2 = BB. Post-flop order: 1, 2, 0.
    const t = tableWith([5000, 5000, 350]);
    const hand = startHand(t, BLINDS, seededRng(2), { button: 0 });
    act(t, 0, 'call');
    act(t, 1, 'call');
    act(t, 2, 'check');
    assert.equal(hand.street, 'flop');
    act(t, 1, 'bet', 200);
    act(t, 2, 'raise', 250); // all-in, only 50 more: not a full raise
    assert.equal(t.seats[2]!.allIn, true);
    // Seat 0 has not acted yet on this street, so may still raise.
    let l = legalActions(t)!;
    assert.equal(l.seat, 0);
    assert.equal(l.canRaise, true);
    assert.equal(l.minTo, 450, 'min raise is current bet (250) plus the last full bet (200)');
    act(t, 0, 'call');
    // Seat 1 already bet 200 and now faces only 50 more: call or fold, no raise.
    l = legalActions(t)!;
    assert.equal(l.seat, 1);
    assert.equal(l.callAmount, 50);
    assert.equal(l.canRaise, false);
    assert.throws(() => act(t, 1, 'raise', 900), (e: unknown) => e instanceof ActionError && e.code === 'illegal_action');
    act(t, 1, 'call');
    assert.equal(hand.street, 'turn');
  });

  it('two short all-ins that add up to a full raise do reopen the betting', () => {
    // Post-flop order: 1, 2, 3, 0.
    const t = tableWith([5000, 5000, 250, 320]);
    const hand = startHand(t, BLINDS, seededRng(2), { button: 0 });
    act(t, 3, 'call');
    act(t, 0, 'call');
    act(t, 1, 'call');
    act(t, 2, 'check');
    assert.equal(hand.street, 'flop');
    act(t, 1, 'bet', 100);
    act(t, 2, 'raise', 150); // all-in short (+50)
    act(t, 3, 'raise', 220); // all-in short (+70); seat 1 now faces 120 >= 100
    act(t, 0, 'call'); // seat 0 still has chips behind, so a re-raise would have someone to answer it
    const l = legalActions(t)!;
    assert.equal(l.seat, 1);
    assert.equal(l.callAmount, 120);
    assert.equal(l.canRaise, true);
  });

  it('caps the call at what an all-in big blind actually posted and refunds nothing extra', () => {
    const t = tableWith([1000, 60]);
    const hand = startHand(t, BLINDS, seededRng(2), { button: 0 }); // seat 0 = SB/button, seat 1 = BB all-in for 60
    assert.equal(t.seats[1]!.allIn, true);
    const l = legalActions(t)!;
    assert.equal(l.seat, 0);
    assert.equal(l.callAmount, 10, 'only 10 more is needed to match the short big blind');
    assert.equal(l.canRaise, false, 'nobody left to respond to a raise');
    act(t, 0, 'call');
    assert.equal(hand.street, 'complete');
    assert.equal(chipsOnTable(t), 1060);
  });

  it('returns an uncalled bet', () => {
    const t = tableWith([1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0 });
    act(t, 0, 'raise', 600);
    act(t, 1, 'fold');
    act(t, 2, 'fold');
    assert.equal(hand.street, 'complete');
    const refund = events(t, 'refund')[0]!;
    assert.ok(refund.t === 'refund' && refund.amount === 500 && refund.seat === 0);
    assert.equal(t.seats[0]!.stack, 1150);
    assert.equal(chipsOnTable(t), 3000);
  });
});

describe('showdown, side pots and eliminations', () => {
  it('pays main and side pots to the right players and eliminates the loser', () => {
    // Dealing order with button 0: seat1, seat2, seat0.
    const t = tableWith([3000, 500, 1500]);
    const deck = riggedDeck(['Ah Ad', 'Kh Kd', 'Qh Qd'], '2c 7d 9s 3h 4c');
    // seat1 (500) has AA, seat2 (1500) has KK, seat0 (3000) has QQ
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0, deck });
    act(t, 0, 'raise', 3000);
    act(t, 1, 'call'); // all-in 500
    act(t, 2, 'call'); // all-in 1500
    assert.equal(hand.street, 'complete');
    // Main pot 1500 -> AA (seat 1). Side pot 2000 -> KK (seat 2). 1500 uncalled back to seat 0.
    assert.equal(t.seats[1]!.stack, 1500);
    assert.equal(t.seats[2]!.stack, 2000);
    assert.equal(t.seats[0]!.stack, 1500);
    assert.deepEqual(hand.result!.eliminated, []);
    const awards = events(t, 'award');
    assert.equal(awards.length, 2);
    assert.equal(chipsOnTable(t), 5000);
  });

  it('eliminates a player who loses an all-in', () => {
    const t = tableWith([1000, 400]);
    const deck = riggedDeck(['2c 7d', 'Ah Ad'], 'Ks 9s 4h 3d 8c'); // button=0 is SB: deals seat1 first
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0, deck });
    // seat 1 (BB, 400) holds 2c7d ; seat 0 holds AA
    act(t, 0, 'raise', 1000);
    act(t, 1, 'call');
    assert.equal(hand.street, 'complete');
    assert.deepEqual(hand.result!.eliminated, [1]);
    assert.equal(hand.result!.topWinner, 0);
    assert.equal(t.seats[0]!.stack, 1400);
    assert.equal(t.seats[1]!.stack, 0);
    assert.throws(() => startHand(t, BLINDS, seededRng(1)), /at least two players/);
  });

  it('splits a tied pot and gives the odd chip to the first winner left of the button', () => {
    const t = tableWith([1000, 1000, 1000]);
    // Board plays (broadway); seat 0 folds after posting nothing; SB folds leaving an odd pot.
    const deck = riggedDeck(['2c 3d', '4c 5d', '2h 3s'], 'Ah Kd Qc Js Th');
    const hand = startHand(t, { sb: 25, bb: 50, ante: 5, anteType: 'classic' }, seededRng(1), { button: 0, deck });
    // order of deal: seat1 (2c3d), seat2 (4c5d), seat0 (2h3s). Pot so far 15 + 75.
    act(t, 0, 'call'); // 50
    act(t, 1, 'fold'); // SB folds: 25 + 5 dead
    act(t, 2, 'check');
    while (handInProgress(t)) act(t, hand.toAct, 'check');
    // Pot = 15 antes + 25 sb + 50 + 50 = 140 -> wait for odd: make it odd via ante 5 * 3 = 15 -> 140 even
    const award = events(t, 'award')[0]!;
    assert.ok(award.t === 'award');
    assert.equal(award.amount, 140);
    assert.deepEqual(award.winners.map((w) => w.amount), [70, 70]);
    assert.equal(chipsOnTable(t), 3000);

    // Now an odd pot: three-way tie over a pot that does not divide evenly.
    const t2 = tableWith([1000, 1000, 1000, 1000]);
    const deck2 = riggedDeck(['2c 3d', '4c 5d', '2h 3s', '6c 7d'], 'Ah Kd Qc Js Th');
    const hand2 = startHand(t2, { sb: 50, bb: 100, ante: 0, anteType: 'none' }, seededRng(1), { button: 0, deck: deck2 });
    act(t2, 3, 'call');
    act(t2, 0, 'call');
    act(t2, 1, 'fold'); // 50 dead
    act(t2, 2, 'check');
    while (handInProgress(t2)) act(t2, hand2.toAct, 'check');
    const award2 = events(t2, 'award')[0]!;
    assert.ok(award2.t === 'award');
    assert.equal(award2.amount, 350);
    // Winners clockwise from the button (seat 0): seat 2, seat 3, seat 0. Odd chips go to the first two.
    assert.deepEqual(award2.winners, [
      { seat: 2, amount: 117 },
      { seat: 3, amount: 117 },
      { seat: 0, amount: 116 },
    ]);
    assert.equal(chipsOnTable(t2), 4000);
  });

  it('a player who folds after contributing forfeits those chips to the pot', () => {
    const t = tableWith([1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(9), { button: 0 });
    act(t, 0, 'raise', 300);
    act(t, 1, 'call');
    act(t, 2, 'fold'); // BB forfeits 100
    assert.equal(hand.street, 'flop');
    const collect = events(t, 'collect')[0]!;
    assert.ok(collect.t === 'collect');
    assert.deepEqual(collect.pots, [{ amount: 700, eligible: [0, 1] }]);
  });

  it('runs the board out when everyone is all-in and shows the hands first', () => {
    const t = tableWith([800, 800, 800]);
    const hand = startHand(t, BLINDS, seededRng(11), { button: 0 });
    act(t, 0, 'raise', 800);
    act(t, 1, 'call');
    act(t, 2, 'call');
    assert.equal(hand.street, 'complete');
    assert.equal(hand.board.length, 5);
    const kinds = hand.events.map((e) => e.t);
    assert.ok(kinds.indexOf('show') < kinds.indexOf('street'), 'hands are tabled before the run-out');
    assert.equal(events(t, 'show').length, 3);
    assert.equal(chipsOnTable(t), 2400);
  });
});

describe('timeouts and absent players', () => {
  it('auto-action checks when free and folds when facing a bet', () => {
    const t = tableWith([1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0 });
    applyAutoAction(t); // seat 0 faces the big blind -> fold
    assert.equal(t.seats[0]!.folded, true);
    act(t, 1, 'call');
    applyAutoAction(t); // big blind can check
    assert.equal(hand.street, 'flop');
    const last = events(t, 'action').at(-1)!;
    assert.ok(last.t === 'action' && last.type === 'check' && last.auto === true);
  });

  it('cannot remove a player in the middle of a hand', () => {
    const t = tableWith([1000, 1000, 1000]);
    startHand(t, BLINDS, seededRng(1), { button: 0 });
    assert.throws(() => unseatPlayer(t, 1), /during a hand/);
  });
});

describe('command handling (duplicates, stale and out-of-order messages)', () => {
  it('applies a duplicated command exactly once', () => {
    const t = tableWith([1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0 });
    const cmd = { seat: 0, handNo: hand.handNo, seq: hand.seq, actionId: newActionId(), action: { type: 'raise', amount: 300 } as PlayerAction };
    const first = submitCommand(t, cmd);
    const stackAfter = t.seats[0]!.stack;
    const second = submitCommand(t, cmd);
    const third = submitCommand(t, cmd);
    assert.deepEqual(first, { ok: true, duplicate: false, seq: 1 });
    assert.equal(second.ok && second.duplicate, true);
    assert.equal(third.ok && third.duplicate, true);
    assert.equal(t.seats[0]!.stack, stackAfter, 'the bet was not taken twice');
    assert.equal(events(t, 'action').length, 1);
    assert.equal(chipsOnTable(t), 3000);
  });

  it('rejects a command built on stale state, from the wrong seat, or for an old hand', () => {
    const t = tableWith([1000, 1000, 1000]);
    const hand = startHand(t, BLINDS, seededRng(1), { button: 0 });
    const base = { handNo: hand.handNo, action: { type: 'call' } as PlayerAction };
    assert.equal(submitCommand(t, { ...base, seat: 0, seq: 0, actionId: 'a' }).ok, true);
    // A delayed message that still thinks seq is 0:
    const stale = submitCommand(t, { ...base, seat: 1, seq: 0, actionId: 'b' });
    assert.ok(!stale.ok && stale.code === 'stale');
    // Two players sending at once: only the player whose turn it is gets through.
    const wrongSeat = submitCommand(t, { ...base, seat: 2, seq: 1, actionId: 'c' });
    assert.ok(!wrongSeat.ok && wrongSeat.code === 'not_your_turn');
    assert.equal(submitCommand(t, { ...base, seat: 1, seq: 1, actionId: 'd' }).ok, true);
    const oldHand = submitCommand(t, { ...base, handNo: hand.handNo - 1, seat: 2, seq: 2, actionId: 'e' });
    assert.ok(!oldHand.ok && oldHand.code === 'wrong_hand');
    assert.equal(chipsOnTable(t), 3000);
  });
});

describe('hidden information', () => {
  it('never sends another player\'s hole cards before showdown', () => {
    const t = tableWith([1000, 1000, 1000, 1000]);
    startHand(t, BLINDS, seededRng(21), { button: 0 });
    for (const viewer of [0, 1, 2, 3, null]) {
      const stream = redactedEvents(t, viewer);
      for (const e of stream) {
        if (e.t === 'hole') assert.equal(e.cards !== null, e.seat === viewer, `viewer ${viewer} saw seat ${e.seat}`);
      }
      const view = viewOf(t, viewer);
      for (const s of view.seats) {
        if (s && s.seat !== viewer) assert.equal(s.cards, null);
        if (s && s.seat === viewer) assert.equal(s.cards!.length, 2);
      }
      const wire = JSON.stringify({ stream, view });
      assert.ok(!wire.includes('"deck"'), 'the deck is never part of a client view');
    }
  });

  it('a bot only sees its own cards', () => {
    const t = tableWith([1000, 1000, 1000]);
    startHand(t, BLINDS, seededRng(21), { button: 0 });
    const ctx = botContext(t, 0);
    assert.deepEqual(ctx.hole, t.seats[0]!.hole);
    const json = JSON.stringify(ctx);
    // The context names the deck *kind* in its rules, never the deck's cards.
    assert.ok(!/"deck":\s*\[/.test(json), 'no card array other than hole and board');
    for (const other of t.seats.slice(1)) for (const c of other!.hole) assert.ok(!(json.includes(`[${c},`) || json.includes(`,${c}]`)) || ctx.hole.includes(c), 'no opponent hole card appears');
    assert.equal(Object.keys(ctx).includes('seats'), false);
    assert.equal(Object.keys(ctx).includes('deck'), false);
  });
});

// ---------------------------------------------------------------------------
// Fuzzing: random legal play must always conserve chips and terminate.
// ---------------------------------------------------------------------------

function randomLegalAction(t: TableState, rng: Rng): PlayerAction {
  const l = legalActions(t)!;
  const options: PlayerAction[] = [];
  if (l.canCheck) options.push({ type: 'check' }, { type: 'check' });
  if (l.canCall) options.push({ type: 'call' }, { type: 'call' });
  if (!l.canCheck) options.push({ type: 'fold' });
  if (l.canBet || l.canRaise) {
    const type = l.canBet ? 'bet' : 'raise';
    options.push({ type, amount: l.minTo });
    options.push({ type, amount: l.maxTo });
    if (l.maxTo > l.minTo) options.push({ type, amount: l.minTo + rng.int(l.maxTo - l.minTo + 1) });
  }
  return options[rng.int(options.length)]!;
}

describe('fuzz: chip conservation and termination', () => {
  it('random legal play over 4,000 hands with antes, short stacks and 2–9 players', () => {
    const rng = seededRng(2026);
    let hands = 0;
    let sidePotHands = 0;
    let splitPots = 0;
    for (let game = 0; game < 700; game++) {
      const n = 2 + rng.int(8);
      const stacks = Array.from({ length: n }, () => 50 + rng.int(4000));
      const t = tableWith(stacks, 9);
      const total = stacks.reduce((a, b) => a + b, 0);
      const anteType = (['none', 'classic', 'bb'] as const)[rng.int(3)];
      for (let h = 0; h < 10; h++) {
        if (occupiedSeats(t).filter((s) => s.stack > 0).length < 2) break;
        const bb = 20 * (1 + rng.int(10));
        const blinds: Blinds = { sb: bb / 2, bb, ante: anteType === 'none' ? 0 : anteType === 'bb' ? bb : Math.ceil(bb / 8), anteType };
        const hand = startHand(t, blinds, rng);
        const view = baseView(t);
        let cursor = 0;
        const drain = () => {
          const evs = redactedEvents(t, null, cursor);
          cursor += evs.length;
          for (const e of evs) applyEvent(view, e);
        };
        drain();
        let steps = 0;
        while (handInProgress(t)) {
          assert.equal(chipsOnTable(t), total, 'chips conserved mid-hand');
          assert.equal(view.potTotal + view.seats.reduce((a, s) => a + (s ? s.stack : 0), 0), total, 'view agrees with engine');
          applyAction(t, hand.toAct, randomLegalAction(t, rng));
          drain();
          assert.ok(++steps < 400, 'hand must terminate');
        }
        hands++;
        assert.equal(chipsOnTable(t), total, 'chips conserved after the hand');
        for (const s of occupiedSeats(t)) {
          assert.ok(s.stack >= 0 && Number.isInteger(s.stack));
          assert.equal(view.seats[s.seat]!.stack, s.stack, 'replayed view matches engine stacks');
        }
        assert.equal(view.potTotal, 0);
        const awards = hand.events.filter((e) => e.t === 'award');
        if (awards.length > 1) sidePotHands++;
        if (awards.some((e) => e.t === 'award' && e.winners.length > 1)) splitPots++;
        const net = Object.values(hand.result!.net).reduce((a, b) => a + b, 0);
        assert.equal(net, 0, 'net results sum to zero');
      }
    }
    assert.ok(hands >= 4000, `played ${hands} hands`);
    assert.ok(sidePotHands > 100, `side pots exercised (${sidePotHands})`);
    assert.ok(splitPots > 5, `split pots exercised (${splitPots})`);
  });
});

describe('demo bots', () => {
  it('Chen scores order the obvious hands', () => {
    assert.equal(chenScore(parseCards('As Ah')), 20);
    assert.ok(chenScore(parseCards('As Ks')) > chenScore(parseCards('As Kd')));
    assert.ok(chenScore(parseCards('7c 2d')) < chenScore(parseCards('Jc Td')));
  });

  it('equity estimates are sane', () => {
    const rng = seededRng(5);
    const aces = estimateEquity(parseCards('As Ah'), [], 1, 3000, rng);
    assert.ok(aces > 0.8 && aces < 0.9, `AA vs random ≈ 85%, got ${aces}`);
    const nuts = estimateEquity(parseCards('As Ks'), parseCards('Qs Js Ts'), 2, 300, rng);
    assert.equal(nuts, 1);
  });

  it('bots of every style only ever take legal actions (1,500 hands)', () => {
    const rng = seededRng(77);
    let hands = 0;
    for (let game = 0; game < 60; game++) {
      const n = 2 + rng.int(8);
      const t = tableWith(Array.from({ length: n }, () => 1500), 9);
      const total = n * 1500;
      const styles = Array.from({ length: n }, () => BOT_STYLES[rng.int(BOT_STYLES.length)]!);
      let level = 0;
      while (occupiedSeats(t).filter((s) => s.stack > 0).length >= 2 && hands < 1500 && level < 400) {
        const bb = 20 * 2 ** Math.floor(level / 12);
        const hand = startHand(t, { sb: bb / 2, bb, ante: 0, anteType: 'none' }, rng);
        while (handInProgress(t)) {
          const ctx = botContext(t, hand.toAct);
          applyAction(t, hand.toAct, chooseBotAction(ctx, styles[hand.toAct]!, rng, 30));
        }
        assert.equal(chipsOnTable(t), total);
        hands++;
        level++;
      }
    }
    assert.ok(hands >= 1000, `played ${hands} hands`);
  });
});
