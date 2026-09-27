// The generator. A lot is one card count n plus one starting partition of n, and the
// starting partition is picked by index into the canonical enumeration from
// js/core/partition.js — so "same seed, same puzzle" is a property of the enumeration
// order, not of a shuffle that happens to land the same way.
//
// Every number a lot carries is computed here and re-computed from the serialised spec by
// tools/bake.mjs before it ships; nothing is estimated at runtime.

import { rngFrom } from './rng.js';
import { partitionsOf, triangularRoot, key, isPartitionOf } from './partition.js';
import { targetOf } from './deal.js';
import { solve, replay } from './solve.js';

export const TIERS = [
  {
    key: 'shoal', label: '浅滩', blurb: '6 张 · 三角数 T3', ns: [6],
    // Bands are measured, not wished for: js/core/solve.js#distanceMap says the par of
    // every one of the p(n) openings, and these windows are the upper part of that
    // histogram. tools/bake.mjs prints the whole table on every run.
    parMin: 2, parMax: 3, quota: 5,
  },
  { key: 'linked', label: '连锁', blurb: '10 张 · 三角数 T4', ns: [10], parMin: 3, parMax: 4, quota: 7 },
  { key: 'twined', label: '缠绕', blurb: '15 张 · 三角数 T5', ns: [15], parMin: 4, parMax: 5, quota: 8 },
  {
    key: 'master', label: '大师', blurb: '21 / 28 张三角，12 / 18 张非三角', ns: [21, 28, 12, 18],
    parMin: 5, parMax: 7, quota: 8,
  },
];

export function tierByKey(k) {
  return TIERS.find((t) => t.key === k) || TIERS[0];
}

// Measure a candidate. Returns { ok, lot } or { ok:false, reason } — the reasons are what
// tools/bake.mjs counts so the acceptance rate in DESIGN.md is a number from a run and not
// a guess.
export function rateLot(n, start, tierKey = 'shoal', { maxStates = 200000 } = {}) {
  const tier = tierByKey(tierKey);
  if (!isPartitionOf(n, start)) return { ok: false, reason: '起始不是 n 的分拆' };
  const info = targetOf(start, { limit: 400 });
  if (!info.target) return { ok: false, reason: info.closed === false ? '轨道未闭合' : '无目标' };
  if (key(info.target) === key(start)) return { ok: false, reason: '开局即目标' };
  const r = solve(start, info.target, { maxStates });
  if (!r.ok) return { ok: false, reason: r.capped ? '搜索超限' : '目标不可达' };
  if (r.par < 2) return { ok: false, reason: '一步内的题' };
  if (r.par < tier.parMin || r.par > tier.parMax) return { ok: false, reason: `par ${r.par} 不在带内` };
  const back = replay(start, r.path);
  if (!back.ok || key(back.piles) !== key(info.target)) return { ok: false, reason: '路径回放不上' };
  if (info.steps >= 0 && r.par > info.steps) return { ok: false, reason: 'par 超过只发牌步数' };
  return {
    ok: true,
    lot: {
      tier: tier.key,
      n,
      k: triangularRoot(n),
      start: start.slice(),
      target: info.target.slice(),
      par: r.par,
      steps: info.steps,
      deals: info.steps,
      preperiod: info.preperiod,
      cycleLen: info.cycleLen,
      attractor: info.attractor,
      kind: info.kind,
      path: r.path,
      states: r.states,
      spec: { n, start: start.slice(), target: info.target.slice() },
    },
  };
}

// Pick the opening by index into the canonical enumeration, so the enumeration order is the
// only thing that decides which puzzle a seed means.
export function makeLotFromN(seed, tierKey, n) {
  const tier = tierByKey(tierKey);
  const rng = rngFrom(seed);
  const all = partitionsOf(n);
  const start = all[rng.int(all.length)];
  return rateLot(n, start, tier.key);
}

export function makeLot(seed, tierKey = 'shoal') {
  const tier = tierByKey(tierKey);
  const rng = rngFrom(seed);
  return makeLotFromN(`${seed}|n`, tier.key, rng.pick(tier.ns));
}

// One seed can be refused (a trivial opening, or a par the band dislikes), so the daily and
// the shared-random routes walk a bounded chain of derived seeds. Bounded, and the bound is
// reported: `attempts` ends up in the lot's provenance line.
export function makeLotTrying(seed, tierKey = 'shoal', attempts = 40) {
  for (let a = 0; a < attempts; a++) {
    const r = makeLot(`${seed}|${a}`, tierKey);
    if (r.ok) return { ...r, attempts: a + 1, seed: `${seed}|${a}` };
  }
  return { ok: false, reason: `${attempts} 次尝试均未通过`, attempts };
}
