// par: the shortest deal/merge/split route, measured by breadth-first search over the p(n)
// positions, and cross-checked three ways.
//
// The hand-written fixtures below are derived in their comments, not read from solve.js.

import { test, run, eq, ok, throws } from '../tools/harness.mjs';
import {
  applyAction, illegalReason, neighbors, solve, buildGraph, parProof, distanceMap, replay, hardestOpening,
} from '../js/core/solve.js';
import { deal, targetOf, stepsToDeal } from '../js/core/deal.js';
import { partitionsOf, key, staircase } from '../js/core/partition.js';

const STAIR3 = [3, 2, 1]; // the staircase of T_3 = 6 cards

test('applyAction: the three legal shapes, and nothing else', () => {
  eq(applyAction([6], { kind: 'deal' }), [5, 1]);
  eq(applyAction([2, 2, 1, 1], { kind: 'merge', a: 0, b: 2 }), [3, 2, 1], 'merge a 2-pile into a 1-pile');
  eq(applyAction([6], { kind: 'split', i: 0, j: 3 }), [3, 3]);
  eq(applyAction([6], { kind: 'split', i: 0, j: 0 }), null, 'an empty part is not a split');
  eq(applyAction([6], { kind: 'split', i: 0, j: 6 }), null, 'neither is the whole pile');
  eq(applyAction([6], { kind: 'split', i: 0, j: 7 }), null);
  eq(applyAction([6], { kind: 'merge', a: 0, b: 0 }), null, 'a pile cannot join itself');
  eq(applyAction([6], { kind: 'merge', a: 0, b: 1 }), null, 'there is no second pile');
  eq(applyAction([6], { kind: 'flip' }), null, 'unknown kinds are refused');
});

test('illegalReason explains a refusal instead of silently returning false', () => {
  eq(illegalReason([2, 2, 1, 1], { kind: 'merge', a: 1, b: 1 }), '不能把一堆并到自己身上');
  eq(illegalReason([3, 1], { kind: 'split', i: 1, j: 1 }), '一堆只有一张牌，拆不开');
  eq(illegalReason([3, 1], { kind: 'split', i: 5, j: 1 }), '那一堆不存在');
  eq(illegalReason([3, 1], { kind: 'split', i: 0, j: 3 }), '拆点必须落在堆的内部');
  eq(illegalReason([3, 1], { kind: 'deal' }), null);
});

test('every action keeps the card count and produces a canonical position', () => {
  for (const n of [6, 10, 15]) {
    for (const p of partitionsOf(n)) {
      for (const { piles } of neighbors(p)) {
        eq(piles.reduce((a, b) => a + b, 0), n, `a neighbour of ${key(p)} lost cards`);
        eq(key(piles), String(piles), `neighbour ${piles} is not in descending order`);
      }
    }
  }
});

test('neighbours of a board of single cards: one deal, one merge shape', () => {
  // [1,1,1]: deal -> [3]; merging any two of the three singles -> [2,1] (one position);
  // nothing is splittable. So exactly two distinct successors.
  const ns = neighbors([1, 1, 1]).map((x) => key(x.piles)).sort();
  eq(ns, ['2,1', '3']);
  // The staircase is a fixed point of deal, so it is its own neighbour.
  ok(neighbors(STAIR3).some((x) => key(x.piles) === key(STAIR3)));
});

test('hand fixture: [6] reaches the 6-card staircase in par 2', () => {
  // Two operations suffice: split 6 into 3+3, then split a 3 into 2+1.
  // One cannot: the only positions one operation away are deal([6]) = [5,1] and the splits
  // [5,1], [4,2], [3,3] — none of which is (3,2,1).
  const r = solve([6], STAIR3);
  eq([r.ok, r.par, r.capped], [true, 2, false]);
  eq(replay([6], r.path).piles, STAIR3, 'the route the search printed must actually play out');
});

test('hand fixture: six single cards need exactly 3 operations, not 2', () => {
  // Lower bound: one operation from [1,1,1,1,1,1] gives deal -> [6] or a merge -> [5,1].
  // From [6] one more operation reaches [5,1], [4,2], [3,3] or [6]; from [5,1] it reaches
  // [4,2] (deal), [6], [5,1] splits, or a merge back to [6]. So (3,2,1) is not two away.
  // Upper bound: deal -> [6], split 6 -> 3+3, split 3 -> 2+1.
  const r = solve([1, 1, 1, 1, 1, 1], STAIR3);
  eq([r.ok, r.par], [true, 3]);
});

test('hand fixture: one merge solves [2,2,1,1]', () => {
  eq(solve([2, 2, 1, 1], STAIR3).par, 1);
  eq(stepsToDeal([2, 2, 1, 1], STAIR3).steps, 6, 'dealing alone would take 6 — the measured gap par exploits');
});

test('solve(0) for a position that is already the target, and never wanders', () => {
  eq(solve(STAIR3, [1, 2, 3]).par, 0);
  eq(solve(STAIR3, STAIR3).path, []);
});

test('solve does not mutate the start or the target it was handed', () => {
  const start = [4, 4, 3, 2, 1, 1];
  const target = [5, 4, 3, 2, 1];
  const s0 = start.slice();
  const t0 = target.slice();
  const r = solve(start, target);
  ok(r.ok);
  eq(start, s0);
  eq(target, t0);
  // [4,4,3,2,1,1] is the 15-card opening that deals for the full 20 steps, and it is one
  // merge away from the staircase: merging a 4 with a 1 leaves (5,4,3,2,1). That asymmetry
  // is exactly why both numbers are printed.
  eq(r.par, 1);
  eq(stepsToDeal(start, target).steps, 20);
});

test('the exhaustive map agrees with every single search: max par of T_k is k', () => {
  // Hand-written: the hardest opening of T_k cards costs exactly k operations.
  const cases = [[6, 3, 3], [10, 4, 4], [15, 5, 5], [21, 6, 6], [28, 7, 7]];
  for (const [n, k, want] of cases) {
    const m = distanceMap(n, staircase(k));
    eq(m.max, want, `hardest ${n}-card opening should have par ${want}`);
    eq(m.unreachable, 0, 'every opening of a triangular count must be solvable');
    eq(m.states, partitionsOf(n).length);
    eq(key(m.maxFrom), m.maxFrom.join(','), 'the hardest opening is reported canonically');
  }
});

test('the map is a real measurement: it reproduces par for every 10-card opening', () => {
  const m = distanceMap(10, staircase(4));
  let checked = 0;
  for (const start of partitionsOf(10)) {
    const info = targetOf(start, { limit: 200 });
    const r = solve(start, info.target, { maxStates: 200000 });
    eq(r.par, m.byKey.get(key(start)), `par(${key(start)})`);
    checked += 1;
  }
  eq(checked, 42, 'every one of p(10)=42 openings was compared against the map');
});

test('a backwards map for a non-triangular count: the hardest 12-card opening is par 5', () => {
  const h = hardestOpening(12);
  eq([h.par, h.steps, h.start, h.target], [5, 11, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [4, 3, 2, 2, 1]]);
  ok(h.par <= h.steps, 'dealing is one of the operations, so par can never exceed the deal count');
});

test('parProof: three routes, a closed edge list, or no certificate', () => {
  for (const n of [6, 10, 15, 21, 12]) {
    const start = partitionsOf(n)[1];
    const info = targetOf(start, { limit: 400 });
    const p = parProof(start, info.target);
    eq([p.ok, p.closed, p.agree, p.layered.par === p.forward && p.forward === p.reverse], [true, true, true, true], `n=${n} ${JSON.stringify(p.layered)} ${JSON.stringify({ f: p.forward, r: p.reverse })}`);
    ok(p.states <= partitionsOf(n).length + 1);
    ok(p.edges > 0);
  }
});

test('buildGraph is closed under every action, for every board of 15 cards', () => {
  const g = buildGraph([15], { maxStates: 200000 });
  eq(g.capped, false);
  for (const [, piles] of g.states) {
    for (const nb of neighbors(piles)) ok(g.states.has(key(nb.piles)), `a neighbour of ${key(piles)} escaped`);
  }
  // Splitting alone can carve any partition out of a single pile, so the component from
  // [15] is the whole of p(15) = 176 positions.
  eq(g.states.size, partitionsOf(15).length);
  eq(g.states.size, 176);
});

test('a capped search says it was capped rather than guessing a number', () => {
  const r = solve([28], staircase(7), { maxStates: 3 });
  eq([r.ok, r.par, r.capped], [false, -1, true]);
  eq(solve([6, 6], [9, 9]).ok, false, 'a 9-pile cannot appear at 12 cards');
});

test('distanceMap refuses a target that is not a partition of n', () => {
  throws(() => distanceMap(6, [3, 2, 1, 1]), 'a 7-card target at 6 cards must be refused');
  throws(() => distanceMap(6, [7]), 'and so must a wrong total');
});

test('replay walks the same legality gate a click walks through', () => {
  const good = replay([6], [{ kind: 'split', i: 0, j: 3 }, { kind: 'split', i: 0, j: 2 }]);
  eq([good.ok, good.piles], [true, [3, 2, 1]]);
  const bad = replay([6], [{ kind: 'split', i: 0, j: 3 }, { kind: 'merge', a: 0, b: 0 }]);
  eq([bad.ok, bad.at], [false, 1]);
});

run();
