// Sound. One rule decides whether this file is honest: 静音必须是真停，不是把 gain 拧到 0。
//
// `muted` therefore does two things — `AudioContext.suspend()` (the clock stops, nothing is
// scheduled) and `play()` returns before a single oscillator node is created. `nodes` counts
// every oscillator this module has ever built, so "静音态不再建节点" is a number a harness can
// read, not a claim in a comment.
//
// The context is created on the first gesture that asks for sound: browsers refuse an
// AudioContext built before one, and node has no WebAudio at all — both cases degrade to
// silence instead of throwing.

const VOICES = {
  deal: { from: 392, to: 523, dur: 0.17, type: 'triangle', gain: 0.15 },
  merge: { from: 294, to: 392, dur: 0.13, type: 'sine', gain: 0.12 },
  split: { from: 587, to: 392, dur: 0.12, type: 'sine', gain: 0.10 },
  deny: { from: 165, to: 110, dur: 0.18, type: 'square', gain: 0.06 },
  win: { from: 523, to: 1046, dur: 0.55, type: 'triangle', gain: 0.18 },
  ui: { from: 240, to: 240, dur: 0.05, type: 'sine', gain: 0.05 },
};

export const SOUND_KEYS = Object.keys(VOICES);

export function createAudio({ muted = false, factory = null } = {}) {
  let ctx = null;
  let master = null;
  let isMuted = !!muted;
  let nodes = 0;          // 建过的振荡器总数：静音时的增量必须为 0
  let plays = 0;          // 真正发声的次数
  let refusals = 0;       // 因为静音被挡掉的次数
  let stops = 0;          // suspend/resume 的切换次数

  function defaultFactory() {
    const AC = typeof AudioContext !== 'undefined' ? AudioContext
      : (typeof window !== 'undefined' && (window.webkitAudioContext || window.AudioContext));
    if (!AC) return null;
    return new AC();
  }

  function ensure() {
    if (ctx || isMuted) return ctx;
    ctx = (factory || defaultFactory)();
    if (!ctx) return null;
    master = ctx.createGain ? ctx.createGain() : null;
    if (master) {
      master.gain.value = 0.9;
      if (ctx.destination && master.connect) master.connect(ctx.destination);
    }
    // 新建的 context 在部分浏览器里以 suspended 起步（自动播放策略），补一次 resume。
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  function voice(name) {
    return VOICES[name] || VOICES.ui;
  }

  function play(name = 'ui') {
    const v = voice(name);
    if (isMuted) {
      refusals += 1;
      return { ok: false, reason: 'muted', nodes };
    }
    const c = ensure();
    if (!c || !c.createOscillator) return { ok: false, reason: 'no-audio-context', nodes };
    if (c.state === 'suspended' && c.resume) c.resume();
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    nodes += 1;
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.from, t0);
    if (v.to !== v.from && osc.frequency.exponentialRampToValueAtTime) {
      osc.frequency.exponentialRampToValueAtTime(v.to, t0 + v.dur);
    }
    const g = c.createGain ? c.createGain() : null;
    if (g) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v.gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
      osc.connect(g);
      if (master) g.connect(master);
      else if (c.destination) g.connect(c.destination);
    } else if (c.destination) {
      osc.connect(c.destination);
    }
    osc.start(t0);
    osc.stop(t0 + v.dur + 0.02);
    plays += 1;
    return { ok: true, name, nodes, at: t0 };
  }

  // 暂停：声音跟着仿真一起停，恢复时接着用同一个 context。
  function hold(on) {
    if (!ctx) return { ok: false, reason: on ? 'no-context' : 'already-running', state: ctx && ctx.state };
    if (on) {
      if (ctx.suspend && ctx.state === 'running') { ctx.suspend(); stops += 1; }
    } else if (!isMuted) {
      if (ctx.resume && ctx.state === 'suspended') { ctx.resume(); stops += 1; }
    }
    return { ok: true, state: ctx.state, muted: isMuted };
  }

  function setMuted(next) {
    const want = !!next;
    if (want === isMuted) return { ok: true, muted: isMuted, state: ctx && ctx.state, unchanged: true };
    isMuted = want;
    if (want) {
      // 先挂起再返回：静音之后这里一个节点都不会再建。
      if (ctx && ctx.suspend && ctx.state === 'running') { ctx.suspend(); stops += 1; }
    } else if (ctx) {
      if (ctx.resume && ctx.state === 'suspended') { ctx.resume(); stops += 1; }
    }
    return { ok: true, muted: isMuted, state: ctx ? ctx.state : 'none' };
  }

  return {
    play,
    hold,
    setMuted,
    get muted() { return isMuted; },
    // 静音开关的两个别名：调用方不必知道内部怎么存。
    mute: () => setMuted(true),
    unmute: () => setMuted(false),
    toggleMute: () => setMuted(!isMuted),
    get sfxEnabled() { return !isMuted; },
    state() {
      return {
        muted: isMuted,
        nodes,
        plays,
        refusals,
        stops,
        context: ctx ? ctx.state : 'none',
      };
    },
  };
}
