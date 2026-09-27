// The play reducer: what a click does, what a refusal costs, and what "finished" means.
// js/core is what the browser runs here, so every row below is a claim about the game the
// player actually plays.

import { test, run, eq, ok, throws } from '../tools/harness.mjs';
import { createGame, act, select, undo, reset, hint, grade, snapshot } from '../js/core/game.js';
import { key } from '../js/core/partition.js';
import { replay } from '../js/core/solve.js';
import { ALL } from '../js/core/library.js';

const LOT6 = { id: 'fixture-6', tier: 'shoal', n: 6, k: 3, start: [4, 1, 1], target: [3, 2, 1], par: 2, steps: 5, attractor: 'staircase(3)' };

test('createGame copies the lot into a board and refuses a malformed one', () => {
  const g = createGame(LOT6);
  eq([g.piles, g.target, g.moves, g.deals, g.done, g.n, g.par], [[4, 1, 1], [3, 2, 1], 0, 0, false, 6, 2]);
  throws(() => createGame({ start: [1] }), 'a lot without a target is not playable');
  throws(() => createGame(null));
});

test('a deal is one operation, counted once, and it moves the cards', () => {
  // [4,1,1] is three piles, so the new pile is a 3 and the singles vanish: [3,3].
  const g = createGame(LOT6);
  const r = act(g, { kind: 'deal' });
  eq([r.ok, g.piles, g.moves, g.deals, g.done], [true, [3, 3], 1, 1, false]);
  // One card off each of the two piles plus a new pile of size 2.
  eq(act(g, { kind: 'deal' }).ok, true);
  eq([g.piles, g.deals], [[2, 2, 2], 2]);
});

test('reaching the target ends the lot', () => {
  const g = createGame(LOT6);
  act(g, { kind: 'deal' });
  act(g, { kind: 'split', i: 0, j: 2 });
  eq([g.done, key(g.piles), g.moves], [true, '3,2,1', 2], 'the par-2 route is deal then split a 3');
  const r = act(g, { kind: 'merge', a: 0, b: 1 });
  eq([r.ok, r.reason, g.moves], [false, '这一关已经结束', 2], 'a finished board takes no more input');
});

test('an illegal action changes nothing at all, not even the counter', () => {
  const g = createGame({ ...LOT6, start: [3, 3], par: 2 });
  const before = snapshot(g);
  for (const bad of [
    { kind: 'merge', a: 0, b: 0 },
    { kind: 'merge', a: 0, b: 7 },
    { kind: 'split', i: 0, j: 0 },
    { kind: 'split', i: 0, j: 3 },
    { kind: 'split', i: 9, j: 1 },
    { kind: 'shuffle' },
    null,
  ]) {
    const r = act(g, bad);
    eq([r.ok, r.reason !== undefined], [false, true], `${JSON.stringify(bad)} should be refused with a reason`);
  }
  eq(snapshot(g), before, 'and the board is exactly as it was');
});

test('splitting a single-card pile is refused with the reason a player needs', () => {
  const g = createGame({ ...LOT6, start: [2, 2, 1, 1] });
  const r = act(g, { kind: 'split', i: 2, j: 1 });
  eq([r.ok, r.reason], [false, '一堆只有一张牌，拆不开']);
  eq(g.moves, 0);
});

test('undo rewinds one operation and reopens a finished lot', () => {
  const g = createGame(LOT6);
  act(g, { kind: 'deal' });
  act(g, { kind: 'split', i: 0, j: 2 });
  ok(g.done);
  eq(undo(g), true);
  eq([g.piles, g.moves, g.deals, g.done], [[3, 3], 1, 1, false]);
  eq(undo(g), true);
  eq([g.piles, g.moves, g.deals], [[4, 1, 1], 0, 0]);
  eq(undo(g), false, 'there is nothing before the start');
});

test('reset puts the lot back exactly as it shipped', () => {
  const g = createGame(LOT6);
  act(g, { kind: 'deal' });
  act(g, { kind: 'merge', a: 0, b: 1 });
  reset(g);
  eq([g.piles, g.moves, g.deals, g.done, g.history.length, g.selected], [[4, 1, 1], 0, 0, false, 0, null]);
});

test('select is a toggle over the piles that are actually there', () => {
  const g = createGame(LOT6);
  eq(select(g, 1), 1);
  eq(select(g, 1), null, 'clicking the same pile twice clears the pick');
  eq(select(g, 0), 0);
  eq(select(g, 99), null, 'a pile that is not on the table deselects');
});

test('a game never writes on the lot it was built from', () => {
  const frozen = JSON.stringify(LOT6);
  const g = createGame(LOT6);
  g.piles.push(99);
  g.piles[0] = 1;
  act(g, { kind: 'deal' });
  reset(g);
  eq(JSON.stringify(LOT6), frozen);
});

test('grade: matching the measured par is three stars, and the arithmetic is the verdict', () => {
  const g = createGame(LOT6);
  eq(grade(g), { stars: 0, label: '未完成' });
  act(g, { kind: 'deal' });
  act(g, { kind: 'split', i: 0, j: 2 });
  eq([g.moves, g.par, g.done], [2, 2, true]);
  eq(grade(g), { stars: 3, label: '命中最少' });

  // Four operations on a par-2 lot: split the 4 in half, merge the halves back, merge the
  // singles up, then deal — a round trip that costs exactly two extra operations.
  const h = createGame(LOT6);
  for (const a of [
    { kind: 'split', i: 0, j: 2 },
    { kind: 'merge', a: 0, b: 1 },
    { kind: 'merge', a: 1, b: 2 },
    { kind: 'deal' },
  ]) {
    eq(act(h, a).ok, true, `the route broke on ${JSON.stringify(a)}`);
  }
  eq([h.piles, h.moves], [[3, 2, 1], 4]);
  eq(grade(h), { stars: 2, label: '略多一手' });

  // Dealing alone, five times: the theorem says it converges, the band says it is a detour.
  const l = createGame(LOT6);
  for (let i = 0; i < 5; i++) eq(act(l, { kind: 'deal' }).ok, true);
  eq([l.done, l.moves], [true, 5]);
  eq(grade(l), { stars: 1, label: '抵达了，但绕了路' });
});

test('hint is a bounded search that names a legal next operation', () => {
  const g = createGame(LOT6);
  const h = hint(g);
  ok(h && h.action, 'the hint found something to say');
  eq([h.left, h.capped], [2, false], 'a 6-card graph is 11 positions; no cap was needed');
  const applied = act(g, h.action);
  eq([applied.ok, g.moves], [true, 1], 'the hint is playable by construction');
  eq(hint(createGame({ ...LOT6, start: [3, 2, 1] })), null, 'a solved board has no hint to give');
  const starved = hint(createGame(LOT6), { maxStates: 1 });
  eq(starved, null, 'a capped search says nothing rather than inventing a move');
});

test('every shipped lot is winnable through act(), by playing its certified route', () => {
  for (const lot of ALL) {
    const g = createGame(lot);
    const want = replay(lot.start, lot.path);
    eq(want.ok, true, `${lot.id}: the shipped route is not legal any more`);
    for (const action of lot.path) {
      const r = act(g, action);
      ok(r.ok, `${lot.id}: act refused ${JSON.stringify(action)} — ${r.reason}`);
    }
    eq([g.done, g.moves, g.par], [true, lot.par, lot.par], `${lot.id}: the route did not land on the target`);
    eq(key(g.piles), key(lot.target), `${lot.id}: finished on the wrong shape`);
    eq(grade(g).stars, 3);
  }
});

run();
