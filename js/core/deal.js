// The one rule of the game, plus the measurements that come out of applying it over and
// over. A deal takes one card off every pile and stacks those cards into a new pile; the
// new pile's size is therefore the number of piles BEFORE the deal, and piles that run out
// disappear. Get either half of that wrong and none of the numbers in README hold.
//
// Bulgarian solitaire theorem (the reason this game has fixed targets): when the card count
// is a triangular number n = T_k, EVERY starting partition reaches the staircase
// (k, k-1, ..., 1) and stops there. When n is not triangular, nothing does — every orbit
// falls into a cycle instead. Both halves are measured in `convergenceCensus` /
// `orbitCensus`, and both are asserted from scratch in test/deal.test.mjs.

import {
  sortDesc, key, staircase, triangularRoot, isStaircase, partitionsOf, lexCompare, minPartition,
} from './partition.js';

export { isStaircase, staircase, triangularRoot };

// The rule, written the way the theorem is stated in the literature.
export function deal(piles) {
  const count = piles.length;
  const next = piles.map((p) => p - 1).filter((p) => p > 0);
  next.push(count);
  return sortDesc(next);
}

// Independent route to the same answer: work on the multiplicity vector (c_s = how many
// piles of size s). Each pile shrinks by one, so c'_{s-1} = c_s for s >= 2, and one new
// pile of size (total pile count) appears. Used only to cross-check `deal`, on every
// partition of n up to 28 — see test/deal.test.mjs.
export function dealByCounts(piles) {
  const max = piles.length ? Math.max(...piles) : 0;
  const width = Math.max(max, piles.length) + 2;
  const c = new Array(width).fill(0);
  for (const p of piles) c[p] += 1;
  const next = new Array(width).fill(0);
  for (let s = 2; s < width; s++) next[s - 1] += c[s];
  next[piles.length] += 1;
  const out = [];
  for (let s = width - 1; s >= 1; s--) for (let i = 0; i < next[s]; i++) out.push(s);
  return out;
}

// Deals until `target` shows up. Returns -1 steps when it never does within `limit`;
// `limit` must be finite so a mistaken target cannot hang a build.
export function stepsToDeal(piles, target, { limit = 400 } = {}) {
  let cur = sortDesc(piles);
  const tk = key(target);
  const path = [cur];
  for (let s = 0; s <= limit; s++) {
    if (key(cur) === tk) return { steps: s, path };
    cur = deal(cur);
    path.push(cur);
  }
  return { steps: -1, path };
}

// The forward orbit of a position under deal: tail (preperiod) then a cycle. Finite state
// space, so a repeat always happens — a `closed: false` result means the budget was too
// small, not that the dynamics is different.
export function orbitOf(piles, { limit = 400 } = {}) {
  const seen = new Map();
  const path = [sortDesc(piles)];
  seen.set(key(path[0]), 0);
  for (let s = 1; s <= limit; s++) {
    const next = deal(path[s - 1]);
    const k = key(next);
    if (seen.has(k)) {
      const first = seen.get(k);
      return {
        closed: true, preperiod: first, cycleLen: s - first,
        cycle: path.slice(first, s), path, budget: s,
      };
    }
    seen.set(k, s);
    path.push(next);
  }
  return { closed: false, preperiod: -1, cycleLen: -1, cycle: [], path, budget: limit };
}

// What a lot's target is, derived from its start alone:
//  - triangular n  -> the staircase; the attractor label names it.
//  - otherwise     -> the canonical smallest member of the cycle the start falls into.
//                     Dealing reaches every cycle member, so the target is always
//                     reachable by dealing, and `steps` below is exactly when.
export function targetOf(start, { limit = 400 } = {}) {
  const k = triangularRoot(sumOf(start));
  if (k) {
    const st = staircase(k);
    const r = stepsToDeal(start, st, { limit });
    return {
      n: sumOf(start), k, target: st, steps: r.steps,
      preperiod: 0, cycleLen: 1,
      attractor: `staircase(${k})`, kind: 'staircase',
    };
  }
  const o = orbitOf(start, { limit });
  if (!o.closed) return { n: sumOf(start), k: 0, closed: false, steps: -1, target: null, attractor: 'open', kind: 'open' };
  const rep = minPartition(o.cycle);
  const hit = stepsToDeal(start, rep, { limit: o.cycleLen + o.preperiod + 2 });
  return {
    n: sumOf(start), k: 0, target: rep, steps: hit.steps,
    preperiod: o.preperiod, cycleLen: o.cycleLen,
    attractor: `orbit(${o.cycleLen},${o.preperiod})`, kind: 'orbit',
  };
}

function sumOf(piles) {
  let t = 0;
  for (const p of piles) t += p;
  return t;
}

// The theorem, counted rather than believed: enumerate every partition of n and deal each
// one. `stuck` counts the starting positions that never reach the staircase inside the
// budget; for triangular n the measured answer is 0. `worst` is the longest such run,
// which is also the deal-only difficulty ceiling of the n.
export function convergenceCensus(n, { limit = 400 } = {}) {
  const k = triangularRoot(n);
  const target = k ? staircase(k) : null;
  const all = partitionsOf(n);
  let converged = 0, stuck = 0, worst = 0, worstFrom = null, open = 0;
  for (const p of all) {
    const r = target ? stepsToDeal(p, target, { limit }) : { steps: -1, budgetUsed: limit };
    if (r.steps >= 0) {
      converged += 1;
      if (r.steps > worst) { worst = r.steps; worstFrom = p.slice(); }
    } else {
      stuck += 1;
      if (!orbitOf(p, { limit }).closed) open += 1;
    }
  }
  return {
    n, k, states: all.length, converged, stuck, open, worst,
    worstFrom, limit, target, closedForm: k ? k * (k - 1) : null,
  };
}

// The other half of the claim: for non-triangular n nothing converges and every orbit is
// periodic. Reports how the p(n) starting positions split between cycles and stragglers.
export function orbitCensus(n, { limit = 400 } = {}) {
  const all = partitionsOf(n);
  let cyclic = 0, open = 0, withPreperiod = 0, maxPre = 0;
  const cycleLens = new Set();
  let shortest = null;
  for (const p of all) {
    const o = orbitOf(p, { limit });
    if (!o.closed) { open += 1; continue; }
    cyclic += 1;
    cycleLens.add(o.cycleLen);
    if (o.preperiod > 0) withPreperiod += 1;
    if (o.preperiod > maxPre) maxPre = o.preperiod;
    const rep = minPartition(o.cycle);
    const cand = { cycleLen: o.cycleLen, preperiod: o.preperiod, rep, from: p.slice() };
    if (!shortest || cand.cycleLen < shortest.cycleLen
      || (cand.cycleLen === shortest.cycleLen && lexCompare(cand.rep, shortest.rep) < 0)) shortest = cand;
  }
  return {
    n, states: all.length, cyclic, open, withPreperiod, maxPreperiod: maxPre,
    cycleLengths: [...cycleLens].sort((a, b) => a - b),
    shortest, limit,
  };
}
