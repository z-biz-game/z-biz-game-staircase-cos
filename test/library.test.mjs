// What shipped: the file the browser reads must still mean what it says.
//
// For every lot in js/data/lots.js this suite re-derives the printed `par` and `steps` from
// the lot's own serialised spec, so an edit that keeps a number but changes a board fails
// the build. `node tools/bake.mjs` runs the same gate before writing the file; this one
// runs it after.

import { test, run, eq, ok } from '../tools/harness.mjs';
import { ALL, TIERS_META, byId, levelAt, lotsIn, reSolve, stats } from '../js/core/library.js';
import { key, isPartitionOf, triangularRoot, staircase, partitionsOf } from '../js/core/partition.js';
import { targetOf, stepsToDeal } from '../js/core/deal.js';
import { solve, replay, distanceMap } from '../js/core/solve.js';

test('the shipped set is the set the build measured', () => {
  ok(ALL.length >= 24, `only ${ALL.length} lots shipped`);
  eq(new Set(ALL.map((l) => l.id)).size, ALL.length, 'lot ids must be unique');
  eq(ALL.map((l) => l.tier), [...ALL.map((l) => l.tier)].sort((a, b) => TIERS_META.findIndex((t) => t.key === a) - TIERS_META.findIndex((t) => t.key === b)));
});

test('every lot is a legal board whose target holds the same cards', () => {
  for (const lot of ALL) {
    ok(isPartitionOf(lot.n, lot.start), `${lot.id}: ${key(lot.start)} is not a partition of ${lot.n}`);
    ok(isPartitionOf(lot.n, lot.target), `${lot.id}: ${key(lot.target)} is not a partition of ${lot.n}`);
    eq(lot.spec.n, lot.n);
    eq(key(lot.spec.start), key(lot.start), `${lot.id}: the spec and the lot disagree about the board`);
    eq(key(lot.spec.target), key(lot.target));
  }
});

test('the serialised spec re-solves to the printed par — no hand-edited artifact survives', () => {
  const bad = [];
  for (const lot of ALL) {
    const round = JSON.parse(JSON.stringify(lot));
    const again = solve(round.spec.start, round.spec.target, { maxStates: 200000 });
    if (!again.ok || again.par !== round.par) bad.push({ id: lot.id, printed: round.par, measured: again.par });
  }
  eq(bad, [], 'these lots no longer reproduce their own number');
  eq(ALL.length >= 24, true);
});

test('the printed deal-only count re-simulates too', () => {
  const bad = [];
  for (const lot of ALL) {
    const info = targetOf(JSON.parse(JSON.stringify(lot.spec)).start, { limit: 400 });
    if (info.steps !== lot.steps || key(info.target) !== key(lot.target)) {
      bad.push({ id: lot.id, printed: lot.steps, measured: info.steps, target: key(info.target) });
    }
    if (stepsToDeal(lot.start, lot.target, { limit: 400 }).steps !== lot.steps) {
      bad.push({ id: lot.id, field: 'stepsToDeal' });
    }
  }
  eq(bad, []);
});

test('par never exceeds the deal-only count, and usually beats it by a lot', () => {
  const bad = ALL.filter((l) => l.par > l.steps);
  eq(bad, [], 'a lot cheaper to deal than to solve cannot be right');
  ok(ALL.every((l) => l.par >= 2), 'every lot is at least two operations — one is not a puzzle');
  // Measured 2026-09-27: 26 of the 27 shipped lots are strictly cheaper with merges and
  // splits than by dealing alone; master-05 (21 cards, opening 7,2,2,2,2,2,2,2) is the one
  // where dealing is already optimal. The floor below keeps a re-bake from quietly
  // shipping a set where the mixed route stops paying for itself.
  const cheaper = ALL.filter((l) => l.par < l.steps).length;
  ok(cheaper >= Math.ceil(ALL.length * 0.9), `${cheaper}/${ALL.length} lots beat pure dealing`);
  const ratio = ALL.map((l) => l.steps / l.par);
  ok(Math.max(...ratio) >= 5, `the softest lot should be several times cheaper to solve than to deal (${Math.max(...ratio)})`);
});

test('a triangular lot aims at a staircase, a non-triangular one at its own orbit', () => {
  for (const lot of ALL) {
    const k = triangularRoot(lot.n);
    eq(lot.k, k);
    if (k) {
      eq(key(lot.target), key(staircase(k)), `${lot.id}: a T_k lot must aim at staircase(${k})`);
      eq(lot.attractor, `staircase(${k})`);
      eq([lot.preperiod, lot.cycleLen], [0, 1]);
    } else {
      ok(/^orbit\(\d+,\d+\)$/.test(lot.attractor), `${lot.id}: ${lot.attractor} is not an orbit label`);
      const o = targetOf(lot.start, { limit: 400 });
      eq(lot.attractor, o.attractor);
      ok(o.cycleLen >= 2, 'a non-triangular count has no fixed point to land on');
    }
  }
});

test('the shipped path replays onto the target through the same gate a finger uses', () => {
  for (const lot of ALL) {
    const r = replay(lot.start, lot.path);
    ok(r.ok, `${lot.id}: the route broke at operation ${r.at}`);
    eq(key(r.piles), key(lot.target), `${lot.id}: the route ended on ${key(r.piles)}`);
    eq(lot.path.length, lot.par);
  }
});

test('the backwards difficulty map confirms each lot of a triangular count', () => {
  const ns = [...new Set(ALL.filter((l) => l.k).map((l) => l.n))];
  for (const n of ns) {
    const m = distanceMap(n, staircase(triangularRoot(n)));
    for (const lot of ALL.filter((l) => l.n === n)) {
      eq(m.byKey.get(key(lot.start)), lot.par, `${lot.id} disagrees with the map of n=${n}`);
    }
    eq(m.max, triangularRoot(n), 'the hardest opening of T_k is k operations');
  }
});

test('TIERS_META is measured off the shipped lots, not typed next to them', () => {
  for (const meta of TIERS_META) {
    const mine = lotsIn(meta.key);
    eq(meta.min, Math.min(...mine.map((l) => l.par)), `${meta.key}: the printed par floor is a lie`);
    eq(meta.max, Math.max(...mine.map((l) => l.par)), `${meta.key}: the printed par ceiling is a lie`);
    eq(meta.stepsMin, Math.min(...mine.map((l) => l.steps)));
    eq(meta.stepsMax, Math.max(...mine.map((l) => l.steps)));
    eq(meta.ns, [...new Set(mine.map((l) => l.n))].sort((a, b) => a - b), `${meta.key}: the printed card counts are wrong`);
    ok(meta.range.includes(String(meta.min)) && meta.range.includes(String(meta.max)));
  }
});

test('byId, levelAt and stats answer the way the shell expects', () => {
  eq(byId('nope-not-a-lot'), null);
  eq(byId(ALL[3].id), ALL[3]);
  eq(levelAt(0), ALL[0]);
  eq(levelAt(ALL.length - 1), ALL[ALL.length - 1]);
  eq(levelAt(10 ** 6), ALL[ALL.length - 1], 'a huge index clamps to the last lot');
  const s = stats();
  eq(s.lots, ALL.length);
  eq(s.tiers, ['shoal', 'linked', 'twined', 'master']);
  for (const t of s.tiers) {
    ok(s.byTier[t].n > 0, `${t} shipped nothing`);
    ok(s.byTier[t].min <= s.byTier[t].max);
  }
});

test('reSolve reports agreement for a real lot and disagreement for a doctored one', () => {
  const lot = ALL[0];
  eq(reSolve(lot).agrees, true);
  eq(reSolve({ ...lot, par: lot.par + 3 }).agrees, false, 'a doctored par must be caught');
  eq(reSolve({ ...lot, start: [lot.n] }).par, solve([lot.n], lot.target).par, 'a different board is a different number');
});

test('the master band really carries the two counterexample counts', () => {
  const master = lotsIn('master');
  const nonTri = master.filter((l) => !l.k);
  ok(nonTri.length >= 2, `only ${nonTri.length} non-triangular lots shipped`);
  for (const lot of nonTri) {
    ok([12, 18].includes(lot.n), `${lot.id} is a ${lot.n}-card lot`);
    ok(partitionsOf(lot.n).some((p) => key(p) === key(lot.start)), 'its opening is inside the enumeration');
  }
});

run();
