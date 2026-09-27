// Play state: the piles on the table, how many operations they have cost, and whether the
// target has been reached. Everything that decides legality lives here or in solve.js —
// js/view.js only ever reports "the player wanted this action".

import { sortDesc, key } from './partition.js';
import { applyAction, illegalReason, solve } from './solve.js';

// `lot` is read, never written: a game must not be able to damage the shipped data.
export function createGame(lot) {
  if (!lot || !Array.isArray(lot.start) || !Array.isArray(lot.target)) {
    throw new Error('createGame: a lot needs a start and a target');
  }
  return {
    lot,
    n: lot.n,
    par: lot.par,
    piles: sortDesc(lot.start),
    target: sortDesc(lot.target),
    targetKey: key(lot.target),
    moves: 0,
    deals: 0,
    done: false,
    selected: null,
    history: [],
  };
}

export function snapshot(game) {
  return {
    n: game.n,
    piles: game.piles.slice(),
    target: game.target.slice(),
    moves: game.moves,
    deals: game.deals,
    done: game.done,
    par: game.lot.par,
  };
}

// The one place a move happens. Illegal actions return false and change nothing, so the
// move counter can never drift from the board.
export function act(game, action) {
  if (game.done) return { ok: false, reason: '这一关已经结束' };
  const reason = illegalReason(game.piles, action);
  if (reason) return { ok: false, reason };
  const next = applyAction(game.piles, action);
  game.history.push({ piles: game.piles.slice(), moves: game.moves, deals: game.deals });
  game.piles = next;
  game.moves += 1;
  if (action.kind === 'deal') game.deals += 1;
  game.selected = null;
  if (key(next) === game.targetKey) game.done = true;
  return { ok: true, piles: next };
}

export function select(game, i) {
  if (i < 0 || i >= game.piles.length) {
    game.selected = null;
    return null;
  }
  game.selected = game.selected === i ? null : i;
  return game.selected;
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  game.piles = last.piles;
  game.moves = last.moves;
  game.deals = last.deals;
  game.done = false;
  game.selected = null;
  return true;
}

export function reset(game) {
  game.piles = sortDesc(game.lot.start);
  game.target = sortDesc(game.lot.target);
  game.targetKey = key(game.lot.target);
  game.moves = 0;
  game.deals = 0;
  game.done = false;
  game.selected = null;
  game.history = [];
  return game;
}

// Bounded live search, and the only one this game runs from an input handler: the graph has
// at most p(28) = 3718 positions, `maxStates` caps it anyway, and a capped search says so
// instead of inventing a hint.
export function hint(game, { maxStates = 20000 } = {}) {
  if (game.done) return null;
  const r = solve(game.piles, game.target, { maxStates });
  if (!r.ok || !r.path.length) return null;
  return { action: r.path[0], left: r.par, states: r.states, capped: r.capped };
}

// `par` is measured, so the verdict is arithmetic and not a mood: matching it means the
// search found nothing better either.
export function grade(game, par = game.lot.par) {
  if (!game.done) return { stars: 0, label: '未完成' };
  if (game.moves <= par) return { stars: 3, label: '命中最少' };
  if (game.moves <= par + 2) return { stars: 2, label: '略多一手' };
  return { stars: 1, label: '抵达了，但绕了路' };
}
