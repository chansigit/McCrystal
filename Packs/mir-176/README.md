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

## 地图美术：槽位 22 必须指向 Shanda

`.map` 单元格里的 file 编号选哪个贴图工程，是按客户端内置的一张表解析的。Mir2 的基础工程
（Tiles / Smtiles / Objects）各版本通用，但后来追加的编号工程在 Wemade 和 Shanda 两支分了家。
1.76 的地图是照 Shanda 那支画的，用 Wemade 那支去画**每个编号都能解析、不报任何错**，只是
画出来的东西不对：比奇省那座镇子会变成一圈木栅栏和骷髅图腾，店老板站在空地上。

所以网关要带这个参数启动：

```
dotnet bin/Debug/net8.0/Client.Web.dll --urls http://127.0.0.1:5080 \
    --server 127.0.0.1:7100 \
    --map-library 22=Map/ShandaMir2/Objects21
```

是**逐槽位**而不是整支切换：把 0..99 全换成 Shanda 虽然也能修好建筑，但 Shanda 的 Objects23
帧数不够，会在地图上挖出 306 格空洞。只换 22 号，取不到帧的格子仍是 67 格（0.17%），与改动前
持平。抽样 5 张图，22 号槽位共占 10552 格，所以这不是给单张地图打的补丁。

已知仍缺的一项：`Map/WemadeMir3/snow/Object1c` 这个工程客户端没有，比奇省有 16 格引用它。
