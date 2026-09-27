// Shortest path over the positions a player can actually reach, which is the only honest
// source for the number printed on screen as `par`.
//
// The graph is directed and small: from a partition of n you may
//   deal               — the rule of the game, one successor,
//   merge two piles    — any pair, one successor each,
//   split one pile     — at any of its internal boundaries.
// So the state space is exactly the p(n) partitions of n (n <= 28 -> at most 3718 nodes)
// and a breadth-first search over it is a *measurement* rather than an opinion: it
// simultaneously proves that no shorter route exists, because the frontier is exhausted.
//
// `parProof` runs the same distance three ways (layered BFS, forward BFS over an explicit
// edge list, reverse BFS over that list flipped) and refuses to certify unless all three
// agree and the edge list is closed under every action. Pure: nothing here mutates its
// arguments.

import { sortDesc, key, partitionsOf } from './partition.js';
import { deal, targetOf } from './deal.js';

export const ACTION_KINDS = ['deal', 'merge', 'split'];
export const DEFAULT_MAX_STATES = 200000;

// The single legality gate: a click, a baked path step and the search all agree because all
// three call this. Returns the resulting canonical position, or null when illegal.
export function applyAction(piles, action) {
  if (!action || typeof action !== 'object') return null;
  if (action.kind === 'deal') return deal(piles);
  if (action.kind === 'merge') {
    const a = action.a | 0;
    const b = action.b | 0;
    if (a === b) return null;
    if (a < 0 || b < 0 || a >= piles.length || b >= piles.length) return null;
    const out = [];
    for (let i = 0; i < piles.length; i++) {
      if (i === a || i === b) continue;
      out.push(piles[i]);
    }
    out.push(piles[a] + piles[b]);
    return sortDesc(out);
  }
  if (action.kind === 'split') {
    const i = action.i | 0;
    const j = action.j | 0;
    if (i < 0 || i >= piles.length) return null;
    // j is the size of the pile the top part becomes: an empty part on either side is not
    // a split, and neither is splitting a pile of one.
    if (j < 1 || j > piles[i] - 1) return null;
    const out = [];
    for (let x = 0; x < piles.length; x++) if (x !== i) out.push(piles[x]);
    out.push(j, piles[i] - j);
    return sortDesc(out);
  }
  return null;
}

// Why an action was refused, for the panel. Keeps the wording out of the view.
export function illegalReason(piles, action) {
  if (!action || !ACTION_KINDS.includes(action.kind)) return '未知操作';
  if (applyAction(piles, action)) return null;
  if (action.kind === 'merge') {
    if (action.a === action.b) return '不能把一堆并到自己身上';
    return '两堆都必须还在牌桌上';
  }
  if (action.kind === 'split') {
    if (action.i < 0 || action.i >= piles.length) return '那一堆不存在';
    if (piles[action.i] < 2) return '一堆只有一张牌，拆不开';
    return '拆点必须落在堆的内部';
  }
  return '这个操作不合法';
}

export function neighbors(piles) {
  const out = [];
  const seen = new Set();
  const push = (action) => {
    const next = applyAction(piles, action);
    if (!next) return;
    const k = key(next);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ piles: next, action });
  };
  push({ kind: 'deal' });
  for (let a = 0; a < piles.length; a++) {
    for (let b = a + 1; b < piles.length; b++) push({ kind: 'merge', a, b });
  }
  for (let i = 0; i < piles.length; i++) {
    // split at j and at size-j land on the same position; only one of them is generated.
    const top = Math.floor(piles[i] / 2);
    for (let j = 1; j <= top; j++) push({ kind: 'split', i, j });
  }
  return out;
}

// Layered BFS: the printed `par`. Also reports how many positions were visited, which is
// what "the search is bounded" means in practice.
export function solve(start, target, { maxStates = DEFAULT_MAX_STATES } = {}) {
  const s = sortDesc(start);
  const t = sortDesc(target);
  const tk = key(t);
  const sk = key(s);
  if (sk === tk) return { ok: true, par: 0, path: [], states: 1, capped: false, target: t };
  const prev = new Map([[sk, null]]);
  let frontier = [s];
  for (let depth = 1; frontier.length; depth++) {
    const next = [];
    for (const cur of frontier) {
      const ck = key(cur);
      for (const { piles: nb, action } of neighbors(cur)) {
        const k = key(nb);
        if (prev.has(k)) continue;
        prev.set(k, { ck, action });
        if (k === tk) {
          const path = [];
          let at = k;
          while (prev.get(at)) {
            path.unshift(prev.get(at).action);
            at = prev.get(at).ck;
          }
          return { ok: true, par: depth, path, states: prev.size, capped: false, target: t };
        }
        next.push(nb);
      }
      if (prev.size > maxStates) return { ok: false, par: -1, path: [], states: prev.size, capped: true };
    }
    frontier = next;
  }
  return { ok: false, par: -1, path: [], states: prev.size, capped: false, unreachable: true };
}

// The whole forward-reachable component, with its edge list. Everything `parProof` checks
// afterwards is computed from this, so the three distance routes share a graph but not an
// algorithm.
export function buildGraph(start, { maxStates = DEFAULT_MAX_STATES } = {}) {
  const s = sortDesc(start);
  const states = new Map([[key(s), s]]);
  const edges = new Map();
  const queue = [s];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const ck = key(cur);
    const list = [];
    for (const { piles: nb, action } of neighbors(cur)) {
      const k = key(nb);
      list.push({ to: k, action });
      if (!states.has(k)) {
        if (states.size > maxStates) return { states, edges, capped: true };
        states.set(k, nb);
        queue.push(nb);
      }
    }
    edges.set(ck, list);
  }
  return { states, edges, capped: false };
}

// One number, three ways, plus the closure check that makes "no shorter route" a proof
// rather than a search that gave up.
export function parProof(start, target, { maxStates = DEFAULT_MAX_STATES } = {}) {
  const layered = solve(start, target, { maxStates });
  const g = buildGraph(start, { maxStates });
  if (g.capped || !layered.ok) return { ok: false, layered, states: g.states.size, capped: true };
  const tk = key(target);
  if (!g.states.has(tk)) return { ok: false, reason: 'target outside the reachable component', layered, g };

  // forward BFS over the explicit edge list
  const fwd = bfsFrom(g.edges, key(start));
  // reverse BFS over the same list flipped
  const rev = bfsFrom(reverse(g.edges), tk);

  let closed = true;
  for (const [k, list] of g.edges) {
    for (const nb of neighbors(g.states.get(k))) {
      if (!g.states.has(key(nb.piles))) closed = false;
    }
    if (!list.length) closed = false;
  }
  const agree = fwd.get(tk) === layered.par && rev.get(key(start)) === layered.par;
  return {
    ok: agree && closed, layered, states: g.states.size, edges: countEdges(g.edges),
    forward: fwd.get(tk) === undefined ? null : fwd.get(tk),
    reverse: rev.get(key(start)) === undefined ? null : rev.get(key(start)),
    closed, agree,
  };
}

function countEdges(edges) {
  let n = 0;
  for (const list of edges.values()) n += list.length;
  return n;
}

function reverse(edges) {
  const out = new Map();
  for (const [from, list] of edges) {
    for (const e of list) {
      if (!out.has(e.to)) out.set(e.to, []);
      out.get(e.to).push({ to: from, action: e.action });
    }
  }
  return out;
}

function bfsFrom(edges, fromKey) {
  const dist = new Map([[fromKey, 0]]);
  const queue = [fromKey];
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    for (const e of edges.get(k) || []) {
      if (dist.has(e.to)) continue;
      dist.set(e.to, dist.get(k) + 1);
      queue.push(e.to);
    }
  }
  return dist;
}

// The whole difficulty map of a card count: enumerate every partition of n, wire up every
// legal action between them, then run one breadth-first search backwards from the target.
// That gives the par of *every* starting position at once, which is what lets a build say
// "the hardest 15-card opening needs k operations" instead of eyeballing it. It is also a
// completeness check on the enumeration: an action landing outside it is a bug, and so is
// a target that is not a partition of n.
export function distanceMap(n, target) {
  const all = partitionsOf(n);
  const index = new Map();
  all.forEach((p, i) => index.set(key(p), i));
  const ti = index.get(key(target));
  if (ti === undefined) throw new Error(`distanceMap: target ${key(target)} is not a partition of ${n}`);
  const back = all.map(() => []);
  let edges = 0;
  for (let i = 0; i < all.length; i++) {
    for (const { piles } of neighbors(all[i])) {
      const j = index.get(key(piles));
      if (j === undefined) throw new Error(`distanceMap: an action left the enumeration of p(${n}) (${key(piles)})`);
      back[j].push(i);
      edges += 1;
    }
  }
  const dist = new Array(all.length).fill(-1);
  dist[ti] = 0;
  const queue = [ti];
  for (let head = 0; head < queue.length; head++) {
    for (const j of back[queue[head]]) {
      if (dist[j] !== -1) continue;
      dist[j] = dist[queue[head]] + 1;
      queue.push(j);
    }
  }
  let max = -1, maxFrom = null, unreachable = 0;
  const hist = new Map();
  all.forEach((p, i) => {
    if (dist[i] < 0) { unreachable += 1; return; }
    hist.set(dist[i], (hist.get(dist[i]) || 0) + 1);
    if (dist[i] > max) { max = dist[i]; maxFrom = p.slice(); }
  });
  return {
    n, target, states: all.length, edges, dist,
    byKey: new Map(all.map((p, i) => [key(p), dist[i]])),
    max, maxFrom, unreachable, histogram: [...hist.entries()].sort((a, b) => a[0] - b[0]),
  };
}

// The same map for a lot whose target is derived from its start (a non-triangular n has no
// staircase), used by tests that want the hardest opening of a card count.
export function hardestOpening(n, { limit = 400 } = {}) {
  const all = partitionsOf(n);
  let best = null;
  for (const start of all) {
    const info = targetOf(start, { limit });
    if (!info.target) continue;
    const r = solve(start, info.target, { maxStates: 200000 });
    if (!r.ok) continue;
    if (!best || r.par > best.par) best = { n, start: start.slice(), target: info.target, par: r.par, steps: info.steps };
  }
  return best;
}

// Replay a stored path from a start position. Used by bake (the path must actually work)
// and by the browser (the certified route has to be playable through the same gate a
// finger uses).
export function replay(start, path) {
  let cur = sortDesc(start);
  const states = [cur];
  for (const action of path || []) {
    const next = applyAction(cur, action);
    if (!next) return { ok: false, at: states.length - 1, states, piles: cur };
    cur = next;
    states.push(cur);
  }
  return { ok: true, states, piles: cur, end: cur };
}
