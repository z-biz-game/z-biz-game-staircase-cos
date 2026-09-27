# 保加利亚梯 · BULGARIAN

保加利亚纸牌（Bulgarian solitaire）：把 `n` 张牌发成几堆，每一次**发牌**就是从每一堆各拿走一张、
把拿走的这些张聚成一堆新牌（新堆的大小 = **发牌前**的堆数，抽空了的堆消失）。
牌数恰好是三角数 `T_k = k(k+1)/2` 时，**任何**开局反复发牌都必然走到阶梯 `(k, k-1, …, 1)` 并停在那里；
牌数不是三角数时，没有任何开局走得到，全部落进周期轨道。

屏幕上的两个数字都是量出来的：

| 印在屏幕上 | 是什么 | 谁算的 |
| --- | --- | --- |
| **最少** `par` | 从本关开局到目标形状的最短操作数（发牌 / 并两堆 / 拆一堆，各算一步） | `js/core/solve.js` 在 `p(n)` 个局面上做广度优先搜索，`tools/bake.mjs` 在构建期量并复验 |
| **只发牌** `steps` | 只准发牌、不许并拆时，从开局到目标形状的发牌次数 | `js/core/deal.js` 逐步模拟；对三角数牌量它由"全分拆穷举"这条独立路背书 |

`par ≤ steps` 恒成立（发牌本身就是操作图里的一条边），两者差多少就是"会不会挑并拆点"的难度差。

## 玩法

1. 顶部一条是**目标形状**（三角数关卡就是阶梯），右上角印着本关的 `牌数 / par / 只发牌`。
2. 三种操作，各算一步：
   * **发牌**：点左上角的发牌块，或按 `D`（也就是定理里的那一步）。
   * **并堆**：点一堆选中，再点另一堆 —— 两堆合成一堆。
   * **拆堆**：按住某一堆里的一张牌往下拖 —— 上面的部分与下面的部分分成两堆。抓最上面那张拖不动，
     因为那会拆出一个空堆。
3. 摆成目标形状就过关。用满 `par` 步 = ★★★ 命中最少，多 1–2 步 = ★★☆，再多 = ★☆☆。
4. `撤销` `U`、`提示` `H`（提示是本机现算的一次有界搜索，会把这一关记为"用过提示"）、`重开` `R`。
5. 路由：`#/c/<n>` 战役、`#/lot/<id>` 分享单关、`#/daily` 每日、`#/random/<band>/<token>` 随机。
   每日题取 `hashSeed("YYYY-MM-DD")`，同一日期在任何设备上是同一副牌。

## 数字从哪来（一条命令复现那张表）

```
node tools/bake.mjs
```

它重跑穷举并打印这仓主张的全部数字，数字对不上就直接构建失败：

```
proof converge n=3 k=2: 3/3 openings reach the staircase, worst 2 = k(k-1) from 1,1,1
proof converge n=6 k=3: 11/11 openings reach the staircase, worst 6 = k(k-1) from 2,2,1,1
proof converge n=10 k=4: 42/42 openings reach the staircase, worst 12 = k(k-1) from 3,3,2,1,1
proof converge n=15 k=5: 176/176 openings reach the staircase, worst 20 = k(k-1) from 4,4,3,2,1,1
proof converge n=21 k=6: 792/792 openings reach the staircase, worst 30 = k(k-1) from 5,5,4,3,2,1,1
proof converge n=28 k=7: 3718/3718 openings reach the staircase, worst 42 = k(k-1) from 6,6,5,4,3,2,1,1
proof par-map n=28: 3718 positions / 63382 actions · max par 7 from 3,3,3,3,3,3,3,3,3,1
```

* **正面定理**：三角数牌量的全部分拆逐个模拟，`stuck`（没走到阶梯的开局数）实测 `0, 0, 0, 0`（n=3/6/10/15），
  n=21、28 也是 0。分拆个数对齐公开整数分拆表 `p(3)=3, p(6)=11, p(10)=42, p(15)=176, p(12)=77, p(21)=792, p(28)=3718`。
* **最坏步数**：`2 / 6 / 12 / 20 / 30 / 42`，也就是 `n=T_k` 时最坏 `k(k-1)` 步；达到最坏的开局也被逐条点名（`worstFrom`）。
* **反面情形**：`n=12`（不是三角数）的全部 77 个开局一个都不收敛，77 个都落进长度为 5 的周期轨道，其中 67 个还有入轨前的尾巴（`preperiod > 0`）。
* **两条独立路线**：分拆个数用枚举 + Euler 五边形数递推各算一遍；`deal` 用"堆列表"与"重数向量"各算一遍，
  在 n≤28 的全部 4742 个局面上对账；`par` 用分层 BFS / 显式边表正向 BFS / 反向 BFS 三条路各算一遍，并且检查边表闭合。
* **反证"没有更短"**：`distanceMap(n, staircase(k))` 把 `p(n)` 个局面的动作图整张建出来（28 张牌：3718 个局面 / 63382 条边），
  从目标反向 BFS 一次得到所有开局的最短距离，与每个关卡单点搜索逐一相等；实测**最难的开局正好要 k 步**（`T_3→3 … T_7→7`）。
* **关卡不许手改**：`js/data/lots.js` 每一行都带着自己的 `spec`，构建期与测试期都从序列化后的 `spec` 重解一遍，
  `par` 或 `steps` 对不上就失败（`node test/library.test.mjs`）。

## 怎么跑

零依赖、零打包器、零图片素材（画面全是 canvas 2D 程序绘制）。

```
npm run dev      # http://127.0.0.1:5212/  （ES module 需要 origin，file:// 被 CORS 挡）
npm test         # node --check 全量 + 每个 test/*.test.mjs
node --test test/
node tools/bake.mjs                    # 重新出题并复验（写 js/data/lots.js）
bash tools/verify.sh                   # node 层 + @boot @play @routes @save @pointer（headless Chrome）
SKIP_UNIT=1 bash tools/verify.sh       # 只跑浏览器层（CI 的 browser job 就是这么做的）
```

`tools/verify.sh` 用一个独立 `mktemp -d` 的 Chrome profile 和自己的一对端口（web `5212`、CDP `9353`）；
**这两个端口不能与兄弟仓的 `:5180` / `:9340`（gridlock）、`:5181` / `:9341`（nine-rings）相同**，
脚本启动前会检查 `:$WEB_PORT` 是否已被占用。

## 已知边界

* 牌量上限 28（`T_7`）。`T_8=36` 起分拆数 17977，枚举仍然算得动但 UI 上没有意义，故意不做。
* 变换本身是确定的，玩家的自由度只有并堆与拆堆两点；因此 `par` 是"三步动作图"上的最短距离，
  而"只发牌"的 `steps` 是定理给的那个可穷举校验的量。两个数都印在屏幕上，也都各自被复算，
  见 `DESIGN.md` 的"确定性系统里的难度到底是什么"。
* 非三角数关卡（12 / 18 张）没有阶梯可去，目标是**该开局自己的周期轨道里按降序字典序最小的那个形状**，
  旁边印 `orbit(周期长度, 入轨尾巴)`；它只由穷举得出，不由猜测得出。
* 每日题与随机题在浏览器里现场生成（实测 8 个日期平均 13ms、最坏 36ms，`master` 档最坏 137ms），
  战役题一律读构建期产物，玩家点击时只做有界搜索（提示用的 BFS 状态上限 20000，超了就明说没有提示）。
* 没有成就、排行榜、签到、内购、云存档；分享只分享谜题本身（`#/lot/<id>`）。

License: MIT（`LICENSE`）。
