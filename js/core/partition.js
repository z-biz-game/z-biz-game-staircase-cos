// The board of Bulgarian solitaire is an integer partition: the sizes of the piles, and
// nothing else. Two deals that differ only in the left-to-right order of the piles are the
// same position, so every state here is normalised to descending order before it is
// compared, keyed, or stored.
//
// Pure: no window, no DOM, no mutation of arguments. `node --test` imports this file
// directly, and so does the browser.

export function sum(piles) {
  let t = 0;
  for (const p of piles) t += p;
  return t;
}

export function sortDesc(piles) {
  return piles.slice().sort((a, b) => b - a);
}

// Canonical identity of a position. Two positions are equal iff their keys are equal.
export function key(piles) {
  return sortDesc(piles).join(',');
}

export function fromKey(str) {
  return String(str).split(',').map(Number);
}

export function isPartitionOf(n, piles) {
  if (!Array.isArray(piles) || piles.length === 0) return false;
  for (const p of piles) {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1) return false;
  }
  return sum(piles) === n;
}

export function triangle(k) {
  return (k * (k + 1)) / 2;
}

// k when n = T_k, otherwise 0. The theorem this game is built on: the staircase exists
// (and every deal converges to it) exactly when this returns non-zero.
export function triangularRoot(n) {
  for (let k = 1; triangle(k) <= n; k++) if (triangle(k) === n) return k;
  return 0;
}

export function isTriangular(n) {
  return triangularRoot(n) > 0;
}

// (k, k-1, ..., 1) — the fixed point of the deal map when n = T_k.
export function staircase(k) {
  const out = [];
  for (let s = k; s >= 1; s--) out.push(s);
  return out;
}

export function isStaircase(piles) {
  const p = sortDesc(piles);
  if (p.length === 0) return false;
  for (let i = 0; i < p.length; i++) if (p[i] !== p.length - i) return false;
  return true;
}

// Every partition of n, each a descending array, in a fixed canonical order (largest
// first part first). Deterministic: the same n always yields the same array of arrays, in
// the same order — the generator indexes into this list, so a shuffled order would change
// every daily puzzle.
export function partitionsOf(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`partitionsOf: bad n ${n}`);
  if (n === 0) return [[]];
  const out = [];
  walk(n, n, [], out);
  return out;
}

function walk(rest, max, acc, out) {
  if (rest === 0) {
    out.push(acc.slice());
    return;
  }
  for (let p = Math.min(max, rest); p >= 1; p--) {
    acc.push(p);
    walk(rest - p, p, acc, out);
    acc.pop();
  }
}

// p(n) by a completely different route: Euler's pentagonal-number recurrence
//   p(n) = sum over k of (-1)^(k-1) * (p(n - k(3k-1)/2) + p(n - k(3k+1)/2)).
// Nothing here enumerates partitions, so when `partitionsOf(n).length` equals this, the
// enumeration is complete rather than merely plausible.
export function pentagonalCount(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`pentagonalCount: bad n ${n}`);
  const p = new Array(n + 1).fill(0);
  p[0] = 1;
  for (let i = 1; i <= n; i++) {
    let total = 0;
    for (let k = 1; ; k++) {
      const g1 = (k * (3 * k - 1)) / 2;
      const g2 = (k * (3 * k + 1)) / 2;
      if (g1 > i && g2 > i) break;
      const sign = k % 2 === 1 ? 1 : -1;
      if (g1 <= i) total += sign * p[i - g1];
      if (g2 <= i) total += sign * p[i - g2];
    }
    p[i] = total;
  }
  return p[n];
}

// Descending-lexicographic order, used to pick a canonical representative out of a cycle.
export function lexCompare(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? a[i] : -1;
    const y = i < b.length ? b[i] : -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function minPartition(list) {
  let best = null;
  for (const p of list) {
    if (!best || lexCompare(p, best) < 0) best = p;
  }
  return best ? best.slice() : null;
}
