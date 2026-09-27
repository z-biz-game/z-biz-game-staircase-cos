// Minimal zero-dep CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9353), BASE_URL (page to attach to)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'         # | @play | @routes | @save | @pointer
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
const PORT = process.env.CDP_PORT || 9353;
// Which page to attach to. Hard-coding the dev-server port silently evaluates against a
// fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5212/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network:
  // a fixed sleep is long enough for localhost and too short for GitHub Pages, where it made
  // an innocent deployment look broken (`window.stair` still undefined, canvas still the
  // unstyled 300x150 default).
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.stair && window.stair.state && window.stair.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        try {
          value = await pointerScenario(cdp, sessionId, runJS);
        } catch (err) {
          value = { rows: [{ test: '@pointer threw', pass: false, detail: String(err.message).slice(0, 300) }] };
        }
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything below goes through
// Chrome's own mouse and keyboard over CDP, so what gets asserted is the pointer-to-pile
// wiring in js/view.js rather than the rules behind it.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  }, sessionId);
  const key = (k, code) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);
  const click = async (p) => {
    await mouse('mousePressed', p.x, p.y, 1);
    await mouse('mouseReleased', p.x, p.y, 0);
    await sleep(70);
  };
  async function drag(from, dx, dy, steps = 5) {
    await mouse('mousePressed', from.x, from.y, 1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', Math.round(from.x + (dx * i) / steps), Math.round(from.y + (dy * i) / steps), 1);
    }
    await mouse('mouseReleased', Math.round(from.x + dx), Math.round(from.y + dy), 0);
    await sleep(80);
  }

  await runJS(`window.stair.load('#/c/1'); 'ok'`);
  await sleep(260);

  const missing = await runJS(`['deal','undo','hint','restart','share','curtain','stars','shelf','wipe','board','readout','backend'].filter((i) => !document.getElementById(i))`);
  rec('every control the shell reaches for exists', missing.length === 0, missing);

  const start = await runJS(`(() => {
    const g = window.stair;
    return { state: g.state, path: g.path(), geom: g.geometry(), pool: g.pool };
  })()`);
  rec('a lot loads with a certified par', start.state.par >= 2 && start.path.length === start.state.par,
    { id: start.state.id, par: start.state.par, path: start.path.length });
  rec('the canvas has real pixels, not the 300x150 default', start.geom && start.geom.W > 240 && start.geom.H > 240, start.geom);

  // One gesture per operation, in the order the search certified, and the board after each
  // gesture must be the board the certified route says — that is what proves the drag landed
  // on the card the finger aimed at, not merely on something legal.
  const { applyAction } = await import('../js/core/solve.js');
  const log = [];
  let played = 0;
  let landed = true;
  let expect = start.state.board.slice();
  for (const action of start.path) {
    const before = await runJS(`window.stair.state.moves`);
    if (action.kind === 'deal') {
      const p = await runJS(`window.stair.deckPoint()`);
      await click(p);
    } else if (action.kind === 'merge') {
      const a = await runJS(`window.stair.pilePoint(${action.a})`);
      const b = await runJS(`window.stair.pilePoint(${action.b})`);
      if (!a || !b) { rec(`piles ${action.a}/${action.b} are on screen`, false, { a, b }); break; }
      await click(a);
      await click(b);
    } else {
      const c = await runJS(`window.stair.cardPoint(${action.i}, ${action.j})`);
      if (!c) { rec(`pile ${action.i} is on screen`, false, c); break; }
      await drag(c, 0, Math.round(c.step * 2));
    }
    const after = await runJS(`(() => { const g = window.stair; return { moves: g.state.moves, board: g.piles(), done: g.state.done, deals: g.state.deals }; })()`);
    expect = applyAction(expect, action);
    const same = expect && after.board.join(',') === expect.join(',');
    if (!same) landed = false;
    played += 1;
    log.push({ want: action, before, ...after, expected: expect });
    if (after.moves !== before + 1) { rec(`gesture ${played} (${action.kind}) costed exactly one operation`, false, log); break; }
    if (!same) { rec(`gesture ${played} (${action.kind}) landed on the certified position`, false, log); break; }
  }
  rec('the mouse plays the whole certified route, one operation per gesture', played === start.path.length && played > 0, log);
  rec('and every gesture landed where the route says', landed, { final: expect, got: await runJS(`window.stair.piles()`) });

  const end = await runJS(`(() => {
    const g = window.stair;
    return {
      state: g.state,
      key: g.canonical(g.piles()),
      target: g.canonical(g.state.target),
      stars: document.getElementById('stars').textContent,
      verdict: document.getElementById('verdict').textContent,
      curtain: !document.getElementById('curtain').hidden,
      record: g.store.record(g.state.id),
    };
  })()`);
  rec('the last gesture lands the staircase and cannot be repeated', end.key === end.target && end.state.done, { got: end.key, want: end.target });
  rec('the win card goes up with three stars', end.curtain && end.stars === '★★★' && end.verdict === '命中最少', { stars: end.stars, verdict: end.verdict, curtain: end.curtain });
  rec('the run is on record at par', !!end.record && end.record.best === start.state.par && end.record.perfect === true, end.record);

  await runJS(`document.getElementById('again').click(); 'ok'`);
  await sleep(220);
  rec('再来一次 clears the card as well as the count', await runJS(`window.stair.state.moves === 0 && document.getElementById('curtain').hidden`), await runJS(`window.stair.state`));

  // A press with no travel is a pick, not a split, and it costs nothing.
  const p0 = await runJS(`window.stair.pilePoint(0)`);
  await drag(p0, 0, 0);
  rec('pressing and releasing in place selects instead of splitting', (await runJS(`window.stair.state.moves`)) === 0 && (await runJS(`window.stair.state.selected`)) === 0,
    await runJS(`({ moves: window.stair.state.moves, selected: window.stair.state.selected })`));
  await click(p0);
  rec('clicking the same pile a second time puts it back down', (await runJS(`window.stair.state.moves`)) === 0 && (await runJS(`window.stair.state.selected`)) === null,
    await runJS(`({ moves: window.stair.state.moves, selected: window.stair.state.selected })`));

  // Felt that is neither a pile nor the deck: the target strip above the board.
  const felt = await runJS(`(() => {
    const g = window.stair;
    const p = g.pilePoint(0);
    const geom = g.geometry();
    return { x: p.x, y: p.y - ((p.size - 1) * p.step + geom.cardH / 2 + 20) };
  })()`);
  await click(felt);
  await drag(felt, 0, 60);
  rec('a click and a drag on bare felt do nothing', (await runJS(`window.stair.state.moves`)) === 0, await runJS(`window.stair.state.moves`));

  // Two clicks on two different piles are a merge, and it lands on the pile the rules say.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  const sizes = await runJS(`window.stair.piles()`);
  const maxV = Math.max(...sizes);
  const maxI = sizes.indexOf(maxV);
  const minV = Math.min(...sizes);
  const minI = sizes.length - 1 - sizes.slice().reverse().indexOf(minV);
  if (maxI !== minI) {
    const pa = await runJS(`window.stair.pilePoint(${maxI})`);
    const pb = await runJS(`window.stair.pilePoint(${minI})`);
    await click(pa);
    const midSel = await runJS(`window.stair.state.selected`);
    await click(pb);
    const now = await runJS(`window.stair.piles()`);
    const want = sizes.filter((_, i) => i !== maxI && i !== minI).concat(maxV + minV).sort((a, b) => b - a);
    rec('clicking one pile then another merges them, once',
      midSel === maxI && (await runJS(`window.stair.state.moves`)) === 1 && now.join(',') === want.join(','),
      { sizes, maxI, minI, selected: midSel, now, want });
  } else {
    rec('clicking one pile then another merges them, once', false, 'one pile only on this lot', sizes);
  }
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);

  // Dragging nine times further than needed still cuts at the grabbed card, and it is still
  // one operation. First walk the prefix of the certified route in-page (that part is already
  // proven by the suite above), then drag the split with real events.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  const splitAt = start.path.findIndex((a) => a.kind === 'split');
  if (splitAt >= 0) {
    await runJS(`window.stair.play(window.stair.path().slice(0, ${splitAt})); 'ok'`);
    const before = await runJS(`window.stair.state.moves`);
    const splitAction = start.path[splitAt];
    const c = await runJS(`window.stair.cardPoint(${splitAction.i}, ${splitAction.j})`);
    await drag(c, 0, Math.round(c.step * 9));
    const after = await runJS(`({ moves: window.stair.state.moves, board: window.stair.piles() })`);
    rec('a nine-fold over-drag still splits once, at the grabbed card',
      after.moves === before + 1, { splitAction, before, after, card: c });
  } else {
    rec('a nine-fold over-drag still splits once, at the grabbed card', false, 'the certified route of this lot has no split');
  }

  // Grabbing the very top card would carve off nothing: it must stay a pick.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  const top = await runJS(`(() => { const g = window.stair; const sizes = g.piles(); const i = sizes.findIndex((s) => s >= 3); return i < 0 ? g.cardPoint(0, 0) : g.cardPoint(i, 0); })()`);
  await drag(top, 0, 70);
  const topAfter = await runJS(`({ moves: window.stair.state.moves, selected: window.stair.state.selected })`);
  rec('dragging the top card of a pile is not a split', topAfter.moves === 0 && topAfter.selected !== null, topAfter);

  // Keyboard shortcuts the panel advertises.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  await key('d', 'KeyD');
  await sleep(140);
  const afterD = await runJS(`({ moves: window.stair.state.moves, deals: window.stair.state.deals })`);
  rec('the d key deals once', afterD.moves === 1 && afterD.deals === 1, afterD);
  await key('u', 'KeyU');
  await sleep(140);
  rec('the u key undoes', (await runJS(`window.stair.state.moves`)) === 0, await runJS(`window.stair.state.moves`));
  await key('h', 'KeyH');
  await sleep(140);
  rec('the h key asks for a hint', (await runJS(`window.stair.state.hints`)) === 1, await runJS(`window.stair.state.hints`));
  await key('r', 'KeyR');
  await sleep(140);
  rec('the r key restarts', (await runJS(`window.stair.state.moves`)) === 0 && (await runJS(`window.stair.state.hints`)) === 0, await runJS(`window.stair.state`));

  return { rows };
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const SCENARIOS = {
  boot: `(async () => {
    const g = window.stair;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    rec('the shell boots straight into a game', g && g.version === 1 && g.state && g.state.mode === 'campaign', g && g.state);
    const c = document.getElementById('board');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    rec('the canvas is laid out, not the unstyled 300x150 default', c.width > 300 && g.geometry() && g.geometry().W > 240, { css: c.width + 'x' + c.height, geom: g.geometry() });
    const lit = (() => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    })();
    rec('the piles were actually painted', lit > 50, { litSamples: lit });
    rec('the shipped pool loaded', g.pool && g.pool.lots >= 24, g.pool && g.pool.lots);
    rec('every band reports a measured range', Object.values(g.pool.byTier).every((t) => t.n > 0 && t.min <= t.max && t.stepsMin <= t.stepsMax), g.pool.byTier);
    rec("the browser's own search agrees with the printed par", g.path().length === g.state.par, { path: g.path().length, par: g.state.par });
    rec('and the device re-solve of the whole lot agrees', g.state.recheck && g.state.recheck.agrees === true, g.state.recheck);
    const readout = document.getElementById('readout').textContent;
    rec('the panel prints operations, par and the deal-only count', /操作/.test(readout) && /最少/.test(readout) && /只发牌/.test(readout), readout);
    rec('the theorem measured in this browser at 6 cards', (() => {
      const c6 = g.census(6);
      return c6.states === 11 && c6.stuck === 0 && c6.worst === 6;
    })(), g.census(6));
    rec('and at 10 cards', (() => {
      const c10 = g.census(10);
      return c10.states === 42 && c10.stuck === 0 && c10.worst === 12;
    })(), g.census(10));
    rec('the counterexample holds here too (77 periodic orbits at 12 cards)', (() => {
      const o = g.orbitCensus(12);
      return o.states === 77 && o.cyclic === 77 && o.open === 0;
    })(), g.orbitCensus(12));
    rec('the attractor label matches the card count', (() => {
      const s = g.state;
      return s.k ? s.attractor === 'staircase(' + s.k + ')' : /^orbit\\(\\d+,\\d+\\)$/.test(s.attractor);
    })(), { n: g.state.n, k: g.state.k, attractor: g.state.attractor });
    return { rows };
  })()`,

  play: `(async () => {
    const g = window.stair;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);

    g.store.reset();
    g.load('#/c/1'); await sleep(160);
    const par = g.state.par;
    const path = g.path();
    rec('the route the page finds is exactly par', path.length === par, { path: path.length, par });

    // A round trip that costs two operations and lands home: merge the biggest pile with the
    // smallest one (the result is necessarily the biggest, i.e. index 0), then cut it back.
    const sizes = g.piles();
    const maxV = Math.max(...sizes);
    const maxI = sizes.indexOf(maxV);
    const minV = Math.min(...sizes);
    const minI = sizes.length - 1 - sizes.slice().reverse().indexOf(minV);
    if (maxI !== minI) {
      g.act({ kind: 'merge', a: maxI, b: minI });
      g.act({ kind: 'split', i: 0, j: maxV });
      const now = g.piles();
      rec('a merge and a cut back costs two operations and lands home',
        g.state.moves === 2 && now.join(',') === sizes.slice().sort((a, b) => b - a).join(','),
        { start: sizes, now, moves: g.state.moves });
    } else {
      rec('a merge and a cut back costs two operations and lands home', false, 'one pile only: nothing to merge', sizes);
    }

    D('restart').click(); await sleep(150);
    g.play(path);
    rec('playing the certified route wins at par with three stars', g.state.done && g.state.moves === par && D('stars').textContent === '★★★' && D('verdict').textContent === '命中最少',
      { moves: g.state.moves, stars: D('stars').textContent, verdict: D('verdict').textContent });
    const atPar = g.store.record(g.state.id);
    rec('the record says solved at par and perfect', !!atPar && atPar.best === par && atPar.perfect === true, atPar);

    // Dealing alone is the theorem's route: it always converges, and it is longer.
    let detour = null;
    for (let i = 1; i <= g.pool.lots; i++) {
      g.load('#/c/' + i); await sleep(120);
      const l = g.lot();
      if (l.k && l.steps >= l.par + 3) { detour = l; break; }
    }
    if (detour) {
      for (let i = 0; i < detour.steps; i++) g.act({ kind: 'deal' });
      rec('dealing every time still lands (the theorem), one star, moves === steps',
        g.state.done && g.state.moves === detour.steps && D('stars').textContent === '★☆☆',
        { id: detour.id, steps: detour.steps, par: detour.par, moves: g.state.moves, stars: D('stars').textContent });
      rec('and the deal counter says only dealing was used', g.state.deals === detour.steps, { deals: g.state.deals });
    } else {
      rec('dealing every time still lands (the theorem), one star, moves === steps', false, 'no triangular lot with steps >= par + 3 shipped');
      rec('and the deal counter says only dealing was used', false, 'skipped');
    }

    g.load('#/c/1'); await sleep(160);
    D('restart').click(); await sleep(140);
    g.play(g.path().slice(0, 1));
    const bad = g.act({ kind: 'merge', a: 0, b: 0 });
    rec('an illegal operation is refused and costs nothing', bad === false && g.state.moves === 1, { ok: bad, moves: g.state.moves });
    const refused = g.act({ kind: 'split', i: 0, j: 0 });
    rec('a split that would carve off nothing is refused with a reason', refused === false && /不合法|不存在|拆不开|内部/.test(D('hintline').textContent), D('hintline').textContent);

    D('undo').click(); await sleep(120);
    rec('undo takes the operation back', g.state.moves === 0 && g.state.done === false, g.state);

    D('restart').click(); await sleep(140);
    const billed = g.store.stats.hints;
    const h = g.hintOnce();
    rec('the hint names an operation and costs a hint', h.hints === 1 && /提示/.test(h.line) && !!h.action, h);
    rec('the hinted operation is legal by construction', g.act(h.action) === true && g.state.moves === 1, { action: h.action, moves: g.state.moves });
    D('undo').click(); await sleep(120);
    g.play(g.path());
    await sleep(160);
    rec('a run that used a hint bills the hint when it lands', g.store.stats.hints === billed + 1, { before: billed, after: g.store.stats.hints });

    D('restart').click(); await sleep(150);
    rec('重开 clears the count, the card and the hints', g.state.moves === 0 && g.state.hints === 0 && D('curtain').hidden, g.state);
    return { rows };
  })()`,

  routes: `(async () => {
    const g = window.stair;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    g.load('#/c/7'); await sleep(160);
    rec('#/c/7 is level seven', g.state.index === 7 && g.state.mode === 'campaign', g.state);
    g.load('#/c/99999'); await sleep(160);
    rec('a huge index clamps to the last level', g.state.index === g.pool.lots, { index: g.state.index, lots: g.pool.lots });
    g.load('#/c/0'); await sleep(160);
    rec('index zero clamps up to one', g.state.index === 1, g.state.index);
    g.load('#/c/9/not-a-number'); await sleep(160);
    rec('a junk segment falls back to a playable lot', g.state.par >= 2 && !!g.state.id, g.state);

    const shareId = g.state.id;
    g.load('#/lot/' + shareId); await sleep(160);
    rec('#/lot/<id> opens that lot', g.state.id === shareId && g.state.mode === 'lot', { want: shareId, got: g.state.id });
    g.load('#/lot/not-a-real-lot'); await sleep(160);
    rec('an unknown lot id falls back instead of blanking the board', !!g.state.id && g.state.mode === 'lot' && g.state.par >= 2, g.state);

    g.load('#/daily'); await sleep(220);
    const daily = g.state.id;
    g.load('#/c/1'); await sleep(160);
    g.load('#/daily'); await sleep(220);
    rec('the daily route is the same puzzle twice', g.state.mode === 'daily' && g.state.id === daily, { first: daily, again: g.state.id });
    rec('the daily label carries the date', /^每日梯 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);
    rec('the daily par was measured on this device', g.state.recheck && g.state.recheck.agrees === true, g.state.recheck);

    for (const tier of Object.keys(g.pool.byTier)) {
      g.load('#/random/' + tier + '/fixedseed'); await sleep(200);
      const first = g.state.id;
      g.load('#/c/1'); await sleep(150);
      g.load('#/random/' + tier + '/fixedseed'); await sleep(200);
      rec('#/random/' + tier + ' stays in its band and repeats itself', g.state.tier === tier && g.state.id === first, { tier: g.state.tier, id: g.state.id, first });
    }
    g.load('#/random'); await sleep(260);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);

    g.load('#/c/1'); await sleep(140);
    return { rows };
  })()`,

  save: `(async () => {
    const g = window.stair;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const KEY = 'staircase.save.v1';

    g.store.reset();
    g.load('#/c/1'); await sleep(180);
    rec('a wiped save is empty', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, { unlocked: g.store.unlocked, backend: g.state.storage });
    rec('the shell says which backend it got', /local|memory|string/.test(typeof g.state.storage), g.state.storage);

    const par = g.state.par;
    g.play(g.path());
    await sleep(180);
    const id = g.state.id;
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records && raw.records[id] && raw.records[id].best === par), raw && Object.keys(raw.records || {}));
    rec('clearing the first level unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });

    // A worse run must not move the record; a better one must.
    g.load('#/c/2'); await sleep(160);
    const second = g.state.id;
    g.play(g.path());
    await sleep(140);
    const firstBest = g.store.record(second).best;
    g.load('#/c/2'); await sleep(160);
    g.act({ kind: 'deal' });
    g.play(g.path());
    await sleep(140);
    const rec2 = g.store.record(second);
    rec('a sloppier replay never lowers the record and always raises plays', rec2.best <= firstBest && rec2.plays >= 2, { firstBest, now: rec2 });
    g.load('#/c/2'); await sleep(160);
    g.play(g.path());
    await sleep(140);
    rec('matching par later keeps the perfect flag', g.store.record(second).perfect === true, g.store.record(second));

    const unlocked = g.store.unlocked;
    g.store.unlock(1);
    rec('unlock is monotone', g.store.unlocked === unlocked, { want: unlocked, got: g.store.unlocked });

    const shelf2 = document.querySelector('#shelf button[data-index=\\'2\\']');
    rec('the shelf lets level two be clicked', !!shelf2 && !shelf2.disabled, shelf2 && shelf2.className);

    g.load('#/daily'); await sleep(220);
    const day = g.state.label.split(' · ')[1];
    g.play(g.path());
    await sleep(180);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已通过/.test(document.getElementById('shelf').textContent), document.getElementById('shelf').textContent.slice(0, 80));

    D('wipe').click(); await sleep(90);
    const armed = Object.keys(g.store.records).length;
    rec('the first click only arms it', armed > 0, { armed });
    D('wipe').click(); await sleep(220);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, key: localStorage.getItem(KEY) });
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
