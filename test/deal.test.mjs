// The deal rule and everything the theorem says about it. Every expectation in this file is
// a literal: the convergence numbers were measured on 2026-09-27 by an independent throwaway
// script (/tmp/stair-probe.mjs, ten lines of arithmetic, sharing no code with js/core) and
// the p(n) values come from the published partition table. Hand-derived small cases are
// spelled out in the comments so a reader can check them without running anything.

import { test, run, eq, ok } from '../tools/harness.mjs';
import {
  deal, dealByCounts, stepsToDeal, orbitOf, targetOf, convergenceCensus, orbitCensus, isStaircase,
} from '../js/core/deal.js';
import { partitionsOf, key, staircase } from '../js/core/partition.js';

test('the rule: one card off every pile, the taken cards become one new pile', () => {
  // deal([6]): one pile -> take 1 -> [5], new pile of size 1 -> [5,1].
  eq(deal([6]), [5, 1]);
  // deal([1,1,1]): three piles -> all empty, dropped; one new pile of size 3.
  eq(deal([1, 1, 1]), [3]);
  // deal([2,2,1,1]): four piles -> [1,1] (the two singles vanish) + a pile of 4.
  eq(deal([2, 2, 1, 1]), [4, 1, 1]);
  // The new pile is sized BEFORE the deal: deal([3,2,1]) -> [2,1] + pile of 3.
  eq(deal([3, 2, 1]), [3, 2, 1], 'the staircase is a fixed point');
});

test('a deal never creates, loses or renames a card', () => {
  for (const p of partitionsOf(21)) {
    const n = deal(p);
    eq(sumOf(n), 21, `deal(${p}) changed the total`);
    ok(n.every((x) => x > 0), `deal(${p}) left an empty pile`);
    ok(p.every((x) => x > 0));
  }
});

test('deal copies: the board the caller handed over is not modified', () => {
  const before = [4, 2, 1, 1];
  const frozen = before.slice();
  deal(before);
  eq(before, frozen);
});

test('the staircase fixed point holds for every k the game ships', () => {
  for (let k = 1; k <= 9; k++) {
    eq(deal(staircase(k)), staircase(k), `staircase(${k}) must not move`);
    ok(isStaircase(deal(staircase(k))));
  }
});

test('multiplicities say the same thing as the pile list, for all 4137 boards up to 28', () => {
  const seen = [];
  for (const n of [3, 6, 10, 15, 21, 28]) {
    for (const p of partitionsOf(n)) {
      const a = deal(p);
      const b = dealByCounts(p);
      if (key(a) !== key(b)) seen.push({ n, p, a, b });
    }
  }
  eq(seen.slice(0, 3), [], 'dealByCounts disagrees with deal somewhere');
  let count = 0;
  for (const n of [3, 6, 10, 15, 21, 28]) count += partitionsOf(n).length;
  eq(count, 3 + 11 + 42 + 176 + 792 + 3718);
  eq(count, 4742);
});

test('stepsToDeal counts deals, not positions, and refuses an unreachable target', () => {
  // [1,1,1] -> [3] -> [2,1]: two deals, so steps = 2.
  eq(stepsToDeal([1, 1, 1], [2, 1]).steps, 2);
  eq(stepsToDeal([2, 1], [2, 1]).steps, 0, 'already there costs nothing');
  // 12 cards has no staircase, so a staircase target must never be "found".
  eq(stepsToDeal([6, 6], [3, 2, 1], { limit: 60 }).steps, -1);
});

test('the theorem, counted: every 3, 6, 10 and 15-card opening reaches the staircase', () => {
  const census = [3, 6, 10, 15].map((n) => convergenceCensus(n, { limit: 400 }));
  eq(census.map((c) => c.stuck), [0, 0, 0, 0], 'stuck must be zero: no opening may fail to converge');
  eq(census.map((c) => c.open), [0, 0, 0, 0], 'and every run must close inside the budget');
  eq(census.map((c) => c.states), [3, 11, 42, 176], 'p(T_2..T_5) = 3, 11, 42, 176');
  eq(census.map((c) => c.converged), [3, 11, 42, 176]);
});

test('the worst deal-only runs are 2, 6, 12, 20 (and 30, 42 further out)', () => {
  const worst = [3, 6, 10, 15, 21, 28].map((n) => convergenceCensus(n, { limit: 400 }));
  eq(worst.map((c) => c.worst), [2, 6, 12, 20, 30, 42]);
  // The same six numbers against the closed form k(k-1) they were found to follow.
  eq(worst.map((c) => c.closedForm), worst.map((c) => c.worst));
});

test('the hardest openings are named, and they are the ones the probe found', () => {
  eq(convergenceCensus(3, { limit: 400 }).worstFrom, [1, 1, 1]);
  eq(convergenceCensus(6, { limit: 400 }).worstFrom, [2, 2, 1, 1]);
  eq(convergenceCensus(10, { limit: 400 }).worstFrom, [3, 3, 2, 1, 1]);
  eq(convergenceCensus(15, { limit: 400 }).worstFrom, [4, 4, 3, 2, 1, 1]);
  eq(convergenceCensus(21, { limit: 400 }).worstFrom, [5, 5, 4, 3, 2, 1, 1]);
  eq(convergenceCensus(28, { limit: 400 }).worstFrom, [6, 6, 5, 4, 3, 2, 1, 1]);
});

test('the counterexample: nothing about 12 cards converges, and every run is periodic', () => {
  const c = orbitCensus(12, { limit: 400 });
  eq([c.states, c.cyclic, c.open], [77, 77, 0], 'p(12)=77 and all 77 sit on a cycle');
  eq(c.cycleLengths, [5], 'measured: the only cycle length at 12 cards is 5');
  eq(c.withPreperiod, 67, 'the other 10 are already on a cycle');
  eq(convergenceCensus(12, { limit: 400 }).converged, 0, 'no staircase exists at 12 cards');
});

test('18 and 20 cards are periodic too (385 and 627 openings)', () => {
  const a = orbitCensus(18, { limit: 400 });
  const b = orbitCensus(20, { limit: 400 });
  eq([a.states, a.cyclic, a.open, a.withPreperiod], [385, 385, 0, 365]);
  eq(a.cycleLengths, [2, 6]);
  eq([b.states, b.cyclic, b.open], [627, 627, 0]);
  eq(b.cycleLengths, [6]);
});

test('orbitOf reports the tail and the cycle, and its cycle really is a cycle', () => {
  // Hand-run: [6,6] -> deal -> [5,5,2] -> [4,4,1,3]? check the shape instead:
  const o = orbitOf([6, 6], { limit: 100 });
  ok(o.closed, 'a 12-card orbit must close inside 100 deals');
  eq(o.cycle.length, o.cycleLen);
  eq(key(deal(o.cycle[o.cycle.length - 1])), key(o.cycle[0]), 'the last cycle member must return to the first');
  ok(o.preperiod + o.cycleLen <= o.path.length);
  eq(new Set(o.cycle.map(key)).size, o.cycle.length, 'a cycle may not repeat a position');
});

test('targetOf: triangular counts aim at the staircase, others at their own cycle minimum', () => {
  const t = targetOf([2, 2, 1, 1]);
  eq([t.target, t.attractor, t.kind, t.steps], [[3, 2, 1], 'staircase(3)', 'staircase', 6]);
  const o = targetOf([4, 4, 4]);
  eq([o.attractor, o.kind, o.preperiod, o.cycleLen], ['orbit(5,5)', 'orbit', 5, 5]);
  eq(o.target, [4, 3, 3, 1, 1], 'the canonical smallest member of that 12-card cycle');
  eq(o.steps, 7, 'dealt into for 7 cards-deal steps');
  eq(sumOf(o.target), 12, 'the target must still hold every card');
});

test('a lot target is always reached by dealing exactly `steps` times', () => {
  for (const n of [6, 10, 12, 15, 18]) {
    for (const start of partitionsOf(n).slice(0, 20)) {
      const info = targetOf(start, { limit: 400 });
      ok(info.target, `no target for ${key(start)}`);
      eq(stepsToDeal(start, info.target, { limit: 400 }).steps, info.steps, `steps lie for ${key(start)}`);
    }
  }
});

test('a single pile of T_k cards needs T_(k-1) deals — a closed form checked against the run', () => {
  // Hand-written from the pattern 1, 3, 6, 10, 15, 21 = k(k-1)/2 (the eroding pile loses
  // one card per deal while the staircase is being carved out of it).
  const expected = [1, 3, 6, 10, 15, 21];
  const got = [];
  for (let k = 2; k <= 7; k++) {
    const n = (k * (k + 1)) / 2;
    const info = targetOf([n], { limit: 400 });
    eq(info.attractor, `staircase(${k})`);
    got.push(info.steps);
  }
  eq(got, expected);
  const starved = orbitOf([28], { limit: 5 });
  eq([starved.closed, starved.cycleLen], [false, -1], 'an open orbit must be reported, not guessed');
});

test('convergence does not depend on the order the piles were dealt in', () => {
  const a = stepsToDeal([3, 3, 2, 1, 1], [4, 3, 2, 1]).steps;
  const b = stepsToDeal([1, 2, 3, 3, 1], [4, 3, 2, 1]).steps;
  eq([a, b], [12, 12], 'hand-checked worst opening of 10 cards converges in 12 deals');
});

function sumOf(piles) {
  let t = 0;
  for (const p of piles) t += p;
  return t;
}

run();
