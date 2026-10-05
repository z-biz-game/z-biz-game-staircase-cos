// js/main.js 的 shell 行为。这里没有一行是字符串检查：它在 node 里真装载那份 ESM（走浏览器
// 同一条 import 路径），真喂 rAF 帧、真发 keydown/pointer 事件，读回来的是 stair.state、
// stair.clock()、stair.sound() 的实测数。§2 的"键盘可用/暂停真停/静音真停/帧率无关"原来
// 只有开着浏览器的会话能复核，从这一行起 `npm run unit` 就能复核。
//
// 一次 boot 装一套 globals（document / rAF / 定时器 / localStorage / AudioContext / Date），
// 所以用例必须跑完一条才轮到下一条：serial() 就是把 body 串起来，否则后一次 boot 会把前一次
// boot 正在用的 globalThis.document 换掉，帧循环会串到别人的队列里。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { test, run, eq, ok } from '../tools/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// index.html 里真实存在的 id 才发元素：main.js 的 $() 拿到 null 就是缺 id，本次 boot 直接崩。
const HTML_IDS = new Set(
  [...readFileSync(join(root, 'index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
);

const CSS_BOX = { width: 900, height: 580, left: 24, top: 96 };
const RING = 'strokeStyle=rgba(120, 220, 255';

// 固定种子的 LCG：宿主 Math.random 不参与，随机路由与分享 token 才会取到同一张牌。
let seed = 0x2f6e2b1;
const nativeRandom = Math.random;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
void nativeRandom;

let queue = Promise.resolve();
function serial(fn) {
  const done = queue.then(fn);
  queue = done.catch(() => {});   // 前一条红掉不许把后面全部带崩
  return done;
}

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// main.js 把 shelf 写成 innerHTML 再 querySelector 回来绑事件，所以桩里必须有一层最小的
// HTML 模型；只支持代码里真用到的那三种选择器（'button[data-tier]'、'[data-back]'、'button'）。
function parseHtml(html) {
  const nodes = [];
  for (const m of String(html).matchAll(/<([a-zA-Z]\w*)([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const dataset = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) dataset[k.slice(5).replace(/-(\w)/g, (_s, c) => c.toLowerCase())] = v;
    }
    const listeners = {};
    const node = {
      tagName: m[1].toUpperCase(), attrs, dataset, innerText: m[2], _listeners: listeners,
      addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
      removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      closest(sel) { return matches(node, sel) ? node : null; },
      click() { for (const fn of listeners.click || []) fn({ type: 'click', preventDefault() {}, target: node }); },
    };
    nodes.push(node);
  }
  return nodes;
}

function matches(node, sel) {
  const s = String(sel);
  const tag = s.match(/^([a-zA-Z]\w*)/);
  const attr = s.match(/\[([\w-]+)\]/);
  if (tag && node.tagName !== tag[1].toUpperCase()) return false;
  if (attr && !(attr[1] in node.attrs)) return false;
  return !!tag || !!attr;
}

async function boot(label, { storage = new Map(), hash = '#/c/5' } = {}) {
  let clock = 1000;
  const rafQueue = new Map();
  const timers = [];
  const winH = {};
  const registry = new Map();
  let rafId = 0;
  let timerId = 1;

  globalThis.requestAnimationFrame = (cb) => { rafId += 1; rafQueue.set(rafId, cb); return rafId; };
  globalThis.cancelAnimationFrame = (i) => { rafQueue.delete(i); };
  globalThis.setTimeout = (cb, ms) => {
    timerId += 1;
    timers.push({ id: timerId, at: clock + Math.max(0, Number(ms) || 0), cb });
    return timerId;
  };
  globalThis.clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  globalThis.performance = { now: () => clock };
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct: () => new RealDate(clock),
    get: (t, k) => (k === 'now' ? () => clock : Reflect.get(t, k)),
  });

  const box = () => ({ ...CSS_BOX, right: CSS_BOX.left + CSS_BOX.width, bottom: CSS_BOX.top + CSS_BOX.height });

  function makeEl(id, isCanvas) {
    const listeners = {};
    const node = {
      id, tagName: isCanvas ? 'CANVAS' : 'DIV', hidden: false, disabled: false,
      textContent: '', title: '', value: '', attrs: {},
      dataset: {}, style: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(k, v) { node.attrs[k] = String(v); },
      getAttribute(k) { return node.attrs[k] ?? null; },
      removeAttribute(k) { delete node.attrs[k]; },
      appendChild(c) { node.children.push(c); return c; },
      closest() { return null; },
      focus() { doc.activeElement = node; },
      blur() { if (doc.activeElement === node) doc.activeElement = doc.body; },
      addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
      removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
      querySelector: (sel) => node._nodes.find((n) => matches(n, sel)) || null,
      querySelectorAll: (sel) => node._nodes.filter((n) => matches(n, sel)),
      getBoundingClientRect: box,
      click(target) {
        for (const fn of listeners.click || []) fn({ type: 'click', preventDefault() {}, target: target || node });
      },
      _listeners: listeners,
      _nodes: [],
    };
    let html = '';
    Object.defineProperty(node, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); node._nodes = parseHtml(html); },
    });
    if (isCanvas) {
      const log = [];
      const state = {};
      const num = (a) => (typeof a === 'number' ? a.toFixed(3) : String(a));
      const ctx = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'measureText') return () => ({ width: 42 });
          if (prop === 'createPattern') return () => ({ __pattern: true });
          if (prop === 'canvas') return node;
          if (prop in state) return state[prop];
          return (...args) => { log.push(`${String(prop)}(${args.map(num).join(',')})`); };
        },
        set(_t, prop, value) {
          state[prop] = value;
          log.push(`${String(prop)}=${typeof value === 'number' ? value.toFixed(3) : String(value)}`);
          return true;
        },
      });
      node.width = 0;
      node.height = 0;
      node.getContext = () => ctx;
      node.setPointerCapture = () => {};
      node.releasePointerCapture = () => {};
      node._log = log;
      node._fire = (type, ev) => {
        for (const fn of listeners[type] || []) {
          fn({ type, pointerId: 1, isPrimary: true, button: 0, preventDefault() {}, ...ev });
        }
      };
    }
    return node;
  }

  function byId(id) {
    if (!registry.has(id)) registry.set(id, makeEl(id, id === 'board'));
    return registry.get(id);
  }

  const doc = {
    body: makeEl('body', false),
    hidden: false,
    fullscreenElement: null,
    title: '保加利亚梯',
    getElementById: (i) => (HTML_IDS.has(i) ? byId(i) : null),
    createElement: (t) => makeEl(`created-${t}`, false),
    querySelector: (sel) => (String(sel).includes('manifest') ? { href: 'http://127.0.0.1/manifest.webmanifest' } : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { requestFullscreen: () => Promise.resolve(), clientWidth: 1200, clientHeight: 900 },
  };
  doc.activeElement = doc.body;

  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.devicePixelRatio = 2;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;
  globalThis.PointerEvent = function PointerEvent() {};
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, addListener() {}, onchange: null });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: { userAgent: 'shell-test', maxTouchPoints: 0, serviceWorker: undefined, clipboard: undefined },
  });
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
    clear: () => storage.clear(),
    key: (i) => [...storage.keys()][i] ?? null,
    get length() { return storage.size; },
  };
  globalThis.Image = function Image() {
    const img = { width: 256, height: 256, naturalWidth: 256, naturalHeight: 256, onload: null, onerror: null };
    Object.defineProperty(img, 'src', { set: () => { queueMicrotask(() => img.onload && img.onload()); } });
    return img;
  };
  globalThis.AudioContext = function AudioContext() {
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = () => ({ connect: (d) => d, disconnect() {} });
    return {
      state: 'running', currentTime: 0, destination: node(),
      createGain: () => ({ ...node(), gain: param() }),
      createOscillator: () => ({ ...node(), type: 'sine', frequency: param(), start() {}, stop() {} }),
      resume() { this.state = 'running'; return Promise.resolve(); },
      suspend() { this.state = 'suspended'; return Promise.resolve(); },
    };
  };
  globalThis.fetch = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ name: '保加利亚梯', start_url: '.', display: 'standalone', icons: [{ src: 'icons/icon-192.png' }] }),
  });
  globalThis.CustomEvent = function CustomEvent(t, o) { this.type = t; Object.assign(this, o || {}); };
  globalThis.Event = function Event(t) { this.type = t; };
  globalThis.alert = () => {};
  globalThis.confirm = () => false;
  globalThis.addEventListener = (t, fn) => { (winH[t] ||= []).push(fn); };
  globalThis.removeEventListener = (t, fn) => { winH[t] = (winH[t] || []).filter((f) => f !== fn); };

  const loc = {
    pathname: '/index.html', search: '', origin: 'http://127.0.0.1', protocol: 'http:', href: '',
    assign() {}, replace(h) { loc.hash = String(h); },
  };
  let hashValue = hash;
  function fire(type, ev) {
    let prevented = false;
    const payload = {
      type, preventDefault() { prevented = true; },
      metaKey: false, ctrlKey: false, altKey: false, target: doc.body, ...ev,
    };
    for (const fn of winH[type] || []) fn(payload);
    return prevented;
  }
  Object.defineProperty(loc, 'hash', {
    get: () => hashValue,
    set(v) {
      const next = String(v);
      if (next === hashValue) return;
      hashValue = next;
      fire('hashchange', {});
    },
  });
  loc.href = 'http://127.0.0.1/index.html' + hashValue;
  globalThis.location = loc;

  await import(`${pathToFileURL(join(root, 'js/main.js')).href}?boot=${label}`);
  await null; await null;
  const stair = globalThis.stair;
  if (!stair) throw new Error(`boot ${label}: window.stair never appeared`);
  const canvas = byId('board');

  const api = {
    stair, doc, canvas, el: byId, storage,
    get clock() { return clock; },
    set hash(v) { loc.hash = v; },
    get hash() { return hashValue; },
    focus(node) { doc.activeElement = node; },
    blur() { doc.activeElement = doc.body; },
    // 浏览器语义：没被 preventDefault 的 Space/Enter，会在聚焦控件上激活一次 click。
    key(k) {
      const prevented = fire('keydown', { key: k });
      if (!prevented && (k === ' ' || k === 'Enter')) {
        const t = doc.activeElement;
        if (t && t !== doc.body && typeof t.click === 'function') t.click();
      }
      return { prevented };
    },
    resize() { fire('resize', {}); },
    at(secs) { clock = 1000 + secs * 1000; for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= clock) timers.splice(i, 1)[0].cb(); },
    pump() {
      const cbs = [...rafQueue.values()];
      rafQueue.clear();
      for (const cb of cbs) cb(clock);
    },
    tap(pt) {
      canvas._fire('pointerdown', { clientX: pt.x, clientY: pt.y });
      canvas._fire('pointerup', { clientX: pt.x, clientY: pt.y });
    },
    tapDeck() { const p = stair.deckPoint(); if (p) api.tap(p); },
    tapPile(i) { const p = stair.pilePoint(i); if (p) api.tap(p); },
    dragSplit() {
      const piles = stair.piles();
      const i = piles.findIndex((s) => s >= 2);
      if (i < 0) return;
      const pt = stair.cardPoint(i, 1);
      if (!pt) return;
      canvas._fire('pointerdown', { clientX: pt.x, clientY: pt.y });
      canvas._fire('pointermove', { clientX: pt.x, clientY: pt.y + 40 });
      canvas._fire('pointerup', { clientX: pt.x, clientY: pt.y + 40 });
    },
    // 提示环只有指向具体堆时才画（kind==='deal' 的 hintAt={i:-1} 不进画面），所以连按到拿到
    // 一个 split/merge 为止 —— 否则"画面随动画相位变"这条判据就是空跑。
    pileHint() {
      const tried = [];
      for (let k = 0; k < 4; k++) {
        const h = stair.hintOnce();
        const a = h && h.action;
        if (!a) { tried.push('null'); continue; }
        tried.push(a.kind);
        if (a.kind !== 'deal') return { kind: a.kind, tried };
      }
      return { kind: null, tried };
    },
    // 强制整幅重绘（resize → view.measure() → draw()），把"这一虚拟秒屏幕上到底是什么"摊成
    // 一次调用序列指纹；提示环的相位就写在这一次的 strokeStyle 里。
    digest() {
      canvas._log.length = 0;
      api.resize();
      const rings = canvas._log.filter((l) => l.startsWith(RING));
      return {
        picture: hash32(canvas._log.join(';')),
        calls: canvas._log.length,
        ringPhase: rings.join(',').slice(0, 120),
        ringCount: rings.length,
      };
    },
  };

  // 测量窗口之外先吃掉哨兵帧：attach()/setPaused(false) 都把 last 归 0，第一帧不吃 dt。
  api.resize();
  api.at(0);
  api.pump();
  return api;
}

// 同一份脚本 + 同一批检查站，三档只换帧间隔。脚本时刻全落在 0.2s 网格上，所以 30/60/120Hz
// 都在同一虚拟时刻触发；坐标在触发那一刻现取（发一次牌之后堆数与 slot 都会变）。
const PLAN = [
  { t: 0.0, what: 'closehelp' },
  { t: 0.2, what: 'deal' },
  { t: 0.4, what: 'pile0' },
  { t: 0.6, what: 'pile1' },
  { t: 1.0, what: 'deal' },
  { t: 1.2, what: 'split' },
  { t: 1.4, what: 'key-d' },
  { t: 1.8, what: 'hint' },
  { t: 2.2, what: 'deal' },
];
const MARKS = [1.5, 2.5, 2.6];

async function tier(hz, secs = 3.0) {
  const sh = await boot(`hz${hz}`);
  const run = {
    closehelp: () => sh.el('closehelp').click(),
    deal: sh.tapDeck,
    pile0: () => sh.tapPile(0),
    pile1: () => sh.tapPile(1),
    split: sh.dragSplit,
    'key-d': () => sh.key('d'),
    hint: sh.pileHint,
  };
  const frames = Math.round(hz * secs);
  const snaps = {};
  let fired = 0;
  for (let k = 1; k <= frames; k++) {
    const secs2 = k / hz;
    sh.at(secs2);
    while (fired < PLAN.length && PLAN[fired].t <= secs2 + 1e-9) { run[PLAN[fired].what](); fired += 1; }
    sh.pump();
    const mark = MARKS.find((m) => Math.abs(secs2 - m) < 1e-9);
    if (mark && !snaps[mark]) {
      const st = sh.stair.state;
      const ck = sh.stair.clock();
      const sd = sh.stair.sound();
      snaps[mark] = {
        animClock: +ck.animClock.toFixed(9),
        hintRaw: +ck.hintLeft.toFixed(9),
        hintLeft: +(ck.hintLeft + 1 / hz).toFixed(9),
        moves: st.moves, deals: st.deals, hints: st.hints, done: st.done,
        selected: st.selected, curtain: st.curtain, muted: st.muted,
        board: st.board.join('|'),
        nodes: sd.nodes, plays: sd.plays, refusals: sd.refusals, stops: sd.stops,
        ...sh.digest(),
      };
    }
  }
  return { hz, fired, snaps };
}

test('空格与回车归当前聚焦的控件：Tab 到「暂停」再按空格必须真暂停，一张牌都不发', () => serial(async () => {
  const sh = await boot('focus-space');
  sh.el('closehelp').click();
  eq([sh.stair.state.moves, sh.stair.state.deals, sh.stair.state.paused], [0, 0, false], '开局读数');

  sh.focus(sh.el('pause'));
  const r = sh.key(' ');
  ok(!r.prevented, '焦点在按钮上时 keydown 不许 preventDefault，否则浏览器永远激活不了这个按钮');
  eq(sh.stair.state.paused, true, '空格必须激活聚焦的「暂停」');
  eq(sh.stair.state.moves, 0, '这一发键盘只许服务那个按钮');
  sh.key(' ');
  eq(sh.stair.state.paused, false, '再按一次空格继续');

  const wasMuted = sh.stair.state.muted;
  sh.focus(sh.el('sound'));
  const r2 = sh.key('Enter');
  ok(!r2.prevented, '回车同样归聚焦控件');
  eq(sh.stair.state.muted, !wasMuted, '回车激活聚焦的「声音」开关');
  eq(sh.stair.state.moves, 0, '回车也不许发牌');

  sh.blur();
  sh.key(' ');
  eq(sh.stair.state.deals, 1, '焦点回到 body 上，空格才是快捷发牌');
  sh.blur();
  sh.key('Enter');
  eq(sh.stair.state.deals, 2, 'body 上的回车同样快捷发牌');
}));

test('键盘的每个键落到它声称的动作：1/2 并堆、d 发牌、h/u/r/p/m 各改哪个读数', () => serial(async () => {
  const sh = await boot('keys');
  sh.el('closehelp').click();
  const open = sh.stair.piles();
  eq(open.reduce((a, b) => a + b, 0), sh.stair.state.n, '开局是一副完整的牌');
  sh.key('1');
  eq(sh.stair.state.selected, 0, '1 选中第 0 堆');
  sh.key('2');
  eq(sh.stair.state.selected, null, '第二次选堆走合并，不残留选中');
  eq(sh.stair.state.moves, 1, '并堆算一步');
  eq(sh.stair.piles().length, open.length - 1, '并掉两堆多一堆');
  eq(sh.stair.piles().reduce((a, b) => a + b, 0), sh.stair.state.n, '键盘并堆只改堆形，不改牌数');
  sh.key('d');
  eq([sh.stair.state.deals, sh.stair.state.moves], [1, 2], 'd 发一张牌');

  sh.key('h');
  eq(sh.stair.state.hints, 1, 'h 用掉一次提示');
  ok(sh.el('hintline').innerHTML.includes('提示'), `hintline 上要说话：${sh.el('hintline').innerHTML}`);
  const m = sh.stair.state.moves;
  sh.key('u');
  eq(sh.stair.state.moves, m - 1, 'u 撤销恰好一步');

  sh.key('r');
  eq([sh.stair.state.moves, sh.stair.state.deals, sh.stair.state.selected], [0, 0, null], 'r 重开回到第 0 步');
  sh.key('p');
  eq(sh.stair.state.paused, true, 'p 暂停');
  sh.key('p');
  eq(sh.stair.state.paused, false, 'p 继续');
  sh.key('m');
  eq(sh.stair.state.muted, true, 'm 静音');
  eq(sh.stair.sound().context, 'suspended', '静音必须把 AudioContext 挂起');
  eq(sh.el('sound').textContent, '声音 关', '按钮文案要跟读数一致');
}));

test('说明面板打开时键盘只服务它自己：按 d 与按空格一张牌都不发', () => serial(async () => {
  const sh = await boot('help-keys');
  sh.el('closehelp').click();
  eq(sh.stair.state.helpOpen, false, '面板已关');
  sh.key('?');
  eq(sh.stair.state.helpOpen, true, '? 打开面板');
  sh.key('d');
  sh.blur();
  sh.key(' ');
  eq([sh.stair.state.deals, sh.stair.state.moves], [0, 0], '面板打开时发牌键必须全部失效');
  sh.key('Escape');
  eq(sh.stair.state.helpOpen, false, 'Escape 关掉面板');
}));

test('暂停真停：animClock 与倒计时冻住、棋盘不接受操作，恢复只吃一帧哨兵', () => serial(async () => {
  const sh = await boot('pause');
  sh.el('closehelp').click();
  sh.tapDeck();
  sh.el('hint').click();
  for (let k = 1; k <= 30; k++) { sh.at(k / 60); sh.pump(); }
  const before = sh.stair.clock();
  ok(before.animClock > 0.4 && before.hintLeft > 0, `暂停前两样都在走：${JSON.stringify(before)}`);
  const board = sh.stair.piles().join('|');
  sh.key('p');
  for (let k = 31; k <= 90; k++) { sh.at(k / 60); sh.pump(); }
  const during = sh.stair.clock();
  eq(during.animClock, before.animClock, '暂停 1.0 虚拟秒，animClock 必须一动不动');
  eq(during.hintLeft, before.hintLeft, '提示倒计时同样不许走');
  sh.tapDeck();
  eq(sh.stair.piles().join('|'), board, '暂停期间点棋盘不许改变局面');
  sh.key('p');
  sh.at(91 / 60);
  sh.pump();
  eq(sh.stair.clock().animClock, before.animClock, '恢复帧是哨兵：不许把暂停期间的 1 秒补回来');
  sh.at(92 / 60);
  sh.pump();
  const step = sh.stair.clock().animClock - before.animClock;
  ok(step > 0 && step < 0.02, `再往后一帧必须继续走且增量 ≈ 1/60，实测 ${step.toFixed(6)}`);
}));

test('静音是真停不是把 gain 拧到 0：静音之后的每次发声请求都不建节点', () => serial(async () => {
  const sh = await boot('mute');
  sh.el('closehelp').click();
  sh.tapDeck();
  sh.tapDeck();
  const live = sh.stair.sound();
  ok(live.nodes > 0 && live.plays > 0, `非静音时确实建了节点：${JSON.stringify(live)}`);
  sh.key('m');
  const muted = sh.stair.sound();
  eq([muted.nodes, muted.plays], [live.nodes, live.plays], '切换瞬间不新建节点');
  eq(muted.context, 'suspended', 'AudioContext 必须挂起');
  sh.tapDeck();
  sh.el('hint').click();
  sh.el('undo').click();
  const after = sh.stair.sound();
  eq([after.nodes, after.plays], [live.nodes, live.plays], '静音之后再玩，节点数增量必须为 0');
  ok(after.refusals > muted.refusals, `被挡掉的发声要数得出来：多出 ${after.refusals - muted.refusals} 次`);
  sh.key('m');
  sh.tapDeck();
  ok(sh.stair.sound().nodes > after.nodes, '取消静音之后必须真的又能发声');
}));

test('同一虚拟秒在 30/60/120Hz 得到同一张画面与同一个动画时钟（shell 级三档对拍）', () => serial(async () => {
  const rows = [];
  for (const hz of [30, 60, 120]) rows.push(await tier(hz));
  for (const m of MARKS) {
    const at = rows.map((t) => t.snaps[m]);
    ok(at.every(Boolean), `${m}s 检查站三档都要有读数`);
    eq(at.map((r) => r.animClock), at.map(() => +m.toFixed(9)), `animClock @${m}s 必须落在同一个虚拟秒`);
    eq(at.map((r) => r.picture), at.map(() => at[0].picture), `整幅重绘指纹 @${m}s 三档必须同图`);
    eq(at.map((r) => r.board), at.map(() => at[0].board), `棋盘 @${m}s 三档必须同局`);
    eq(at.map((r) => [r.moves, r.deals, r.hints, r.selected]),
      at.map(() => [at[0].moves, at[0].deals, at[0].hints, at[0].selected]), `操作计数 @${m}s 三档必须相同`);
    eq(at.map((r) => [r.nodes, r.plays, r.refusals, r.stops]),
      at.map(() => [at[0].nodes, at[0].plays, at[0].refusals, at[0].stops]), `发声计数 @${m}s 三档必须相同`);
    if (m === 2.5) {
      // 判尺不是空跑的哨兵：这一站必须真有一圈提示环在屏上，且相位写进了 strokeStyle。
      ok(at.every((r) => r.ringCount > 0), `2.5s 没有任何提示环上屏 ⇒ 画面指针对动画相位不敏感，判尺作废：${at.map((r) => r.ringCount).join('/')}`);
      eq(at.map((r) => r.ringPhase), at.map(() => at[0].ringPhase), `提示环相位（strokeStyle）@2.5s 三档必须同图`);
    }
    if (at[0].hintRaw > 0) {
      // 提示是在 1.8s 那一帧点亮的，倒计时天然带一档"采样滞后"：补掉 1/hz 之后三档必须同值。
      eq(at.map((r) => r.hintLeft), at.map(() => at[0].hintLeft), `hintLeft（补掉一帧采样滞后）@${m}s 三档必须相等`);
    } else {
      eq(at.map((r) => r.hintRaw), at.map(() => at[0].hintRaw), `hintLeft @${m}s 三档必须相等`);
    }
  }
  // 原始 hintLeft 的差必须是"一帧的采样滞后"，不是帧率依赖：30→60 的差要能在 60→120 减半。
  const raw = rows.map((t) => t.snaps[2.5].hintRaw);
  const d1 = raw[1] - raw[0];
  const d2 = raw[2] - raw[1];
  ok(raw[2] - raw[0] <= 1 / 30 + 1e-9, `三档 spread 必须 ≤ 最低档的一帧(1/30)：${(raw[2] - raw[0]).toFixed(6)}`);
  ok(Math.abs(2 * d2 - d1) < 1e-6, `帧率翻倍时滞后必须减半：d1=${d1.toFixed(6)} d2=${d2.toFixed(6)}`);
  eq(rows.map((t) => t.fired), [PLAN.length, PLAN.length, PLAN.length], '三档触发的事件条数必须相同');
}));

test('重开把动画累加器与高亮缓冲一起清零：attach 之后画面回到第 0 秒', () => serial(async () => {
  const sh = await boot('restart');
  sh.el('closehelp').click();
  sh.tapDeck();
  sh.el('hint').click();
  sh.tapPile(9);          // 一次不合法的点击，点亮拒绝闪烁
  for (let k = 1; k <= 48; k++) { sh.at(k / 60); sh.pump(); }
  const dirty = sh.stair.clock();
  ok(dirty.animClock > 0.6 && dirty.hintLeft > 0, `推进之后缓冲非零：${JSON.stringify(dirty)}`);
  sh.key('r');
  const after = sh.stair.clock();
  eq(after.animClock, 0, '重开必须把 animClock 归零');
  eq(after.hintLeft, 0, '提示高亮必须跟着消失');
  eq(sh.stair.state.moves, 0, '局面回到第 0 步');
}));

test('路由换牌局不换引擎：#/c、#/daily、#/random、#/lot 之后读数自洽且 par 可复算', () => serial(async () => {
  const sh = await boot('routes');
  sh.el('closehelp').click();
  const seen = [];
  for (const h of ['#/c/9', '#/daily', '#/random/linked/7kq2', '#/lot/linked-02']) {
    sh.hash = h;
    const st = sh.stair.state;
    ok(st.id, `${h} 之后必须有牌局`);
    eq([st.moves, st.hints, st.curtain], [0, 0, false], `${h} 是新一局`);
    const chk = sh.stair.reSolve();
    ok(chk.agrees, `${h} 的 par 必须能被本机重算复现：印着 ${st.par} 算出 ${chk.par}`);
    seen.push(`${st.id}:${st.n}:${st.par}`);
  }
  eq(new Set(seen).size, 4, `四次路由要拿到四个不同牌局：${seen.join(' / ')}`);

  // shelf 不是死标记：随机面板上的「换一副牌」按钮点下去必须真的换一副。
  sh.hash = '#/random/twined/kq77';
  const here = sh.stair.state.id;
  const reroll = sh.el('shelf').querySelector('[data-reroll]');
  ok(reroll, '随机面板要给出 data-reroll 按钮');
  reroll.click();
  ok(sh.stair.state.id !== here, `换一副牌要真的换牌局：${here} → ${sh.stair.state.id}`);
  eq(sh.stair.state.mode, 'random', '换牌之后还在随机档');
  const tiers = sh.el('shelf').querySelectorAll('button[data-tier]');
  ok(tiers.length >= 2, `难度按钮要能点：${tiers.length} 个`);
  const last = tiers[tiers.length - 1];
  last.click();
  eq(sh.stair.state.tier, last.dataset.tier, `点「${last.dataset.tier}」就切到那一段`);
}));

test('存档是真的往返：通关写进 localStorage，换一次引擎读回成绩与静音', () => serial(async () => {
  const disk = new Map();
  const sh = await boot('save-1', { storage: disk });
  sh.el('closehelp').click();
  sh.el('sound').click();                 // 走 toggleSound 才会把设置写进盘
  eq(sh.stair.state.muted, true, '先静音');
  const route = sh.stair.path();
  ok(route.length > 0, '本机搜索必须给出一条最优路线');
  const moves = sh.stair.play(route);
  const done = sh.stair.state;
  eq([done.done, done.moves, done.curtain], [true, route.length, true], `走完 ${moves} 步必须通关`);
  ok(done.unlocked > done.index, `通关要解锁下一关：${done.index} → ${done.unlocked}`);
  ok([...disk.keys()].some((k) => k.startsWith('staircase')), `存档要落到具名的键：${[...disk.keys()].join(',')}`);

  const again = await boot('save-2', { storage: disk });
  eq(again.stair.state.muted, true, '静音设置必须从盘上读回来');
  eq(again.stair.state.unlocked, done.unlocked, '解锁进度必须读回来');
  eq(again.stair.state.solved, done.solved, '通关数必须读回来');
  eq(again.stair.shell().settings.sound, false, 'settings.sound 落盘为 false');
  eq(again.stair.shell().dropped, 0, '自己写的存档不该丢记录');
  again.el('wipe').click();
  again.el('wipe').click();
  eq(again.stair.state.solved, 0, '两次点击清空之后成绩归零');
}));

await run();
