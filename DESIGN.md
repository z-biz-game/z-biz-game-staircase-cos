# DESIGN · 保加利亚梯（面向维护者）

这份文件只回答三个问题：为什么这样实现、哪条约束一破就出 bug、哪个数字是哪一次实测打印出来的。
宣传性内容一律不写；要复现主张请看 `README.md` 与 `node tools/bake.mjs` 的输出。

## 1. 分层与它为什么必须这么分

```
js/core/partition.js  整数分拆：状态是什么、有多少个（枚举 + Euler 五边形数递推）
js/core/deal.js       发牌规则本身 + 由它导出的定理测量（收敛穷举、轨道普查、目标形状）
js/core/solve.js      动作图（发/并/拆）：applyAction 单一合法性闸门、BFS、parProof、distanceMap
js/core/game.js       一局的状态机：act/undo/reset/hint/grade
js/core/make.js       出题：种子 → 分拆下标 → rateLot（带难度带与拒绝原因计数）
js/core/library.js    战役表读取 + #/daily 与 #/random 两条运行时生成 + reSolve
js/core/storage.js    存档（唯一允许碰 window 的 core 模块，守卫式且**抛异常**）
js/core/rng.js        hashSeed + mulberry32（与 gridlock-cos 逐字节相同）
js/view.js            像素与手势，不判合法性
js/main.js            DOM / 路由 / 存档 / window.stair 钩子
```

* `js/core/*` 里不出现 `document.`，也不出现 `window.`（`storage.js` 只在 `localStorageBackend()` 一个函数里读
  `window.localStorage`）。这条不是洁癖：`node --test test/` 直接 import 这些文件，一旦有人把 DOM 伸进 core，
  100 多条断言就跑不了了（`test/repo.test.mjs` 里有一条机器检查这条边界）。
* 合法性只有一处：`solve.js#applyAction`。手指点击、拖拽、bake 里存下来的 `path`、提示用的搜索、
  测试里的 `replay()` 全都过这个闸门。因此"测试点得动"和"规则允许"不可能是两套答案
  （`test/game.test.mjs` 里"每个出厂关卡都能用 act() 走完认证路线"就是这条的闭环）。
* `view.js` 只做**装饰性**钳制：抓最上面那张牌往下拖不会产生拆分（那会切出空堆），于是那次手势退化成"选中"。
  真正的拒绝仍然来自 core，见 `illegalReason` 的文案。

## 2. 状态的规范化：一切都过 `key()`

牌堆的左右顺序没有意义，所以状态是**降序数组**，相等判断一律走 `key(piles) = sortDesc(piles).join(',')`。
分拆枚举 `partitionsOf(n)` 固定按"首项从大到小"的字典序输出，**生成器是按这个顺序取下标的**：
换掉枚举顺序就等于换掉所有每日题与分享题。这条是隐式契约，`test/make.test.mjs` 里有一条断言钉住它
（`partitionsOf(10)[0] == [10]`、末位是 10 个 1、前三项是 `6 / 5,1 / 4,2`）。

## 3. 发牌规则：两种写法 + 对账

前两位建造者在这条上翻过车，所以这里写死并测了两遍：

```js
const count = piles.length;                       // 新堆大小 = 发牌【前】的堆数
const next = piles.map((p) => p - 1).filter((p) => p > 0);   // 空堆丢掉
next.push(count);
```

`dealByCounts()` 用重数向量 `c_s`（大小为 s 的堆有几摞）做同一件事：`c'_{s-1} = c_s (s≥2)`，再给
`c'_{count}` 加一。两条路在 n ≤ 28 的全部 4742 个局面上逐一相等（`test/deal.test.mjs`）。
少写 `.filter(p => p > 0)` 或者把 `count` 取成发牌之后的堆数，收敛数字立刻对不上锚点。

## 4. 目标形状：三角数与非三角数

`targetOf(start)`：

* `n = T_k` → 目标是 `staircase(k)`，`attractor = "staircase(k)"`，`steps` 是发牌到它的次数。
  阶梯是发牌的不动点，所以到了就不会走开。
* `n` 非三角 → 没有阶梯。取**该开局自己的 deal 轨道上、降序字典序最小的那个周期元素**为目标，
  `attractor = "orbit(cycleLen, preperiod)"`。选轨道上的元素而不是全局某个代表元，是因为
  这样目标对玩家一定"发得到"（`steps ≥ 0` 恒成立），非三角关卡的 `par ≤ steps` 才有意义。

`T_k` 与"任何开局都收敛"是同一个定理的两面，两面都测了：正面 `stuck = 0`，反面 12 张牌 77 个开局
全部进入长度 5 的周期轨道、`other = 0`。

## 5. 确定性系统里的难度到底是什么（规格要求定案的一条）

规格 §4 允许两件事：给玩家一个真实自由度（并/拆），或者做成纯观察 + "预测步数"。本仓选了前者，
并把两个量分开印，因为它们各自的答案是不同的问题：

* `steps`（只发牌）是**定理的量**：与玩家无关，由全分拆穷举证明，最坏 `k(k-1)`。
* `par`（发/并/拆）是**谜题的量**：在动作图上被 BFS 精确量出，最坏 `k`（`n=T_k` 时）。
  这一步的可证性来自：动作图有限（`p(n)` 个结点）、`parProof()` 要求分层 BFS / 正向 / 反向三条路一致、
  并且边表对每个结点的所有动作**闭合**；`distanceMap()` 再对全体开局反向 BFS 一次，
  给出"这个牌量最难的开局要几步"。所以 `par` 不是搜索器自己给自己打分。
* 两者的差就是玩家的价值：出厂 27 关里有 26 关 `par < steps`（最悬殊的一关 `par 5 / steps 37`），
  唯一 `par == steps` 的是 `master-05`（21 张，开局 `7,2,2,2,2,2,2,2`）——那关只发牌已经最优。
  这条被 `test/library.test.mjs` 的"par 永不超过 steps，且至少九成关严格更短"钉住。

破坏点：如果有人把"并堆"限制成只许并最小的两堆之类，`par` 就变成另一张图上的数，
出厂数据全部要重烤；`bake` 的复验闸门会让它自己叫出来，不会静默上线。

## 6. 运行时算不算得起（结构量 vs 计时量）

**结构量**（逐位可复现，与机器无关）：`p(n)`、`stuck`、最坏 `steps` 与 `worstFrom`、`par`、
轨道长度与 preperiod、出厂关卡表（同一份代码 `node tools/bake.mjs` 得到同一批 27 关，
只有 `BAKED_AT` 那一行时间戳会变）。

**计时量**（2026-09-27，本机 11 个并发构建的负载下；`slowest par-proof` 两次分别 311ms / 533ms，
所以这些数只能当量级看）：

| 测的东西 | 实测 | 在哪跑 |
| --- | --- | --- |
| `node tools/bake.mjs` 全量 | 0.8–1.4s，293 次尝试接受 27 关（接受率 9.2%） | 构建期 |
| 拒绝原因计数 | `par 2 不在带内=100 · par 3 不在带内=81 · 一步内的题=40 · par 4 不在带内=32 · 重复局面=10 · 开局即目标=3` | 构建期 |
| 单次搜索最大状态数 | 1692（出厂关卡里最宽的一次） | 构建期 |
| `parProof`（含整图闭合检查）最慢一档 | 311–533ms（n=6/10/15/21/28/12/18 七档） | 构建期 |
| `distanceMap(28)` | 3718 结点 / 63382 边，约 160ms | 构建期 / 测试期 |
| `#/daily` 现场生成（含出题链） | 8 个日期平均 13ms，最坏 36ms | 浏览器，仅换路由时 |
| `master` 档 `makeLotTrying` | 平均 52ms，最坏 137ms，平均尝试 10.5 次 | 浏览器，仅换路由时 |
| 关卡复验 `reSolve`（最宽一关） | 20–42ms | 浏览器，每次路由 |
| 提示 `hint()`（最宽一关开局） | 27ms / 1571 状态 | 浏览器，点击时 |
| `convergenceCensus(15)` / `orbitCensus(12)` 在浏览器里 | < 10ms | `@boot` 段现场重算 |

契约禁止的"点击时无上限的现场搜索"与本仓的边界：点击只做**有上限**的 BFS（`maxStates` 默认 20000，
提示用这个值；状态数打印在提示文案里），全枚举只出现在 `bake` 与测试；上面这些中位数都在 300ms 以下，
没有出现"实测中位数 > 300ms 却偷偷放在前端"的情况。最宽的现场搜索是 `master` 档出题，实测最坏 137ms。

## 7. 踩过的坑（都在这一节，别处不要重复）

| 坑 | 症状 | 根因与修法 |
| --- | --- | --- |
| `.curtain` 用 `display:grid` 覆盖了 `[hidden]` | 浏览器层 19 条指针断言里 9 条失败：真实鼠标点击"什么都没发生"，而 `curtain.hidden === true` | UA 样式表的 `[hidden]{display:none}` 优先级低于仓里的 `display:grid`，胜利卡片其实一直在盖着画布吃掉事件。加 `.curtain[hidden]{display:none}`（`.toast` 同）。**注入 JS 改状态永远测不出这一条**，只有 CDP 真事件能。 |
| `cardPoint()` 返回整张牌的中心 | 拖"最上面那张牌"本该不拆分，却拆在了下一张上 | 牌是叠着的，可见带只有 `step` 高：命中判定按带（`floor((y-oy)/step)`），而返回给台架的坐标用的是整张牌中心 `cardH/2`，`cardH > step` 时落到下一带。改成 `cardMid()` 返回可见带中心，两者同一个模型。 |
| 把 `distanceMap` 的 `dist` 数组按字符串 key 索引 | 断言得到"更短的 par"，看起来是求解器出错 | 其实 `dist['10']` 被 JS 当成 `dist[10]`（数组下标），读到的是**另一个分拆**的距离。core 补 `byKey` 映射，测试改用 `m.byKey.get(key(start))`。这条是测试写错，不是实现错。 |
| 手写期望 `deal([4,1,1]) == [3,2,1]` | game 层 7 条断言连坐失败 | 期望值算错了：三堆 → 新堆是 3，两张单牌抽空后消失，结果是 `[3,3]`。修的是测试期望，代码没动。 |
| 以为 10 个单牌"只发牌要 10 步" | make 层断言失败（实测 7） | 第一次发牌把 10 个单牌聚成 `[10]`，单堆 `T_k` 只需 `T_{k-1}` 步：`1 + 6 = 7`。这个闭式现在是一条断言（`k=2..7` 给 1,3,6,10,15,21）。 |
| 派单文字里的 "for n=12 (78 cards)" | 与 `p(12)=77` 矛盾 | 规格 `b3-staircase.md` 的反面情形是 **12 张牌的 77 个分拆全部周期**（`T_12 = 78`、`p(12) = 77` 被串成了一句）。按规格实现并测成 `states=77, cyclic=77, open=0`。 |
| `hashSeed` 名字 | —— | 它是 FNV-1a **派生**的两轮 UTF-16 混合：`hashSeed('a') = 723832900`，教科书 FNV-1a 是 `3826002220`。测试只断言自洽值与"不等于公开向量"，不声称符合任何人。 |
| 难度带一开始写成 `par ≥ 2` | 出厂关卡挤在最易一档，band 名存实亡 | 先用 `distanceMap` 把 `p(n)` 个开局的 par 直方图整个打出来，再把带定在直方图的上半部（`shoal 2-3 / linked 3-4 / twined 4-5 / master 5-7`）。带是**测量之后**定的，定级用的表由 `bake` 每次重打。 |
| 端口与兄弟仓相撞 | 台架会测到别人家的游戏 | 本仓固定 web `5212` / CDP `9353`（`:5180/:9340` 是 gridlock，`:5181/:9341` 是 nine-rings）；`verify.sh` 启动前 `lsof` 检查占用，Chrome 用独立 `mktemp -d` profile，`trap cleanup EXIT` 里 `wait` 掉后台 PID，导航后 `waitShell()` 轮询 `window.stair.state.id` 而不是定长 sleep（定长 sleep 会把画布留在未样式的 300×150 上，制造假故障）。 |

## 8. 存档与失败方式

`storage.js#localStorageBackend()` 在没有 `window.localStorage` 的环境里**抛异常**（node、`file://`、
被拦的页面），而不是返回 null 假装存过了。`main.js` 捕获一次，退化成 `memoryBackend()`，
并把退化原因写在面板的"成绩只存在这台设备"那一行（`window.stair.state.storage` 报告后端名）。
`best` 只降不升、`unlock` 只升不降、清档真的删 key，都由 `test/storage.test.mjs` 钉住。

## 9. 已知不做

* `T_k > 28`（`p(36)=17977` 算得动，但 36 张牌在画布上读不成一竖列）。
* 多人、在线、排行榜、成就、签到、内购、云存档。
* 牌面美术素材：卡背是圆角矩形 + 内衬 + 阴影，纯绘制，零图片文件。
* 玩家自定义牌量：所有 `n` 都来自 `TIERS`，因为每档的 `par` 带与穷举表都是按 `n` 预先量好的。
* 动画与音效：`view.js` 的 `requestAnimationFrame` 循环只在拖拽 / 提示高亮 / 拒绝闪烁时重绘，
  胜利卡片出现后不再持续重绘（省电，也让 headless 的 `visibilitychange` 不影响验收）。
