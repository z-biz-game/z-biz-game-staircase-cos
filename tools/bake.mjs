// The content pipeline: where every shipped level comes from. The browser never generates
// the campaign, it only reads what this file wrote.
//
//   node tools/bake.mjs                     # -> js/data/lots.js
//   PER_TIER=12 node tools/bake.mjs         # more lots per band
//
// A lot enters the file only if re-solving its *serialised* spec reproduces the par and the
// deal-step count printed beside it, so a hand-edited artifact cannot survive a build. The
// same run prints the statistics DESIGN.md quotes (tries, rejection reasons, timings).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIERS, makeLotFromN } from '../js/core/make.js';
import { partitionsOf, key, pentagonalCount, staircase, triangularRoot } from '../js/core/partition.js';
import { targetOf, convergenceCensus } from '../js/core/deal.js';
import { solve, replay, parProof, distanceMap } from '../js/core/solve.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const t0 = Date.now();

const reasons = new Map();
const bump = (r) => reasons.set(r, (reasons.get(r) || 0) + 1);
let totalTries = 0;
let maxStatesSeen = 0;
let slowestSolve = 0;
let proofLines = [];

const out = [];
for (const tier of TIERS) {
  const wanted = Number(process.env.PER_TIER || tier.quota);
  const perN = Math.max(1, Math.ceil(wanted / tier.ns.length));
  const picked = [];
  const start = Date.now();
  for (const n of tier.ns) {
    const seen = new Set();
    let got = 0;
    for (let s = 0; got < perN && picked.length < wanted && s < perN * 80; s++) {
      totalTries += 1;
      const r = makeLotFromN(`bake-${tier.key}-${n}-${s}`, tier.key, n);
      if (!r.ok) { bump(r.reason); continue; }
      const sig = key(r.lot.start);
      if (seen.has(sig)) { bump('重复局面'); continue; }
      seen.add(sig);
      maxStatesSeen = Math.max(maxStatesSeen, r.lot.states);
      picked.push(r.lot);
      got += 1;
    }
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  if (picked.length < wanted) console.error(`note: ${tier.key} reached ${picked.length}/${wanted} (only so many openings clear the band)`);
  picked.sort((a, b) => a.par - b.par || a.n - b.n || key(a.start).localeCompare(key(b.start)));
  picked.forEach((p, i) => { p.id = `${tier.key}-${String(i + 1).padStart(2, '0')}`; });
  console.log(`${tier.key}: ${picked.length} lots in ${secs}s (par ${picked.length ? Math.min(...picked.map((p) => p.par)) : '-'}-${picked.length ? Math.max(...picked.map((p) => p.par)) : '-'} · 只发牌 ${picked.length ? Math.min(...picked.map((p) => p.steps)) : '-'}-${picked.length ? Math.max(...picked.map((p) => p.steps)) : '-'})`);
  out.push(...picked);
}

// --- the gate: re-solve the serialised object, exactly as it will ship ------------------
const shipped = out.map((lot) => ({
  id: lot.id,
  tier: lot.tier,
  n: lot.n,
  k: lot.k,
  start: lot.start,
  target: lot.target,
  par: lot.par,
  steps: lot.steps,
  deals: lot.deals,
  preperiod: lot.preperiod,
  cycleLen: lot.cycleLen,
  attractor: lot.attractor,
  kind: lot.kind,
  states: lot.states,
  path: lot.path,
  spec: lot.spec,
}));

for (const entry of shipped) {
  const round = JSON.parse(JSON.stringify(entry));
  const info = targetOf(round.spec.start, { limit: 400 });
  const again = solve(round.spec.start, round.spec.target, { maxStates: 200000 });
  const back = replay(round.spec.start, round.path);
  if (!again.ok) throw new Error(`${entry.id}: target unreachable from its own spec`);
  if (again.par !== round.par) {
    throw new Error(`${entry.id}: printed par ${round.par} but re-solving the spec gives ${again.par}`);
  }
  if (info.steps !== round.steps || key(info.target) !== key(round.spec.target)) {
    throw new Error(`${entry.id}: printed deal-steps ${round.steps} / target ${key(info.target)} disagrees with the spec`);
  }
  if (!back.ok || key(back.piles) !== key(round.spec.target)) {
    throw new Error(`${entry.id}: shipped path does not replay onto the printed target`);
  }
  if (entry.par > round.steps) throw new Error(`${entry.id}: par ${entry.par} exceeds the deal-only count ${round.steps}`);
}

// --- the proof table the README prints, recomputed on this very run --------------------
for (const n of [3, 6, 10, 15, 21, 28]) {
  const k = pentagonalCount(n);
  const e = partitionsOf(n).length;
  if (k !== e) throw new Error(`p(${n}) enumerated ${e} but the pentagonal recurrence says ${k}`);
}
// Convergence, counted: every partition of a triangular n reaches its staircase, and the
// deal-only ceiling is k(k-1). Both halves printed, neither believed.
for (const n of [3, 6, 10, 15, 21, 28]) {
  const c = convergenceCensus(n, { limit: 400 });
  if (c.stuck) throw new Error(`n=${n}: ${c.stuck} openings never reached staircase(${c.k})`);
  if (c.worst !== c.k * (c.k - 1)) {
    throw new Error(`n=${n}: worst deal-only run ${c.worst} breaks the measured ceiling k(k-1)=${c.k * (c.k - 1)}`);
  }
  proofLines.push(`converge n=${n} k=${c.k}: ${c.states}/${c.states} openings reach the staircase, worst ${c.worst} = k(k-1) from ${key(c.worstFrom)}`);
}
// The par map: one backwards BFS over the whole action graph of n gives the par of every
// opening at once. For a triangular n the printed claim is "the hardest opening needs
// exactly k operations" — checked here, and again in test/solve.test.mjs.
for (const tier of TIERS) {
  for (const n of tier.ns) {
    const k = triangularRoot(n);
    if (!k) continue;
    const m = distanceMap(n, staircase(k));
    if (m.max !== k) throw new Error(`n=${n}: hardest opening has par ${m.max}, not k=${k}`);
    if (m.unreachable) throw new Error(`n=${n}: ${m.unreachable} openings cannot reach the staircase at all`);
    proofLines.push(`par-map n=${n}: ${m.states} positions / ${m.edges} actions · max par ${m.max} from ${key(m.maxFrom)} · hist ${JSON.stringify(m.histogram)}`);
  }
}
for (const tier of TIERS) {
  for (const n of tier.ns) {
    // A fixed, lot-independent witness for the band: the single-pile opening of n cards.
    const start = [n];
    const info = targetOf(start, { limit: 400 });
    const t0n = Date.now();
    const rr = parProof(start, info.target, { maxStates: 200000 });
    if (!rr.ok) throw new Error(`par proof refused for n=${n}: ${JSON.stringify({ closed: rr.closed, agree: rr.agree, capped: rr.capped })}`);
    slowestSolve = Math.max(slowestSolve, Date.now() - t0n);
    proofLines.push(`${tier.key} n=${n}: par ${rr.layered.par} = forward ${rr.forward} = reverse ${rr.reverse} over ${rr.states} positions / ${rr.edges} edges (closed ${rr.closed ? 'yes' : 'no'}) · 只发牌 ${info.steps} 步`);
  }
}

const meta = TIERS.map((t) => {
  const mine = shipped.filter((l) => l.tier === t.key);
  const pars = mine.map((l) => l.par);
  const steps = mine.map((l) => l.steps);
  const lo = Math.min(...pars);
  const hi = Math.max(...pars);
  return {
    key: t.key, label: t.label, blurb: t.blurb, min: lo, max: hi,
    stepsMin: Math.min(...steps), stepsMax: Math.max(...steps),
    ns: [...new Set(mine.map((l) => l.n))].sort((a, b) => a - b),
    range: lo === hi ? `${lo} 步` : `${lo}-${hi} 步`,
  };
});

const lines = [
  '// Generated by tools/bake.mjs — the levels in this game are measurements, not opinions.',
  '// `par` is the BFS-shortest deal/merge/split count over the partition graph of `spec.n`;',
  '// `steps` is the deal-only count from `spec.start` to `spec.target` (the theorem, this',
  '// lot). `node tools/bake.mjs` recomputes both from the serialised spec on the same line',
  '// and refuses to write the file when a number disagrees; `node test/library.test.mjs`',
  '// repeats that check against what actually shipped.',
  `export const BAKED_AT = ${JSON.stringify(new Date().toISOString())};`,
  `export const TIERS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...shipped.map((l) => `  ${JSON.stringify(l)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

const byTier = {};
for (const l of shipped) byTier[l.tier] = (byTier[l.tier] || 0) + 1;
console.log('');
console.log(`wrote ${shipped.length} lots (${Object.entries(byTier).map(([k, n]) => `${k}:${n}`).join(' ')}) -> js/data/lots.js`);
console.log(`tries ${totalTries} accepted ${shipped.length} rate ${(100 * shipped.length / totalTries).toFixed(1)}%`);
console.log(`rejections: ${[...reasons.entries()].map(([r, n]) => `${r}=${n}`).join(' ') || 'none'}`);
console.log(`max BFS states ${maxStatesSeen} · slowest par-proof ${slowestSolve}ms · total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const l of proofLines) console.log(`proof ${l}`);
