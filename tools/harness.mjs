// Tiny zero-dep test harness: every test/*.test.mjs suite prints the same shape, so
// tools/verify.sh can aggregate the node suites and the browser suites on one line and
// `node --test test/` stays green (a failing row exits non-zero).

const rows = [];
const pending = [];

export function test(name, fn) {
  let out;
  try {
    out = fn();
  } catch (err) {
    rows.push({ test: name, pass: false, detail: String((err && err.message) || err) });
    return;
  }
  if (out && typeof out.then === 'function') {
    // An async body that rejects must red the row, not float away as an unhandled rejection.
    const row = { test: name, pass: true };
    rows.push(row);
    pending.push(out.catch((err) => {
      row.pass = false;
      row.detail = String((err && err.message) || err);
    }));
    return;
  }
  rows.push({ test: name, pass: true });
}

export function ok(cond, msg = 'expected truthy') {
  if (!cond) throw new Error(msg);
}

export function eq(a, b, msg = 'not equal') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n    got      ${sa}\n    expected ${sb}`);
}

export function throws(fn, msg = 'expected a throw') {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg);
}

export function fail(msg) {
  throw new Error(msg);
}

export async function run() {
  await Promise.all(pending);
  const bad = rows.filter((r) => !r.pass);
  for (const r of rows) console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.test}${r.pass ? '' : '\n         ' + r.detail}`);
  console.log(`rows: ${rows.length} fail: ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
}
