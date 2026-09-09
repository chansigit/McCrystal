# mir-176 open items

What is left, what is deliberately not being built, and what is broken in 1.76's own
data and should stay broken. Companion to `Packs/mir-176/README.md`, which covers how
each content class was imported, and `docs/project-status.md`, which covers the whole
project. Update this file rather than starting a new list.

As of 2026-09-08, `main` at `7cfa9715`.

## Blocked on a human

**Nothing in this pack has been verified in game by a person.** Monster sprites, drop
tables, the darkness on dark maps, the four new panels (trade, party, refine, special
repair), the doors, and the minimap numbers are all checked only by tests, validators
and rendered harnesses. The gap is not knowledge, it is that logging in needs the
account owner.

Two things need a restart before they can be seen at all: doors need the gateway
rebuilt (the map payload gained a `doors` field), and the minimaps need the *server*
restarted, because it reads `Server.MirDB` once at boot.

## Still to build, and 1.76 needs it

Ordered by what blocks play.

### 合成 (crafting) -- the last import with no way to reach it

The pack has 13 recipes and 7 crafting NPCs: 沓水店老板 (`4Bdm`), 药房小老板 (`4Gdm`),
药店老板 (`4Adm`), 药剂师 (`4ndm`, `4Idm`), 合成师 (`9maker`), 恶魔炼药师 (`4Ddm`).

The server sends a craft page as `S.NPCGoods` with `PanelType.Craft` and takes
`C.CraftItem { UniqueID, Count, Slots }` back. `src/shop.js` **refuses it outright**:

```js
if (![0, 1].includes(goods.Type)) { this.close(); $("npc-status").textContent = "此合成窗口尚未接入"; return; }
```

So the content imported and the window does not open. The importer was taught to tell a
crafting NPC from a shop specifically so these would not be sold as goods -- that half
landed, this half did not. Work: extend the existing shop panel with an ingredient grid
and wire `CraftItem`.

### Buff and debuff icons

`AddBuff` / `RemoveBuff` already reach `characterStats`, so the *numbers* on the stat
panel are right, but there is no icon strip in the HUD (native's `BuffDialog.cs:79`).
A player can only infer what is on them from the stat values. Poison dots and in-world
auras are done; this is the strip.

### Binding a newly learned spell

F1-F8 fire whatever the character already had bound (`src/skills.js:117`). There is no
assign panel, so a browser-only player can never bind a spell they learn after
creation. `C.MagicKey` is already whitelisted; only the UI is missing.

### 师徒 (mentorship)

**1.76 has this, and an earlier note in this project wrongly filed it as post-1.76.**
`9helper-0` -- placed on Bichon Province -- carries the whole menu: a player under 18
may take a master over 28, the master earns 声望 as the student levels, 声望 buys a
荣誉勋章 in Bichon, and the student graduates automatically at 28. Crystal has the
subsystem (`Info.Mentor`, `Settings.MentorLevelGap`, `MentorBreak()`, and
`PlayerObject.LevelUp` already checks the gap), so this is a client-side gap, not an
engine one.

One oddity in the source worth knowing before implementing: the 拜师 button is
`<拜师/@@guildwar>`, the same `@@` input page the King uses to ask for a guild name.
`@@guildwar` is the only `@@` page any placed 1.76 script uses -- twice, both here. It
may be 1.76 reusing the engine's name-input page, or its own copy-paste bug; that has
not been settled.

### 结婚 / 离婚 (marriage)

Also 1.76, also previously misfiled. `9marryman` (月老) stands on `M101` 姻缘神殿 with
求婚 / 取消求婚 / 离婚 / 询问结婚时间, and there is a 求婚戒指 to hand out. `9marry-0120`
is an unplaced second copy that gates 求婚 on level 22 and a 金条. Crystal has the
marriage packets and the ring slot.

### 行会 and 沙巴克 (deprioritised by the user, not cancelled)

Creating a guild (the King on `0122`, 100万 gold plus a 沃玛号角), applying for a guild
war, the 17 castle shop surcharges the import bound to Sabuk, and seeing the refine
window end to end -- all of it needs an owning guild before it can be exercised.

## Deliberately not building

All of it postdates 1.76, or has nothing in the pack that can reach it: mail, the
auction house / trust merchant, the game shop, rankings, heroes and companions,
intelligent creatures (pets), awakening, socketing, fishing, item rental, mounts as a
usable system, inspecting another player, `ObjectSitDown`, `MergeItem`/`CombineItem`,
and script timers.

### What `Roll` is, and why it is on this list

`S.Roll { Type, Page, Result, AutoRoll }` is a dice dialog. The server sends it only
from two script actions:

- `ROLLDIE <page> <autoRoll>` -- `Type = 0`, a six-sided die.
- `ROLLYUT <page> <autoRoll>` -- `Type = 1`, the four sticks of the Korean board game
  *yut*, which is where Mir's dice mini-games come from.

Both roll `Envir.Random.Next(1, 7)`, store the result in `NPCData["NPCRollResult"]` so a
following page can branch on `<$ROLLRESULT>`, and jump to `Page`. The client's job is to
animate the throw and show the number.

**Neither action appears anywhere in the mir-176 pack**, so nothing in 1.76 can make the
server send it. An earlier note in this project described `Roll` as the Mongchon lottery
clerk; that was wrong. The lottery NPCs (`9Blo` in Bichon, `9Mlo` in Mongchon) sell
彩票 through an ordinary `[TRADE]` block and print the prize table as plain text --
1 等 1,000,000 金币 down to 6 等 500 -- and the scratching happens in M2's own item
handling, not through this packet.

## Faults in 1.76's own data, kept as they are

Every one of these fails the same way on the original engine, so the pack is a faithful
copy with them in it. `--validate-pack` reproduces the geometry ones on demand.

| What | Count | Note |
| --- | ---: | --- |
| Movement sources on cells nobody can stand on | 8 | e.g. Bichon 399,225 is `back = 0x8000`, a hole |
| Spawn boxes with no walkable cell | 9 | `D501`, `D713`, `D714` |
| Movement discarded for an undeclared source map | 1 | `20122` should be `0122`; guessing was refused |
| Drop lines naming items that never existed | 17 | 11 distinct names absent from `StdItems` |
| Spawn lines naming monsters that never existed | 4 | `牛头侍卫8` is 1.76's own typo for `牛魔侍卫8` |
| Script links pointing at pages that do not exist | 13 | broken in the source, or M2 subsystems Crystal lacks |
| Item names that resolve to two different items | 2 | `魔法头盔`, `小手镯` -- one of each is unreachable |
| Skills in the table with no book to learn them | 76 | `Envir.FillMagicInfoList()` tops the list up to 109 |
| Columns for how far a light source reaches | 0 | `StdItems` has none; M2 decides it in the client |

### Light had to come from somewhere else

1.76's `StdItems` has 24 columns and not one of them is light: M2's client decides a
torch's glow from the item category, so the number never existed in the data. Crystal
puts it on the item (`ItemInfo.Light`; both engines then do
`if (real.Light > light) light = real.Light`), so the first import gave all 352 items a
light of 0 and a worn torch was indistinguishable from no torch -- the player stayed at
the client-side floor of 3 that native gives the local player and nobody else.

The values now come from Crystal's own classic database, an independent witness the same
way it was for the minimaps: its Candle and Torch match 蜡烛 and 火把 on weight, image
and durability, all three. The byte is packed -- `light % 15` indexes
`DXManager.LightSizes` and `light / 15` is the brightness -- so the ladder reads 蜡烛 38
(8 wide at 2), 火把 41 (11 at 2), 火炬 74 (14 at 4). The 23 荣誉勋章 and 参赛证 share
the same `Stdmode 30` slot and are left dark: nothing in either source says what they
should give, and a medal is not a lamp.

### Maps nothing can reach

332 of 386 maps are reachable from the towns players start in. The other 54 are
accounted for in `docs/project-status.md`; `Tools/Mir176Import/map-audit.py` re-runs the
check. The two that are content rather than bookkeeping:

- **新手训练营 (`D12`)** -- 1,830 monsters, two guards, minimap 104, and no entrance in
  any of the ten archived 1.76 sources. The intended route is visible in the data:
  `D12` is `NORECONNECT(0131)`, `0131` is 密室, reachable from Bichon at 272,621 -- and
  `merchant.txt` places nobody in that room. The missing piece is the last hop, and
  putting an NPC there would be inventing content.
- **The quest maps (`Q011`-`Q016`)** -- the chain hangs off `Q011`, which nothing
  reaches, because 1.76's `MapQuest_def/` had nothing to import.

### Client art the archive cannot supply

`Map/WemadeMir3/snow/Object1c` is not among the client's map libraries and Bichon
Province references it on 16 cells, which stay empty. The 1.76 archive carries no map
art at all (four `.wil` files: Items, Mon1, mmap, StateItem), so it cannot be filled in
from there.

Related, and only checkable in game: **1.76's maps are not classic's maps.** Bichon
Province is 700x700 here against a different file entirely in `classic`, and Moonglow
Isle likewise. 1.76's Bichon has the lotus pond people farm 重装衣服 at; classic's does
not. The minimap art is WeMade's original, so where the geometry differs the radar
picture and the terrain under the player may not line up.

## Optional polish

- **Sprite upscaling** covers monsters 0-99 (23,653 frames, 616 MB). All monsters would
  be 188,013 frames, about 13 minutes and 5.3 GB; the whole corpus about 2 hours and
  50 GB. `docs/sprite-upscaling-research.md` has the evidence and the landmines.
- **`classic` reports 75 errors and 106 warnings** against mir-176's 0 and 19. They are
  upstream Crystal data, chiefly the eleven guild-territory teleporters offering `7` and
  `peunmok_village`, which that pack's own map table does not contain.
