#!/usr/bin/env python3
"""gen_art.py —— 本仓美术资产的母本生成器（只用 python3 标准库）。

视觉母题：阶梯本身就是这游戏的真相 —— 牌数是三角数 T_k 时反复发牌必然收敛到
(k, k-1, …, 1)，所以图标画的就是那座楼梯：左高右低的五段牌垛，最左一段镀金，
因为它就是"发牌"那一步造出来的新堆。台面用同一块毛毡：图标、画布、社交卡共用
一套令牌（css/game.css 的 --bg/--panel/--gold/--ink 与 js/view.js 的 CARD[]），
不凭空编色。

为什么手写 PNG 而不用 Pillow：package.json 承诺零依赖，CI 里 pip 装 Pillow 会给
这条承诺打洞；zlib + struct 足够写出合规 PNG，而且同一份代码在任何 python3 上
产出**逐字节相同**的文件 —— 资产因此是可审计的（`--verify` 重画一遍并与盘上比字节）。

用法:
  python3 assets/gen/gen_art.py            # 画全部资产进仓
  python3 assets/gen/gen_art.py --verify   # 只校验盘上资产能否被重画复现（不落盘）
"""
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# ------------------------------------------------------------------ 调色板（仓内实测令牌）
BG = (20, 22, 26)           # --bg        #14161a
PANEL = (27, 31, 38)        # --panel     #1b1f26
INK = (227, 232, 240)       # --ink       #e3e8f0
MUTED = (154, 165, 180)     # --muted     #9aa5b4
GOLD = (224, 166, 60)       # --gold      #e0a63c
GOLD_DARK = (169, 119, 33)  # --gold-dark #a97721
DEEP = (9, 11, 14)          # 比 --bg 更暗一档，给径向底收边
DECK = (32, 65, 83)         # view.js 里发牌块的底色 #204153
CARDS = [(47, 75, 99), (107, 64, 70), (63, 96, 70), (109, 90, 52), (74, 63, 104), (47, 95, 92),
         (99, 73, 58), (61, 74, 99), (92, 64, 85), (71, 86, 63), (106, 85, 96), (58, 85, 96)]


def mix(a, b, t):
    return (int(a[0] + (b[0] - a[0]) * t + 0.5),
            int(a[1] + (b[1] - a[1]) * t + 0.5),
            int(a[2] + (b[2] - a[2]) * t + 0.5))


def shade(c, f):
    return (min(255, int(c[0] * f + 0.5)), min(255, int(c[1] * f + 0.5)), min(255, int(c[2] * f + 0.5)))


def noise_table(n=4096, seed=1, lo=0.0, hi=1.0):
    """确定性 LCG 噪声表。资产必须可复现，所以不用 random、更不用时间做种。"""
    s = seed & 0x7FFFFFFF
    out = []
    span_ = hi - lo
    for _ in range(n):
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        out.append(lo + span_ * (s / float(0x7FFFFFFF)))
    return out


class Canvas:
    """RGB(A) 光栅。形状边缘按解析覆盖度混合，所以是真正的抗锯齿而不是采样糊。"""

    def __init__(self, w, h, rgba=False, fill=None):
        self.w, self.h = w, h
        self.rgb = bytearray(w * h * 3)
        self.alpha = bytearray(b'\xff' * (w * h)) if rgba else None
        if fill:
            self.fill_solid(fill)

    def fill_solid(self, col):
        self.rgb = bytearray(bytes(col[:3]) * (self.w * self.h))
        if self.alpha is not None:
            a = col[3] if len(col) == 4 else 255
            self.alpha = bytearray([a] * (self.w * self.h))

    def blend(self, x, y, col, a=255):
        if a <= 0 or x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = y * self.w + x
        if self.alpha is not None:
            self.alpha[i] = min(255, self.alpha[i] + int(a))
        p = i * 3
        if a >= 254:
            self.rgb[p], self.rgb[p + 1], self.rgb[p + 2] = col[0], col[1], col[2]
        else:
            k = a / 255.0
            inv = 1.0 - k
            self.rgb[p] = int(self.rgb[p] * inv + col[0] * k + 0.5)
            self.rgb[p + 1] = int(self.rgb[p + 1] * inv + col[1] * k + 0.5)
            self.rgb[p + 2] = int(self.rgb[p + 2] * inv + col[2] * k + 0.5)

    def span(self, y, xa, xb, col, a=255):
        """一行 [xa, xb) 的水平条带，端点按亚像素覆盖度混合。"""
        if y < 0 or y >= self.h or xb <= xa or a <= 0:
            return
        if xa < 0:
            xa = 0.0
        if xb > self.w:
            xb = float(self.w)
        if xb <= xa:
            return
        ix, fx = int(xa), int(xb)
        ci = ix if xa == ix else ix + 1          # ceil
        fl = fx                                    # floor
        if xa < ci:
            self.blend(ix, y, col, a * (ci - xa))
        if fl < xb:
            self.blend(fx, y, col, a * (xb - fx))
        if fl <= ci:
            return
        n = fl - ci
        if a >= 254:
            p = (y * self.w + ci) * 3
            self.rgb[p:p + n * 3] = bytes(col[:3]) * n
            if self.alpha is not None:
                s = y * self.w + ci
                self.alpha[s:s + n] = b'\xff' * n
        else:
            for x in range(ci, fl):
                self.blend(x, y, col, a)

    def rect(self, x0, y0, x1, y1, col, a=255):
        for y in range(int(y0), int(y1 + 0.999)):
            self.span(y, x0, x1, col, a)

    def rounded_rect(self, x0, y0, x1, y1, r, col, a=255):
        r = max(0.0, min(r, (x1 - x0) / 2.0, (y1 - y0) / 2.0))
        rr = r * r
        for y in range(int(y0), int(y1 + 0.999)):
            dy = (y0 + r) - (y + 0.5) if y < y0 + r else (y + 0.5 - (y1 - r) if y > y1 - r else 0.0)
            if abs(dy) >= r:
                inset = 0.0 if dy == 0.0 else r
            else:
                inset = r - (rr - dy * dy) ** 0.5
            self.span(y, x0 + inset, x1 - inset, col, a)

    def disc(self, cx, cy, rad, col, a=255):
        for y in range(int(cy - rad), int(cy + rad + 0.999)):
            dy = y + 0.5 - cy
            if abs(dy) >= rad:
                continue
            dx = (rad * rad - dy * dy) ** 0.5
            self.span(y, cx - dx, cx + dx, col, a)


def card(cv, x0, y0, x1, y1, r, face, edge=None, t=1.0, edge_a=255, inner=True):
    """一张牌：面色 → 整块覆描边色 → 内圈还原面色，剩下的就是等宽的圆角边框。
    三层都是精确解析形状，所以边宽与像素网格无关，16px 与 1024px 上是同一个比例。"""
    cv.rounded_rect(x0, y0, x1, y1, r, face)
    if edge is not None:
        cv.rounded_rect(x0, y0, x1, y1, r, edge, edge_a)
        ri = max(0.0, r - t)
        cv.rounded_rect(x0 + t, y0 + t, x1 - t, y1 - t, ri, face)
    if inner:
        k = t * 1.7
        cv.rounded_rect(x0 + k, y0 + k, x1 - k, y1 - k, max(0.0, r - k), INK, 26)
        cv.rect(x0 + k * 1.4, y0 + k * 1.2, x1 - k * 1.4, y0 + k * 1.2 + max(1.0, t), INK, 44)


def encode_png(cv):
    ctype = 6 if cv.alpha is not None else 2
    raw = bytearray()
    for y in range(cv.h):
        raw.append(0)
        row = y * cv.w
        if cv.alpha is None:
            raw += cv.rgb[row * 3:(row + cv.w) * 3]
        else:
            for x in range(cv.w):
                p = (row + x) * 3
                raw += cv.rgb[p:p + 3]
                raw.append(cv.alpha[row + x])

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', cv.w, cv.h, 8, ctype, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def write_png(path, cv):
    data = encode_png(cv)
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)
    return len(data)


# ------------------------------------------------------------------ 5x7 点阵大写字体
GLYPHS = {
    'A': '01110 10001 10001 11111 10001 10001 10001',
    'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01111 10000 10000 10000 10000 10000 01111',
    'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111',
    'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01111 10000 10000 10111 10001 10001 01111',
    'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '11111 00100 00100 00100 00100 00100 11111',
    'J': '00111 00010 00010 00010 00010 10010 01100',
    'K': '10001 10010 10100 11000 10100 10010 10001',
    'L': '10000 10000 10000 10000 10000 10000 11111',
    'M': '10001 11011 10101 10101 10001 10001 10001',
    'N': '10001 11001 10101 10011 10001 10001 10001',
    'O': '01110 10001 10001 10001 10001 10001 01110',
    'P': '11110 10001 10001 11110 10000 10000 10000',
    'Q': '01110 10001 10001 10001 10101 10010 01101',
    'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110',
    'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110',
    'V': '10001 10001 10001 10001 10001 01010 00100',
    'W': '10001 10001 10001 10101 10101 11011 10001',
    'X': '10001 10001 01010 00100 01010 10001 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100',
    'Z': '11111 00001 00010 00100 01000 10000 11111',
    '0': '01110 10001 10011 10101 11001 10001 01110',
    '1': '00100 01100 00100 00100 00100 00100 01110',
    '2': '01110 10001 00001 00010 00100 01000 11111',
    '3': '11110 00001 00001 01110 00001 00001 11110',
    '4': '00010 00110 01010 10010 11111 00010 00010',
    '5': '11111 10000 11110 00001 00001 10001 01110',
    '6': '01110 10000 10000 11110 10001 10001 01110',
    '7': '11111 00001 00010 00100 01000 01000 01000',
    '8': '01110 10001 10001 01110 10001 10001 01110',
    '9': '01110 10001 10001 01111 00001 00001 01110',
    '-': '00000 00000 00000 11111 00000 00000 00000',
    '.': '00000 00000 00000 00000 00000 01100 01100',
    ',': '00000 00000 00000 00000 00100 00100 01000',
    ':': '00000 01100 01100 00000 01100 01100 00000',
    '/': '00001 00010 00010 00100 01000 01000 10000',
    '(': '00100 01000 01000 01000 01000 01000 00100',
    ')': '01000 00100 00100 00100 00100 00100 01000',
    '=': '00000 00000 11111 00000 11111 00000 00000',
    '+': '00000 00100 00100 11111 00100 00100 00000',
    ' ': '00000 00000 00000 00000 00000 00000 00000',
}
GLYPH_ROWS = {k: [row[i] == '1' for row in v.split(' ') for i in range(5)]
              for k, v in GLYPHS.items()}


def text_width(text, scale, tracking=1):
    return len(text) * (5 + tracking) * scale - tracking * scale


def draw_text(cv, x, y, text, scale, col, a=255, tracking=1):
    """点阵字按整数倍放大：在社交卡上得到干净可读的方块字，不需要任何字体文件。"""
    cx = int(x)
    for ch in text.upper():
        rows = GLYPH_ROWS.get(ch)
        if rows:
            for r in range(7):
                ry = y + r * scale
                for c in range(5):
                    if rows[r * 5 + c]:
                        cv.rect(cx + c * scale, ry, cx + (c + 1) * scale, ry + scale, col, a)
        cx += (5 + tracking) * scale
    return cx


# ------------------------------------------------------------------ 台面
def felt_back(cv, seed=7, grain=8.0, center=(0.5, 0.44), power=0.85):
    """径向收边的毛毡台面：图标、社交卡共用同一块布。"""
    w, h = cv.w, cv.h
    nz = noise_table(8192, seed, -grain, grain)
    step = max(1.0, grain / 1.6)
    nz = [round(v / step) * step for v in nz]
    cx, cy = w * center[0], h * center[1]
    maxr = ((w * 0.5) ** 2 + (h * 0.5) ** 2) ** 0.5 * 1.18
    inner = mix(PANEL, (46, 56, 70), 0.5)
    RAMP = 512
    lut = [mix(inner, DEEP, (i / float(RAMP - 1)) ** power) for i in range(RAMP)]
    dx2 = [((x + 0.5 - cx) ** 2) for x in range(w)]
    rgb = cv.rgb
    lim = RAMP - 1
    for y in range(h):
        dy2 = (y + 0.5 - cy) ** 2
        nb = (y * 7) & 8191
        p = y * w * 3
        for x in range(w):
            t = (dx2[x] + dy2) ** 0.5 / maxr
            c = lut[lim if t >= 1.0 else int(t * lim)]
            # 斜纹：整数周期，任何尺寸下都不断裂，瓦片也因此严丝合缝
            g = nz[(x + nb) & 8191]
            if (x + y) % 6 == 0 or (x - y + 6 * h) % 6 == 0:
                g += grain * 0.55
            a = p + x * 3
            if g >= 0:
                rgb[a] = c[0] + int((255 - c[0]) * g / 255.0)
                rgb[a + 1] = c[1] + int((255 - c[1]) * g / 255.0)
                rgb[a + 2] = c[2] + int((255 - c[2]) * g / 255.0)
            else:
                rgb[a] = c[0] + int(c[0] * g / 255.0)
                rgb[a + 1] = c[1] + int(c[1] * g / 255.0)
                rgb[a + 2] = c[2] + int(c[2] * g / 255.0)


def sheen(cv, seed=29):
    """一道斜向高光 + 细颗粒：让全套位图像同一套设计语言，而不是各画各的。"""
    w, h = cv.w, cv.h
    nz = noise_table(4096, seed)
    nz = [round((0.975 + v * 0.05) / 0.004) * 0.004 for v in nz]
    denom = float(w + h * 1.35)
    for y in range(h):
        nb = (y * 13) & 4095
        base = y * 1.35
        for x in range(w):
            t = (x + base) / denom
            v = 1.0
            if 0.30 < t < 0.52:
                v = 1.0 + 0.055 * (1 - abs(t - 0.41) / 0.11)
            elif 0.70 < t < 0.86:
                v = 1.0 + 0.03 * (1 - abs(t - 0.78) / 0.08)
            v *= 0.975 + nz[(x + nb) & 4095] * 0.05
            if 0.997 < v < 1.003:
                continue
            p = (y * w + x) * 3
            cv.rgb[p] = min(255, int(cv.rgb[p] * v))
            cv.rgb[p + 1] = min(255, int(cv.rgb[p + 1] * v))
            cv.rgb[p + 2] = min(255, int(cv.rgb[p + 2] * v))


# ------------------------------------------------------------------ 母题：阶梯
PILES = (5, 4, 3, 2, 1)


def staircase(cv, S, detail=True, ox=0.0, oy=0.0):
    """五段牌垛 (5,4,3,2,1)：左高右低，最左一段镀金，左边那块是发牌堆。"""
    u = S / 100.0
    base, cw, ch, ov, pitch = 78.0, 12.4, 16.4, 6.4, 15.0
    x0 = 16.0
    t = max(1.0, 0.9 * u)
    r = 2.0 * u

    def X(v):
        return ox + v * u

    def Y(v):
        return oy + v * u

    if detail:
        cv.rect(X(x0) - 3 * u, Y(base + 1.4), X(x0 + pitch * 4 + cw) + 3 * u, Y(base + 2.4), GOLD, 140)
    for i, hh in enumerate(PILES):
        tone = CARDS[i % len(CARDS)]
        px = x0 + i * pitch
        if not detail:
            top = base - ch - (hh - 1) * ov
            body = shade(tone, 1.2) if i == 0 else mix(tone, INK, 0.10)
            cv.rounded_rect(X(px), Y(top), X(px + cw), Y(base + 1.6), 2.2 * u, body)
            continue
        for j in range(hh):
            y = base - ch - j * ov
            frac = j / float(max(1, hh - 1))
            face = shade(mix(tone, INK, 0.05 + 0.11 * frac), 1.0 + 0.09 * frac)
            top_card = j == hh - 1
            edge = (GOLD, 235) if top_card and i == 0 else (INK, 95)
            card(cv, X(px), Y(y), X(px + cw), Y(y + ch), r, face, edge[0], t, edge[1])
            if top_card:
                # 牌面读数：垛顶那张牌上的一颗点，小尺寸下它会糊掉，所以只在 detail 里画
                m = cw * 0.30
                cv.rounded_rect(X(px + cw / 2 - m / 2), Y(y + ch / 2 - m / 2),
                                X(px + cw / 2 + m / 2), Y(y + ch / 2 + m / 2), m * 0.3, INK, 130)
    if not detail:
        top = base - ch - (PILES[0] - 1) * ov
        cv.rect(X(x0), Y(top), X(x0 + cw), Y(top + 2.6), GOLD, 240)

    # 发牌块：每一局的第一步按在这块牌上
    dx, dw, dh = 2.0, 11.6, 17.6
    dy = base - dh - 0.6
    card(cv, X(dx), Y(dy), X(dx + dw), Y(dy + dh), 2.4 * u, DECK,
         mix(GOLD, INK, 0.25), max(1.0, 1.4 * u), 245, inner=False)
    if detail:
        for k, a in enumerate((165, 115, 70)):
            cv.rect(X(dx + 2.4), Y(dy + 4.4 + k * 3.4), X(dx + dw - 2.4), Y(dy + 5.4 + k * 3.4), INK, a)
    return u


def rounded_mask(cv, r):
    """把方图切出圆角，角上按解析覆盖度改成透明。"""
    S = cv.w
    out = Canvas(S, S, rgba=True)
    out.rgb = bytearray(cv.rgb)
    d = 0
    for y in range(S):
        for x in range(S):
            if x < r and y < r:
                d = ((r - x - 0.5) ** 2 + (r - y - 0.5) ** 2) ** 0.5
            elif x >= S - r and y < r:
                d = ((x - (S - r) + 0.5) ** 2 + (r - y - 0.5) ** 2) ** 0.5
            elif x < r and y >= S - r:
                d = ((r - x - 0.5) ** 2 + (y - (S - r) + 0.5) ** 2) ** 0.5
            elif x >= S - r and y >= S - r:
                d = ((x - (S - r) + 0.5) ** 2 + (y - (S - r) + 0.5) ** 2) ** 0.5
            else:
                out.alpha[y * S + x] = 255
                continue
            out.alpha[y * S + x] = int(max(0.0, min(1.0, r - d)) * 255 + 0.5)
    return out


def build_icon(S, maskable=False, rounded=True):
    if maskable:
        # maskable：主体缩进安全区（≈80%），四周纯色，系统的圆形/圆角遮罩裁不到牌垛
        inner = int(S * 0.72)
        core = build_icon(inner, maskable=False, rounded=False)
        cv = Canvas(S, S)
        flat = mix(PANEL, DEEP, 0.5)
        cv.fill_solid(flat)
        for y in range(S):
            for x in range(S):
                if (x + y) % 7 == 0:
                    cv.blend(x, y, shade(flat, 1.12), 90)
        off = (S - inner) // 2
        for y in range(inner):
            src = y * inner * 3
            dst = (y + off) * S * 3 + off * 3
            cv.rgb[dst:dst + inner * 3] = core.rgb[src:src + inner * 3]
        return cv
    cv = Canvas(S, S)
    felt_back(cv, seed=7)
    staircase(cv, S, detail=S >= 96)
    sheen(cv, seed=29)
    if rounded and S >= 180:
        cv = rounded_mask(cv, S * 0.225)
    return cv


def build_felt(S=256):
    """游戏台面纹理：无缝平铺的毛毡，view.js 用它给 canvas 铺底。"""
    cv = Canvas(S, S)
    cv.fill_solid(PANEL)
    nz = noise_table(4096, 101)
    for y in range(S):
        row = y * S
        nb = (y * 5) & 4095
        for x in range(S):
            f = 1.0
            if (x + y) % 5 == 0:
                f *= 1.05
            if (x - y + S) % 5 == 0:
                f *= 0.95
            if (x + y * 2) % 11 == 0:
                f *= 1.03
            f *= 0.94 + nz[(x + nb) & 4095] * 0.13
            col = shade(PANEL, f)
            p = (row + x) * 3
            cv.rgb[p:p + 3] = bytes(col)
    return cv


def build_cardback(S=128):
    """牌背纹理：可平铺的菱形网格 + 金色发丝线。view.js 按堆色再叠一层色相。"""
    cv = Canvas(S, S)
    base = (30, 38, 47)
    cv.fill_solid(base)
    nz = noise_table(4096, 202)
    step = S // 16
    hi = (86, 106, 128)
    mid = (42, 53, 66)
    for y in range(S):
        row = y * S
        nb = (y * 3) & 4095
        for x in range(S):
            a = (x + y) % (2 * step)
            b = (x - y + 8 * S) % (2 * step)
            col = base
            if a < 2 or b < 2:
                col = hi
            elif step - 2 < a < step + 2 and step - 2 < b < step + 2:
                col = mid
            p = (row + x) * 3
            cv.rgb[p:p + 3] = bytes(shade(col, 0.96 + nz[(x + nb) & 4095] * 0.09))
    g = step
    cv.rect(g, 0, g + 1, S, GOLD, 46)
    cv.rect(0, g, S, g + 1, GOLD, 46)
    return cv


def build_glow(S=256):
    """径向金光 sprite（带 alpha）：发牌块的强调，以及阶梯已成时的满台光晕。"""
    cv = Canvas(S, S, rgba=True, fill=(0, 0, 0, 0))
    c = S / 2.0
    for y in range(S):
        dy = (y + 0.5 - c) ** 2
        for x in range(S):
            d = ((x + 0.5 - c) ** 2 + dy) ** 0.5 / c
            if d >= 1.0:
                continue
            a = int(max(0.0, 1.0 - d) ** 2.4 * 235 + 0.5)
            if a <= 1:
                continue
            p = (y * S + x) * 3
            col = mix(GOLD, INK, max(0.0, 0.5 - d))
            cv.rgb[p:p + 3] = bytes(col)
            cv.alpha[y * S + x] = a
    return cv


def build_og(W=1200, H=630):
    """社交卡：左边读数，右边那座楼梯。"""
    cv = Canvas(W, H)
    felt_back(cv, seed=7, grain=6.0)
    staircase(cv, H * 0.86, detail=True, ox=W * 0.545, oy=H * 0.07)
    big = max(6, H // 62)          # 标题：1024 宽的卡上 70px 高
    sub = max(3, H // 200)
    x = int(W * 0.05)
    y = int(H * 0.14)
    lh = 8 * big
    draw_text(cv, x, y, 'BULGARIAN', big, INK)
    draw_text(cv, x, y + lh, 'STAIRCASE', big, GOLD)
    bar = y + 2 * lh + big
    cv.rect(x, bar, x + text_width('STAIRCASE', big), bar + max(3, sub), GOLD, 210)
    for i, t in enumerate(('T(K) = K(K+1)/2', 'CONVERGES TO (K,K-1,...,1)', 'PAR IS MEASURED BY BFS')):
        draw_text(cv, x, bar + 4 * sub + 26 + i * (9 * sub + 20), t, sub, INK if i == 2 else MUTED)
    draw_text(cv, x, int(H * 0.90), 'CANVAS  /  PWA  /  ZERO DEPS', sub, MUTED, 190)
    sheen(cv, seed=41)
    return cv


ASSETS = [
    ('icons/icon-1024.png', lambda: build_icon(1024)),
    ('icons/icon-512.png', lambda: build_icon(512)),
    ('icons/icon-192.png', lambda: build_icon(192)),
    ('icons/icon-maskable-512.png', lambda: build_icon(512, maskable=True)),
    ('icons/icon-maskable-192.png', lambda: build_icon(192, maskable=True)),
    ('icons/apple-touch-icon.png', lambda: build_icon(180, rounded=False)),
    ('icons/icon-180.png', lambda: build_icon(180, rounded=False)),
    ('icons/favicon-96.png', lambda: build_icon(96, rounded=False)),
    ('icons/favicon-64.png', lambda: build_icon(64, rounded=False)),
    ('icons/favicon-48.png', lambda: build_icon(48, rounded=False)),
    ('icons/favicon-32.png', lambda: build_icon(32, rounded=False)),
    ('icons/favicon-16.png', lambda: build_icon(16, rounded=False)),
    ('assets/art/felt-256.png', lambda: build_felt(256)),
    ('assets/art/cardback-128.png', lambda: build_cardback(128)),
    ('assets/art/glow-256.png', lambda: build_glow(256)),
    ('assets/art/og-cover-1200x630.png', lambda: build_og(1200, 630)),
]


def main():
    verify = '--verify' in sys.argv
    bad, total = 0, 0
    for rel, fn in ASSETS:
        path = os.path.join(ROOT, rel)
        want = encode_png(fn())
        if verify:
            try:
                have = open(path, 'rb').read()
            except OSError:
                have = b''
            state = '一致' if have == want else ('缺失' if not have else '字节不一致')
            bad += state != '一致'
            print('%-34s %8s' % (rel, state))
            continue
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(path, 'wb') as fh:
            fh.write(want)
        print('%-34s %7dB' % (rel, len(want)))
        total += len(want)
    if verify:
        print('verify: %s' % ('全部可复现' if not bad else '%d 个需重画' % bad))
        sys.exit(1 if bad else 0)
    print('-> %d bytes written' % total)


if __name__ == '__main__':
    main()
