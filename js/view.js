// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing about the rules: on release it hands js/main.js the operation the finger asked
// for ({deal} / {merge a,b} / {split i,j}), and js/core/solve.js is the only thing that can
// say yes or no. A pile can therefore be highlighted wrong for a frame; it can never be
// moved illegally.
//
// Zero image assets: every card is a rounded rectangle drawn here, sized by the element box
// and multiplied by devicePixelRatio so the text stays crisp on a phone.

const PAD = 16;
const DECK = 0.78; // deck block width, in card widths
const STRIP = 46; // the target row across the top
const CARD = ['#2f4b63', '#6b4046', '#3f6046', '#6d5a34', '#4a3f68', '#2f5f5c', '#63493a', '#3d4a63',
  '#5c4055', '#47563f', '#6a5560', '#3a5560'];
const BG = '#14161a';
const FELT = '#1b1f26';
const EDGE = 'rgba(226, 232, 240, 0.10)';
const GOLD = '#e0a63c';
const GLOW = 'rgba(224, 166, 60, 0.6)';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createView(canvas, { onAction, onPick } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  let target = [];
  let geom = null;
  let drag = null; // { i, j, from, along, split }
  let flash = null; // { kind, until } — a refusal or a landed deal
  let hintAt = null; // { i, j, until }
  let raf = 0;
  let last = 0;

  // ---- geometry --------------------------------------------------------------------
  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(240, Math.round(box.width));
    const H = Math.max(240, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game) { geom = null; return; }
    const piles = game.piles;
    const slots = Math.max(4, piles.length + 1);
    const usable = W - PAD * 2;
    const slot = usable / slots;
    const cardW = Math.max(22, Math.floor(Math.min(slot * 0.82, (H - STRIP - PAD * 2) / 1.4)));
    const cardH = Math.round(cardW * 1.38);
    const ox = Math.round(PAD + slot * DECK + (slot - cardW) / 2);
    const oy = STRIP + PAD;
    const tallest = Math.max(...piles, ...target, 1);
    const room = Math.max(cardH + 4, H - oy - PAD - cardH);
    const step = Math.max(6, Math.min(Math.round(cardH * 0.42), Math.floor(room / Math.max(1, tallest - 1))));
    geom = {
      W, H, slot, cardW, cardH, ox, oy, step,
      deckX: Math.round(PAD + (slot * DECK - cardW) / 2),
      deckW: cardW,
      deckY: oy,
      piles,
    };
    draw();
  }

  function localPoint(ev) {
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  // Client-space pixels for a pile/card/deck — the same mapping the hit test reads, run
  // backwards, so an automated finger presses what a player would aim at.
  function toClient(x, y) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.round(box.left + x), y: Math.round(box.top + y) };
  }

  function cardTop(i, j) {
    return geom.oy + j * geom.step;
  }

  // The centre of the part of card j that is actually visible: cards overlap by design, so a
  // finger can only land on the exposed band (plus the whole of the last card). `hit()` maps
  // a point to a band and `cardPoint()` returns that band's centre — if those two ever
  // disagree, a split drag lands on the wrong card.
  function cardMid(i, j) {
    const size = game.piles[i];
    return j < size - 1 ? cardTop(i, j) + geom.step / 2 : cardTop(i, size - 1) + geom.cardH / 2;
  }

  function pileX(i) {
    return geom.ox + i * geom.slot;
  }

  // Which pile/card a point is over. The topmost card wins on the overlap, and a pile's
  // exposed sliver counts as its own card.
  function hit(p) {
    if (!geom || !game) return null;
    if (p.x >= geom.deckX && p.x <= geom.deckX + geom.deckW
      && p.y >= geom.deckY && p.y <= geom.deckY + geom.cardH) return { deck: true };
    const i = Math.floor((p.x - geom.ox + (geom.slot - geom.cardW) / 2) / geom.slot);
    if (i < 0 || i >= game.piles.length) return null;
    const size = game.piles[i];
    const bottom = cardTop(i, size - 1) + geom.cardH;
    if (p.y < geom.oy || p.y > bottom) return null;
    let j = Math.floor((p.y - geom.oy) / geom.step);
    j = Math.max(0, Math.min(size - 1, j));
    return { i, j, size };
  }

  // ---- input -----------------------------------------------------------------------
  function down(ev) {
    if (!game || game.done) return;
    const p = localPoint(ev);
    const h = hit(p);
    if (!h) return;
    if (h.deck) {
      drag = { deck: true, from: p };
      ev.preventDefault();
      return;
    }
    drag = { i: h.i, j: h.j, grab: h.j, size: h.size, from: p, along: 0, split: 0 };
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
    }
    ev.preventDefault();
    draw();
  }

  function move(ev) {
    if (!drag || drag.deck) return;
    const p = localPoint(ev);
    drag.along = p.y - drag.from.y;
    // Cosmetic only: the cut is the card the finger grabbed, and grabbing the top card
    // would carve off nothing. js/core/solve.js applies the real rule.
    drag.split = drag.along > Math.max(6, geom.step * 0.5) && drag.grab >= 1 ? drag.grab : 0;
    ev.preventDefault();
  }

  function up(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (ev) ev.preventDefault();
    if (d.deck) {
      if (onAction) onAction({ kind: 'deal' });
      return;
    }
    if (d.split >= 1 && onAction) {
      onAction({ kind: 'split', i: d.i, j: d.split });
      return;
    }
    if (onPick) onPick(d.i);
  }

  // ---- drawing ---------------------------------------------------------------------
  function drawCard(x, y, w, h, i, lifted) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = lifted ? 14 : 5;
    ctx.shadowOffsetY = lifted ? 6 : 2;
    ctx.fillStyle = CARD[i % CARD.length];
    roundRect(ctx, x, y, w, h, Math.round(w * 0.14));
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(240, 244, 250, 0.10)';
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, Math.round(w * 0.11));
    ctx.fill();
    ctx.strokeStyle = 'rgba(12, 16, 22, 0.55)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.round(w * 0.14));
    ctx.stroke();
  }

  function drawTargetStrip() {
    const { W, cardW } = geom;
    const scale = Math.min(0.5, (W - PAD * 2) / (cardW * (target.reduce((a, b) => a + b, 0) + target.length)));
    const w = Math.max(8, Math.round(cardW * scale));
    const h = Math.round(w * 1.38);
    ctx.fillStyle = EDGE;
    ctx.fillRect(PAD, 6, W - PAD * 2, STRIP - 12);
    ctx.font = `${Math.max(10, Math.round(h * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
    ctx.fillText('目标', PAD + 6, 6 + (STRIP - 12) / 2);
    let x = PAD + 6 + ctx.measureText('目标').width + 10;
    for (const size of target) {
      for (let j = 0; j < size; j++) {
        const y = Math.max(6, STRIP - 8 - h - (size - 1 - j) * Math.max(2, h * 0.16));
        ctx.fillStyle = 'rgba(226, 232, 240, 0.22)';
        roundRect(ctx, x, y, w, h, 3);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(226, 232, 240, 0.7)';
      ctx.fillText(String(size), x, STRIP - 10);
      x += w + 6;
    }
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.textAlign = 'right';
    ctx.fillText(`${game.n} 张 · par ${game.lot.par} · 只发牌 ${game.lot.steps}`, W - PAD - 6, STRIP / 2);
    ctx.textAlign = 'left';
  }

  function drawDeck() {
    const { deckX, deckY, deckW, cardH } = geom;
    const grabbed = drag && drag.deck;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = grabbed ? 16 : 6;
    ctx.shadowOffsetY = grabbed ? 7 : 3;
    ctx.fillStyle = grabbed ? '#2a4a5e' : '#204153';
    roundRect(ctx, deckX, deckY + (grabbed ? -3 : 0), deckW, cardH, Math.round(deckW * 0.14));
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = GLOW;
    ctx.lineWidth = 2;
    roundRect(ctx, deckX + 0.5, deckY + (grabbed ? -3 : 0) + 0.5, deckW - 1, cardH - 1, Math.round(deckW * 0.14));
    ctx.stroke();
    ctx.fillStyle = 'rgba(240, 244, 250, 0.9)';
    ctx.font = `${Math.max(11, Math.round(cardH * 0.2))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('发牌', deckX + deckW / 2, deckY + cardH * 0.42);
    ctx.font = `${Math.max(10, Math.round(cardH * 0.16))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.6)';
    ctx.fillText(`已发 ${game.deals}`, deckX + deckW / 2, deckY + cardH * 0.72);
    ctx.textAlign = 'left';
  }

  function drawPile(i, size) {
    const { cardW, cardH, step } = geom;
    const x = pileX(i);
    const selected = game.selected === i;
    const hinted = hintAt && hintAt.i === i && performance.now() < hintAt.until;
    const dragging = drag && drag.i === i && drag.split >= 1;
    const cut = dragging ? drag.split : -1;
    for (let j = 0; j < size; j++) {
      const y = cardTop(i, j) + (cut >= 0 && j >= cut ? Math.min(18, drag.along * 0.35) : 0);
      drawCard(x, y, cardW, cardH, i, selected || (hinted || false) || (cut >= 0 && j === cut));
      if (j === size - 1) {
        ctx.fillStyle = 'rgba(240, 244, 250, 0.92)';
        ctx.font = `${Math.max(11, Math.round(cardW * 0.42))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(size), x + cardW / 2, y + cardH * 0.55);
        ctx.textAlign = 'left';
      }
    }
    if (selected) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.5;
      roundRect(ctx, x - 3, geom.oy - 3, cardW + 6, (size - 1) * step + cardH + 6, Math.round(cardW * 0.16));
      ctx.stroke();
    }
    if (hinted) {
      const t = (performance.now() % 900) / 900;
      ctx.strokeStyle = `rgba(120, 220, 255, ${(0.85 - t * 0.5).toFixed(3)})`;
      ctx.lineWidth = 2 + t * 4;
      roundRect(ctx, x - 4 - t * 5, geom.oy - 4 - t * 5, cardW + 8 + t * 10, (size - 1) * step + cardH + 8 + t * 10, Math.round(cardW * 0.18));
      ctx.stroke();
    }
    if (cut >= 0) {
      // The cut line: where the pile would separate if the finger let go here.
      const y = cardTop(i, cut) - Math.max(3, step * 0.35) + Math.min(18, drag.along * 0.35);
      ctx.strokeStyle = GLOW;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + cardW + 4, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function draw() {
    if (!geom) return;
    const { W, H } = geom;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (!game) return;
    ctx.fillStyle = FELT;
    roundRect(ctx, 6, STRIP - 6, W - 12, H - STRIP, 12);
    ctx.fill();
    drawTargetStrip();
    drawDeck();
    for (let i = 0; i < game.piles.length; i++) drawPile(i, game.piles[i]);
    if (game.done) {
      ctx.fillStyle = 'rgba(224, 166, 60, 0.16)';
      roundRect(ctx, 6, STRIP - 6, W - 12, H - STRIP, 12);
      ctx.fill();
      ctx.fillStyle = GOLD;
      ctx.font = `${Math.max(14, Math.round(geom.cardW * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('阶梯已成', W / 2, H - 22);
      ctx.textAlign = 'left';
    }
    if (flash && performance.now() < flash.until) {
      ctx.fillStyle = 'rgba(255, 120, 120, 0.9)';
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(flash.kind, PAD, H - 12);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (last || now));
    last = now;
    void dt;
    if (drag || (hintAt && now < hintAt.until) || (flash && now < flash.until)) draw();
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    attach(next) {
      game = next;
      target = next && next.target ? next.target.slice() : [];
      drag = null;
      hintAt = null;
      measure();
    },
    measure,
    redraw: draw,
    geometry() { return geom ? { slot: geom.slot, cardW: geom.cardW, cardH: geom.cardH, step: geom.step, ox: geom.ox, oy: geom.oy, W: geom.W, H: geom.H } : null; },
    // Client-space centre of pile i, and of card j inside it: what an automated finger needs.
    pilePoint(i) {
      if (!geom || !game || i < 0 || i >= game.piles.length) return null;
      const size = game.piles[i];
      return {
        ...toClient(pileX(i) + geom.cardW / 2, cardTop(i, size - 1) + geom.cardH / 2),
        cell: geom.cardW, size, step: geom.step,
      };
    },
    cardPoint(i, j) {
      if (!geom || !game || i < 0 || i >= game.piles.length) return null;
      const jj = Math.max(0, Math.min(game.piles[i] - 1, j));
      return {
        ...toClient(pileX(i) + geom.cardW / 2, cardMid(i, jj)),
        cell: geom.cardW, j: jj, size: game.piles[i], step: geom.step,
      };
    },
    deckPoint() {
      if (!geom) return null;
      return { ...toClient(geom.deckX + geom.deckW / 2, geom.deckY + geom.cardH / 2), cell: geom.deckW };
    },
    showHint(action) {
      if (!action) return;
      if (action.kind === 'split') hintAt = { i: action.i, j: action.j, until: performance.now() + 2400 };
      else if (action.kind === 'merge') hintAt = { i: action.a, j: action.b, until: performance.now() + 2400 };
      else hintAt = { i: -1, j: -1, until: performance.now() + 2400 };
      draw();
    },
    flash(reason) {
      flash = { kind: reason || '不合法', until: performance.now() + 1600 };
      draw();
    },
    start() {
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}
