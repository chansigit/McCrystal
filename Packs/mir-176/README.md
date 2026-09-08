# mir-176

A strict classic 1.76 pack, built from the recovered GPL baseline described in
`docs/research/legend-176-sources.md`: revision `48bfebd` of `mir2-geem2`,
exported to `ThirdParty/legend-176/snapshots/geem2-official-176/`, GPL-3.0, 564
maps and the 1.76 database.

Names stay in Chinese. Drop tables, spawn tables and NPC scripts all reference
items and monsters *by name*, so translating would have to be complete and
consistent across every stage; keeping the source names is both the authentic
1.76 world and the smaller surface for mistakes. Nothing here is shared with
`classic`, which stays English -- the two packs do not interoperate, which is
what having packs is for.

## Building it

`Tools/Mir176Import` rebuilds `Server.MirDB` from the sources on every run, so
there is no incremental state to drift. It writes nothing without `--write`, and
produces `docs/reports/mir-176-import.md` either way -- reviewing that report is
how a stage is signed off.

```sh
dotnet run --project Tools/Mir176Import -- \
    --source ThirdParty/legend-176/snapshots/geem2-official-176 \
    --pack Packs/mir-176/pack.yaml --report docs/reports/mir-176-import.md --write
```

## State

Every pack needs its own state directory. `ContentPack` defaults `StateRoot` to
the working directory, so two packs run without `--state` would share one
`Server.MirADB` -- the same characters, under two incompatible sets of item and
skill indexes.

```sh
dotnet Server.Console.dll --pack /path/to/Packs/mir-176/pack.yaml --state state-176
```

## Stages

| Stage | Source | Status |
| --- | --- | --- |
| Skills | `GEEM2.db` `Magic` | done, 33 of 33 |
| Items | `GEEM2.db` `StdItems` | done, 352 of 352 |
| Maps and connections | `Envir/mapinfo.txt` | done, 386 maps |
| NPCs | `Envir/merchant.txt`, `market_def/` | done, 172 of 426 scripts |
| Monsters | `GEEM2.db` `Monster` | done, 388 of 389 |
| Drops | `Envir/MonItems/` | done, 336 tables |
| Spawns | `Envir/mongen.txt` | done, 3,438 of 3,442 lines |
| Recipes | `Envir/MakeItem.txt` | done, 13 of 13 |
| Conquest | `Envir/Castle/` | done, 1 castle, 16 parts |
| Quests | `Envir/MapQuest_def/` | nothing to import, see below |

The pack boots and runs: 386 maps, 172 NPCs, 388 monsters and 53,942 of them
alive at once on a 14ms loop, 13 recipes, and Sabuk with its gate, three walls
and twelve wall archers. `--validate-pack` reports 0 errors.

## Client assets

Shared with `classic`. The `clientAssets` field in the manifest is metadata --
`ContentPack` declares it and nothing reads it.

Items are verified: all 352 `Looks` values land on real frames of `Items.Lib`,
and a contact sheet of a sample confirmed the icons are the right icons -- rings
render as rings, potions as potions.

Monsters took longer, because the sprite numbering does not carry across. An
earlier note here claimed all 389 `RaceImg` values were verified because each had
a matching `Monster/NN.Lib`. That checked only that a file existed at that number.
Rendering them showed the numbering is unrelated: 鹿 asks for image 11, which in
these assets is a ForestYeti, and 稻草人 asks for 18, an OmaWarrior. Both
`RaceImg` and `Appr` index the M2 client's own library order, and Crystal's
`Monster` enum is Crystal's numbering of its own files. There is no arithmetic
between them.

`monster-sprites.tsv` now settles all 389 rows -- 388 sprites and one deliberate
blank -- and every one of the 111 sprites it names has a real `.Lib` behind it.
How each was decided, and the `(Race, Appr)` rule that both filled the gaps and
found eleven of my own mistakes, is further down.

Two things that were expensive to learn and should not be re-litigated:

- **Which monsters belong in 1.76 is not this tool's call.** Four guesses at it
  were wrong -- the 暗之 set, 黄泉教主, 重装使者 and the whole 圣域 set are all
  1.76. The file has no exclusion list: a row with a sprite is in the pack, a row
  without one is out, and that judgement is a person's.
- **Siege sprites are not under `Monster/`.** `MonsterObject.cs:158-180` sends
  940-944 to `Data/Siege/`, 950-964 to `Data/Gate/` and 10000+ to `Data/Pets/`.
  Enumerating only `Monster/NNN.Lib` silently drops the Sabuk gate and walls,
  which is most of a castle siege. `SabukDoor` is `SabukGate` 950 in
  `Data/Gate/00.Lib`, and `SabukW1` to `SabukW3` are 957 to 959.

That question about the siege is settled, and the answer is that there was no
question: M2Server models the gate and walls as monsters with hit points, and so
does Crystal. `ConquestGateInfo` and `ConquestWallInfo` each hold a `MobIndex`
pointing at a `MonsterInfo`, and `ConquestGuildInfo.Spawn` builds them through
`MonsterObject.GetMonster` like any other creature. The 沙巴克 section below has
the details.

## 怪物行为：`Race` 是 M2 的行为类

M2Server 按 `Monster.Race` 决定一只怪用哪个行为类，Crystal 按 `MonsterInfo.AI`
决定（`MonsterObject.GetMonster`）。两套编号的对照写在 `monster-ai.tsv` 里：38 个
Race，每个一行，依据大多来自 crystalm2-176 同名记录的 AI 值，Race 分组内多数一致
就取多数，冲突的写清判断理由。

对得最干净的是那些 M2 专门开了一个 Race 的怪——95 挖洞僵尸、96 复活僵尸、101 祖玛、
87 掷斧骷髅、91 火焰沃玛、85 食人花——Crystal 的类名就是同一只怪的英文名，一眼对上。
最大的一个是 Race 81，180 只，M2 的普通近战族，66 个锚点全指向 AI 0。

两处判断跟 crystalm2 不一致，都记在表里：狼和蝎子在 crystalm2 是 AI 9
HarvestMonster（可剥皮的尸体、不主动打人），1.76 的狼和蝎子会追人，所以取 0。

一个 Race 里行为确实分两种的，用 `name` 行覆盖：Race 107 是"不动怪"，触龙神取 14
EvilCentipede（不动、隐身后现形），宝箱取 3 Tree（不动也不攻击）。

`Race 93`（暗黑战士、暴牙蜘蛛、圣域杀手）没有可用依据——crystalm2 里那个"暗黑战士"
是后期的同名怪——先按普通近战导入，表里标了 `无依据`。

## 爆率和刷怪

两边的格式几乎一样，转换主要是在拒绝：

**爆率**（`Envir/MonItems/` → `Envir/Drops/`）。`1/60 攻击神水` 两边同义，只有金币要
把 `金币` 换成 Crystal 解析器认的 `Gold`。15,887 行里 14,181 行落进包里，17 行因为
物品名对不上被丢掉——11 种物品 1.76 的 `StdItems` 里根本没有（铂金项链、护神项链、
MOTO手机…），报告里逐个列了次数。唯一做的归一化是全角括号换半角（`布衣（女）` →
`布衣(女)`），那是排版差异不是另一件物品；除此之外没有任何近似匹配，因为爆错东西要
杀上一万次才看得出来。

27 张源表没有对应的怪（`奥玛` 系列是 `沃玛` 的另一种音译，还有一份韩文更新日志被当成
了怪名），跳过。52 只怪 1.76 就没给爆率表（守卫、城门、活动怪居多），写成空表占位——
不写的话 Crystal 自己会生成模板，包就永远和提交的内容对不上。

**刷怪**（`Envir/mongen.txt`）。列几乎一一对应：地图、x、y、怪名、半径、数量、分钟。
`Count` 是这张图要维持的数量而不是每波刷几只，`Delay` 两边都是分钟
（`Map.cs:761` 乘 `Settings.Minute`），直接抄。第一列是地图**文件名**不是序号——`3`
是 `3.map`——所以刷怪点和 `mapinfo.txt` 用同一套名字对上。

3,442 行进来 3,438 行，落在 227 张地图上。没落上的 4 行点名了 `楔蛾0`、`剧毒蜘蛛0`、
`牛头侍卫8` 三只 `Monster` 表里没有的怪。

`--validate-pack` 另外报了 9 个死刷怪点（`RESPAWN_NOWHERE_TO_STAND`）：D501 的三个角
落在 400 宽的地图外、半径 100 也够不回来，D713/D714 的一个点整块都是墙。这是 1.76
自己的数据错，在原引擎上也一样刷不出来，所以按警告记着、原样保留。

这个检查是照着引擎自己的判断写的：`Map.cs:479` 把可站立格子按半径框过滤，所以关键不是
中心点能不能站，而是**框里有没有一格能站**。第一版只查中心点，报了 22 个错，其中 13 个
是好的——1.76 的表里经常把中心写在图外，靠半径伸回来，M2 和 Crystal 都照样刷得出来。

## 合成、攻城、任务

**合成**（`Envir/MakeItem.txt` → `Envir/Recipe/`）。M2 把全部配方放一个文件里，
`[产物]` 后面跟 `材料 数量`；Crystal 一条配方一个文件、产物取自文件名。13 条全部导入。
手工费不在这里——合成师收的 100 金和一根金条是它自己脚本里的 `TAKE` 行，NPC 阶段已经带过来了。

真正要紧的是**这两件事在 M2 里长得一样**：合成 NPC 用 `[goods]` 段声明"我能做什么"，
商店用同一个段声明"我卖什么"，唯一的区别是引擎自己应答的 `@makedrug` 页。按商店读进来的
后果是**赤血魔剑摆上了柜台按金币卖**——上一版就是这样的，7 个 NPC 全中，其中合成师
（9maker）连魔血/虹魔三件套一起在卖。

现在的判据要两个条件同时成立：脚本里有 `@makedrug` 页，**并且** `[goods]` 段每一行都是
`MakeItem.txt` 会做的东西。只满足一个不算——有三个是正经商店，货架上十八样里夹着两样药粉，
它们没有 `@makedrug`，仍然照卖。命中的 7 个改写成 `[RECIPE]`，`@makedrug` 页连带指向它的
链接一起改名 `@CRAFT`，页面文字原样保留。

**攻城**（`Envir/Castle/` → `ConquestInfo`）。这一段短，是因为两边的模型本来就一样：
M2 把沙巴克的门和墙做成有血的怪，Crystal 也是——`ConquestGateInfo` / `ConquestWallInfo` /
`ConquestArcherInfo` 各自持一个 `MobIndex` 和一个 `Location`，由 `ConquestGuildInfo` 通过
`MonsterObject.GetMonster` 刷出来。

**AI 号在这里是硬要求，而且不匹配时是静默的**：`ConquestGuildInfo.Spawn` 检查
`if (monsterInfo.AI != 81) return;`（门）、`!= 82`（墙）、`!= 80`（弓箭手），不打日志。
所以 `SabukDoor` 必须 81 Gate、`SabukW1..3` 必须 82 Wall——这两个由 Race 110/111 自然对上；
`弓箭手` 得单独覆盖成 80 ConquestArcher，因为它同 Race 的兄弟 `弓箭守卫` 是城门口那 67 个
守卫，要留在 57 TownArcher。

城池文件是**存档和布局混在一起**的：同一个键出现两次，先是作者写的值，后面是运行中的服务端
写回的状态。所以只读每个键的**第一次**出现——读最后一次会导入一座门血量为 0 的城。
弓箭手和守卫的岗位同理：M2 先用本地化键写了布局（`弓箭卫士_N_X`、`卫士_N_X`），
后面又追加了一批清零的英文键（`Archer_N_X`、`Guard_N_X`），有坐标的是前者。

导进来的是：门 1（672,330）、墙 3、守城弓箭手 12。**4 个近战守卫岗位没有导入**——Crystal
只有一份守城名单，而它的 `Spawn` 要求 AI 80，把一个 AI 6 的卫士放进去会静默不刷，
所以宁可记在报告里。攻城时间表 1.76 的文件里没有（M2 是靠 NPC 申请开战的），
保持 Crystal 的 `Request` 类型、不设固定星期。

服务端起来后在线怪物从 53,926 变成 53,942，正好是 1 门 + 3 墙 + 12 弓箭手。

**任务：没有可导的。** `Envir/MapQuest_def/` 里那 9 个文件不是 Crystal 意义上的任务
（`QuestInfo` 是有描述、步骤、奖励的结构），而是 M2 的怪物死亡触发脚本，用 `#IF/#ACT/#SAY`
和 `[401]`、`[402]` 这样的标志位工作，文字还是英文原版的。更要紧的是**整个 1.76 快照里没有
任何文件引用它们**——搜过了，一处都没有，连 `mapinfo.txt` 和 `Npc_def/` 都不提。
它们是孤立的。真正的 1.76 任务内容在 NPC 脚本里，也就是 `market_def/` 里那 254 个还没导入的
脚本（问答、行会、迷宫引路人那类），那是 NPC 阶段的后续，不是一个独立的任务阶段。

## 网关必须用 `--maps` 指向包里的地图

`Client.Web` 的资源根写死在 `Build/Client/Debug`，地图原本也从那里读——也就是 Crystal 自带的
那一套。服务端跑的是本包的地图，客户端却画客户端目录里的同名文件，两边是**不同的世界**：
新人村 (620–650, 590–645) 在本包的 `0.map` 里是茅屋、钟楼、菜地，在 Crystal 自带的 `0.map`
里是个兽人营地。NPC 按本包坐标站着，脚下是另一张图的地形。

两个文件都叫 `0.map`、都是合法的 700×700 比奇省，任何一层都不会报错，所以这个故障完全无声，
只表现为"景物有点不对"，走到镇子上才变成"建筑全没了"。

```
dotnet bin/Debug/net8.0/Client.Web.dll --urls http://127.0.0.1:5080 \
    --server 127.0.0.1:7100 \
    --maps /Users/chensijie/codes/Crystal/Packs/mir-176/Maps
```

`/health` 会回显实际使用的地图目录，可以用它确认。

已知仍缺的一项：`Map/WemadeMir3/snow/Object1c` 这个贴图工程客户端没有，比奇省有 16 格引用它。

## 已知问题（查过了，源头如此，不是导入的锅）

用 `--validate-pack` 随时可以复现：

```
cd Build/Server/Debug && dotnet Server.Console.dll \
    --pack ../../../Packs/mir-176/pack.yaml --validate-pack
```

**8 条传送的源点站不上去。** 例如比奇省 (399,225)：该格 `back = 0x8000`，只有墙标志位、
没有地板贴图，是个空洞。玩家走不上去，传送永远不会触发。1.76 原始数据就是这样。

**1 条传送被丢弃。** mapinfo.txt 里源地图写成了 `20122`，应为 `0122`。宁可丢也不猜。

**2 组物品重名。** `魔法头盔` 和 `小手镯` 各有两件属性不同的（前者一件 14 级 2000 金、
一件 15 级 12000 金）。脚本、商店、爆率都按名字找物品，所以每组里有一件永远拿不到——
1.76 的 `StdItems` 原表就是这样，原版引擎也一样。

**技能表里是 109 个而不是 33 个。** `Envir.FillMagicInfoList()` 每次加载后无条件补齐
Crystal 认识的全部法术。多出来的 76 个没有对应的技能书（包里只有 33 本），玩家学不到，
是死数据；导入的 33 个不会被覆盖，`MagicExists` 挡住了。

**`Map/WemadeMir3/snow/Object1c` 客户端没有这个贴图工程**，比奇省有 16 格引用它，那 16 格
永远是空的。1.76 归档里不含地图美术（只有 Items / Mon1 / mmap / StateItem 四个 wil），补不上。

**9 个刷怪点永远不出怪。** 见上面"爆率和刷怪"一节，是 1.76 自己的坐标错。

**17 行爆率被丢掉。** 点名的 11 种物品 1.76 的 `StdItems` 里没有。


## 怪物贴图：`(Race, Appr)` 是那把钥匙

1.76 的 `Monster` 表里有个 `Appr` 列（外观号），它、而不是 `RaceImg`，决定一只怪长什么样：
鸡=160、鹿=161、鹿1=161——变体与本体共用一个号。

`Appr` 和 Crystal 的 `Image` 是两套编号，没有固定偏移（实测 247 对里只有 6 对数值相同），
但同一个 `Appr` 必然是同一个外观。所以拿已经配对好的怪反推出一张对照表，就能把没配上的
怪补出来。

**但键是 `(Race, Appr)`，不是 `Appr`。** 拿 247 个同名锚点分别检验四种键：

| 键 | 分组 | 组内自相矛盾 |
|---|---|---|
| `Appr` | 88 | 4 |
| `RaceImg` | 31 | 13 |
| `RaceImg + Appr` | 91 | 3 |
| **`Race + Appr`** | **95** | **1** |

`Race + Appr` 只剩一处矛盾：足球和黑色恶蛆都是 `Race 81 / Appr 74`，而两只都有同名记录。
足球是活动道具，1.76 那行大概是借来占位的，所以这一处按名字判——球形归 149 Football，
`飞火流星1/2` 跟着足球走。其余 94 组内部一致。

这条规则的用处不只是补空缺，更是**查错**：把整张表按 `(Race, Appr)` 分组，任何一组里出现
两个 `Image` 就是一处错。跑一遍抓出 11 行，全部是我按名字拆词猜的——

| 行 | 我猜的 | 实际 | 拆词错在哪 |
|---|---|---|---|
| 圣域卫士 | 0 Guard | 66 ZumaGuardian | 是「圣域版祖玛卫士」，不是「圣域版卫士」 |
| 圣域弓箭手 | 139 ArcherGuard | 64 ZumaArcher | 同上，是祖玛弓箭手 |
| 圣域骷髅 | 22 Skeleton | 89 BoneCaptain | 是骷髅锤兵 |
| 圣域蝙蝠 | 19 CaveBat | 203 ValeBat | 是山洞蝙蝠 |
| 圣域钳虫 | 39 Tongs | 40 EvilTongs | 是邪恶钳虫 |
| 圣域炎兽 | 80 Shinsu1 | 79 Shinsu | 渲图选的「像兽形的那个」，数据说是另一个 |
| 弓箭手 | 139 ArcherGuard | 378 ArcherGuard3 | 与弓箭守卫同外观 |
| 地狱犬 / 圣域冥狼 | 148 DarkBrownWolf | 104 Wolf | 1.76 里跟普通狼同一张图 |
| 石墓尸王 | 93 BoneLord | 69 DigOutZombie | 见下 |

名字拆词是最不可靠的一类依据，而它在这张表里恰好最容易写。`(Race, Appr)` 是它的解药。

### 骷髅洞那一段连号

`Appr 142..148` 对上 `Image 87..93`，七步里六步有独立的同名记录：

| Appr | 1.76 | Image | 依据 |
|---|---|---|---|
| 142 | 恶灵僵尸 | 87 RoninGhoul | 同名记录 |
| 143 | 恶灵尸王 | 88 ToxicGhoul | 同名记录 |
| 144 | 骷髅锤兵 | 89 BoneCaptain | 填空缺 |
| 145 | 骷髅长枪兵 | 90 BoneSpearman | 同名记录 |
| 146 | 骷髅刀斧手 | 91 BoneBlademan | 同名记录 |
| 147 | 骷髅弓箭手 | 92 BoneArcher | 同名记录 |
| 148 | 黄泉教主 | 93 BoneLord | 用户指定，与连号一致 |

黄泉教主一族（黄泉教主 / 0 / 8 / 暗之黄泉教主 / 圣域修罗，`Appr` 全是 148）落在 93 上，
和连号的末端严丝合缝；crystalm2-176 里另有一只「骷髅教主」也用 93，是同一个旁证。

而 `93` 原先被我按 `proposed` 给了石墓尸王。石墓尸王的 `(Race 95, Appr 50)` 与僵尸2 完全
相同，僵尸2 有同名记录指向 69 DigOutZombie——渲出来是个光头、穿橙色僧袍的僵尸，正是石墓
七层那只和尚僵尸。两只怪一个是 55 级 5000 血的 BOSS，一个是 25 级的杂兵，1.76 让它们共用
一张图，这在这份数据里很常见。

### 威思而小虫

`Race 82 / Appr 48`，1.76 里没有同外观的兄弟，但三条线索指向同一个答案：
`mongen.txt:671` 把它刷在盟重省（map 3）；那张图的野怪是羊、狼、盔甲虫、多角虫、猎鹰、
沙虫，对应 `Image 103 / 104 / 105 / 106 / 108 / 109`，块里唯一没被认领的是 **110
VisceralWorm**；而「威思而」正是 Visceral 的音译。

### 还剩一只

`飞火流星`（`Race 120 / Appr 3`，1 级 9999 血 0 攻）没有配图，也不需要：`mongen.txt` 不刷
它，`Npc_def/` 里没有脚本召唤它，整个 1.76 服务端只有 `Monster` 表这一行提到它。它的
`飞火流星1/2` 才是活动里真正出现的火球，已经配到 149 Football。留空即排除出本包。
