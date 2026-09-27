// What the shell is allowed to know about the level set: the shipped lots, the bands they
// actually landed in, and the two runtime-generated routes (daily and shared random).
//
// The campaign never invents a number: a baked lot carries the par the build step measured,
// and daily/random lots are produced by the same js/core/make.js the build step used, so a
// date means the same puzzle on every device.

import { LOTS, TIERS_META } from '../data/lots.js';
import { rngFrom } from './rng.js';
import { key } from './partition.js';
import { targetOf } from './deal.js';
import { solve } from './solve.js';
import { TIERS, tierByKey, makeLotTrying } from './make.js';

export { TIERS, TIERS_META, tierByKey };

export const ALL = LOTS;
export const MAX_STATES = 200000;

export function byId(id) {
  return ALL.find((l) => l.id === id) || null;
}

export function levelAt(i) {
  return ALL[Math.min(ALL.length - 1, Math.max(0, i))];
}

export function lotsIn(tierKey) {
  return ALL.filter((l) => l.tier === tierKey);
}

// Re-derive a lot's numbers from its own serialised spec. Used on the campaign lots by
// test/library.test.mjs (anti hand-edit) and on the generated ones by the shell before it
// prints a number: the difference between "the file says 6" and "this device measures 6".
export function reSolve(lot, { maxStates = MAX_STATES } = {}) {
  const spec = JSON.parse(JSON.stringify(lot.spec || lot));
  const info = targetOf(spec.start, { limit: 400 });
  const target = spec.target || info.target;
  const r = solve(spec.start, target, { maxStates });
  return {
    par: r.ok ? r.par : -1,
    steps: info.steps,
    target,
    attractor: info.attractor,
    states: r.states,
    agrees: !!r.ok
      && r.par === lot.par
      && info.steps === lot.steps
      && key(info.target) === key(target),
  };
}

export function dailyLot(day) {
  const rng = rngFrom(`daily-date|${day}`);
  const tier = TIERS[rng.int(TIERS.length)];
  const r = makeLotTrying(`daily|${day}|${tier.key}`, tier.key);
  if (!r.ok) return null;
  return { ...r.lot, id: `daily-${day}`, generated: { seed: r.seed, attempts: r.attempts, tier: tier.key, route: 'daily' } };
}

export function randomLot(seedStr, tierKey) {
  const tier = tierByKey(tierKey);
  const r = makeLotTrying(`random|${seedStr}`, tier.key);
  if (!r.ok) return null;
  return { ...r.lot, id: `random-${tier.key}-${seedStr}`, generated: { seed: r.seed, attempts: r.attempts, tier: tier.key, route: 'random' } };
}

export function stats() {
  const byTier = {};
  for (const t of TIERS) {
    const mine = ALL.filter((l) => l.tier === t.key);
    const pars = mine.map((l) => l.par);
    const steps = mine.map((l) => l.steps);
    byTier[t.key] = {
      n: mine.length,
      min: pars.length ? Math.min(...pars) : 0,
      max: pars.length ? Math.max(...pars) : 0,
      stepsMin: steps.length ? Math.min(...steps) : 0,
      stepsMax: steps.length ? Math.max(...steps) : 0,
      ns: [...new Set(mine.map((l) => l.n))].sort((a, b) => a - b),
      label: t.label,
      blurb: t.blurb,
    };
  }
  return { lots: ALL.length, byTier, tiers: TIERS.map((t) => t.key) };
}
