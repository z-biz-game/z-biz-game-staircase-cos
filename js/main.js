// The shell: hash routes in, canvas out, save file in between. Nothing here knows the rules
// of the game — those are js/core — and nothing here draws — that is js/view.js.

import { createGame, act, select, undo, reset, hint, grade, snapshot } from './core/game.js';
import { solve } from './core/solve.js';
import { createStore, localStorageBackend, memoryBackend } from './core/storage.js';
import { targetOf, convergenceCensus, orbitCensus } from './core/deal.js';
import { key, isPartitionOf } from './core/partition.js';
import {
  ALL, TIERS, TIERS_META, byId, levelAt, lotsIn, dailyLot, randomLot, reSolve, stats, tierByKey,
} from './core/library.js';
import { todayKey } from './core/rng.js';
import { createView } from './view.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), deal: $('deal'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('board'), wipe: $('wipe'), backend: $('backend'),
};

// localStorage is guarded in js/core/storage.js and THROWS when it is not there (file://,
// a blocked page, node). The shell catches that once, loudly, and says which backend it is
// using instead of pretending a run was saved.
let backend;
try {
  backend = localStorageBackend();
} catch (err) {
  backend = memoryBackend();
  el.backend.textContent = `存档只在本次会话里（${err.message.split(':')[0]}）`;
}
const store = createStore(backend);

const LEVELS = ALL.length;
const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  lot: null,
  game: null,
  hints: 0,
  lastHint: null,
  label: '',
  day: null,
  recheck: null,
};

function clampIndex(n) {
  return Math.min(LEVELS, Math.max(1, Number(n) || 1));
}

// #/c/7 · #/daily · #/lot/twined-03 · #/random/master/4kq2
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', tier: (p[1] && tierByKey(p[1]).key) || TIERS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    const lot = dailyLot(day) || ALL[0];
    return { lot, label: `每日梯 · ${day}`, note: `hashSeed("${day}") 选出的牌局`, day };
  }
  if (rt.mode === 'random') {
    const tier = tierByKey(rt.tier);
    return { lot: randomLot(`${tier.key}|${rt.key}`, tier.key) || ALL[0], label: `随机 · ${tier.label}`, note: tier.blurb };
  }
  if (rt.mode === 'lot') {
    const lot = byId(rt.id) || ALL[0];
    return { lot, label: `关卡 ${lot.id}`, note: tierByKey(lot.tier).blurb };
  }
  const lot = levelAt(rt.index - 1);
  return { lot, label: `第 ${rt.index} 关`, note: `共 ${LEVELS} 关 · ${tierByKey(lot.tier).label}` };
}

const view = createView(el.canvas, {
  onAction: (action) => commit(action),
  onPick: (i) => pick(i),
});

function setGame(lot, label) {
  app.lot = lot;
  app.label = label || app.label;
  app.game = createGame(lot);
  app.hints = 0;
  view.attach(app.game);
  el.curtain.hidden = true;
  say('');
  // The number on screen gets re-measured on this device before it is trusted.
  const chk = reSolve(lot);
  app.recheck = { par: chk.par, steps: chk.steps, agrees: chk.agrees };
  if (!chk.agrees) say(`注意：本机重算得到 par ${chk.par}，与关卡印着的 ${lot.par} 不一致 —— 请重新 bake。`);
}

function say(html) { el.hintline.innerHTML = html; }
function stars(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderCrumbs() {
  const lot = app.lot;
  const tier = tierByKey(lot.tier);
  const rec = store.record(lot.id);
  el.crumbs.innerHTML = `${app.label}<b>${tier.label}<span class="band"> ${tier.blurb}</span></b>`;
  el.readout.innerHTML = [
    field('操作', app.game.moves, '已用的发/并/拆'),
    field('最少', lot.par, '搜索量出', 'par'),
    field('只发牌', lot.steps, '定理给的上限', 'steps'),
    field('最佳', rec && rec.best ? rec.best : '—', rec && rec.perfect ? '等于最少' : '你的纪录', 'best'),
    field('牌数', `${lot.n} 张`, lot.attractor),
  ].join('');
  el.undo.disabled = !app.game.moves || app.game.done;
  el.hint.disabled = app.game.done;
  el.deal.disabled = app.game.done;
}

function renderTotals() {
  const s = store.stats;
  const solved = Object.values(store.records).filter((r) => r.solved).length;
  el.totals.innerHTML = `已通 <b>${solved}</b>/${LEVELS} · 命中最少 <b>${Object.values(store.records).filter((r) => r.perfect).length}</b>`
    + ` · 提示 <b>${s.hints}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const meta of TIERS_META) {
      html += `<p class="tier">${meta.label} · ${meta.range}<span class="band"> 只发牌 ${meta.stepsMin}-${meta.stepsMax}</span></p>`;
      for (const lot of lotsIn(meta.key)) {
        const n = ALL.indexOf(lot) + 1;
        const rec = store.record(lot.id);
        const cls = [
          n === app.index ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" title="${lot.id} · ${lot.n} 张 · par ${lot.par}" ${n > unlocked ? 'disabled' : ''}>${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一段难度</p>';
    for (const t of TIERS) {
      html += `<button type="button" class="${t.key === app.route.tier ? 'here' : ''}" data-tier="${t.key}">${t.label}<br><small>${t.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一副牌</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-tier]').forEach((b) => b.addEventListener('click', () => go(`#/random/${b.dataset.tier}/${token()}`)));
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.tier}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一局对所有人相同${done ? ' · 已通过' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到战役 第 ${store.unlocked} 关</button>`;
  } else {
    el.shelf.innerHTML = '<p class="tier">分享的关卡</p><button type="button" class="wide" data-back="1">回到战役</button>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

// The one place an operation happens: a tap on the deck, a drag across a pile, a click pair
// for a merge, and the test hook's replay all arrive here.
function commit(action) {
  const r = act(app.game, action);
  if (!r.ok) {
    view.flash(r.reason);
    view.redraw();
    say(`不合法：${r.reason}`);
    return false;
  }
  if (app.game.done) finish();
  else {
    view.redraw();
    renderCrumbs();
    say(`${describe(action)} · 已用 ${app.game.moves} 步（最少 ${app.lot.par}）`);
  }
  return true;
}

function describe(action) {
  if (action.kind === 'deal') return '发了一次牌';
  if (action.kind === 'merge') return `并了第 ${action.a + 1} 与第 ${action.b + 1} 堆`;
  return `在第 ${action.i + 1} 堆拆出 ${action.j} 张`;
}

// Two clicks make a merge: pick a pile, then pick the one it joins. Clicking the same pile
// twice puts it back down.
function pick(i) {
  if (app.game.done) return;
  const was = app.game.selected;
  if (was === null) {
    select(app.game, i);
    view.redraw();
    renderCrumbs();
    say(`选中第 ${i + 1} 堆 · 再点一堆就是把两堆并起来`);
    return;
  }
  if (was === i) {
    select(app.game, i);
    view.redraw();
    renderCrumbs();
    say('放下了');
    return;
  }
  commit({ kind: 'merge', a: was, b: i });
}

function finish() {
  const lot = app.lot;
  const g = app.game;
  const rec = store.solve(lot.id, { moves: g.moves, par: lot.par, deals: g.deals, hints: app.hints });
  if (app.day) store.markDaily(app.day, lot.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.min(LEVELS, Math.max(store.unlocked, app.index + 1)));
    nextIndex = app.index < LEVELS ? app.index + 1 : 0;
  }
  const gr = grade(g);
  el.stars.textContent = stars(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `你的 <b>${g.moves}</b> 步（其中发牌 <b>${g.deals}</b>） · 搜索最少 <b>${lot.par}</b>`
    + ` · 只发牌要 <b>${lot.steps}</b> · 提示 <b>${app.hints}</b>`
    + (rec.best === g.moves ? '<br>这是这一关的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  view.redraw();
  render();
}

function token() { return Math.random().toString(36).slice(2, 8); }

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    location.replace(`${location.pathname}${location.search}#/random/${rt.tier}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.lot) { say('这一档还没有烤好的关卡'); return; }
  app.day = r.day || null;
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.lot) + 1;
  setGame(r.lot, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2000);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.lot.id}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => toast('链接已复制'), () => toast(url));
  } else toast(url);
}

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${TIERS[0].key}/${token()}`);
});

el.deal.addEventListener('click', () => commit({ kind: 'deal' }));
el.undo.addEventListener('click', () => {
  if (undo(app.game)) {
    view.attach(app.game);
    renderCrumbs();
    say(app.game.moves === 0 ? '回到起点' : `撤销一步 · 还有 ${app.game.moves} 步`);
  }
});
el.hint.addEventListener('click', () => {
  const h = hint(app.game);
  if (!h) {
    app.lastHint = null;
    say('搜索在当前局面找不到可给的提示（或者它超了状态上限）—— 撤销一步或重开。');
    return;
  }
  app.lastHint = h.action;
  app.hints += 1;
  view.showHint(h.action);
  say(`提示：${describe(h.action)} —— 之后还需 <b>${h.left - 1}</b> 步（本机搜索 ${h.states} 个局面）`);
  renderCrumbs();
});

function restart() {
  reset(app.game);
  app.hints = 0;
  view.attach(app.game);
  el.curtain.hidden = true;
  render();
  say('回到起点');
}

el.restart.addEventListener('click', restart);
el.again.addEventListener('click', restart);
el.share.addEventListener('click', shareLink);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LEVELS, app.index + 1)}`));

let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape' && !el.curtain.hidden) el.curtain.hidden = true;
  else if (k === 'u') el.undo.click();
  else if (k === 'h') el.hint.click();
  else if (k === 'r') el.restart.click();
  else if (k === 'd' || k === ' ') { ev.preventDefault(); el.deal.click(); }
});

view.start();
// Deliberately not paused on visibilitychange: a tab that reports itself hidden (headless
// Chrome does) must still be able to finish a lot.
apply();

window.stair = window.staircase = {
  version: 1,
  get state() {
    return {
      mode: app.mode,
      label: app.label,
      id: app.lot && app.lot.id,
      tier: app.lot && app.lot.tier,
      n: app.lot && app.lot.n,
      k: app.lot && app.lot.k,
      attractor: app.lot && app.lot.attractor,
      index: app.index,
      moves: app.game && app.game.moves,
      deals: app.game && app.game.deals,
      par: app.lot && app.lot.par,
      steps: app.lot && app.lot.steps,
      hints: app.hints,
      done: !!(app.game && app.game.done),
      selected: app.game ? app.game.selected : null,
      unlocked: store.unlocked,
      solved: Object.values(store.records).filter((r) => r.solved).length,
      curtain: !el.curtain.hidden,
      storage: backend.name,
      recheck: app.recheck,
      board: app.game ? app.game.piles.slice() : null,
      target: app.game ? app.game.target.slice() : null,
    };
  },
  get pool() { return stats(); },
  get meta() { return TIERS_META; },
  load(hash) { go(hash); return app.lot && app.lot.id; },
  lot() { return app.lot ? JSON.parse(JSON.stringify(app.lot)) : null; },
  piles() { return app.game ? app.game.piles.slice() : null; },
  // Where pile i / card j / the deck sit in client pixels — what an automated finger needs.
  pilePoint(i) { return view.pilePoint(i); },
  cardPoint(i, j) { return view.cardPoint(i, j); },
  deckPoint() { return view.deckPoint(); },
  geometry() { return view.geometry(); },
  // The certified route, recomputed on this device from the lot's own spec.
  path() {
    if (!app.game) return [];
    return solve(app.game.piles, app.game.target, { maxStates: 200000 }).path || [];
  },
  // Play a route through the same commit() a finger uses.
  play(actions) {
    for (const a of actions || []) commit(a);
    return app.game.moves;
  },
  act(action) { return commit(action); },
  snapshot() { return app.game ? snapshot(app.game) : null; },
  reSolve() { return app.lot ? reSolve(app.lot) : null; },
  targetOf(start) { return targetOf(start); },
  isPartitionOf(n, piles) { return isPartitionOf(n, piles); },
  canonical(piles) { return key(piles); },
  // The theorem, measured in the visitor's own browser. n <= 15 is 176 runs and stays well
  // under a frame budget; bigger censuses belong to the build step.
  census(n) { return convergenceCensus(n, { limit: 400 }); },
  orbitCensus(n) { return orbitCensus(n, { limit: 400 }); },
  hintOnce() { el.hint.click(); return { hints: app.hints, line: el.hintline.textContent, action: app.lastHint }; },
  store,
};
