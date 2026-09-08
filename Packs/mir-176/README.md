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
| Items | `GEEM2.db` `StdItems` | not started, 352 rows |
| Maps and connections | `Envir/mapinfo.txt` | not started, 542 maps |
| Monsters | `GEEM2.db` `Monster` | **blocked on sprite identity**, see below |
| Spawns | `Envir/mongen.txt` | not started, 3,443 lines |
| Drops | `Envir/MonItems/` | not started, 363 files |
| NPCs | `Envir/merchant.txt`, `market_def/` | not started, 426 scripts |
| Quests, recipes, castles | `MapQuest_def/`, `MakeItem.txt`, `Castle/` | not started |

The pack does not boot yet: the engine needs maps and start points, and neither
stage has run.

## Client assets

Shared with `classic`. The `clientAssets` field in the manifest is metadata --
`ContentPack` declares it and nothing reads it.

Items are verified: all 352 `Looks` values land on real frames of `Items.Lib`,
and a contact sheet of a sample confirmed the icons are the right icons -- rings
render as rings, potions as potions.

Monsters are not, and the reason is worth stating plainly. An earlier note here
claimed all 389 `RaceImg` values were verified because each had a matching
`Monster/NN.Lib`. That checked only that a file existed at that number. Rendering
them showed the numbering is unrelated: 鹿 asks for image 11, which in these
assets is a ForestYeti, and 稻草人 asks for 18, an OmaWarrior. Both `RaceImg` and
`Appr` index the M2 client's own library order, and Crystal's `Monster` enum is
Crystal's numbering of its own files. There is no arithmetic between them.

## Monsters: the sprite identity problem

`monster-sprites.tsv` holds the mapping as it stands. 247 of 389 rows are
settled; the rest need a person.

Three bridges were tried, and only one survived.

**Spawn coordinates.** The English original server's `MongenOriginal.txt` and the
Chinese `mongen.txt` are the same spawn table, so the same map and cell names the
same creature in two languages. That yields 39 pairs -- 鹿 to Deer, 稻草人 to
Scarecrow, 食人花 to CannibalPlant -- exactly Crystal's enum names. Too few to
build on, but exactly what a reference set is for.

**Drop-rate fingerprints.** Matching `MonItems` files by their sequence of drop
odds gives 13 pairs and false ones among them: 猎鹰 paired to skystinger, a
falcon to a wasp. Abandoned.

**crystalm2-176's `Image` column.** An unrelated Crystal server carrying these
Chinese names. It was dismissed at first because its `Image` disagreed with
`RaceImg` on 170 of 171 shared monsters -- which, once `RaceImg` turned out not
to be a sprite index, is what a correct column would look like. Checked against
the 39 coordinate anchors it agrees on 31 of 33 comparable ones, the two
exceptions being near-misses (CaveBat against ValeBat, VisceralWorm against
SandWorm). That gives 171 rows directly and 76 more through the M2 convention
that a numbered variant shares its base's sprite.

For the remaining 142, `monster-pairing.py` derives 64 suggestions by taking
names apart -- 圣域稻草人 resolves through 稻草人, 暗之牛魔王 through 牛魔王,
蝎子王 through 蝎子 -- iterated to a fixed point. They are suggestions, marked
`derived:` in the file, and none is confirmed.

That leaves about 40 base creatures with no evidence at all: 触龙神, 虹魔教主,
黄泉教主, 牛魔法师, 牛魔祭司, 血僵尸, 电僵王, 雪人王, 剧毒蜘蛛, 千年树妖,
龙卫, 鹰卫, 虎卫, and most of the 圣域 set. Their numbered variants follow
whatever the base gets.

Two things that are settled and should not be re-litigated:

- **Which monsters belong in 1.76 is not this tool's call.** Four guesses at it
  were wrong -- the 暗之 set, 黄泉教主, 重装使者 and the whole 圣域 set are all
  1.76. The file has no exclusion list: a row with a sprite is in the pack, a row
  without one is out, and that judgement is a person's.
- **Siege sprites are not under `Monster/`.** `MonsterObject.cs:158-180` sends
  940-944 to `Data/Siege/`, 950-964 to `Data/Gate/` and 10000+ to `Data/Pets/`.
  Enumerating only `Monster/NNN.Lib` silently drops the Sabuk gate and walls,
  which is most of a castle siege. `SabukDoor` is `SabukGate` 950 in
  `Data/Gate/00.Lib`, and `SabukW1` to `SabukW3` are 957 to 959.

Still open for the siege stage: M2Server models the gate and walls as monsters
with hit points, while Crystal has a conquest system where they are
`ConquestGuildGateInfo` and `ConquestWalls` rather than spawns.

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

**没有怪物。** 贴图配对还有 78 行未确认，见 `monster-sprites.tsv`；爆率和刷怪都压在它后面。

