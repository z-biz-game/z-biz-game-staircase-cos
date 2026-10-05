// js/view.js 的时间与输入行为。这些不是字符串检查：每一行都喂真帧、真指针事件，
// 读回来的是累加器与命中堆号。对拍的原始数字在 commit 正文里。

import { test, ok, eq, run } from '../tools/harness.mjs';
import { createView } from '../js/view.js';
import { createGame, act, select, reset } from '../js/core/game.js';
import { levelAt } from '../js/core/library.js';

const CSS_BOX = { width: 880, height: 560, left: 40, top: 120 };

// 一个会把每一次 ctx 调用与每一次属性写入都记下来的 2D 上下文桩。
function makeCanvas(box = CSS_BOX, dpr = 2) {
  const log = [];
  const state = {};
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 42 });
      if (prop === 'createPattern') return () => ({ __pattern: true });
      if (prop === 'canvas') return canvas;
      if (prop in state) return state[prop];
      return (...args) => { log.push(`${String(prop)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`); };
    },
    set(_t, prop, value) { state[prop] = value; log.push(`${String(prop)}=${typeof value === 'number' ? value.toFixed(3) : String(value)}`); return true; },
  });
  const listeners = {};
  const canvas = {
    width: 0, height: 0, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height }),
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    _fire(type, ev) { for (const fn of listeners[type] || []) fn({ type, pointerId: 1, preventDefault() {}, ...ev }); },
    _log: log,
  };
  return canvas;
}

// rAF 完全由虚拟时钟驱动：帧号决定时间，墙钟不参与。`now` 只会往前走，
// 免得第二次 feed 把负 dt 喂进累加器（那会造出一条根本不存在的缺陷）。
function makeClock() {
  let queue = new Map();
  let id = 0;
  let now = 1000;
  globalThis.requestAnimationFrame = (cb) => { id++; queue.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = (i) => { queue.delete(i); };
  return {
    get now() { return now; },
    step(t) {
      now = t;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(now);
    },
    // 从当前时刻再喂 secs 秒。首帧（开局/恢复后的那一帧）不带前置时间戳，
    // 所以它不吃 dt —— 那是防跳步的哨兵，补偿由调用方按 1/hz 处理。
    feed(hz, secs, { firstFrameSentinel = false } = {}) {
      const stepMs = 1000 / hz;
      const frames = Math.round(hz * secs);
      if (firstFrameSentinel) this.step(now + stepMs);   // 吃掉哨兵帧，不计入时长
      for (let k = 1; k <= frames; k++) this.step(now + stepMs);
      return frames;
    },
  };
}

globalThis.window = globalThis;
globalThis.devicePixelRatio = 2;
globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, addListener() {} });

function openLot(i = 3, box = CSS_BOX) {
  const lot = levelAt(i);
  const game = createGame(lot);
  const picks = [];
  const actions = [];
  const canvas = makeCanvas(box);
  const view = createView(canvas, {
    onAction: (a) => { actions.push(a); act(game, a); },
    onPick: (i2) => { picks.push(i2); if (game.selected === null) select(game, i2); else act(game, { kind: 'merge', a: game.selected, b: i2 }); },
  });
  view.attach(game);
  view.measure();
  view.start();
  return { lot, game, canvas, view, picks, actions };
}

test('同一虚拟秒在 30/60/120Hz 收到同一个动画读数（dt 是唯一时间来源）', () => {
  const clock = makeClock();
  const T = 1.2;
  const PAUSE = 0.3;   // 600ms 起暂停 300ms：暂停期间不吃 dt，所以净推进是 T - PAUSE
  const rows = [30, 60, 120].map((hz) => {
    const { view } = openLot(3);
    view.showHint({ kind: 'deal' });
    view.flash('对拍');
    const stepMs = 1000 / hz;
    const frames = Math.round(hz * T);
    clock.step(1000);                     // 开局哨兵帧（区间之外）
    let atPause = 0;
    let atResume = 0;
    let sentinels = 0;
    for (let k = 1; k <= frames; k++) {
      const now = 1000 + k * stepMs;
      const elapsed = now - 1000;
      if (!atPause && elapsed >= 600) { view.setPaused(true); atPause = view.clock().animClock; }
      if (atPause && !atResume && elapsed >= 900) { view.setPaused(false); atResume = view.clock().animClock; sentinels = 1; }
      clock.step(now);
    }
    const c = view.clock();
    return {
      hz,
      anim: +(c.animClock + sentinels / hz).toFixed(9),
      hint: +(c.hintLeft - sentinels / hz).toFixed(9),
      flash: +(c.flashLeft - sentinels / hz).toFixed(9),
      frozen: +(atResume - atPause).toFixed(9),
    };
  });
  // 净推进 = 1.2 - 0.3 = 0.9；提示 2.4 与拒绝 1.6 的倒计时同步少算 0.3。
  for (const r of rows) {
    eq(r.anim, 0.9, `animClock @${r.hz}Hz 必须落在 0.9 虚拟秒`);
    eq(r.hint, 1.5, `hintLeft @${r.hz}Hz`);
    eq(r.flash, 0.7, `flashLeft @${r.hz}Hz`);
    eq(r.frozen, 0, `暂停窗口 @${r.hz}Hz 不许推进`);
  }
});

test('把动画时钟的 dt 换成常量，三档立刻分家（判尺不是空跑）', () => {
  // 变异实测：真仓三档全等（上一条），把 `animClock += dt` 钉成 += 0.016666 之后
  // 30/60/120Hz 分别得到 0.4666/0.9166/1.8166 —— 差 1.35 秒。这里用同样的时间源
  // 断言"帧数 × 常量"必然随帧率走，钉住这条判据本身有效。
  const perFrame = 0.016666;
  const at = (hz) => Math.round(hz * 1.2) * perFrame;
  ok(Math.abs(at(120) - at(30)) > 1.3, '常量步长必须让 30Hz 与 120Hz 分家');
  const dt = (hz) => Math.round(hz * 1.2) / hz;
  eq(dt(30), dt(120), '同一虚拟时长下按 dt 积分必须相等');
});

test('暂停期间仿真不推进，恢复后从冻住的那一刻继续', () => {
  const clock = makeClock();
  const { view, game } = openLot(3);
  act(game, { kind: 'deal' });
  clock.step(1000);
  for (let k = 1; k <= 30; k++) clock.step(1000 + k * (1000 / 60));   // 0.5s
  const beforePause = view.clock().animClock;
  view.setPaused(true);
  for (let k = 31; k <= 90; k++) clock.step(1000 + k * (1000 / 60));  // 暂停 1.0s
  const duringPause = view.clock().animClock;
  eq(duringPause, beforePause, '暂停 1.0 虚拟秒，动画时钟必须一动不动');
  view.setPaused(false);
  clock.step(1000 + 91 * (1000 / 60));   // 恢复后的第一帧：哨兵，dt=0，不许吃掉暂停期间的墙钟
  eq(view.clock().animClock, beforePause, '恢复帧不得把暂停期间的 1 秒补回来');
  clock.step(1000 + 92 * (1000 / 60));
  ok(view.clock().animClock > beforePause, '再往后一帧必须继续走');
  ok(view.clock().animClock - beforePause < 0.05, `恢复后单帧增量 ≈ 1/60，实测 ${view.clock().animClock - beforePause}`);
});

test('reduceMotion 是真的分支：关掉之后画面不再随动画时钟变化', () => {
  const clock = makeClock();
  const phaseLog = (reduced) => {
    const { view, canvas } = openLot(3);
    view.setReducedMotion(reduced);
    view.showHint({ kind: 'merge', a: 0, b: 1 });   // 会呼吸的高亮环只在提示活着时绘制（2.4s 倒数）
    canvas._log.length = 0;
    const runs = [];
    for (const [i, d] of [0, 0.37, 0.34].entries()) {
      clock.feed(60, d, { firstFrameSentinel: i === 0 });   // 开局那一帧不吃 dt，之后每帧都算
      canvas._log.length = 0;
      view.redraw();
      runs.push({ at: view.clock().animClock, log: canvas._log.join(';') });
    }
    return runs;
  };
  const reduced = phaseLog(true);
  ok(reduced[1].at > 0.3 && reduced[2].at > 0.6, `动画时钟确实在走：${reduced.map((r) => r.at.toFixed(3)).join('/')}`);
  eq(reduced[1].log, reduced[0].log, 'reduced-motion 下相位必须画出同一张图');
  eq(reduced[2].log, reduced[0].log, 'reduced-motion 下相位必须画出同一张图');
  const moving = phaseLog(false);
  ok(new Set(moving.map((r) => r.log)).size > 1, '不降级时同一张图必须随时钟变（否则上一条是空断言）');
});

test('指针命中按 CSS 缩放换算：CSS 尺寸缩一半、DPR 拉高，点第 i 堆还是第 i 堆', () => {
  const box = { width: 440, height: 280, left: 300, top: 90 };   // 真机上的 CSS 盒，与后备像素无关
  globalThis.devicePixelRatio = 3;
  const canvas = makeCanvas(box, 3);
  const game = createGame(levelAt(5));
  const picked = [];
  const view = createView(canvas, { onAction: () => {}, onPick: (i) => picked.push(i) });
  view.attach(game);
  view.measure();
  const geom = view.geometry();
  eq([canvas.width, canvas.height], [Math.round(box.width * 3), Math.round(box.height * 3)], '后备 store 按 DPR 放大');
  for (const i of [0, 1, 2]) {
    const pt = view.pilePoint(i);
    ok(pt, `第 ${i} 堆要有命中点`);
    ok(pt.x >= box.left && pt.x <= box.left + box.width && pt.y >= box.top && pt.y <= box.top + box.height,
      `pilePoint(${i}) 必须落在 CSS 盒内（客户端坐标），实测 ${pt.x},${pt.y}`);
    canvas._fire('pointerdown', { clientX: pt.x, clientY: pt.y });
    canvas._fire('pointerup', { clientX: pt.x, clientY: pt.y });
  }
  eq(picked, [0, 1, 2], '三次点击必须依次命中 0/1/2 堆');
  // 越界点击：盒外的一个点不许命中任何堆
  canvas._fire('pointerdown', { clientX: box.left - 200, clientY: box.top - 200 });
  canvas._fire('pointerup', { clientX: box.left - 200, clientY: box.top - 200 });
  eq(picked.length, 3, '画布外的点击不许选中任何堆');
  globalThis.devicePixelRatio = 2;
});

test('重开把时钟、缓冲、玩家位置一起复位：动画与局面都回到第 0 秒', () => {
  const clock = makeClock();
  const { view, game, lot } = openLot(4);
  act(game, { kind: 'deal' });
  act(game, { kind: 'deal' });
  select(game, 0);
  view.showHint({ kind: 'deal' });
  view.flash('对拍');
  clock.feed(60, 0.8);
  const dirty = view.clock();
  ok(dirty.animClock > 0.5 && dirty.hintLeft > 0 && dirty.flashLeft > 0, `推进后三个缓冲都非零：${JSON.stringify(dirty)}`);
  const fresh = reset(createGame(lot));
  eq([fresh.moves, fresh.deals, fresh.selected], [0, 0, null], '核心局面复位');
  view.attach(fresh);          // 换关/重开走的同一条路：attach 必须顺手把动画累加器清零
  const after = view.clock();
  eq(after.animClock, 0, 'animClock 必须归零');
  eq(after.hintLeft, 0, '提示高亮必须跟着消失');
  eq(after.flashLeft, 0, '拒绝闪烁必须跟着消失');
});

test('没有 PointerEvent 时 touch/mouse 落到同一条命中路径，有 PointerEvent 时不许双触发', () => {
  // 用 shoal-05：开局是 6 个单张堆，0/1/2 三堆都真实存在（shoal-04 只有一整垛）。
  const openNoPointer = () => {
    delete globalThis.PointerEvent;
    return openLot(4);
  };
  const { view, canvas, game, picks } = openNoPointer();
  const touch = (type, pt, list = 'touches') => canvas._fire(type, {
    [list]: [{ clientX: pt.x, clientY: pt.y }],
    changedTouches: [{ clientX: pt.x, clientY: pt.y }],
  });
  const before = game.piles.length;
  const p0 = view.pilePoint(0);
  const p1 = view.pilePoint(1);
  touch('touchstart', p0);
  touch('touchend', p0, 'changedTouches');
  touch('touchstart', p1);
  touch('touchend', p1, 'changedTouches');
  eq(picks, [0, 1], '两次触摸必须落到 0/1 堆');
  eq([game.moves, game.piles.length, game.piles.reduce((a, b) => a + b, 0)], [1, before - 1, 6],
    `两次触摸必须真的并掉一堆：${JSON.stringify(game.piles)}`);

  canvas._fire('mousedown', { clientX: p0.x, clientY: p0.y });
  canvas._fire('mouseup', { clientX: p0.x, clientY: p0.y });
  eq(picks, [0, 1, 0], '鼠标点击走同一个 pick()');

  globalThis.PointerEvent = function PointerEvent() {};
  const withPointer = openLot(4);
  const q0 = withPointer.view.pilePoint(0);
  touch.call(null, 'touchstart', q0);
  touch.call(null, 'touchend', q0, 'changedTouches');
  eq(withPointer.picks, [], '支持 pointer 的引擎里 touch 必须被完全忽略');
  withPointer.canvas._fire('pointerdown', { clientX: q0.x, clientY: q0.y, pointerId: 1 });
  withPointer.canvas._fire('pointerup', { clientX: q0.x, clientY: q0.y, pointerId: 1 });
  eq(withPointer.picks, [0], '一次 pointer 点击命中一次，不多不少');
});

test('窄屏一排放不下就换行：每列命中宽度 ≥44px，跨行的堆照样点得着、拆得对', () => {
  // 343px 是 iPhone SE 去掉 body 左右 padding 的画布宽。修前 master-07（19 堆）在这里
  // 只有 15.6px 一列，27 关里 20 关不足 44px；换行之后列宽下限 44.4px。
  const NARROW = { width: 343, height: 700, left: 0, top: 0 };
  const lot = levelAt(26);                 // master-07：28 张 19 堆，最挤的一张
  const game = createGame(lot);
  const picks = [];
  const actions = [];
  const canvas = makeCanvas(NARROW);
  const view = createView(canvas, { onAction: (a) => actions.push(a), onPick: (i) => picks.push(i) });
  view.attach(game);
  const g = view.geometry();
  ok(g.rows >= 2, `19 堆在 343px 必须换行（rows=${g.rows} columns=${g.columns}）`);
  ok(g.slot >= 44, `换行之后每列命中宽度必须 ≥44px（实测 ${g.slot.toFixed(1)}）`);
  for (let i = 0; i < game.piles.length; i++) {
    const p = view.pilePoint(i);
    ok(p.x >= 0 && p.x <= NARROW.width && p.y >= 0 && p.y <= NARROW.height,
      `第 ${i} 堆中心必须落在画布内（x=${p.x} y=${p.y}）`);
    canvas._fire('pointerdown', { clientX: p.x, clientY: p.y, pointerId: 1 });
    canvas._fire('pointerup', { clientX: p.x, clientY: p.y, pointerId: 1 });
    eq(picks[picks.length - 1], i, `点第 ${i} 堆必须命中第 ${i} 堆（${JSON.stringify(game.piles)}）`);
  }
  eq(picks.length, game.piles.length, '一堆都不许多点出来');
  // 拖拽拆堆的阈值按"该堆所在行的露出带"算，不是按第一行算。
  const i = game.piles.findIndex((sz) => sz >= 2);
  ok(i >= 0, '必须有一垛至少 2 张才谈得上拆');
  const step = view.geometry().step;
  const cp = view.cardPoint(i, 1);
  canvas._fire('pointerdown', { clientX: cp.x, clientY: cp.y, pointerId: 1 });
  canvas._fire('pointermove', { clientX: cp.x, clientY: cp.y + step, pointerId: 1 });
  canvas._fire('pointerup', { clientX: cp.x, clientY: cp.y + step, pointerId: 1 });
  eq(actions[actions.length - 1], { kind: 'split', i, j: 1 }, '拖第 2 张必须拆出 j=1');
});

test('拆堆改变牌堆数之后几何必须重算：新增的堆画在界内、也点得到', () => {
  // shoal-02 开局只有 3 堆，measure() 按 4 列铺；连拆三次变 6 堆，不重算就会把整堆画到画布外
  // （修前实测 343px 宽下第 6 堆中心 x=504，越界 161px；900px 宽下 x=1379，越界 479px）。
  const NARROW = { width: 343, height: 560, left: 0, top: 0 };
  const { game, view, canvas, picks } = openLot(1, NARROW);
  const n0 = game.piles.length;
  let split = 0;
  while (split < 3) {
    const i = game.piles.findIndex((sz) => sz >= 2);
    if (i < 0) break;
    act(game, { kind: 'split', i, j: 1 });
    split += 1;
    view.redraw();          // js/main.js 的 commit() 走的就是这条路：只 redraw，不 measure
  }
  eq([split, game.piles.length > n0], [3, true], `必须真的把牌堆数拆大（${n0}→${game.piles.length}）`);
  const g = view.geometry();
  eq(g.count, game.piles.length, `几何必须按新的堆数重算：geom.count=${g.count} 堆数=${game.piles.length}`);
  ok(g.slot < NARROW.width / game.piles.length + 1, `列宽必须收窄到放得下：slot=${g.slot}`);
  for (let i = 0; i < game.piles.length; i++) {
    const p = view.pilePoint(i);
    ok(p && p.x >= 0 && p.x <= NARROW.width, `第 ${i} 堆中心 x=${p && p.x} 必须落在画布 [0,${NARROW.width}] 内`);
    canvas._fire('pointerdown', { clientX: p.x, clientY: p.y, pointerId: 1 });
    canvas._fire('pointerup', { clientX: p.x, clientY: p.y, pointerId: 1 });
    eq(picks[picks.length - 1], i, `点第 ${i} 堆的必须命中第 ${i} 堆（实到 ${picks[picks.length - 1]}）`);
  }
});

run();
