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
| Monsters | `GEEM2.db` `Monster` | not started, 389 rows |
| Spawns | `Envir/mongen.txt` | not started, 3,443 lines |
| Drops | `Envir/MonItems/` | not started, 363 files |
| NPCs | `Envir/merchant.txt`, `market_def/` | not started, 426 scripts |
| Quests, recipes, castles | `MapQuest_def/`, `MakeItem.txt`, `Castle/` | not started |

The pack does not boot yet: the engine needs maps and start points, and neither
stage has run.

## Client assets

Shared with `classic`, and verified rather than assumed: all 352 item `Looks`
values land on real frames of `Items.Lib`, and all 389 monster `RaceImg` values
(9 to 99) have a matching `Monster/NN.Lib`. The `clientAssets` field in the
manifest is metadata -- `ContentPack` declares it and nothing reads it.
