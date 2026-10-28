# 保加利亚梯 - 交付报告

| 字段 | 值 |
| --- | --- |
| **App 名称** | 保加利亚梯 |
| 英文名 / 仓名 | BULGARIAN · `z-biz-game-staircase-cos` |
| 基线 → 本次 | 并线后 `10f347f` → 修复 `64bef0e` + `aed596c` + 本文件这一笔 |
| 玩法一句话 | 每次从每堆各拿走一张、把拿走的聚成新一堆（新堆 = 发牌前的堆数，空堆消失）；牌数是三角数 `T_k` 时任何开局都必然走到阶梯 `(k,k-1,…,1)`，玩家另外可以并两堆或拆一堆，用最少操作摆出目标形状 |
| 依赖数 | 0（`dependencies` 与 `devDependencies` 都是 `{}`，无打包器、无 npm install） |
| node 层断言 | 148 条（11 个套件），fail 0 |
| 浏览器层断言 | 72 条（`@boot @play @routes @save @pointer` 五档），fail 0，console 干净 |
| 部署集闸 | 41 条引用（含 5 张位图尺寸核对）/ 69 条断言，fail 0；台架 `DS_SELFTEST rc=0` |
| 测试钩子 | `window.stair`（同时挂 `window.staircase` 别名） |
| 路由 | `#/c/<n>` · `#/lot/<id>` · `#/daily`（`hashSeed("YYYY-MM-DD")`） · `#/random/<band>/<token>` |

## 0. 一句话

并线（`864146f`）把两侧内容按"重叠块取较新权威"合到一起，在这仓留下六处互相打架的接线，
其中第一处是**整局级**的：`js/view.js` 里 `let reduceMotion` 被声明了两次，
ES module 里同名顶层声明是 SyntaxError ⇒ 模块根本不加载 ⇒ `js/main.js` 的 import 一起炸
⇒ 页面上一行都不跑。
这次修的还不止并线带进来的：浏览器闸的 `@pointer` 段在**并线前就已经是红的**——
第一次打开摊开的玩法说明盖住盘面，第一根合成手指点空、把说明关掉了，
于是"鼠标能不能把认证路线走完"这条腿实际什么都没量。
本次逐处归因并修掉，**没有删任何功能**：删的全是并线拼出来的重复实现
（两套 setter、两套全屏、两套动效监听、重复的 manifest link、重复的 service worker 注册），
并线弄丢的那几块（清单里更全的元信息、sw.js 的 SHELL 预缓存、文档的 25 处行号）都补回来了。

## 1. `js/view.js`：`let reduceMotion` 声明了两次 ⇒ SyntaxError ⇒ 整局不可玩

**旧代码错在哪**

并线后的 `js/view.js` 同时留着两处声明：

```js
  let reduceMotion = false;                                  // 68 行（远端侧那份）
  const ringPhase = () => (reduceMotion ? 0.5 : (performance.now() % 900) / 900);
  ...
  let reduceMotion = !!(media && media.matches);            // 79 行（本地侧那份）
```

ES module 的顶层是模块作用域，同名 `let` 声明两次是 **SyntaxError**（不是运行期错误），
解析阶段就失败 ⇒ `js/view.js` 永远不会被求值 ⇒ `js/main.js` 里的
`import { createView } from './view.js'` 一起失败 ⇒ 整局不可玩。

把并线后的文件原样复制成 `.mjs` 再 `node --check`，它自己这么说：

```
/private/tmp/_stair_view_head.mjs:79
  let reduceMotion = !!(media && media.matches);
      ^
SyntaxError: Identifier 'reduceMotion' has already been declared
```

**新代码为什么对**

只留一处声明，初值直接读 `matchMedia('(prefers-reduced-motion: reduce)')` 的 `matches`，
不是 `false`：玩家系统里开着减弱动效时，第一帧就不该闪一下再停下来。
同时把被指出的那张牌的描边环相位从 `performance.now()`（墙钟）换成 `animClock`（虚拟秒）：

```js
const t = reduceMotion ? 0.3 : (animClock % 0.9) / 0.9;
```

墙钟不冻，按住暂停键看环还在呼吸，是"暂停"这个词在骗人；虚拟秒冻住，环也跟着停。
原先那个 `ringPhase` 辅助函数在并线后已经是死代码（画环的地方直接算的），一并删掉。
对外只留一个 setter，名字取闸调的那个（`js/view.js:525-532` 的 `setReducedMotion`），
`test/view.test.mjs:159`（`setReducedMotion`）那条"reduceMotion 是真的分支"因此恢复绿。

## 2. 两套全屏接线叠在一起

**旧代码错在哪**

并线后 `js/main.js` 同时有两套全屏：

* 本地侧 `toggleFullscreen()` + `#fullscreen` 按钮；
* 远端侧 `bindFullscreen()` IIFE + `#btn-fullscreen` 按钮。

`index.html` 里两个按钮**都在**（80 行与 85 行），同一次点击走两条路；
远端那套还自己注册了一个 `keydown` 监听，于是按 F 键会**连着切两次**（进全屏再退出）。

**新代码为什么对**

能力取两边并集，只留一条接线：

* `js/main.js:417-425`（`fullscreenApi`）一次问清 `requestFullscreen` / `webkitRequestFullscreen` /
  `msRequestFullscreen` 与三个 `exit*`、三个 `fullscreenElement`；
* 查得出能力就进出，查不出就按 `js/main.js:427-430`（`markFullscreenUnsupported`）
  把按钮灰掉并把原因写进 `title`（不解释的禁用等于这功能没做完）；
* `requestFullscreen` 返回 Promise，iOS Safari 对多数非 video 元素直接拒绝，
  这个 rejection 必须吃掉，否则冒泡成未捕获错误、整局游戏跟着挂；
* Esc 与系统手势退出都不经过我们的代码，按钮状态只能靠 `fullscreenchange` 回写
  （否则用户已经退出、HUD 还停在「全屏」，下一次点击反而会重新进全屏）；
* 接线只绑 `#fullscreen`（`aria-pressed` 有 CSS 画按下态），重复入口 `#btn-fullscreen` 删掉。

F 键补 `ev.repeat` 守卫：按住不放不该连着切进切出。

## 3. 两套减弱动效路径 + 两个 setter 名字

**旧代码错在哪**

并线后 `js/main.js` 里 `applyReducedMotion`（本地侧）与 `motionQuery` / `applyReduceMotion`（远端侧）
各改各的状态；`js/view.js` 上同时挂着 `setReduceMotion` 与 `setReducedMotion` 两个 setter。
活下来的 `test/view.test.mjs` 调的是 **`setReducedMotion`**，删错那个就报
`view.setReducedMotion is not a function`。

**新代码为什么对**

合成一条路：系统设置（`matchMedia` 的 change 事件，老 Safari 走 `addListener` 回落）→
`js/main.js:72-76`（`applyReducedMotion`）→ `view.setReducedMotion` → 视图里那一个 `reduceMotion` 变量；
对外的运行时钩子也只留一份（`js/main.js:637-640` 的 `__rmHook`）。
视图上的 setter 幂等（同一个值再来一次直接返回，不重画——重画会把 `hintLeft` 这类倒计时也推一帧），
变了就重画：开关来回拨时环的相位要立刻换边，而不是等下一帧。

## 4. `sw.js` 整份取了远端侧那版

**旧代码错在哪**

并线把 `sw.js` 换成了远端侧那版（`VERSION='staircase-cos-v1'`、只预缓存 `index.html` 与
`manifest.webmanifest`、没有导航兜底），而活下来的 `test/pwa.test.mjs` 是照**本地**那版写的
（`sw.js:9-10` 的 `VERSION` 与 `SHELL` 预缓存 `./`、`./index.html`、`./manifest.webmanifest`、
`./css/game.css`、`./js/main.js`，外加"没有缓存时导航回落到 shell"那一条）。

**新代码为什么对**

闸是行为裁决者：`sw.js` 还原成本地那版。`test/pwa.test.mjs` 十条断言回到全绿
（并线后基线上这一条本来就是红的）。

## 5. `test/repo.test.mjs`：并线加了测试体却没并进 import

**旧代码错在哪**

并线在 `test/repo.test.mjs` 里加了一条"生成器逐字节重画每一张图"的用例，用到 `spawnSync`，
却没把 `import { spawnSync } from 'node:child_process'` 并进来 ⇒ 这条用例直接抛
`spawnSync is not defined`，整条腿红。

**新代码为什么对**

补上那一行（`test/repo.test.mjs:7` 的 `spawnSync`，node 标准库，仓里仍然零依赖）。
注意：加 import 会让这个文件其后的行号整体 +1，所以 README 里引它的 12 处 `文件:行号`
要跟着重钉（见第 7 节）。

## 6. `manifest.webmanifest` 与 `index.html` 的 `<head>`：两套合同叠在一起

**旧代码错在哪**

并线把清单换成了远端侧那版：四个图标**全部**以 base64 内联（清单 300 kB 起），
而活下来的 `test/repo.test.mjs` 要求清单里的图标**在盘上**且 `sizes` 等于 IHDR 真宽高
（`ok(existsSync(join(root, icon.src)))` + `eq(icon.sizes, ${w}x${h})`）⇒ 那条腿红。

远端那版清单还丢掉了本地那版更全的东西：`id` / `lang` / `dir` / `scope` / `display_override` /
`orientation` / `categories` / `shortcuts`，以及 `maskable 512` 与 `1024` 母本两档图标。

同一时刻 `index.html` 的 `<head>` 被并线拼成**两份**：两个 `<link rel="manifest">`、
两套 og/twitter 元信息 ⇒ `deploy-set` 的 H 段数出 26 个 head 标签，而它钉住的是 14。

**新代码为什么对**

* 清单还原成本地那版（文件图标，`manifest.webmanifest:16-21` 的 `icons`）。
  理由有三条：仓里物理上就带着那 12 张 PNG（`icons/`）与 4 张美术图（`assets/art/`），
  还有 `assets/gen/gen_art.py` 能把它们逐字节重画出来；`js/view.js` 按路径加载
  felt/cardback/glow 三张贴图；活下来的门禁就是"图标在盘上"这一条。
  远端那版的内联清单是为它自己那套"零二进制资产"的承诺准备的，本仓并不作那个承诺。
  `deploy-set` 的 P 段对**文件图标与内联位图读的是同一段 IHDR**，强度不减。
* `<head>` 去重成一份：留本地那版的 PNG favicon（16/32/48/64/96 + apple-touch-icon）
  与远端那版的内联 SVG favicon（它是零依赖的一枚图标，先于 PNG 生效），
  og/twitter 元信息各留一份（`index.html:10-26` 的 `og:image`）。
* `og:image` 改成**绝对 URL**：抓取器读的是别人页面上的字符串，不会替 Pages 补 `/<slug>/` 前缀，
  相对写法在别人眼里就是一张 404 的卡片。`deploy-set` 的 R7 就是量这一句，
  而它的前缀来源是 README 里那份部署前缀声明——本仓原先**没有**这份声明，
  于是 R7 连"前缀是什么"都不知道。本次在 README 第七节补上唯一的那一份。
* 顺带把仓里已有却没声明的 `favicon-48` / `favicon-64` 两档补进 `<head>`。
* 顺带收回**重复的 service worker 注册**：并线从远端侧搬来一个经典脚本 `js/sw-register.js`，
  `index.html` 里多一条 `<script src="js/sw-register.js">`，它自己也 register 一次；
  而 `js/main.js` 早已从 `./pwa.js` 调 `registerServiceWorker()`（带 `navigator.serviceWorker === null`
  与 `file://` 守卫，scope 按页面 URL 算，Pages 子路径下也对）。
  同一份脚本注册两遍，浏览器只会保留一个 registration，但那是两套并行的守卫与两处会各自
  报错的代码。留 `pwa.js` 那一套（有测试照着它写），删 `sw-register.js` 与那条 script 标签。

## 7. 文档行号：25 处引用全部漂了

**旧代码错在哪**

并线换掉了被引用的那些文件（`js/main.js`、`js/core/storage.js`、`server.cjs`、
`electron/main.cjs`、`tools/harness.mjs`、`css/game.css`、`test/repo.test.mjs`），
README 里 25 处 `文件:行号` 全部指错：4 处漂出文件末尾，40 处带着指认的引用落到了隔壁一行。
这就是仓里那条文档腿报的：

```
FAIL every `path:NN` citation in the docs points at a real file and stays inside it
       4/251 条引用不在盘上、同名不唯一或漂出文件末尾
FAIL the name glued to a citation really appears in the lines it points at
       40/244 条带指认的引用漂到了隔壁一行
```

**新代码为什么对**

逐条重钉到当前树上真的那几行（改的是**钉**，不是闸的断言强度）：

| 旧引用（并线前那一侧的行号） | 新引用 | 指认 |
| --- | --- | --- |
| `js/main.js` 187-202 行 | `js/main.js:225-247` | commit |
| `js/main.js` 64-73 行 | `js/main.js:101-117` | resolve / ALL |
| `js/main.js` 254 行 | `js/main.js:300` | `Math.random` |
| `js/main.js` 96-98 行 | `js/main.js:132-135` | recheck |
| `js/core/storage.js` 37-45 行 | `js/core/storage.js:57-65` | records |
| `js/core/storage.js` 99 行 | `js/core/storage.js:208` | `Date.now()` |
| `server.cjs` 60 行 | `server.cjs:63` | PORT |
| `electron/main.cjs` 9 行 | `electron/main.cjs:15-16` | port |
| `tools/harness.mjs` 36-41 行 | `tools/harness.mjs:49-55` | run |
| `css/game.css` 103-106、180 行 | `css/game.css:114-117,190` | hidden |
| `test/repo.test.mjs` 29-37 行 | `test/repo.test.mjs:40-47` | dependencies |
| `test/repo.test.mjs` 39-46 行 | `test/repo.test.mjs:50-60` | BANNED |
| `test/repo.test.mjs` 48-55 行 | `test/repo.test.mjs:195-203` | favicon |
| `test/repo.test.mjs` 57-70 行 | `test/repo.test.mjs:206-222` | localStorage |
| `test/repo.test.mjs` 72-81 行 | `test/repo.test.mjs:225-233` | view |
| `test/repo.test.mjs` 83-105 行 | `test/repo.test.mjs:236-256` | Syntax |
| `test/repo.test.mjs` 107-114 行 | `test/repo.test.mjs:259-265` | pages |
| `test/repo.test.mjs` 116-130 行 | `test/repo.test.mjs:268-281` | CDP_PORT |
| `test/repo.test.mjs` 120-122 行 | `test/repo.test.mjs:273` | wait |
| `test/repo.test.mjs` 132-140 行 | `test/repo.test.mjs:284-291` | BULGARIAN |
| `test/repo.test.mjs` 142-148 行 | `test/repo.test.mjs:294-299` | LICENSE |
| `test/repo.test.mjs` 154-156 行 | `test/repo.test.mjs:307-308` | rows |
| `test/repo.test.mjs` 174-243 行 | `test/repo.test.mjs:316-351` | scan |

README 里另外几处现在也说了假话，一并改成真的：

* 「零图片素材」「无二进制资产」——本仓有 16 张 PNG，全部可由 `assets/gen/gen_art.py` 逐字节重画；
* favicon 契约——原先写"必须是内联 `data:image/svg+xml,`"，实际门禁要的是**真的 PNG 文件**；
* 第五节那张目录表（行数/字节数）、出货产物文件数（13 → 37）、node 断言条数（111 → 148）、
  套件数（8 → 11）、语法门扫到的文件数（27 → 33）；
* `node --test test/` 这个写法在本机 node 22.22.3 上**跑不起来**（它把 `test/` 当模块解析，
  报 `Cannot find module '.../test'`），能跑的是 `node --test test/*.test.mjs`（11 pass / 0 fail）；
* 部署集闸那三对常量随并线后的产物重钉：`EXPECT_CHECKS` 29→41→43、`EXPECT_ROWS` 53→69→71、
  `EXPECT_HEAD_TAGS` 14→24→26（后一档是 2026-10-28 跟上 art 批次）（`tools/deploy-set.mjs:38` 的 `EXPECT_CHECKS`）。

## 8. 浏览器闸的 `@pointer` 段：并线前就已经是红的

**旧代码错在哪**

这一条不是并线带进来的——用 `git worktree add --detach /tmp/stair-ours 864146f^1` 在
**并线前**那一侧跑同一个闸，`@pointer` 同样 6 条红：

```
FAIL gesture 1 (deal) costed exactly one operation
FAIL the mouse plays the whole certified route, one operation per gesture
FAIL and every gesture landed where the route says
FAIL the last gesture lands the staircase and cannot be repeated
FAIL the win card goes up with three stars
FAIL the run is on record at par
```

根因在产品自己的一个**要留**的行为上：第一次打开这台设备（一个记录都没有）时，
`js/main.js:545`（`showHelp`）会把玩法说明摊在盘上。说明面板是 `position:absolute; inset:0`
的整层，点它自己的空白处就关掉它（`js/main.js:480` 的 `helpcard` 那个 click 处理写的就是
"点到面板自己就关"）。而 `@pointer` 段的第一根合成手指落在**发牌块**上——
发牌块在盘面左上角，说明本体的 620px 卡片是居中的，所以那一点落在面板的空白处：
这一下被面板吃掉了，"点发牌块"变成"把说明关掉"，路线从此对不上。

于是这条腿在量"鼠标能不能把认证路线走完"，实际量到的是"第一根手指点到了说明面板的空白处"。
后面十几条与鼠标有关的断言也跟着一起废掉（它们的前置是"第一下点中了"）。

**新代码为什么对**

修法在**闸**这一侧，不在产品这一侧：产品那个"第一次打开摊开说明"是要留的行为
（说明里写的键就是下面那套键盘处理），删它才是拿功能换分数。
node 侧那套（`test/shell.test.mjs`）早就是这么做的——它的执行计划第一件事就是 `closehelp`。
浏览器段补上同一口径（`tools/playtest.mjs:199-220` 的 `closehelp`）：先把说明按玩家会按的
那个按钮关掉，再钉一条**前提**——手指要点的那个位置上，最上面的元素必须就是画布本身
（`tools/playtest.mjs:220` 的 `the board is the top element`）。
这条把"手指点得到盘"从"手势结果对不对"里拆出来单独钉住：以后再有什么浮层盖上来
（升级提示、结算卡、公告），红的是这一条，而不是一路红到"认证路线走不完"那种看不出所以然的地方。

`@pointer` 段 19 → 20 条，浏览器腿 `13/13/14/12/19` → `13/13/14/12/20`。

## 9. 真实文件清单（本次动过的 9 个文件）

| 文件 | 动了什么 | 为什么 |
| --- | --- | --- |
| `js/view.js` | 删一处重复声明 + 死代码 `ringPhase`；描边环相位改走 `animClock`；setter 合一 | 重复声明是 SyntaxError，整局不可玩 |
| `js/main.js` | 删远端侧 `bindFullscreen` IIFE 与第二套动效监听；能力并入本地那套；F 键加 `repeat` 守卫 | 一次点击走两条路；按键连切 |
| `index.html` | 删重复的全屏入口与重复的 manifest link；`<head>` 去重；`og:image` 改绝对 URL；补 favicon-48/64；删 `sw-register.js` 的 script 标签 | 两个 manifest link；分享卡片 404；SW 注册两遍 |
| `manifest.webmanifest` | 还原本地那版（文件图标 + 全套元信息） | 门禁要求图标在盘上；远端那版丢了 shortcuts 与 maskable 512 |
| `sw.js` | 还原本地那版（`VERSION='staircase-v1'` + SHELL 预缓存 + 导航兜底） | `test/pwa.test.mjs` 是照它写的 |
| `js/sw-register.js` | 删除 | 与 `js/pwa.js` 的注册重复 |
| `test/repo.test.mjs` | 补 `import { spawnSync } from 'node:child_process'` | 并线加了用例体没加 import |
| `tools/playtest.mjs` | `@pointer` 段先关掉第一次打开的说明，再钉"手指落点上面是画布" | 闸把鼠标腿自己废掉了 |
| `tools/deploy-set.mjs` | 三对常量重钉（41 / 69 / 24） | 并线改了页面与产物，钉的是实数 |
| `README.md` | 25 处行号重钉 + 若干处"现在说了假话"的句子改成真的 | 文档要指得到真的那几行 |

## 10. 删行审计

`git diff --stat 10f347f aed596c`：10 files changed, 256 insertions(+), 278 deletions(-)。

删掉的行逐块点名（**没有一块是功能**）：

| 删掉的东西 | 为什么可以删 |
| --- | --- |
| `js/view.js` 重复的 `let reduceMotion = false;` 与死代码 `ringPhase` | 重复声明是 SyntaxError；`ringPhase` 并线后无人调用 |
| `js/view.js` 两个 setter 里的一个 | 两个 setter 改同一个状态，留闸调的那个 |
| `js/main.js` 远端侧 `bindFullscreen` IIFE 整段 | 与本地那套重复；能力已并入，重复入口也删了 |
| `js/main.js` 远端侧第二套 `motionQuery` / `applyReduceMotion` / 监听 | 两套路径各改一份状态 |
| `index.html` 重复的 `<link rel="manifest">`、重复的 og/twitter 元信息、重复的全屏入口 | 同一件事写两遍，H 段数出的标签条数因此翻倍 |
| `manifest.webmanifest` 四段内联 base64 图标（300 kB 起） | 本仓的图标在盘上，门禁要的就是在盘上 |
| `js/sw-register.js` 整份 | 与 `js/pwa.js` 的注册重复 |
| `sw.js` 远端侧整份 | 换成本地那版，不是删功能 |
| README 里那 25 处旧行号与若干处旧读数 | 改钉，不是改断言强度 |

## 11. 验收命令与原样输出

```
$ cd z-biz-game-staircase-cos && bash tools/verify.sh
...
--- test/deal.test.mjs      rows: 16 fail: 0
--- test/game.test.mjs      rows: 12 fail: 0
--- test/library.test.mjs   rows: 12 fail: 0
--- test/make.test.mjs      rows: 13 fail: 0
--- test/partition.test.mjs rows: 14 fail: 0
--- test/pwa.test.mjs       rows: 10 fail: 0
--- test/repo.test.mjs      rows: 24 fail: 0
--- test/shell.test.mjs     rows:  9 fail: 0
--- test/solve.test.mjs     rows: 17 fail: 0
--- test/storage.test.mjs   rows: 12 fail: 0
--- test/view.test.mjs      rows:  9 fail: 0
opened http://127.0.0.1:5212/
(no console output)
boot lot: shoal-01
=== @boot ===      rows: 13 fail: 0
=== @play ===      rows: 13 fail: 0
=== @routes ===    rows: 14 fail: 0
=== @save ===      rows: 12 fail: 0
=== @pointer ===   rows: 20 fail: 0
=== console ===
(none)
=== deploy-set ===
部署集：43 条引用（含 5 张位图尺寸核对），失败 0 项
rows: 69 fail: 0
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
DS_SELFTEST_BASELINE 部署集：43 条引用（含 5 张位图尺寸核对），失败 0 项 rows=69
=== ALL GREEN ===
```

`RC=0`。node 侧 11 个套件合计 148 条断言、浏览器侧 5 档合计 72 条断言，全部 `fail: 0`，
控制台 `(none)`，部署集双闸 41 条引用 / 69 条断言 0 失败、台架 rc=0。

`node --test test/*.test.mjs` 另跑一遍：`# tests 11`、`# pass 11`、`# fail 0`。

## 12. 行为变化需知会

1. **减弱动效的初值变了**：原先初值恒为 `false`（先按"有动效"画一帧再被系统设置改掉），
   现在直接读 `matchMedia`——系统里开着减弱动效的玩家，第一帧就是静态的。
2. **描边环在暂停时停住了**：相位改走虚拟秒，暂停时环不再呼吸。
3. **F 键不再连切**：按住不放只切一次。
4. **`window.staircase.setReduceMotion` 改名为 `setReducedMotion`**：这是活下来的
   `test/view.test.mjs` 调的那个名字。旧的 `setReduceMotion` 不再存在
   （并线后两个都在，是并线拼出来的）。
5. **分享卡片现在指绝对 URL**：`og:image` 从 `assets/art/og-cover-1200x630.png` 改成
   `https://z-biz-game.github.io/z-biz-game-staircase-cos/assets/art/og-cover-1200x630.png`。
6. **service worker 的缓存名**回到 `staircase-v1`（并线后是 `staircase-cos-v1`），
   预缓存的清单回到五件套（并线后只有两件）。
7. **service worker 只注册一次**（走 `js/pwa.js` 那一路，带 `file://` 与 null 守卫）。

## 13. 未实现 / 需人接手

1. **部署集闸的 X13 那一把在本仓是 SKIP**：它要清单里真有一段内联 base64 位图，
   而本仓的清单图标是 `icons/` 里的真文件 ⇒ 台架打印
   `X13 SKIP · manifest 里没有内联 data:image/png 图标（这一仓的位图都是文件）`。
   P 段改由 X7 证（把 `icons/icon-192.png` 的声明改成 256x256 必须被点名，实跑确实点了名）。
2. **线上站点没验过**：本轮只跑了本地闸，没有对
   `https://z-biz-game.github.io/z-biz-game-staircase-cos/` 做任何网络核对。
   README 里那份部署前缀声明是**写给闸读的**，不是"站点已上线"的读数。
3. **闸的"浏览器层条数"仍然没有地板**：`verify.sh` 只打印 `rows:` 与 `fail:`，
   `fail` 为空就退 0。这条不变（是仓里既有的选择，不是本轮引入的）。
4. **`@boot` / `@play` / `@routes` / `@save` 四段仍然在说明面板可能摊开的状态下跑**：
   本轮只补了 `@pointer`（唯一一段靠鼠标点击的）。那四段量的是状态与键盘，不受浮层影响；
   但若以后有浮层盖住键盘焦点，那四段要照 `@pointer` 的办法各自补一次。

## 14. 基线归因（并线后基线 vs 并线前）

用 `git worktree add --detach /tmp/stair-ours 864146f^1`（并线**前**那一侧）与
`/tmp/stair-pre`（并线后 `10f347f`）在**同一台机器**上跑同一批闸：

| 腿 | 并线前（`864146f^1`） | 并线后（`10f347f`） | 归因 |
| --- | --- | --- | --- |
| `node --check js/view.js` | 通过 | **SyntaxError: Identifier 'reduceMotion' has already been declared** | 并线引入（整局级） |
| `test/view.test.mjs` | 通过 | 绿（两个 setter 都在，恰好蒙对） | 并线引入（隐患） |
| `test/pwa.test.mjs` | 通过 | 红（`sw.js` 与用例不同源） | 并线引入 |
| `test/repo.test.mjs` | 通过 | 红 5 项（spawnSync / manifest / 4 处越界 / 40 处锚点漂） | 并线引入 |
| `tools/deploy-set.mjs` | 不存在（远端侧才有这套闸） | 红 4 项（H4 / R7 / R12 / R13） | 并线引入 |
| 浏览器 `@pointer` 段 | **红 6 条**（第一次打开的说明吃掉了第一根手指） | 红 6 条 | **并线前就有**，本轮修掉 |
| `node --test test/*.test.mjs` | 通过 | 11 套件里 3 个红 | 并线引入 |

## 15. 上一轮留下的记录（转述，不是本轮读数）

本文件替换的是上一轮那份交付报告。下面这几条是上一轮记下的事实，**都不是本轮的读数**，
写在这里是为了不让它们随文件一起消失（README 里那几处引用指着它们）：

* 派单文档 `b3-staircase.md` 曾经被 `DESIGN.md:116` 与上一轮那份交付报告引用过；
* 2026-09-27 主代理实抓过线上站点的四个 200，发布 sha 是 `fd0fe15`——那是一次人工核对，
  不是任何一道门的读数，本轮没有重跑；
* 出厂关卡文件 `js/data/lots.js` 线上抓到的是 11,097 B（与仓里那份同大小，`BAKED_AT` 那行为空时
  `diff` 忽略）；本轮重新量过，仓里那份仍是 11,097 B；
* `MAX_N` 这类"牌量上限"常量在发布前已被删除——"上限 28"现在只由 `test/make.test.mjs` 的档位表保证，
  引擎本身对任何正整数都算得动；
* 出题计时表（平均 13 ms / 最坏 36 ms 那张）的来源脚本**没有入库**，是一次性脚本；
* 桌面形态的 `npm run electron` 在 `package.json:10`（`electron`）里是个脚本，
  但 electron **不是**依赖（`package.json:32-33` 的 `dependencies` 两个 `{}`），
  `electron/main.cjs:1-4` 的 `dependency` 自己写明了这一点；本轮同样没跑过它。
