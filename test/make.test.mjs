// The generator and the deterministic seeds: same seed, same puzzle, on any device.
//
// hashSeed is NOT textbook FNV-1a: it is an FNV-1a-derived two-round UTF-16 mixer, so
// hashSeed('a') = 723832900 while the published FNV-1a vector for "a" is 3826002220. The
// numbers asserted below are this mixer's own, written by hand after measuring them once;
// they exist to catch a refactor that changes the seeds (and therefore every daily puzzle),
// not to claim conformance with anyone else's hash.

import { test, run, eq, ok } from '../tools/harness.mjs';
import { hashSeed, mulberry32, rngFrom, todayKey } from '../js/core/rng.js';
import { TIERS, tierByKey, rateLot, makeLot, makeLotFromN, makeLotTrying } from '../js/core/make.js';
import { partitionsOf, key, isPartitionOf, triangularRoot } from '../js/core/partition.js';
import { targetOf } from '../js/core/deal.js';
import { dailyLot, randomLot } from '../js/core/library.js';

test('hashSeed is a pure function of the string, and lands inside 32 bits', () => {
  eq(hashSeed('a'), 723832900);
  eq(hashSeed('a'), hashSeed('a'), 'same input, same output');
  eq(hashSeed('2026-09-27'), hashSeed('2026-09-27'));
  for (const s of ['', 'a', 'ab', '2026-09-27', 'daily|2026-09-27|shoal', '梯', '\u{1F0CF}']) {
    const h = hashSeed(s);
    ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${s} escaped 32 bits: ${h}`);
  }
  // Not textbook FNV-1a, and that is deliberate — the second round per code unit is what
  // spreads ASCII seeds out.
  ok(hashSeed('a') !== 3826002220, 'if this ever equals the public FNV-1a vector the mixer changed');
});

test('hashSeed separates the seeds the routes actually use', () => {
  const seeds = ['2026-09-26', '2026-09-27', '2026-09-28', 'daily|2026-09-27|shoal', 'daily|2026-09-27|linked'];
  const hs = seeds.map(hashSeed);
  eq(new Set(hs).size, seeds.length, 'two dates must not collide onto one puzzle');
  ok(Math.abs(hs[0] - hs[1]) > 1000, 'neighbouring dates should not sit next to each other');
});

test('mulberry32 is reproducible and stays in range', () => {
  const a = mulberry32(hashSeed('staircase'));
  const b = mulberry32(hashSeed('staircase'));
  const xs = [];
  for (let i = 0; i < 50; i++) xs.push(a());
  const ys = [];
  for (let i = 0; i < 50; i++) ys.push(b());
  eq(xs, ys);
  ok(xs.every((x) => x >= 0 && x < 1));
  const rng = mulberry32(1234);
  for (let i = 0; i < 200; i++) {
    const v = rng.int(7);
    ok(Number.isInteger(v) && v >= 0 && v < 7);
    const r = rng.range(3, 5);
    ok(r >= 3 && r <= 5);
  }
  eq(rng.chance(1), true);
  eq(rng.chance(0), false);
});

test('rngFrom takes a seed string, a number, or an rng that is already built', () => {
  eq(rngFrom('x')(), rngFrom('x')());
  eq(rngFrom(42)(), mulberry32(42)());
  const built = mulberry32(7);
  eq(rngFrom(built), built, 'an rng is passed through, not reseeded');
});

test('todayKey is the YYYY-MM-DD the daily route hashes', () => {
  eq(todayKey(new Date(2026, 8, 27)), '2026-09-27');
  eq(todayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('the bands are the four the spec names, and every card count is legal for them', () => {
  eq(TIERS.map((t) => t.key), ['shoal', 'linked', 'twined', 'master']);
  eq(TIERS.map((t) => t.ns), [[6], [10], [15], [21, 28, 12, 18]]);
  eq(tierByKey('nope'), TIERS[0], 'an unknown band falls back instead of throwing');
  // 6, 10, 15, 21, 28 are triangular; 12 and 18 are the deliberate counterexamples.
  eq([6, 10, 15, 21, 28].map(triangularRoot), [3, 4, 5, 6, 7]);
  eq([12, 18].map(triangularRoot), [0, 0]);
});

test('rateLot rejects what a lot must never be, and says why', () => {
  eq(rateLot(6, [3, 2, 1], 'shoal'), { ok: false, reason: '开局即目标' });
  eq(rateLot(6, [2, 1], 'shoal'), { ok: false, reason: '起始不是 n 的分拆' });
  eq(rateLot(6, [1, 1, 1, 1, 1, 1], 'master').reason, 'par 3 不在带内', 'an easy opening is a band miss, not a bug');
  const r = rateLot(10, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 'linked');
  // One deal gathers ten singles into [10]; the single pile of T_4 then needs T_3 = 6 more
  // deals, so the deal-only count is 7 while the measured par is 4.
  eq([r.ok, r.lot.par, r.lot.steps, r.lot.attractor], [true, 4, 7, 'staircase(4)']);
});

test('a generated lot is always a partition of its own card count', () => {
  for (const tier of TIERS) {
    for (let s = 0; s < 25; s++) {
      const r = makeLot(`audit-${tier.key}-${s}`, tier.key);
      if (!r.ok) { ok(typeof r.reason === 'string' && r.reason.length > 0); continue; }
      const lot = r.lot;
      ok(tier.ns.includes(lot.n), `${lot.id || 'x'} left its band ${tier.key}`);
      ok(isPartitionOf(lot.n, lot.start), `${key(lot.start)} is not a partition of ${lot.n}`);
      ok(isPartitionOf(lot.n, lot.target));
      eq(lot.k, triangularRoot(lot.n));
      ok(lot.par >= 2 && lot.par <= lot.steps, `par ${lot.par} vs steps ${lot.steps}`);
      ok(lot.path.length === lot.par);
      ok(lot.attractor.startsWith(lot.k ? 'staircase(' : 'orbit('));
    }
  }
});

test('the same seed means the same lot, forever', () => {
  const a = makeLotTrying('frozen-seed', 'twined');
  const b = makeLotTrying('frozen-seed', 'twined');
  eq([a.ok, b.ok], [true, true]);
  eq(a.seed, b.seed, 'the chain of derived seeds must be deterministic too');
  eq([a.lot.n, a.lot.start, a.lot.target, a.lot.par, a.lot.steps, a.lot.attractor],
    [b.lot.n, b.lot.start, b.lot.target, b.lot.par, b.lot.steps, b.lot.attractor]);
  const c = makeLotTrying('other-seed', 'twined');
  ok(key(c.lot.start) !== key(a.lot.start) || c.lot.par !== a.lot.par, 'two different seeds should not be the same puzzle');
  // A single seed that happens to be refused is not an error: the band is the filter.
  eq(makeLotFromN('seed-A', 'twined', 15).ok, false);
});

test('makeLotTrying walks a bounded chain of seeds and reports how far it went', () => {
  const r = makeLotTrying('daily|2026-09-27|shoal', 'shoal');
  eq(r.ok, true);
  ok(r.attempts >= 1 && r.attempts <= 40, `attempts ${r.attempts} out of the bound`);
  const dry = makeLotTrying('nothing-works', 'master', 3);
  ok(dry.ok === true || (dry.ok === false && dry.attempts === 3));
});

test('#/daily from one date string is one puzzle on every device', () => {
  const day = '2026-09-27';
  const a = dailyLot(day);
  const b = dailyLot(day);
  ok(a && b, 'the daily route generated something');
  eq([a.id, a.n, a.start, a.target, a.par, a.steps, a.attractor], [b.id, b.n, b.start, b.target, b.par, b.steps, b.attractor]);
  eq(a.id, `daily-${day}`);
  eq(a.generated.route, 'daily');
  const other = dailyLot('2026-09-28');
  ok(key(other.start) !== key(a.start), 'the next date must be a different deal');
  // And the printed number still measures out on this device.
  const info = targetOf(a.start, { limit: 400 });
  eq([info.steps, key(info.target)], [a.steps, key(a.target)]);
});

test('a shared random link stays inside the band it names', () => {
  for (const tier of TIERS) {
    const r = randomLot('shared-token', tier.key);
    ok(r, `${tier.key} generated nothing for a shared seed`);
    eq(r.tier, tier.key);
    ok(tier.ns.includes(r.n));
    eq(randomLot('shared-token', tier.key).start, r.start, 'the same link twice is the same puzzle');
  }
  ok(key(randomLot('shared-token', 'linked').start) !== key(randomLot('shared-token', 'twined').start)
    || randomLot('shared-token', 'linked').n !== randomLot('shared-token', 'twined').n, 'different bands should differ');
});

test('partitionsOf order is the generator contract: index 0 is the single pile', () => {
  eq(partitionsOf(10)[0], [10]);
  eq(partitionsOf(10)[partitionsOf(10).length - 1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  eq(partitionsOf(6).map(key).slice(0, 3), ['6', '5,1', '4,2']);
});

run();
