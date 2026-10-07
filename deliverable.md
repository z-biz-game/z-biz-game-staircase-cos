# 保加利亚梯 - 交付报告

## 摘要

| 字段 | 值 |
| --- | --- |
| **App 名称** | 保加利亚梯 |
| 英文名 / 仓名 | BULGARIAN · `z-biz-game-staircase-cos` |
| 玩法一句话 | 每次从每堆各拿走一张、把拿走的聚成新一堆（新堆 = 发牌前的堆数，空堆消失）；牌数是三角数 `T_k` 时任何开局都必然走到阶梯 `(k,k-1,…,1)`，玩家另外可以并两堆或拆一堆，用最少操作摆出目标形状 |
| 难度数字的来源 | `par` = `js/core/solve.js` 在 `p(n)` 个局面的动作图（发/并/拆）上做广度优先搜索量出的最短操作数；`steps` = 只发牌时到目标的发牌次数（定理的量）。两者都在构建期从序列化 `spec` 复算，对不上就构建失败 |
| 对外锚点（全部复现） | 三角数牌量全分拆收敛 `stuck = 0,0,0,0`（n=3/6/10/15，另 21/28 也是 0）；分拆数 `3 / 11 / 42 / 176 / 77 / 792 / 3718`；最坏只发牌步数 `2 / 6 / 12 / 20 / 30 / 42 = k(k-1)`；反面 `n=12` 的 77 个开局全部进入长度 5 的周期轨道（`other = 0`） |
| 出厂关卡 | 27 关（shoal 5 · linked 7 · twined 8 · master 7），四档 par 带 2-3 / 3-4 / 4-4 / 5-5 |
| 依赖数 | 0（`dependencies` 与 `devDependencies` 都是 `{}`，无打包器、无 npm install） |
| 二进制资产 | 0（无 png/mp3/字体；favicon 是 index.html 里内联 SVG data-URI；画面全部 canvas 2D 程序绘制） |
| node 层断言 | 104 行（8 个套件），fail 0 |
| 浏览器层断言 | 71 行（@boot @play @routes @save @pointer），fail 0，console 干净 |
| 测试钩子 | `window.stair`（同时挂 `window.staircase` 别名） |
| 路由 | `#/c/<n>` · `#/lot/<id>` · `#/daily`（`hashSeed("YYYY-MM-DD")`） · `#/random/<band>/<token>` |

## 文件清单与验证者

| 文件 | 作用 | 由谁验证 |
| --- | --- | --- |
| `js/core/partition.js` | 状态=整数分拆；`key()` 规范化；枚举 + Euler 五边形数递推两条路算 `p(n)` | `node test/partition.test.mjs`（14 行，含公开分拆表逐点对账） |
| `js/core/deal.js` | 发牌规则（堆列表写法 + 重数向量写法两份实现）、轨道、收敛穷举、轨道普查、目标形状 | `node test/deal.test.mjs`（16 行） |
| `js/core/solve.js` | 唯一合法性闸门 `applyAction`、分层 BFS `solve`、显式边表 `buildGraph`、三路对账 `parProof`、全量难度图 `distanceMap`、`replay` | `node test/solve.test.mjs`（17 行，含手算 fixture 与"没有更短"反证） |
| `js/core/game.js` | 一局状态机：act/undo/reset/select/hint/grade/snapshot | `node test/game.test.mjs`（12 行，含"每个出厂关卡都能用 act() 走完认证路线"） |
| `js/core/make.js` | 出题：种子→分拆下标→`rateLot`（难度带 + 拒绝原因）、四档 `TIERS` | `node test/make.test.mjs`（13 行） |
| `js/core/library.js` | 战役表读取、`#/daily`/`#/random` 运行时生成、`reSolve`、`stats` | `node test/library.test.mjs`（12 行）+ `@routes` 段现场比对 |
| `js/core/storage.js` | 存档：守卫式 localStorage（**抛异常**）+ 内存后端 + 单调 best/unlock | `node test/storage.test.mjs`（8 行）+ `@save` 段真实 localStorage |
| `js/core/rng.js` | `hashSeed`（FNV-1a 派生两轮 UTF-16 混合）+ `mulberry32`，与 gridlock-cos 逐字节相同 | `node test/make.test.mjs` 里 4 行 rng 断言（自洽值，不声称公开向量） |
| `js/data/lots.js` | 构建期产物：27 关，每行带 `spec/par/steps/path/attractor` | `node test/library.test.mjs` 从序列化 `spec` 重解 + `node tools/bake.mjs` 写入门禁 |
| `js/view.js` | canvas 2D 程序绘制牌堆/目标条/发牌块 + 点击与拖拽手势（不判合法性） | `@pointer` 段 19 行真实 CDP 鼠标事件 |
| `js/main.js` | DOM、路由、存档接线、`window.stair` 钩子 | `@boot @play @routes @save` 五段 + `bash tools/verify.sh` |
| `index.html` | 外壳、内联 SVG data-URI favicon、"数字从哪来"面板 | `@boot` 的"控制台零噪声"路径：`tools/verify.sh` 的 console 段（实测 `(none)`） |
| `css/game.css` | 版式；`.curtain[hidden]`/`.toast[hidden]` 两条防吞事件规则 | `@pointer` 段（去掉这两条会立刻挂 9 行，见改动表） |
| `tools/bake.mjs` | 出题 + 门禁 + 打印穷举证据表 | `node tools/bake.mjs`（本报告"数字从哪来"就是它这次的输出） |
| `tools/harness.mjs` | node 与浏览器同形状的断言行 | `bash tools/verify.sh` 聚合行 |
| `tools/playtest.mjs` | 零依赖 CDP 驱动（Node 全局 fetch/WebSocket） | `bash tools/verify.sh` 的 `@*` 五段 |
| `tools/verify.sh` | 一次性验收门（web 5212 / CDP 9353，独立 Chrome profile，SKIP_UNIT） | `bash tools/verify.sh` → `=== ALL GREEN ===` |
| `test/*.test.mjs`（8 个文件） | 104 行 node 断言 | `node --test test/`（8 tests / pass 8 / fail 0）与 `npm run unit` |
| `test/repo.test.mjs` | 仓本身作为门禁：零依赖、无二进制资产、core 纯度、favicon 是内联 SVG、CI 文件集 == `npm run check` 文件集、pages 只拷 index.html/css/js、端口 5212/9353、README 与交付报告同名 | `node test/repo.test.mjs`（11 行） |
| `package.json` | 零依赖 + `check/unit/test/bake/verify` 脚本 | `npm run check`、`npm test`、`node test/repo.test.mjs` |
| `server.cjs` / `electron/main.cjs` | 零依赖静态服务器（ES module 需要 origin）与桌面壳 | `bash tools/verify.sh` 全程通过它提供页面；`npm run check` 语法；`node test/repo.test.mjs` 的 `main` 字段一行 |
| `.github/workflows/ci.yml` | unit（`node --check` 全量 + 每个 test 文件）+ browser（`SKIP_UNIT=1`） | `node test/repo.test.mjs` 断言它的 glob 集合与 `npm run check` 完全一致 |
| `.github/workflows/pages.yml` | 只 `cp index.html css js` 的部署 | `node test/repo.test.mjs`（禁止 `path: .`，禁止把 tools/test/server 带进产物） |
| `LICENSE` / `.gitignore` | MIT + "Copyright (c) 2026 z-biz-game"；忽略 node_modules 与 _site | `node test/repo.test.mjs` |
| `README.md` / `DESIGN.md` / `deliverable.md` | 玩法与数字复现 / 维护者向约束与实测 / 本报告 | `node test/repo.test.mjs` 的显示名一致性一行；README 的复现命令是 `node tools/bake.mjs`；DESIGN 第 6 节的计时表来自 `node /tmp/stair-bench.mjs` 那一次实测（脚本未入库，数字为一次性实测，见未实现清单） |

## 数字从哪来

`node tools/bake.mjs`（2026-09-27 本仓最后一次实跑，原样粘贴）：

```
shoal: 5 lots in 0.0s (par 2-3 · 只发牌 3-5)
linked: 7 lots in 0.0s (par 3-4 · 只发牌 4-10)
twined: 8 lots in 0.0s (par 4-4 · 只发牌 5-13)
note: master reached 7/8 (only so many openings clear the band)
master: 7 lots in 0.2s (par 5-5 · 只发牌 5-37)

wrote 27 lots (shoal:5 linked:7 twined:8 master:7) -> js/data/lots.js
tries 293 accepted 27 rate 9.2%
rejections: 开局即目标=3 一步内的题=40 重复局面=10 par 2 不在带内=100 par 3 不在带内=81 par 4 不在带内=32
max BFS states 1692 · slowest par-proof 533ms · total 1.4s
proof converge n=3 k=2: 3/3 openings reach the staircase, worst 2 = k(k-1) from 1,1,1
proof converge n=6 k=3: 11/11 openings reach the staircase, worst 6 = k(k-1) from 2,2,1,1
proof converge n=10 k=4: 42/42 openings reach the staircase, worst 12 = k(k-1) from 3,3,2,1,1
proof converge n=15 k=5: 176/176 openings reach the staircase, worst 20 = k(k-1) from 4,4,3,2,1,1
proof converge n=21 k=6: 792/792 openings reach the staircase, worst 30 = k(k-1) from 5,5,4,3,2,1,1
proof converge n=28 k=7: 3718/3718 openings reach the staircase, worst 42 = k(k-1) from 6,6,5,4,3,2,1,1
proof par-map n=6: 11 positions / 42 actions · max par 3 from 1,1,1,1,1,1 · hist [[0,1],[1,5],[2,4],[3,1]]
proof par-map n=10: 42 positions / 266 actions · max par 4 from 1,1,1,1,1,1,1,1,1,1 · hist [[0,1],[1,10],[2,19],[3,11],[4,1]]
proof par-map n=15: 176 positions / 1645 actions · max par 5 from 2,2,2,2,2,2,2,1 · hist [[0,1],[1,16],[2,57],[3,72],[4,28],[5,2]]
proof par-map n=21: 792 positions / 10225 actions · max par 6 from 2,2,2,2,2,2,2,2,2,2,1 · hist [[0,1],[1,24],[2,145],[3,319],[4,240],[5,57],[6,6]]
proof par-map n=28: 3718 positions / 63382 actions · max par 7 from 3,3,3,3,3,3,3,3,3,1 · hist [[0,1],[1,33],[2,298],[3,1055],[4,1461],[5,713],[6,144],[7,13]]
proof shoal n=6: par 2 = forward 2 = reverse 2 over 11 positions / 42 edges (closed yes) · 只发牌 3 步
proof linked n=10: par 3 = forward 3 = reverse 3 over 42 positions / 266 edges (closed yes) · 只发牌 6 步
proof twined n=15: par 4 = forward 4 = reverse 4 over 176 positions / 1645 edges (closed yes) · 只发牌 10 步
proof master n=21: par 5 = forward 5 = reverse 5 over 792 positions / 10225 edges (closed yes) · 只发牌 15 步
proof master n=28: par 6 = forward 6 = reverse 6 over 3718 positions / 63382 edges (closed yes) · 只发牌 21 步
proof master n=12: par 4 = forward 4 = reverse 4 over 77 positions / 576 edges (closed yes) · 只发牌 10 步
proof master n=18: par 5 = forward 5 = reverse 5 over 385 positions / 4271 edges (closed yes) · 只发牌 15 步
```

每档 par 区间（构建期实测，写进 `js/data/lots.js` 的 `TIERS_META`）：shoal 2-3、linked 3-4、twined 4-4、master 5-5；
只发牌步数区间：3-5 / 4-10 / 5-13 / 5-37。接受率 9.2%，拒绝原因计数见上；`master` 只凑到 7/8 关，
因为该档要求 `par 5-7` 且四种牌量（21/28/12/18）都要有开局，能过带的开局数量有限（这是带定义的自然结果，不是生成器失败）。

复现命令：`node tools/bake.mjs`（同一份代码两次跑出同一批 27 关，只有 `BAKED_AT` 时间戳一行不同）。

计时类数字（随机器与负载漂移，与上面的结构量分开看）：`bake` 全量 0.8–1.4s；单次搜索最大状态数 1692；
`parProof` 最慢一档 311–533ms；`#/daily` 现场生成 8 个日期平均 13ms / 最坏 36ms；`master` 档出题最坏 137ms；
浏览器里一次 `reSolve` 20–42ms；一次提示 27ms / 1571 状态。

## 改动表（先写错在哪 → 为什么对）

| 曾经的错误 | 错在哪 | 为什么现在是对的 | 证据 |
| --- | --- | --- | --- |
| 发牌规则写成"新堆 = 处理后的堆数"或忘了丢空堆（前两位建造者在这里翻过两次车） | 阶梯不再是不动点，收敛数字全部对不上锚点 | `deal()` 逐字按 `count = piles.length; piles = piles.map(p=>p-1).filter(p=>p>0); piles.push(count)`；另有重数向量版 `dealByCounts()` 独立复算 | `node test/deal.test.mjs` 前 5 行（含 `deal([1,1,1])=[3]`、`deal([2,2,1,1])=[4,1,1]`、阶梯是不动点、4742 个局面两路相等） |
| `.curtain { display: grid }` 覆盖了 `[hidden]` | 胜利卡片一直透明地盖在画布上吃掉所有指针事件；注入 JS 改状态的测试完全看不出来 | 加 `.curtain[hidden]{display:none}`（`.toast` 同）；现在真实鼠标点击走完整条认证解 | `@pointer` 19 行 fail 0（改之前 9 行 fail），`bash tools/verify.sh` |
| `cardPoint()` 返回整张牌中心，而命中判定按可见带（牌是叠着的，`cardH > step`） | 台架拖"最上面那张牌"实际拖在了下一张上，拆点错位 | `cardMid()` 返回可见带中心，`hit()` 与 `cardPoint()` 用同一个模型；指针段现在还逐手势核对棋盘 | `@pointer` 的 "and every gesture landed where the certified position says" 一行 + `dragging the top card of a pile is not a split` |
| 测试把 `distanceMap` 的 `dist` 数组按字符串 key 索引（`dist['10']` 被当成下标 10） | 看起来像"求解器给出了更短的 par" | core 返回 `byKey` 映射，测试用 `m.byKey.get(key(start))`；**这是测试期望错，不是实现错** | `node test/solve.test.mjs` "the map is a real measurement"（42 个开局逐一相等） |
| 手写期望 `deal([4,1,1]) == [3,2,1]` | 算错了：3 堆 → 新堆是 3，两张单牌抽空后消失，结果 `[3,3]` | 修的是测试里的期望值与随后的 par/grade 路线，代码未动 | `node test/game.test.mjs`（12 行 fail 0） |
| 期望"10 个单牌只发牌要 10 步" | 第一次发牌把 10 张聚成 `[10]`，单堆 `T_k` 只要 `T_{k-1}` 步，合计 7 | 闭式 `1,3,6,10,15,21` 现在是一条独立断言，与模拟逐一对账 | `node test/deal.test.mjs` "a single pile of T_k cards needs T_(k-1) deals" |
| 难度带一开始定为 `par ≥ 2` | 出厂关卡全挤在最易一档，"band"没有测量含义 | 先用 `distanceMap` 打出 `p(n)` 个开局的完整 par 直方图，再把带定在直方图上半部；带是结果不是愿望 | `node tools/bake.mjs` 的 `par-map ... hist` 五行 + `test/library.test.mjs` 的 `TIERS_META` 对账 |
| 派单文字里的 "for n=12 (78 cards): all 77 partitions cycle" | `78 = T_12` 与 `77 = p(12)` 被串成一句，按字面无法同时成立 | 按规格 `b3-staircase.md` 实现反面情形：**12 张牌**的 77 个分拆全部周期（`cycles=77, other=0`）；没有为了凑 78 去改期望值 | `node test/deal.test.mjs` 的 n=12 那一段（states/cyclic/open/withPreperiod/cycleLengths 五项） |
| `hashSeed` 被称作 FNV-1a | 它是 FNV-1a 派生的两轮 UTF-16 混合，`hashSeed('a')=723832900 ≠ 3826002220` | 文档照实写，测试断言自洽值并显式断言"不等于公开向量" | `node test/make.test.mjs` 前 4 行 |

## 验收结论

原样粘贴本仓实跑输出：

```
$ npm run check
> staircase@1.0.0 check
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK
OK
```

```
$ node --test test/
ℹ tests 8
ℹ pass 8
ℹ fail 0

$ for f in test/*.test.mjs; do node "$f" | tail -1; done
deal.test.mjs      rows: 16 fail: 0
game.test.mjs      rows: 12 fail: 0
library.test.mjs   rows: 12 fail: 0
make.test.mjs      rows: 13 fail: 0
partition.test.mjs rows: 14 fail: 0
repo.test.mjs      rows: 12 fail: 0
solve.test.mjs     rows: 17 fail: 0
storage.test.mjs   rows: 8 fail: 0
                                     合计 104 行 / 0 失败
```

```
$ SKIP_UNIT=1 bash tools/verify.sh
=== node suites ===
opened http://127.0.0.1:5212/
(no console output)
boot lot: shoal-01
=== @boot ===
rows: 13 fail: 0
=== @play ===
rows: 13 fail: 0
=== @routes ===
rows: 14 fail: 0
=== @save ===
rows: 12 fail: 0
=== @pointer ===
rows: 19 fail: 0
=== console ===
(none)
=== ALL GREEN ===
```

浏览器层 71 行合计 0 失败；`@pointer` 段全部走 CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`
真实事件（点发牌块=一次发牌、点两堆=一次并堆、按住某张牌下拖=一次拆堆），
断言包含：整条认证解用鼠标走完、逐手势核对棋盘、原地按下不计数、裸桌面点击与拖拽不计数、
抓最上面那张牌不拆分、九倍过拖仍只算一步且拆在抓的那张、终点判定与三颗星、存档落盘 `staircase.save.v1`、
清空存档要两次点击。

`verify.sh` 共跑了 4 次（第 1 次暴露模块导出名写错与 `@routes` 正则转义错，第 2 次暴露 `.curtain` 吞事件，
第 3 次暴露 `cardPoint` 命中带错位，第 4 次 ALL GREEN）；每次都用独立 `mktemp -d` profile，结束后
`pgrep -f "remote-debugging-port=9353"` 与 `pgrep -f "server.cjs 5212"` 都确认没有残留进程。
截图 5 张：`/tmp/puzzle-brief/shots/stair-{boot,play,routes,save,pointer}.png`。

## 未实现清单

* `DESIGN.md` 第 6 节的计时表来自一次性脚本 `/tmp/stair-bench.mjs`（未入库，因为它只读 core 的公开函数、
  不属于任何验收门）。数字是那一次实测，换机器会变；结构量（关卡表、穷举锚点）不受影响。
  若维护者要复算：对 `dailyLot / reSolve / hint / makeLotTrying` 各计时一轮即可。
* `electron/main.cjs` 在，但 electron 不是依赖（零依赖硬约束），`npm run electron` 需要维护者自备 electron；
  受支持的路径是 `npm run dev` 与 `bash tools/verify.sh`。
* 没有 `test/balance.mjs`（gridlock 有）：本仓的难度表不是抽样统计，而是 `distanceMap` 对 `p(n)` 个开局的
  **全量**直方图，直接打印在 `bake` 输出里，因此不需要单独的平衡脚本。
* `master` 档出厂 7 关而非 8 关（能同时满足"带 5-7"和"四种牌量都有开局"的候选有限）；
  `bake` 打印了 `note:` 而没有静默，也没有为了凑数放宽带。
* 每日题的日期分档由 `hashSeed("daily-date|" + day)` 选档，未做"某天完全不出题"的空档处理：
  实测 8 个日期全部出题成功（`ok`），若未来带定义变严导致某天空档，`resolve()` 会回落到战役第一关并打印标签。
* 未做：牌面图案素材、动画过渡、多人/在线、任何后端服务。

## 线上验收（GitHub Pages，主代理 2026-09-27 实抓）

发布 sha `fd0fe15`，CI trigger `01f5be0` → Actions `success`。

| 资源 | 结果 |
| --- | --- |
| `/`（index.html） | 200 / 4,027 B |
| `js/main.js` | 200 / 15,934 B |
| `css/game.css` | 200 / 5,700 B |
| `js/data/lots.js` | 200 / 11,097 B |
| `<title>` | `保加利亚梯 · BULGARIAN`，与 README 首行一致 |

主代理自己的门禁实跑（不采信任何转述）：`npm run check` rc=0；node **104 条 / 0 失败**；
浏览器 **71 条 / 0 失败** 且 `=== ALL GREEN ===` 退出 0；zero-deps、0 个二进制资产、
core purity clean、无幽灵导出、无密钥样式串。

发布前主代理对本仓动过两处代码，记录在此以免来源被误认：`js/core/partition.js` 里的
`MAX_N` 与 `isSortedDesc` 被删除。判定依据是全仓（`js` `test` `tools`，含 partition.js 自身）
对这两个名字**零引用**，且 README/DESIGN/deliverable 三份文档从未提到它们（grep 核对），
所以删除不改变任何行为、也不产生文档漂移。门禁当时正是以 `ghostExports` 拒绝本仓的。

另需说明：本仓的构建会话在报告里**修正了主代理派单里两处写错的锚点**——
`T_3/T_6/T_10/T_15` 实际指 n=3/6/10/15（n=6 的最差是 6 步而不是 2 步），
以及"n=12（78 张牌）77 个分拆"混淆了 `T_12=78` 与 `p(12)=77`。两处都按规格重算后按事实落地，
没有为了通过测试而放宽期望。
