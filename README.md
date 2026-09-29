# 保加利亚梯 · BULGARIAN

交付物：浏览器原生的保加利亚纸牌（Bulgarian solitaire），零运行时依赖、零打包器、零图片素材，
一个 `server.cjs` 起页面，一条 `npm test` 把这仓主张的全部数字复跑一遍。
屏幕上那两个数字不是设定值：**最少** `par` 是发牌/并堆/拆堆这张动作图上的最短操作数，
由广度优先搜索量出来；**只发牌** `steps` 是定理给的那条纯发牌路线的长度，由逐步模拟量出来。
两个数都在构建期从关卡自己那份序列化 `spec` 重算一遍，对不上就不写盘（`tools/bake.mjs:80-96`）。

这个文件只写**本轮复跑量出来的事实**，每个数字后面挂 `文件:行号`；量不到的事一律进最后一节。
本轮跑过的是 `npm test`、`node --test test/`、`node tools/bake.mjs`（在仓库副本里跑的，理由见第五节）
和几个只读观测脚本；**按指令没有跑 `tools/verify.sh`**（浏览器闸重，会污染同一台机器上其它代理的计时读数），
所以第六节里浏览器闸的条数是源码静态计数，不是实测。

## 一、规则，以及它能被指到哪儿

这个仓**没有日文原文，也没有可点名的英文 URL**，所以不要在这里写"日英双源"。能指的只有四处内部证据：

* **规则本体**写死在三行里：`js/core/deal.js:19-24` —— 新堆的大小是**发牌前**的堆数
  （`const count = piles.length`），每堆减一，抽空了的堆被 `.filter(p => p > 0)` 丢掉。
  同一件事的第二种写法是重数向量版 `dealByCounts()`（`js/core/deal.js:30-41`），两条路在
  3/6/10/15/21/28 张牌的全部 **4742** 个局面上逐一相等（断言 `test/deal.test.mjs:47-61`，
  和式与 4742 都在 `test/deal.test.mjs:59-60`；该用例的标题里那句"4137 boards"是旧读数，
  断言钉的是 4742 —— 标题与断言不一致，本轮按断言写）。
  `DESIGN.md:39-45` 把那三行原样贴了一遍，并说明前两位建造者在这条上翻过车。
* **定理的正反两面都是本仓穷举出来的**，不是引来的：收敛普查 `js/core/deal.js:117-136`，
  轨道普查 `js/core/deal.js:140-162`。`js/core/deal.js:6-10` 只把这称作"the literature 里那条定理"，
  没有点名文献。
* **唯一一条可点名的外部锚**是整数分拆表：`test/partition.test.mjs:3-4` 写明它是 OEIS A000041、
  "written by hand from the literature and never read back out of this repo's own enumeration"，
  表体在 `test/partition.test.mjs:13-16`（p(0..15)、18、20、21、28），与递归枚举
  （`js/core/partition.js:69-75`）和 Euler 五边形数递推（`js/core/partition.js:93-110`）三方对账，
  对账的断言在 `test/partition.test.mjs:63-67`、`test/partition.test.mjs:88-99`。
* 派单文档 `b3-staircase.md` 被 `DESIGN.md:116` 与 `deliverable.md:106` 引用过，
  **但它不在仓里**，本轮在工作区根也没找到，所以本文件不把它算作出处。

玩家的三种操作与"这一步合法吗"只有一个裁决者：`applyAction()`（`js/core/solve.js:25-54`，
动作种类表 `js/core/solve.js:20`），拒绝时给的那句话在 `js/core/solve.js:57-70`。
手指点击、拖拽、bake 存下来的 `path`、提示用的搜索、测试里的 `replay()` 全都过这一个闸门
（`js/core/game.js:42-54` 的 `act()`、`js/core/solve.js:282-292` 的 `replay()`、
`js/core/make.js:47` 出货前的回放、`js/main.js:187-202` 的 `commit()`），
所以"测试点得动"和"规则允许"不可能是两套答案；`test/game.test.mjs:143-155` 把 27 关逐关用
`act()` 走完认证路线，`test/solve.test.mjs:163-168` 再证 `replay()` 走的是同一道闸门。
`js/view.js` 只交出手势、不判合法性，这件事被静态地钉在 `test/repo.test.mjs:72-81`。
过关判定只有一句：`js/core/game.js:52` 的 `key(next) === game.targetKey`；
星级是算术，不是印象：`js/core/game.js:100-105`（`moves ≤ par` 三星，`≤ par+2` 两星，否则一星）。
目标形状由开局自己推出来，不来自表：三角数 `n = T_k` 就是阶梯 `(k,…,1)`，
非三角数就取**该开局自己的周期轨道上降序字典序最小的那个成员**（`js/core/deal.js:85-105`），
旁边印的 `orbit(周期, 尾巴)` 就是这个选择的结果（`js/core/partition.js:112-129` 负责"最小"）。

## 二、承诺表：每条都是一条真会红的命令

下面这六条的"读数"一列，**全部来自本轮 `npm test` 的原样输出**（`rows: N fail: 0` 那一行由
`tools/harness.mjs:36-41` 打印，任何一行失败就 `process.exit(1)`）。本仓没有
`tools/check.mjs` 那样的聚合门，所以"少跑一套就红"这句话不成立，见最后一节。

| 承诺 | 哪条命令会红 | 判什么 | 条数从哪来 |
|---|---|---|---|
| 出厂每一关印着的 `par` / `steps` / `path` 还能从它自己那行的 `spec` 重算出来 | `npm test`（`test/library.test.mjs`）；`node tools/bake.mjs` 在写盘之前自己再判一遍 | `solve(spec.start, spec.target)` 的 `par` 必须等于印着的 `par`（`test/library.test.mjs:30-39`），`targetOf().steps` 与 `stepsToDeal()` 两路都必须等于印着的 `steps`（`test/library.test.mjs:41-53`），`path` 逐步回放必须落在目标上且长度等于 `par`（`test/library.test.mjs:86-93`）；写盘侧是 `tools/bake.mjs:85,87,90,93,95` 这五处 `throw` | 本轮 `rows: 12 fail: 0`；12 也是 `test/library.test.mjs` 里 `test()` 调用点的静态计数 |
| 三角数牌量的**每一个**开局都收敛到阶梯，最坏步数恰是 `k(k-1)` | `npm test`（`test/deal.test.mjs`）+ `node tools/bake.mjs` | `stuck` 必须是 `[0,0,0,0]`、`open` 必须是 `[0,0,0,0]`、局面数必须是 `[3,11,42,176]`（`test/deal.test.mjs:71-77`）；`worst` 必须是 `[2,6,12,20,30,42]` 且逐个等于 `closedForm`（`test/deal.test.mjs:79-84`）；六个最坏开局逐条点名（`test/deal.test.mjs:86-93`）；bake 侧是 `tools/bake.mjs:108,110` 两处 `throw` | 本轮 `rows: 16 fail: 0`；bake 本轮打印 6 行 `proof converge …` |
| `par` 是"没有更短"的证明，不是搜索器自己给自己打分 | `npm test`（`test/solve.test.mjs`）+ `node tools/bake.mjs` | `T_k` 最难的开局正好要 `k` 步、且 `unreachable === 0`，五档全查（`test/solve.test.mjs:99-109`）；`distanceMap` 反向 BFS 的读数必须逐个等于单点 `solve()` 的读数，10 张牌 42 个开局全比（`test/solve.test.mjs:111-121`）；`parProof` 要求分层 / 正向 / 反向三条路同数且边表闭合（`test/solve.test.mjs:129-138`，实现 `js/core/solve.js:159-185`）；`buildGraph` 对 15 张牌必须闭合且恰好覆盖 p(15)=176 个局面（`test/solve.test.mjs:140-150`）；超限的搜索必须报 `capped` 而不是猜一个数（`test/solve.test.mjs:152-156`）；bake 侧是 `tools/bake.mjs:122,123,134` | 本轮 `rows: 17 fail: 0`；bake 本轮打印 5 行 `proof par-map …` + 7 行三路对账 |
| 出题器不许把玩家骗进"数不对的题"：拒绝要说理由，接受要能回放 | `npm test`（`test/make.test.mjs`） | `rateLot` 的五条出口逐个点名（`js/core/make.js:39-49`；断言 `test/make.test.mjs:77-85`，其中 `[6,2,1]`→`par 3 不在带内`、`[1×6]`→`开局即目标`）；生成盘必须 `2 ≤ par ≤ steps`、`path.length === par`、attractor 前缀与 `k` 一致（`test/make.test.mjs:87-102`，四档各 25 颗 seed）；`partitionsOf` 的枚举顺序是生成器契约，写死三条（`test/make.test.mjs:152-156`） | 本轮 `rows: 13 fail: 0` |
| 同一颗 seed = 同一副牌；每日题在任何设备上是同一副 | `npm test`（`test/make.test.mjs`） | `hashSeed('a') === 723832900` 且必须**不等于**公开 FNV-1a 的 `3826002220`（`test/make.test.mjs:16-27`，实现 `js/core/rng.js:4-13`）；同一 seed 连跑两次逐字段相同、不同 seed 不许撞（`test/make.test.mjs:104-115`）；`dailyLot('2026-09-27')` 两次同盘、次日必须是另一副、而且本机 `targetOf` 重算必须与盘上数字一致（`test/make.test.mjs:125-138`）；`#/random` 四条档位分别同 token 同盘（`test/make.test.mjs:140-150`） | 本轮 `rows: 13 fail: 0`（与上一条共用套件）；本轮另跑 3 次 `makeLotTrying('frozen-seed','twined')`，三次逐字相同：`frozen-seed|4|10,1,1,1,1,1|4` |
| 这个仓自己作为门禁：零依赖、无二进制资产、分层不许渗、CI 与本地文件集不许漂、端口归属不许撞、README 与交付报告同名 | `npm test`（`test/repo.test.mjs`） | `dependencies` / `devDependencies` 必须都是 `{}`（`test/repo.test.mjs:29-37`）；禁 14 种二进制扩展名且任何被拷的文件不得 > 400 kB（`test/repo.test.mjs:39-46`）；favicon 必须是内联 `data:image/svg+xml,` 且 HTML 里不许有 `<img`（`test/repo.test.mjs:48-55`）；`js/core/` 里不许出现 `window.` / `document.` / `localStorage`，只有 `storage.js` 被允许读且必须**抛异常**（`test/repo.test.mjs:57-70`）；CI 的 Syntax 步骤 glob 集合必须与 `npm run check` 完全一致（`test/repo.test.mjs:83-91`）；`pages.yml` 只许 `cp index.html` + `cp -r css js`（`test/repo.test.mjs:93-100`）；`verify.sh` 里 CDP 9353 / web 5212、`mktemp -d`、`trap cleanup EXIT`、两个后台 PID 都被 `wait`、启动行里不许出现 swiftshader（`test/repo.test.mjs:102-116`）；README 首行必须逐字是 `# 保加利亚梯 · BULGARIAN` 且与 `deliverable.md` 的 App 名称行同名（`test/repo.test.mjs:118-126`） | 本轮 `rows: 11 fail: 0` |

## 三、怎么跑：`package.json` 的 8 条脚本逐条核对

`package.json` 全文 39 行，顶层键是 `name`/`version`/`description`/`type`/`main`/`scripts`/`keywords`/
`author`/`license`/`dependencies`/`devDependencies`/`build`；`dependencies` 与 `devDependencies`
都是空的 `{}`（`package.json:30-31`），所以不需要 `npm install`。下面每一行都对着
`package.json:7-16` 抄，最后一列是本轮**是否真的执行过**。

| 命令 | 展开成什么 | 出处 | 本轮 |
|---|---|---|---|
| `npm start` | `node server.cjs`（端口默认 5212） | `package.json:8`、`server.cjs:60` | 未跑 |
| `npm run dev` | `node server.cjs 5212` | `package.json:9` | 未跑 |
| `npm run electron` | `electron .`（electron **不是**依赖，需自备） | `package.json:10`、`electron/main.cjs:1-4` | 未跑 |
| `npm run bake` | `node tools/bake.mjs`（**会重写 `js/data/lots.js`**） | `package.json:11` | 在仓库副本里跑过，见第五节 |
| `npm run check` | `for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" \|\| exit 1; done && echo OK` | `package.json:12` | 跑过（作为 `npm test` 的第一步），打印 `OK` |
| `npm run unit` | `for f in test/*.test.mjs; do node "$f" \|\| exit 1; done` | `package.json:13` | 跑过（作为 `npm test` 的第二步） |
| `npm test` | `npm run check && npm run unit` | `package.json:14` | **跑过，rc=0** |
| `npm run verify` | `bash tools/verify.sh` | `package.json:15` | **按指令未跑** |

本轮 `npm test` 的原样结论行（`>` 那两行是 npm 自己回显的命令）：

```
> staircase@1.0.0 check
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK
OK
rows: 16 fail: 0     rows: 12 fail: 0     rows: 12 fail: 0     rows: 13 fail: 0
rows: 14 fail: 0     rows: 11 fail: 0     rows: 17 fail: 0     rows:  8 fail: 0
```

八行合计 **103 条断言 / 0 失败**，语法门扫到 **24 个文件**（本轮把这 24 个文件名逐个列出来数过：
`js/main.js`、`js/view.js`、`js/core/` 八个、`js/data/lots.js`、`server.cjs`、`electron/main.cjs`、
`tools/` 三个 `.mjs`、`test/` 八个 `.mjs`）。
`node --test test/` 也跑过，原样结尾：`ℹ tests 8`、`ℹ suites 0`、`ℹ pass 8`、`ℹ fail 0`、
`ℹ duration_ms 216.620583`。这套 `node --test` 之所以能用，是因为每个套件末尾自己调
`run()` 收尾（`tools/harness.mjs:36-41`），而不是靠测试运行器发现用例。

`tools/` 里没有 `check.mjs`、没有 `balance.mjs`、没有 `golden*`、没有 `counter-test`：
`tools/` 一共四个文件（`bake.mjs` 179 行、`harness.mjs` 41 行、`playtest.mjs` 597 行、
`verify.sh` 131 行）。别处如果写"七套 suite"或"平衡闸"，在这个仓都没有对应物。

## 四、门禁清单：每套判什么、本轮交回几条

八套 node 断言全部由 `npm test` 跑到（条数 = 本轮 `npm test` 输出的 `rows:` 原样，
顺序就是 `test/*.test.mjs` 的字典序），右侧"静态"列是该文件里 `test()` 调用点的计数，
本轮两者逐套相同。

| 套件 | 判什么（关键断言的行号） | 本轮实测条数 | 静态条数 |
|---|---|---|---|
| `test/deal.test.mjs` | 发牌规则的四把手算例、两写法在 4742 个局面上对账、收敛普查 `stuck=[0,0,0,0]`、最坏 `[2,6,12,20,30,42]` 与 `k(k-1)`、六个最坏开局点名、12 张牌的反面（77/77/0、周期只有 5、67 个有尾巴）、18/20 张牌（385、627）、`targetOf` 两类出口、单堆 `T_k` 的闭式 `1,3,6,10,15,21` | 16 | 16 |
| `test/game.test.mjs` | `act()` 是唯一写入者：发牌计一步、非法动作**连计数器都不动**、`undo` 能重开已结束的关、`reset` 回到出厂、`grade` 的三档算术、提示是有界搜索且不落笔就不算步、27 关逐关用 `act()` 走完认证路线 | 12 | 12 |
| `test/library.test.mjs` | 出厂表自证：`spec` 重解、`steps` 重模拟、`par ≤ steps` 且至少九成严格更短、`steps/par` 最大比值 ≥ 5、三角关必须指向阶梯而非三角关必须是 `orbit(a,b)` 形状、`path.length === par`、`TIERS_META` 必须是被量出来的不是抄上去的、`master` 档真的带着 12 与 18 两种反例 | 12 | 12 |
| `test/make.test.mjs` | rng 与出题：`hashSeed` 自洽且不冒充公开向量、日期不撞、`mulberry32` 可复现、四档 `TIERS` 的 ns 列表被钉死、`rateLot` 五个拒绝理由、生成盘 100 颗 seed 的不变式、seed→盘 幂等、`makeLotTrying` 的 40 次上限、枚举顺序契约 | 13 | 13 |
| `test/partition.test.mjs` | 状态代数与"有多少个状态"：三角数/阶梯判定、`key()` 规范化、`isPartitionOf` 的六种拒绝、p(0..15/18/20/21/28) 与公开表对账（枚举与递推两条路各一遍）、字典序与 `minPartition` | 14 | 14 |
| `test/repo.test.mjs` | 见上一节最后一行 | 11 | 11 |
| `test/solve.test.mjs` | 三动作的合法性与文案、`neighbors` 的保牌与规范化、把手算 fixture（`[6]`→par 2、六张单牌→par 3、`[2,2,1,1]`→par 1 而只发牌要 6）、`T_k` 最难开局 = `k`、42 个开局逐一等于 `distanceMap`、12 张牌最难开局 par 5、三路对账、`buildGraph` 闭合、超限报 `capped`、`replay` 走同一闸门 | 17 | 17 |
| `test/storage.test.mjs` | 存档：没有 `window.localStorage` 就**抛**、后端必须真有三件套、`best` 只降不升 / `plays` 只升 / `perfect` 一旦成立不再掉、`unlock` 单调、每日打卡按日期分账、`solves/ops/deals/hints/perfect` 分开记账、清档真的删 key、坏 JSON 与坏形状都从空白开始而不是崩 | 8 | 8 |

`tools/bake.mjs` 是第二层门，但它**不在 `npm test` 里、也不在 CI 里**（`ci.yml:32-35` 只有 Syntax 与 Suites
两步，没有 bake 步骤），而且它会重写 `js/data/lots.js`（`tools/bake.mjs:168-170`）。
本轮为了不动仓里的文件，把它在仓库副本上跑了一遍（`rsync --exclude .git` 到工作区根的
`_tmp-staircase-bake/`），rc=0，结论行原样：

```
wrote 27 lots (shoal:5 linked:7 twined:8 master:7) -> js/data/lots.js
tries 293 accepted 27 rate 9.2%
rejections: 开局即目标=3 一步内的题=40 重复局面=10 par 2 不在带内=100 par 3 不在带内=81 par 4 不在带内=32
max BFS states 1692 · slowest par-proof 196ms · total 0.5s
```

外加 18 行 `proof …`（6 行收敛、5 行 par-map、7 行三路对账），stderr 一行
`note: master reached 7/8 (only so many openings clear the band)`。
它内部有 **12 处 `throw`**（`tools/bake.mjs:85,87,90,93,95,102,108,110,122,123,134`）全部在写盘那一步之前，
所以"数对不上就不落盘"是顺序决定的事实，不是承诺。
本轮还做了一件没有闸门支撑、只能算一次性对账的事：**副本烤出来的 `lots.js` 与仓里那份逐字节相同**
（`diff` 忽略 `BAKED_AT` 那一行为空；仓里那份 11,097 B，`deliverable.md:194` 记的线上抓到的也是 11,097 B）。
这条不要读成"重烤永远得到同一批盘"——bake 会静默重写文件，CI 也不跑它，能钉住出厂数据的只有
`test/library.test.mjs` 那一套，而且它对关卡数只有 `≥ 24` 的地板（`test/library.test.mjs:15`、
`test/repo.test.mjs:142`），本轮实测是 27。

浏览器层五段（`bash tools/verify.sh`，**本轮未跑**）：`verify.sh:99` 的默认清单是
`boot play routes save pointer`，每段交回 `rows/fail` 两个数（`verify.sh:101-122`），
判据本体全在 `tools/playtest.mjs` 的 `SCENARIOS`（`tools/playtest.mjs:360-592`）与
`pointerScenario()`（`tools/playtest.mjs:171-357`）。**源码里没有钉"每段该交回几条"的期望值**，
`fail` 为空就 `exit 0`（`verify.sh:121`、`verify.sh:130-131`），所以本仓**没有**
"少一条断言就红"这类地板。能给的只有静态计数（`rec()` 调用点，`tools/playtest.mjs`）：

| 段 | 判什么 | 必然执行的 `rec()` 数 |
|---|---|---|
| `@boot` | `window.stair.version === 1` 且开局是战役模式、画布宽高非 300×150 默认、按像素采样证明牌堆真的被画过（`lit > 50`）、出厂池 ≥ 24 关、四档都有读数、页面自己搜出来的路线长度等于 `par`、本机 `reSolve` 对账为真、面板同时印"操作/最少/只发牌"、在这个浏览器里重跑 6 张牌（11/0/6）与 10 张牌（42/0/12）的普查、12 张牌的 77 个轨道全周期、attractor 与牌数一致 | 13 |
| `@play` | 页面现搜的路线恰为 `par`、并一刀换两步回原形、按认证路线打完必须三星并落档、只发牌打完必须 ★☆☆ 且 `moves === steps` 且发牌计数等于 `steps`、非法动作不计数并给出中文理由、撤销、提示要计一次 hint 且提示那一笔必须点得动、用完提示的那局要记账、重开清计数清卡片 | 13 |
| `@routes` | `#/c/n` 的四条（正常、超大索引夹到末关、0 夹到 1、垃圾段回落成可玩的一关）、`#/lot/<id>` 两条（打开与未知 id 回落）、`#/daily` 三条（同一日期两次同盘、标签带日期、`par` 是本机量的）、`#/random/<band>/<token>` **四档各一条**（所以这 4 条与档位表绑死）、裸 `#/random` 会把 token 写进 URL | 14 |
| `@save` | 清档后为空、后端名字说出口、成绩真的落进 `localStorage` 而不只在内存里、通关解锁下一关、更差的一轮不许抬纪录但要抬 `plays`、后来命中 `par` 要保住 `perfect`、`unlock` 单调、货架第二关可点、当日通关要打卡且货架显示"已通过"、清空存档必须两次点击且 key 真没了 | 12 |
| `@pointer` | 全部走 CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`：十二个控件 id 都在、盘带认证 `par`、画布有真像素、**用鼠标把整条认证路线走完且每一手势后的盘面都等于 `applyAction` 算出的那一个**、终点判定 + 三星 + 落档、原地按不算拆、点同一堆两下是放下、裸桌面不计数、点两堆就是并一次、九倍过拖仍只拆一处、抓最上面那张不拆、`d/u/h/r` 四个键各一次 | 19 |

合计 71。`@pointer` 另有 4 处只在事情坏掉时才追加的 `rec()`（`tools/playtest.mjs:227,232,241,242`）。
`@play` 里那两条"只发牌"和 `@pointer` 里"并堆/过拖"两条形如 `if … else rec(…, false, …)`
的分支值得单独说一句：它们**没有跳过**，条件不满足就直接判 false
（`tools/playtest.mjs:455-456`、`tools/playtest.mjs:307`、`tools/playtest.mjs:328`），
所以这几条红的时候是真的有东西不对，不是没测到。
`deliverable.md:139-156` 记录过一次实跑交回的正是 13/13/14/12/19、`(none)` 控制台、`=== ALL GREEN ===`，
那是**上一轮别人的读数**，本文件不把它当本轮证据。

## 五、目录（本轮 `ls` 的真实结果，行数由 `wc -l` 量）

```
index.html            64 行 / 4,027 B   单画布外壳 + 内联 SVG data-URI favicon + "这一关的数字从哪来"面板
css/game.css         187 行 / 5,700 B   含 .curtain[hidden] / .toast[hidden] 两条防吞事件的规则（103-106、180 行）
js/main.js           427 行 / 15,934 B  路由、面板、存档接线、window.stair === window.staircase 钩子
js/view.js           373 行 / 14,367 B  canvas 2D 绘制 + 手势，不判合法性；几何唯一源是 measure()
js/core/deal.js      162 行 / 6,679 B   发牌规则两份写法 + 轨道 + 收敛/轨道普查 + 目标形状
js/core/partition.js  129 行 / 3,954 B  状态=整数分拆、key()、枚举、Euler 递推、字典序
js/core/solve.js     292 行 / 11,052 B  applyAction 单闸门、分层 BFS、buildGraph、parProof、distanceMap、replay
js/core/make.js       97 行 / 4,348 B    出题：TIERS 四档、rateLot、makeLot / makeLotFromN / makeLotTrying
js/core/library.js    86 行 / 3,144 B    战役表读取、#/daily 与 #/random 现场生成、reSolve、stats
js/core/game.js      105 行 / 3,408 B    一局状态机：act/select/undo/reset/hint/grade/snapshot
js/core/storage.js   132 行 / 4,202 B    一个 key（staircase.save.v1）、守卫式 localStorage（抛异常）、内存后端
js/core/rng.js        49 行 / 1,523 B    hashSeed（FNV-1a 派生的两轮 UTF-16 混合）+ mulberry32
js/data/lots.js       37 行 / 11,097 B   构建期产物：27 关 + TIERS_META + BAKED_AT，每行自带 spec
server.cjs            70 行 / 2,326 B    零依赖静态服务（CommonJS，Electron 也 require 它）
tools/bake.mjs       179 行 / 8,801 B    出题 + 写盘前的 12 处 throw + 打印那 18 行 proof
tools/harness.mjs     41 行 / 1,251 B    node 与浏览器同形状的断言行，rows/fail 两列
tools/playtest.mjs   597 行 / 31,169 B   裸 CDP 驱动（node 全局 fetch/WebSocket）+ 五段判据
tools/verify.sh      131 行 / 5,188 B    生命周期：起 Chrome 与服务、预检、聚合、cleanup
test/*.test.mjs      8 个文件（deal 170 / game 158 / library 150 / make 158 / partition 112 / repo 150 / solve 170 / storage 99 行）
electron/main.cjs     36 行              桌面壳：startServer({port: 0}) 起临时端口再 loadURL
.github/workflows/ci.yml     50 行       unit job（Syntax + Suites）与 browser job（SKIP_UNIT=1、WD_TIMEOUT=240）
.github/workflows/pages.yml  45 行       只 cp index.html 与 css/ js/
DESIGN.md 135 行 / README.md（本文件）/ deliverable.md 209 行 / LICENSE / .gitignore
```

出货产物是 **13 个文件**：`index.html` + `css/game.css` + `js/` 下 11 个 `.js`（本轮
`find js -name '*.js' | wc -l` 实测 11）。名单由 `pages.yml:29-31` 那三行决定，
`test/repo.test.mjs:93-100` 不许它把 `tools/`、`test/`、`server.cjs`、`electron/` 带进产物，
也不许写 `path: .`。

## 六、难度是怎么量出来的

这个仓没有抽样平衡脚本，难度是一张**全量直方图**：`distanceMap(n, staircase(k))`
把 `p(n)` 个局面和它们之间的所有合法动作整张建出来，从目标反向 BFS 一次，
于是同时得到每一个开局的 `par`、最难开局要几步、以及直方图（`js/core/solve.js:224-262`）。
本轮 `node tools/bake.mjs` 逐字打印（副本内跑，机器 Darwin 26.6.2 arm64、15 核、node v26.8.1）：

```
proof par-map n=6:  11 positions / 42 actions · max par 3 from 1,1,1,1,1,1 · hist [[0,1],[1,5],[2,4],[3,1]]
proof par-map n=10: 42 positions / 266 actions · max par 4 from 1,1,1,1,1,1,1,1,1,1 · hist [[0,1],[1,10],[2,19],[3,11],[4,1]]
proof par-map n=15: 176 positions / 1645 actions · max par 5 from 2,2,2,2,2,2,2,1 · hist [[0,1],[1,16],[2,57],[3,72],[4,28],[5,2]]
proof par-map n=21: 792 positions / 10225 actions · max par 6 from 2,2,2,2,2,2,2,2,2,2,1 · hist [[0,1],[1,24],[2,145],[3,319],[4,240],[5,57],[6,6]]
proof par-map n=28: 3718 positions / 63382 actions · max par 7 from 3,3,3,3,3,3,3,3,3,1 · hist [[0,1],[1,33],[2,298],[3,1055],[4,1461],[5,713],[6,144],[7,13]]
```

档位是**照着这张直方图的上半部**定的，不是先定再找证据（`js/core/make.js:14-28` 的注释这么写，
`DESIGN.md:118` 记了它一开始写错成 `par ≥ 2` 的那次）：`shoal 2-3 / linked 3-4 / twined 4-5 / master 5-7`。
本轮从 `js/data/lots.js` 读出来的实际分布是（`node -e` 只读查询 `js/core/library.js` 的 `ALL`）：

| 档 | 关数 | 牌量 | 出厂 `par` 逐个 | `par` 带（定义 → 实到） | 只发牌 `steps` |
|---|---|---|---|---|---|
| `shoal` 浅滩 | 5 | 6 | 2,2,2,2,3 | 2-3 → 2..3 | 3,3,5,3,4 |
| `linked` 连锁 | 7 | 10 | 3,3,3,3,3,3,4 | 3-4 → 3..4 | 4,5,6,7,7,9,10 |
| `twined` 缠绕 | 8 | 15 | 4,4,4,4,4,4,4,4 | 4-5 → **只有 4** | 5,5,5,8,9,12,12,13 |
| `master` 大师 | 7 | 12/18/21/28 | 5,5,5,5,5,5,5 | 5-7 → **只有 5** | 5,7,8,10,11,12,37 |

所以两个带的高半边（`twined` 的 5、`master` 的 6-7）在出厂数据里一次都没被用到——
带是**过滤器**（超出就拒，`js/core/make.js:46`），不是承诺"每档都会铺开"。
关卡数与接受率是本轮实测：293 次尝试接受 27 关（9.2%），拒绝原因点名到个位
（`par 2 不在带内=100 · par 3 不在带内=81 · 一步内的题=40 · par 4 不在带内=32 · 重复局面=10 · 开局即目标=3`），
`master` 只凑到 7/8 关并在 stderr 里明说（`tools/bake.mjs:53`）。

两个数各代表一种难度，而它们的差就是玩家的自由度：本轮实测 27 关里 **26 关 `par < steps`**，
唯一 `par == steps` 的是 `master-05`（21 张，开局 `7,2,2,2,2,2,2,2`，认证路线是五次发牌），
悬殊最大的是 `master-07`（`par 5 / steps 37`，比值 7.4）；这组事实由
`test/library.test.mjs:55-67` 钉成门（`par ≤ steps` 恒成立、`par ≥ 2`、至少九成严格更短、最大比值 ≥ 5），
`DESIGN.md:74-76` 写的是同一批数（本轮自己重查过，与它一致，含 `master-05` 那关的牌面）。
`js/data/lots.js` 每关还带着搜索见过的局面数 `states`：本轮最小 6、最大 1692（`master-07`），
而 `p(28) = 3718` 是这个动作图能有的最大结点集，所以提示那条**点击时的有界搜索**
（`js/core/game.js:91` 的 `maxStates = 20000`）在本仓所有能出货的牌量上都撞不到上限——
20000 > 3718 ≥ 任何一次搜索访问的状态数，本轮把 20 000 压在 `master-07` 的开局上确实得到
`{ok:true, par:5, states:1692, capped:false}`，而把上限压到 3 就退回 `null`（宁可不提示也不猜）。

结构量与计时量不是一回事。结构量（`p(n)`、`stuck`、`worst` 与 `worstFrom`、`par`、轨道长度、
出厂表）逐位可复现；计时量只当读数。本轮自己的读数（只读观测脚本
`_tmp-staircase-bench.mjs`，机器负载 `loadavg 2.47 / 2.72 / 2.80`，15 核，node v26.8.1）：
`#/daily` 八个日期全部出得来，平均 **3.9 ms**、最坏 **14.3 ms**，尝试次数 1–7；
`master` 档 `makeLotTrying` 二十颗 seed 二十次成功，平均 **19.6 ms**、最坏 **50.5 ms**、
尝试次数最多 25（上限 40，`js/core/make.js:91`）；最宽一关的 `reSolve` **14.2 ms**、
一次 `hint` **13.6 ms**（见 1692 个局面）；`distanceMap(28)` **94.7 ms**（3718 结点 / 63382 边）；
`convergenceCensus(15)` 0.7 ms、`orbitCensus(12)` 0.3 ms（77/77/0、`withPreperiod` 67、
`maxPreperiod` 8 —— 出厂那关 12 张牌的 `master-01` 标签正是 `orbit(5,8)`）；
bake 全量 **0.5 s**、`slowest par-proof` **196 ms**。
`DESIGN.md:87-105` 那张表记的是平均 13 ms / 最坏 36 ms / 最坏 137 ms / 311–533 ms，
比本轮大一截；它来自一个**没有入库**的一次性脚本（`deliverable.md:172-174` 自己写明了），
所以两处读数不该被当成同一个量互相对账，本文件只把本轮这一组当数。

## 七、端口与 URL 形态

本仓拥有的两个号写死在源码里，也被 `test/repo.test.mjs:102-116` 按字面正则钉住：
**web 5212**（`tools/verify.sh:22`、`server.cjs:60` 的默认值、`package.json:9` 的 `dev`、
`tools/playtest.mjs:16` 的默认 `BASE_URL`）、**CDP 9353**（`tools/verify.sh:21`、
`tools/playtest.mjs:13`）。`server.cjs:60` 允许 `argv[2] || process.env.PORT || 5212`，
`verify.sh` 也接受 `WEB_PORT=` / `CDP_PORT=` 覆盖，但默认值才是门读的那个数。
`verify.sh:6-9` 的注释点名了兄弟仓的 `:5180/:9340`（gridlock）与 `:5181/:9341`（nine-rings），
理由是"别人家的服务会答在这一口上，于是整套用例静默地在测另一个游戏"——这两个外部号是**注释里的说法**，
本轮没有去查那两个仓。`electron/main.cjs:11` 用 `port: 0` 拿临时端口，与上面两个号无关。

浏览器闸**只跑一种 URL 形态**：`BASE=${BASE_URL:-http://127.0.0.1:5212/}`（`tools/verify.sh:23`），
也就是仓库自己就是文档根的 root 形态；`tools/verify.sh` 里**没有** `SHAPES` 这类多形态循环
（本轮 grep 无命中），`playtest.mjs:523` 断言的路由形态（`#/c/…`、`#/lot/…`、`#/daily`、`#/random/…`）
全都是 hash，不是路径前缀。CI 的 browser job 原样继承这个默认（`.github/workflows/ci.yml:46-50`
只设 `SKIP_UNIT: 1` 与 `WD_TIMEOUT: 240`），**所以 CI 覆盖的是 root 一种，不覆盖 Pages 前缀那一种**。
`pages.yml:32-45` 把产物交给 GitHub Pages，前缀形态（`/z-biz-game-staircase-cos/…`）只有在真实部署之后
才存在，而本仓的 `server.cjs:49-55` 只有一个 docroot，**没有**"把仓库挂在一段前缀下"的本地服务模式，
所以要跑前缀形态只能 `BASE_URL=https://…/z-biz-game-staircase-cos/ bash tools/verify.sh`
（脚本会因此不起服务、只连一次 Chrome，`tools/verify.sh:23` 的覆盖就是为这条路径留的）——
本轮没有跑，也没有做任何网络核对。

`bash tools/verify.sh` 的失败是分号段的，每条都有明确的退出码，值得背下来：
`exit 2` 找不到 Chrome（`tools/verify.sh:33`）、`exit 6` `:$WEB_PORT` 已被占用
（`tools/verify.sh:36-39`，`lsof -nP -iTCP -sTCP:LISTEN`）、`exit 3` DevTools 始终没在
`:$CDP_PORT` 上绑定（`tools/verify.sh:61-66`）、`exit 4` 静态服务始终没答 `BASE`
（`tools/verify.sh:67-72`）、`exit 5` 页面里始终没有 `window.stair.state.id`
（`tools/verify.sh:92-97`），其余失败走 `FAILED=1` 那条汇总（`tools/verify.sh:75,130-131`）。
两处值得注意的不对称：预检**只查 web 口**，CDP 口 9353 不查，占了就撞上别人家的浏览器
（`tools/verify.sh:36` 那一个 `if`，`verify.sh:8-10` 把这条留给人工 `pgrep`）；
截图目录默认落在仓外的 `/tmp/puzzle-brief/shots`（`tools/verify.sh:24`），
`tools/` 与 `js/` 都不含 `shots/`，所以跑过一次浏览器闸之后仓里不会多出文件。
`verify.sh:57` 那条看门狗（默认 300 s、CI 给 240 s）会直接 `cleanup`，
`cleanup` 里 `kill -9` 再 `wait` 两个后台 PID 并删掉 `mktemp -d` 的 profile
（`tools/verify.sh:41-53`），这两条同样是 `test/repo.test.mjs:106-108` 按字面读的。

## 八、这个仓**不承诺**什么

| 不承诺 | 为什么（本轮实测/源码点名） | 出处 |
|---|---|---|
| **不承诺浏览器闸是绿的，也不承诺它的断言条数** | 按指令本轮没跑 `tools/verify.sh`，所以 `=== ALL GREEN ===` 这句话我没有本轮证据；更要紧的是**源码里没有条数地板**：`verify.sh:117-121` 只打印 `rows:` 与 `fail:`，`fail` 为空就退 0，node 侧 `verify.sh:80-84` 与 `package.json:13` 都是 `test/*.test.mjs` 的 glob——把八个套件删掉三个，两道门照样全绿。本文件给的 13/13/14/12/19 与 103 都是**静态或本轮实测的读数**，不是被钉住的期望值。 | `tools/verify.sh:80-84,99,117-121`、`package.json:13`、`tools/harness.mjs:36-41` |
| **不承诺站点在线，也不承诺 Pages 前缀形态可用** | CI 的 browser job 只跑 root 形态，Pages workflow 只是拷文件、不测前缀 URL，本地服务只有一个 docroot 因而没有前缀模式可跑；本轮没做任何网络核对。仓内唯一相关记录是 `deliverable.md:185-199`（主代理 2026-09-27 实抓的四个 200 与发布 sha `fd0fe15`），那是**转述**，不是本轮读数，也不是任何一道门。 | `.github/workflows/ci.yml:46-50`、`.github/workflows/pages.yml:27-35`、`server.cjs:49-55`、`deliverable.md:185-199` |
| **不承诺界面手感与美术** | 浏览器段只认三类证据：DOM id 齐不齐（`tools/playtest.mjs:200-201`）、画布有没有真像素与被画过（`tools/playtest.mjs:209`、`368-376`）、真事件之后状态与盘面变了没有（`tools/playtest.mjs:220-245`）。类名、`aria-*`、CSS 观感、注释里的意图一概不是证据；`css/game.css:103-106` 那两条 `[hidden]` 规则之所以重要，只是因为它们决定事件会不会被盖住的卡片吃掉（`DESIGN.md:111`）。 | `tools/playtest.mjs:171-357`、`css/game.css:103-106,180`、`DESIGN.md:111` |
| **不承诺 `par` 是"人类觉得难"，也不承诺难度梯子铺开** | `par` 是动作图上的最短操作数，仅此而已（`js/core/solve.js:97-129`）；带是过滤器不是分布承诺，本轮出厂数据里 `twined` 八关全是 4（带定义 4-5）、`master` 七关全是 5（带定义 5-7），高半边一次没被碰到。本仓也没有 `tools/balance.mjs`、没有"单调性"断言、没有 p95/预算那一套定价；跨档之间唯一的单调证据是那张 `par-map` 直方图的最大值 `3/4/5/6/7`。 | `js/core/make.js:23-27`、`js/core/solve.js:224-262`、本轮 `npm run bake` 副本读数 |
| **不承诺同一颗 seed 跨版本还是同一副牌，也不承诺存档会按题面作废** | seed→盘 是纯函数（本轮同 seed 连跑三次逐字相同，判定路径上没有随机数），但契约是"枚举顺序 + 那个 mixer"：`partitionsOf` 的字典序被 `test/make.test.mjs:152-156` 钉住、`hashSeed('a')=723832900` 被 `test/make.test.mjs:16-27` 钉住，流水线一改版同一个 seed 就是另一张盘。而 `js/core/storage.js` 全文没有题面指纹字段（存档形状只有 `records/daily/unlocked/stats`，`js/core/storage.js:37-45`），旧成绩只会按 `lot.id` 找回来。装机时的对账只到"打印一句警告"这一层（`js/main.js:96-98`），`@boot` 那条 `recheck.agrees` 判的是**当前这一关**，不是存档。 | `js/core/partition.js:65-75`、`js/core/make.js:72-80`、`js/core/storage.js:37-45`、`js/main.js:96-98` |
| **不承诺每日题与随机题永远出得来** | `makeLotTrying` 40 次封顶，撞满就返回 `ok:false`（`js/core/make.js:91-97`）；`dailyLot`/`randomLot` 拿到 null 时装配层**静默回落**到 `ALL[0]`，标签照旧写着"每日梯 · 日期"（`js/core/library.js:53-66`、`js/main.js:64-73`）。本轮 8 个日期 8/8 出、master 档 20 颗 seed 20/20 出、最多 25 次尝试（离 40 还有余量），但没有任何一道门判这条回落。裸 `#/random` 写进 URL 的那段 token 来自 `Math.random()`（`js/main.js:254`），所以"分享链接必同盘"只对已经带 token 的链接成立。 | `js/core/make.js:91-97`、`js/core/library.js:53-66`、`js/main.js:64-73,254`、本轮观测脚本 |
| **不承诺 `n > 28` 会被拒绝** | `partitionsOf(n)` 对任何正整数都算得动（`js/core/partition.js:69-75`），`MAX_N` 这类常量在发布前已被删除（`deliverable.md:201-204` 记录了这次删除）。"牌量上限 28"这件事由 `test/make.test.mjs:70` 钉死的 `TIERS` ns 列表 `[6]/[10]/[15]/[21,28,12,18]` 保证——是**档位表没有更大的 n**，不是引擎会拒绝更大的 n。 | `js/core/partition.js:69-75`、`test/make.test.mjs:68-75`、`DESIGN.md:130` |
| **不承诺非三角数关卡的目标是唯一答案** | 12 / 18 张牌没有阶梯，目标取**该开局自己轨道上降序字典序最小**的那个周期成员（`js/core/deal.js:85-105`、`js/core/partition.js:112-129`）；同一轨道里其余成员同样合法，"这个目标比别的难"没有任何测量。门的强度只是：`attractor` 必须长成 `orbit(a,b)`、`cycleLen ≥ 2`（`test/library.test.mjs:69-83`），以及 `master` 档至少两关是反例且牌量只能是 12 或 18（`test/library.test.mjs:140-148`）。 | `js/core/deal.js:85-105`、`test/library.test.mjs:69-83,140-148` |
| **不承诺任何计时上界** | 计时量与结构量分家的理由写在 `DESIGN.md:81-105`，而那张计时表的来源脚本没有入库（`deliverable.md:172-174`）。本轮同一台机器重测普遍更小（daily 平均 3.9 ms vs 表内 13 ms；`slowest par-proof` 196 ms vs 表内 311–533 ms），说明这些数随负载走。所以"点击时只做有界搜索"这条是真的（`js/core/game.js:91` 的 20000 是个字面上界），"最坏 137 ms"那类话只能当某一次的读数。 | `DESIGN.md:81-105`、`js/core/game.js:88-96`、本轮观测脚本 |
| **不承诺 `npm run electron` 能用** | 脚本在（`package.json:10`），electron 却**不是**依赖（`package.json:30-31` 两个 `{}`），`electron/main.cjs:1-4` 自己写明了这一点；本轮没跑过它。受支持的路径是 `npm run dev` / `npm start` / `bash tools/verify.sh`。 | `package.json:10,30-31`、`electron/main.cjs:1-4`、`deliverable.md:175-176` |
| **不承诺"引擎里没有时钟"** | 静态门只查 `window.` / `document.` / `localStorage`（`test/repo.test.mjs:57-70`），没有禁 `Date`；`js/core/rng.js:44` 有 `new Date()`（每日题的日期默认值），`js/core/storage.js:99` 有 `Date.now()`（每日打卡的时刻）。这两个读数都不进 `par`/`steps` 的判定路径，但兄弟仓那句"引擎不许出现 `Date`"在本仓是假的，不要照抄。反过来 `js/core/` 里 `Math.random` 是 0 处（本轮 grep，唯一一处在 `js/main.js:254`），不过这件事**也没有门**在管。 | `test/repo.test.mjs:57-70`、`js/core/rng.js:44`、`js/core/storage.js:99`、本轮 grep |
| **不承诺关卡数量是 27** | 门是地板不是等号：`test/library.test.mjs:15` 与 `test/repo.test.mjs:142` 都只要求 `≥ 24`。27 是本轮 bake 重烤并 `diff` 之后确认的当前出厂数（`wrote 27 lots (shoal:5 linked:7 twined:8 master:7)`），`master` 那一档本来想要 8 关、实际 7 关并在 stderr 里明说（`tools/bake.mjs:53`）。 | `test/library.test.mjs:15`、`test/repo.test.mjs:142`、本轮副本 bake 输出 |

License: MIT（`LICENSE`，`Copyright (c) 2026 z-biz-game`，由 `test/repo.test.mjs:128-134` 核对）。
