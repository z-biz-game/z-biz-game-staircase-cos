// The board algebra: what a position is, and how many positions there are.
//
// p(n) below is the public integer-partition sequence (OEIS A000041), written by hand from
// the literature and never read back out of this repo's own enumeration.

import { test, run, eq, ok } from '../tools/harness.mjs';
import {
  key, fromKey, sortDesc, isPartitionOf, partitionsOf, pentagonalCount,
  staircase, triangularRoot, isTriangular, isStaircase, triangle, lexCompare, minPartition, sum,
} from '../js/core/partition.js';

// Hand-written: p(0..15) and a few larger values, from the standard table.
const PUBLIC_P = {
  0: 1, 1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 11, 7: 15, 8: 22, 9: 30, 10: 42,
  11: 56, 12: 77, 13: 101, 14: 135, 15: 176, 18: 385, 20: 627, 21: 792, 28: 3718,
};

test('the card counts this game uses are the ones the spec names', () => {
  eq([triangle(2), triangle(3), triangle(4), triangle(5), triangle(6), triangle(7)], [3, 6, 10, 15, 21, 28]);
  eq([triangularRoot(3), triangularRoot(6), triangularRoot(10), triangularRoot(15)], [2, 3, 4, 5]);
});

test('a non-triangular count has no root (12, 18, 20, 8)', () => {
  eq([triangularRoot(12), triangularRoot(18), triangularRoot(20), triangularRoot(8)], [0, 0, 0, 0]);
  eq([isTriangular(3), isTriangular(12)], [true, false]);
});

test('staircase(k) is (k, k-1, ..., 1) and sums to T_k', () => {
  eq(staircase(1), [1]);
  eq(staircase(2), [2, 1]);
  eq(staircase(3), [3, 2, 1]);
  eq(staircase(7), [7, 6, 5, 4, 3, 2, 1]);
  for (let k = 1; k <= 9; k++) eq([sum(staircase(k)), isStaircase(staircase(k))], [triangle(k), true]);
});

test('isStaircase rejects near-misses rather than counting cards', () => {
  eq([isStaircase([3, 2, 2]), isStaircase([2, 2]), isStaircase([1, 1]), isStaircase([])], [false, false, false, false]);
  eq(isStaircase([1, 2, 3]), true, 'order must not matter — a position is a multiset');
});

test('key() is the canonical identity: same multiset, same key', () => {
  eq(key([1, 3, 2]), key([3, 2, 1]));
  eq(key([1, 3, 2]), '3,2,1');
  eq(fromKey('3,2,1'), [3, 2, 1]);
  ok(key([2, 2, 1]) !== key([2, 1, 1]), 'different multisets need different keys');
});

test('sortDesc never touches its argument', () => {
  const src = [1, 4, 2];
  eq(sortDesc(src), [4, 2, 1]);
  eq(src, [1, 4, 2], 'sortDesc copied before sorting');
});

test('isPartitionOf accepts sums and rejects everything else', () => {
  eq(isPartitionOf(6, [3, 2, 1]), true);
  eq(isPartitionOf(6, [2, 1]), false, 'wrong total');
  eq(isPartitionOf(6, [3, 2, 1, 0]), false, 'a zero-size pile is not a pile');
  eq(isPartitionOf(6, [3, 1.5, 1.5]), false, 'cards are whole');
  eq(isPartitionOf(6, []), false, 'no piles is not a dealt board');
  eq(isPartitionOf(6, ['3', '2', '1']), false, 'strings are not sizes');
});

test('partitionsOf enumerates the public counts for every n the game uses', () => {
  for (const [n, expected] of Object.entries(PUBLIC_P)) {
    eq(partitionsOf(Number(n)).length, expected, `p(${n}) enumerated`);
  }
});

test('partitionsOf is canonical: descending, summing to n, and duplicate-free', () => {
  for (const n of [1, 4, 6, 10, 15, 21]) {
    const all = partitionsOf(n);
    const keys = new Set(all.map(key));
    eq(keys.size, all.length, `p(${n}) has repeats`);
    for (const p of all) {
      ok(sum(p) === n, `p(${n}) member ${p} sums to ${sum(p)}`);
      ok(isPartitionOf(n, p) && String(p) === sortDesc(p).join(','), `${p} is not descending`);
    }
  }
});

test('partitionsOf(0) is the empty partition and bad n throws', () => {
  eq(partitionsOf(0), [[]]);
  let threw = 0;
  for (const bad of [-1, 2.5, NaN]) { try { partitionsOf(bad); } catch { threw += 1; } }
  eq(threw, 3);
});

test('the enumeration count survives an independent route (Euler pentagonal recurrence)', () => {
  for (const n of [5, 10, 12, 15, 21, 28]) {
    eq(pentagonalCount(n), partitionsOf(n).length, `p(${n}): recurrence vs enumeration`);
  }
  eq([pentagonalCount(3), pentagonalCount(6), pentagonalCount(10), pentagonalCount(15)], [3, 11, 42, 176]);
});

test('pentagonalCount matches the public hand-written table too', () => {
  for (const [n, expected] of Object.entries(PUBLIC_P)) {
    eq(pentagonalCount(Number(n)), expected, `p(${n}) from the recurrence`);
  }
});

test('lexCompare orders descending partitions and minPartition picks the smallest', () => {
  eq([lexCompare([3, 2, 1], [3, 2, 1]), lexCompare([4, 1], [3, 3]), lexCompare([3, 3], [4, 1])], [0, 1, -1]);
  eq(lexCompare([3, 2], [3, 2, 1]), -1, 'a prefix counts as smaller');
  eq(minPartition([[4, 1], [3, 3], [2, 2, 2]]), [2, 2, 2]);
  eq(minPartition([]), null);
});

test('the 12-card count that the counterexample is built on is 77', () => {
  eq([partitionsOf(12).length, pentagonalCount(12), isTriangular(12)], [77, 77, false]);
});

run();
