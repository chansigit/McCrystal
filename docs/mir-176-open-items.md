# mir-176 open items

What is left, what is deliberately not being built, and what is broken in 1.76's own
data and should stay broken. Companion to `Packs/mir-176/README.md`, which covers how
each content class was imported, and `docs/project-status.md`, which covers the whole
project. Update this file rather than starting a new list.

As of 2026-09-15, `main` at `46e54a0e` plus the craft window.

## Blocked on a human

The account owner has now played the pack, and that one session found three things no
test had: a worn torch that gave no light (1.76 records none, fixed in `7b2eb9cc`), 牛魔法师
casting with no visible effect, and 屠龙殿 spawning eighty monsters that do not exist
(`46e54a0e`). Two of those were in the data; none were reachable from this side.

Still checked only by tests and validators, because they need someone playing: the four
newer panels (trade, party, refine, special repair) and now the craft window, the doors,
whether the minimap art lines up on the maps whose geometry differs from classic's, and
牛魔法师's missing spell effect -- which is a *client* gap and ours to fill if we choose,
since Crystal's AI 26 broadcasts nothing but `S.ObjectRangeAttack`.

## Built since this list was written

**合成 (crafting) is reachable.** `src/craft.js` opens on `PanelType.Craft` -- the same
S.NPCGoods a shop arrives as -- lists what the NPC makes, picks one bag slot per material
and sends `C.CraftItem`. The seven NPCs are 沓水店老板 (`0109` 4,8), 药房小老板 (`0119`
14,14), 药店老板 (`0153` 7,14), 药剂师 (`1006` 9,10 and 苍月岛 161,316), 恶魔炼药师
(`B343` 14,10) and 合成师 (`R001` 桃源之门 53,115), between them the 13 recipes.

Three things the window has to do because the server does them:

- **One slot per material, no more.** `NPCScript.Craft` counts the slots it consumed
  against `Tools.Count + Ingredients.Count` and refuses a mismatch, so a second slot
  holding the same herb is not a bigger pile -- it is a refusal.
- **A material must be met from one slot.** Two stacks of three leaves are six leaves the
  player can see and cannot spend; the window says so rather than letting the server
  answer with a bare `false`.
- **Success is not success.** `S.CraftItem { Success }` means the attempt was processed.
  Where the recipe's chance is under 100 the materials are taken either way and the
  failure arrives as a chat line, which is what the window's hint warns about.

`NPCScript.Craft` also dereferenced a recipe it had not found -- a page left open while
the player walked to another craftsman is enough to reach it -- so it now answers the way
every other refusal in that method does.

**Five of 1.76's 33 skills had no way into this client**, and a systematic packet-by-packet
comparison found them: 瞬息移动 and 野蛮冲撞 were missing from the aiming table, and 刺杀剑术,
半月弯刀 and 烈火剑法 are not casts at all -- they ride on the attack packet, which the
gateway refused to let carry a spell. The same sweep found that every colour the server
sends was arriving as an empty object, which is where 红名 and 灰名 live.
`docs/mir-176-client-gap-audit.md` has the method, the full findings and what is correctly
absent.

## Still to build, and 1.76 needs it

Ordered by what blocks play.

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
| Spawn lines naming monsters that never existed | 3 | `楔蛾0`, `剧毒蜘蛛0`; the fourth was corrected, below |
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

### The one place the pack departs from the source

`mongen.txt` asks 屠龙殿 for **牛头侍卫8**, eighty of them, and no such monster exists in
1.76's `Monster` table -- nor does 牛头侍卫 -- while the same spawn block names 牛魔侍卫8
twice more and that one is real (Race 81 / Appr 176). It is a typo with one obvious
reading, so on the user's instruction `SpawnStage.MisspelledMonsters` corrects it and the
import report lists what it changed. 屠龙殿 now holds 180 牛魔侍卫8 rather than 100 plus
eighty empty slots.

`楔蛾0` (2 lines) and `剧毒蜘蛛0` (1) are left alone. The `0` suffix is a real variant
family elsewhere in the table, so which monster was meant there is a guess rather than a
typo that reads only one way.

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
