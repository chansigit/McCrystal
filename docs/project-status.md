# Project status

As of 2026-09-08, `main` at `ff37fec3`. Living document — update the date and
the sections that changed rather than starting a new file.

## What runs where

| Service | Address | Notes |
| --- | --- | --- |
| Game server | `127.0.0.1:7000` | `Server.Console`, run from `Build/Server/Debug` |
| Web client gateway | `http://127.0.0.1:5080` | `Client.Web`, serves the browser client |
| GM admin console | `http://127.0.0.1:5081` | Loopback only, password `asdfasdfHPC` in `[Admin]` of `Configs/Setup.ini` |
| Server status port | `127.0.0.1:3000` | Native, unchanged |

Changing the admin password requires stopping the server first: it writes its
in-memory settings back over `Setup.ini` on shutdown, so an edit made while it
runs is silently overwritten.

macOS AirPlay Receiver also listens on `*:7000`. The game server binds
`127.0.0.1:7000` specifically and normally coexists with it, but if AirPlay
restarts and grabs the port first the server fails to bind. The failure shows as
`[outer workloop error]` with `Address already in use`, the game loop never
starts, and every admin action then times out while read-only queries still work.

**Never identify the game server by port alone** — `lsof` on 7000 also returns
the macOS ControlCenter process. Filter on `dotnet`.

### launchd jobs

An earlier session registered two transient jobs with `launchctl submit`, which
restarted the processes on exit. That is why killing the server appeared not to
work, and why it came back without `--pack classic`.

`com.mccrystal.server` has been removed, because it kept resurrecting the server
with a stale `Setup.ini`. The game server is now started by hand:

```sh
cd Build/Server/Debug && dotnet Server.Console.dll --pack classic
```

`com.mccrystal.web` still manages the web gateway. Both jobs are transient — no
plist file — so nothing survives a reboot. Drop the remaining one with
`launchctl remove com.mccrystal.web`.

`Client.Web/play.sh` is the portable way to bring the stack up. Prefer it over a
macOS-specific launchd plist.

## The account and its characters

Account `cocofly`. **One connection per account** — logging in kicks whoever is
already on, so a background agent must never log in while the user is playing.

| Character | Class | Level | Note |
| --- | --- | --- | --- |
| `kzs` | Wizard | 40 | Was 65535, lowered to 1 for testing, raised to 40 to fix weight |
| `gan` | Warrior | 10 | Was 65535, still overweight, cannot run |

Both reached 65535 through the experience-curve bug described below. Lowering a
level through the admin console also zeroes `Experience`, which is required —
stale experience re-levels the character on the next kill.

**Lowering a level collapses the weight caps.** `CanRun`
(`Server/MirObjects/HumanObject.cs:135`) requires
`CurrentBagWeight <= Stats[Stat.BagWeight]`; `CanWalk` does not. So an
overweight character walks but cannot run, and a character carrying a max-level
inventory at level 10 is far over the cap. Authentic behaviour, and the
explanation for "right-click running stopped working".

Native also refuses to run below 10 HP (`Client/MirScenes/GameScene.cs:11527`),
faithfully ported — another reason a freshly-lowered character cannot run.

The admin console only acts on **online** characters. A watcher script polling
`/api/players` and applying the change when the character appears is the way to
do this without making the user wait.

## GM admin console

Hosted inside `Server.Console`, bound to loopback. Overview, online players with
actions, accounts and characters, live logs with server actions, read-only
database browsing, statistics. Every mutation runs on the engine thread through
`Envir.AdminActions` and is logged with an `[Admin]` prefix. Setup and security
rules in `Server.Admin/README.md`.

Two defects found in review, both worth remembering because they recur:

- The path guard compared case-sensitively while ASP.NET routing matches
  case-insensitively, so `GET /API/overview` reached every endpoint with no
  cookie. Fixed with `StartsWithSegments(..., OrdinalIgnoreCase)` plus a required
  `X-Admin-Console` header on state-changing methods. **Any command the gateway
  rejects tears down the whole session**, so an over-strict validator produces a
  disconnect loop rather than an error — that is what an 80-slot bound did to
  accounts with expanded 160-slot storage.
- Setting a level above the configured experience curve makes
  `RefreshMaxExperience` return 0, and `GainExp` then loops a character to 65535
  on their next kill. The console now bounds levels by `ExperienceList.Count`,
  which `ExpList.ini` populates to 500.

## Web client

Coverage: 126 of 278 server packets handled, 50 of 153 client packets sendable.
Unhandled packets are logged to the console rather than dropped silently;
`window.__unhandledPackets` lists what a session saw.

Done: town revive, character creation and deletion, item drop and split, drop
gold, NPC sell, repair and special repair with prices, NPC storage, player
trading, parties, the refine and appraisal window, the character stat panel, the
experience bar and the weight block, the hair layer, skill hotkeys on F1..F8 and
Ctrl+F1..F8, combat feedback (struck, poisoned, pushed), the day/night lighting
pass, and the animation work below.

Not built, and all of it post-1.76 or cosmetic: mail, the auction market, heroes,
awakening, mounts as a subsystem, `PlayerInspect`, `ObjectSitDown`,
`MergeItem`/`CombineItem`.

`Roll` was on that list as 1.76 content, described as the lottery clerk. That was
wrong. `S.Roll` only ever comes from the script actions `ROLLDIE` and `ROLLYUT`,
and **neither appears anywhere in the mir-176 pack**. The lottery NPCs (`9Blo`,
`9Mlo`) sell 彩票 through a plain `[TRADE]` block and print the prize table as
text; the scratching happens in M2's own item handling, not through this packet.
Nothing in 1.76 can make the server send it.

`Opendoor` is built, and it was real: the pack's maps carry door cells -- 182 in
Bichon Province, 123 in Mongchon, 99 on Moonglow Isle, 12 in Zuma Temple 1F and
12 on the first illusion floor. Doors are per *index*, not per cell: `Map.AddDoor`
masks the map byte with `0x7F` and hands back the door it already has, so every
cell of index 3 is one door and they swing together -- which is why `S.Opendoor`
names only an index. The two timers differ on purpose: `Map.Process` closes a door
5000ms after it opened and the client asks again after 4000ms, renewing it before
the server drops it under the player. Doors go to the browser as their own sparse
list rather than two more columns on 490,000 cells.

Four subsystems landed together and each carried a protocol surprise worth
keeping, all recorded in the modules themselves:

- **`S.TradeConfirm` is not a lock.** `PlayerObject.TradeConfirm` is sent to both
  sides *after* the items and gold have already changed hands. And `C.TradeGold`
  accumulates: it debits the account the moment it arrives, so the box means "add
  this much" and the running total only moves on `S.LoseGold`. Whether the partner
  has locked in cannot be shown at all — the server says it in chat and sends no
  packet.
- **`S.DeleteGroup` is not "someone left".** It goes to the player being removed,
  so it clears the whole roster. A member who is not the leader has no leave
  command either: `C.DelMember` is refused for anyone but `GroupMembers[0]`, and
  turning grouping off is what calls `LeaveGroup`.
- **`CharacterInfo.AllowGroup` is an uninitialised bool** and the server never
  states it — `S.SwitchGroup` is only ever an echo of a change. Native has the
  same gap and assumes the same default, so the first press of the button is what
  synchronises the two.
- **Special repair is the same handler.** `PlayerObject.RepairItem` charges
  `RepairPrice() * 3` and skips the line that shaves a thirtieth off `MaxDura`;
  there is no `S.SRepairItem`, the reply is `S.RepairItem`.

The vault, both trade grids and the refine grid behave identically on the server
-- fill the target only if it is empty, never swap, never merge, echo `From`/`To`
plus a bare `Success` -- so that logic lives once in `src/grid-transfer.js`. It
throws rather than shrugs: an accepted move the browser cannot apply means the
two have diverged, so the panel asks for a reload instead of letting the player
drag items that are not there.

**`src/*.js` is not what the browser runs.** `index.html` loads
`wwwroot/client.js`, an esbuild bundle. Editing a module changes nothing in the
browser until `cd Client.Web && npm run build` regenerates it -- and the unit
tests import the sources directly, so a green test run says nothing about what is
being served. `style.css` and `index.html` are served raw, so a CSS fix appears
to work while the JavaScript beside it silently does not: that mix is what makes
this trap hard to see. Rebuild, then confirm in the browser rather than
reasoning about it.

The gateway serves `wwwroot` from the source tree, so once rebuilt the bundle is
live and the user only needs a cache-busting reload. Chrome caches `client.js`,
`index.html` and `style.css` heuristically. A background agent doing web work
should use a **git worktree** so the user's live client is not disturbed.

`window.__debug` (the world and the session state) and `window.__monsters()`
(what the server said about every monster in view) are the console handles for
telling a rendering bug apart from a server state faithfully rendered.

Two findings worth keeping:

- `S.UserInformation` does **not** carry a player's computed stats. The native
  client derives all of them in `UserObject.RefreshStats`. The stat panel is a
  port of that whole chain in float-exact arithmetic — the level formulas are C#
  `float`, so every step needs `Math.fround`, including `Gain`/`GainRate` after
  JSON parsing.
- `Stats.Count` is `Values.Sum(Math.Abs)`, a sum of magnitudes rather than a key
  count, so the gateway's flattening of `Stats` to a name-value map preserves
  everything needed to compute item prices in the browser. An earlier assumption
  that this data was destroyed was wrong.

Full native-versus-web comparison and roadmap: `docs/web-client-gap-analysis.md`.

## Animation

`docs/web-client-animation-audit.md` is the specification and records what is
done. **Groups 1 and 2 are complete**, and Group 3 is complete except for the
two classes this pack turns off.

Landed: the frame cursor anchored to each action's own start; per-monster attack
duration; the `Blend` flag; native's action fallbacks; Struck and Revive; attack
variants; `ObjectRangeAttack`; Show and Hide with the burrowers and the statues;
per-monster draw offsets; a statue's spawn-time stoned state; the 275-call
monster overlay table over 85 monsters; ground spells (`S.ObjectSpell`);
attached effects with real lifetimes (`S.ObjectEffect`); the one projectile
(`S.ObjectProjectile`); poison tints and status dots; the complete player frame
set with Struck, Stance, the attack variants, Revive, Mine and Lunge; mounts;
wings; and transforms.

Deliberately not done: the Assassin and Archer body sets. `Configs/Setup.ini`
carries `AllowCreateAssassin=False` and `AllowCreateArcher=False`, which is
right for a 1.76 pack, so no character on this server can reach that code.

Two techniques worth reusing. The overlay table was **generated** from the C# by
a parser and then checked by evaluating all 275 frame expressions in both
languages over nine frame-and-direction pairs; hand transcription of 1,260 lines
would have been worse in every way. And the Hydra overlay, the one entry that
had been verified by hand before, is kept as a regression guard: its generated
row must reproduce the old shortcut exactly.

## Sprite upscaling

`docs/sprite-upscaling-research.md` has the full evidence. The verdict is xBRZ
rather than any AI model, because the art is pre-rendered 3D downsampled rather
than pixel art, so every "correct" pixel-art scaler degenerates to nearest
neighbour on it, and because the whole ncnn family upscales alpha with a bicubic
layer outside the network.

It is built and running.

- `Tools/SpriteHD/` decodes a `.Lib`, runs the pre-passes, upscales 2x through
  the xBRZ WASM port in one long-lived node process, and writes
  `Data/HD/<library>/<index>.png`.
- The gateway serves an override in place of the decoded frame, and `assetScale`
  in `entity-presentation.js` halves the sprite scale when a texture arrives at
  exactly twice its manifest size. Nothing in the protocol changed.
- Monsters 0-99 are converted: 23,653 frames, 92 seconds, 616 MB. Everything
  from 100 up is untouched and renders as before, which makes it a live control.
- All monsters would be 188,013 frames, about 13 minutes and 5.3 GB. The whole
  corpus is 1,870,142 frames, about 2 hours and roughly 50 GB, and there were
  27 GB free when this was written.

Two things that silently ruin a frame if skipped, both verified rather than
assumed. The RGB under transparent pixels has to be zeroed *before* upscaling:
without it xBRZ leaves 192 of 256 output pixels that the client loader's
`a == 0 && rgb != 0` rule would force opaque, and with it, exactly zero. And the
shadow dither has to be detected per frame *and* per colour, because a
whole-frame parity test only reaches 93% and the parity flips within a single
walk cycle.

The shadow fix is the change you notice first, and it is not upscaling at all.
The shadow in this art is a 50% checkerboard of `RGBA(16,8,8,255)` faking half
opacity on 1999 hardware; replacing it with a solid region at alpha 128 gives a
better shadow than the original engine could draw. It is on 100% of `AArmour`,
71% of `CArmour` and 60% of monster frames -- exactly the things that cast one.

## The mir-176 content pack

A second content pack, built from the GPL 1.76 baseline in
`docs/research/legend-176-sources.md`. `Tools/Mir176Import` rebuilds its
`Server.MirDB` from source on every run and writes nothing without `--write`; the
report it produces either way is how a stage is signed off.

Every stage now imports: 33 skills, 352 items, 386 maps, 172 NPCs, 388 of 389
monsters, 336 drop tables, 3,438 of 3,442 spawn lines, 13 recipes, and Sabuk with
its gate, three walls and twelve wall archers. `--validate-pack` reports **0
errors and 19 warnings**, and the pack boots with 53,942 monsters alive on a 14ms
loop. Every one of those 19 is 1.76's own data -- 8 movement sources on cells
nobody can stand on, 9 spawn boxes with no walkable cell in them, 2 duplicate
item names -- and they fail identically on the original engine, which is why they
are warnings. `Packs/mir-176/README.md` has the per-stage account, along with the
17 drop lines naming items that never existed and the 13 script links 1.76 itself
left dangling.

Skills and items reconciled exactly rather than approximately: both engines are
linear in level, and the item table's three mode-dependent fields -- a potion's Ac
being what it restores, a book's Shape being its class and its DuraMax its
required level -- each turned out to yield a check rather than just a conversion.

Monsters were the hard stage, and the lesson generalises. Verifying that
`Monster/NN.Lib` exists for every `RaceImg` proved nothing, because 1.76's
numbering is not Crystal's -- rendering caught it when 鹿 came out a ForestYeti.
What finally settled all 389 rows was **`(Race, Appr)` as the sprite identity**:
`Appr` is the appearance index and `Race` the behaviour class, and together they
partition the table into 95 groups with exactly one conflict across 247 anchors.
That rule filled the remaining gaps *and* found eleven of my own name-derived
guesses to be wrong. `Tools/Mir176Import/monster-audit.py` re-runs the check.

Behaviour keys off the same column: M2 dispatches on `Race`, Crystal on
`MonsterInfo.AI`, so `Packs/mir-176/monster-ai.tsv` maps 38 races with per-name
overrides where one race covers two creatures (宝箱 and 触龙神 are both Race 107).

Three more rules came out of it. Sprite libraries live outside `Data/Monster/`
for sieges and pets (`MonsterObject.cs:158-180`), so enumerating one directory
silently drops the Sabuk gate. Rendering settles what a sprite *looks like*, not
which sprite 1.76 *used* -- one correction went the wrong way for exactly that
reason. And which monsters count as 1.76 is the user's call, not a heuristic's:
four attempts at that classification were wrong.

Everything here fails silently, which is why each stage ships with a check. A
wrong sprite still loads. A spawn on a wall never fires. A conquest part whose AI
is not 81/82/80 returns from `ConquestGuildInfo.Spawn` without a word. A crafting
NPC read as a shop happily sells 赤血魔剑 for gold -- which it did, until the
importer learned to require both `[@makedrug]` and an all-recipe `[goods]` block.
The validator codes `RESPAWN_NOWHERE_TO_STAND`, `CONQUEST_PART_BLOCKED`,
`SCRIPT_MOVE_MAP_MISSING` and `SCRIPT_MOVE_BLOCKED` exist to make four of those
speak.

The last two came out of asking whether the illusion floors work. They do -- ten
maps, 229 spawn lines of the `8`-suffixed double-drop variants, `NORECALL` on all
ten and `NORECONNECT(H007)` on the top three -- but **the way in is not in the map
tables at all.** There is no movement cell to 幻境 anywhere; it is entered by a
single `MOVE H001 73 67` inside 105 NPC scripts, which every existing teleport
check was blind to. Both ways a script `MOVE` can fail are silent: an unknown map
name gets a bare `return` from `NPCSegment`, and a destination in a wall gets a
`false` from `MapObject.Teleport` that nothing reads, so the NPC takes the click
and does nothing. All 154 script moves in the pack now check out.

Honouring the script's own sections is the part that took a second pass. A first
version read every line of the file and reported the classic pack's Peddlar as
teleporting to a map called "to" -- the line was prose in a `#SAY` block, "move
to another place on that floor". `NPCScript.ParseSegment` treats a line as a
command only inside `#ACT` or `#ELSEACT`, so the check does too, and 33 of its 60
findings on that pack turned out to be that mistake.

The 27 that survived are real, and they are in **`classic`**, not here: every one
of the eleven guild-territory teleporters offers two destinations, `7` and
`peunmok_village`, that its own map table does not contain, and the GM teleporter
offers four more. `docs/reports/classic-pack-report.json` has been regenerated --
it had been written before the geometry checks existed and still claimed 2 errors,
where that pack now reports 75 errors and 106 warnings against mir-176's 0 and 19.

## What else was missing from the maps

The illusion floors were missed entirely until they were asked about, so the whole
map set was audited rather than spot-checked: build the graph from `MapInfo.Movements`
plus every script `MOVE` (the NPC's map is in its file name), then walk it from the
towns 1.76 actually starts players in.

**332 of 386 maps are reachable.** The 54 that are not break down as:

- **28 event and system maps** the engine teleports into rather than the world
  connecting to: the football pitch (11), guild-war (9, though `F003` *is*
  reachable from a placed NPC), 神秘战场 (3), the three jail maps -- which
  `StartPoint.txt` does list as revival points -- and the two quiz rooms.
- **13 unnumbered duplicate floors** with no spawns and no NPCs: three extra
  沃玛寺庙 pairs, `D2054`-`D2056`, `D2065`, `D2066`, `D2074`, `D2077`.
- **6 quest maps.** The chain hangs off `Q011`, which nothing reaches, so
  `Q012`-`Q016` behind it are shut too. 1.76's `MapQuest_def/` had nothing to
  import, which is why.
- **6 strays**: an advanced-class house, a jail, `D10071`, and three literally
  titled 待定 ("to be decided").
- **新手训练营 (`D12`)**, which is its own case, below.

Two of the earlier passes of this audit under-reported reachability, because a
placed NPC's `MOVE` opens 勇斗寺殿, 未知暗殿 and one guild-war map. Trust the
script, not a summary written from an intermediate run of it.

### 新手训练营 has no entrance in any 1.76 source

It is the second-largest spawn table in the pack -- 16 lines, 1,830 monsters -- it
has two guards in `GuardList.txt` and minimap 104, and **nothing anywhere reaches
it.** Checked, because the expectation is that an NPC takes you in:

- No movement cell in `mapinfo.txt` names it, in either direction.
- No script teleports to it. Every `MOVE`/`MAPMOVE`/`MAP` target across all 425
  `market_def` scripts and the three `Npc_def` ones comes to 47 distinct maps, and
  `D12` is not one of them -- placed or unplaced.
- It is not a start point, and not in `Npcs.txt`.
- The same holds in all ten archived 1.76 sources, including the current GeeM2
  tree, so this is not a truncated snapshot.

What the data does show is the shape of the intended route. `D12` is declared
`NORECONNECT(0131)`, and `0131` is 密室 ("secret room"), reachable from Bichon
Province at 272,621 -- so a player disconnecting in the camp comes back to that
room. The room has **no monsters and nobody standing in it**: `merchant.txt` places
no NPC on `0131` at all. So the last hop, 密室 → 训练营, is the piece 1.76's own
placement table is missing. Putting an NPC there would be inventing content, not
importing it, so the camp stays orphaned and this is recorded instead.

Two scares in that audit were my own script rather than the pack, and both are
worth recording because they are the same mistake twice. 石墓阵, the 28-map maze
behind Stone Tomb, looked cut off with 240 spawn lines stranded; the maze's
movement lines write their coordinates with spaces instead of commas
(`D71601 17 12 -> D71609 36 34`), and the importer already accepts both -- with a
comment saying exactly how many lines do it. And 幻境 looked unreachable because
1.76 spells the action `MAPMOVE`, which the importer renames to the engine's
`MOVE`; reading the source instead of the pack missed the rename. Check the
converted artefact, not the input.

## Finding where a monster lives

Respawn tables exist only inside the binary `Server.MirDB`, and the admin console
does not expose them, so "which map has Zuma statues" cannot be answered from
memory — Zuma Temple 1F and 2F have none at all, despite the name.

```sh
curl -s -b jar 'http://127.0.0.1:5081/api/db/monsters?q=' > monsters.json
python3 Tools/DumpSpawns/dump_spawns.py --monsters monsters.json --monster ZumaStatue
```

The script parses the header and the `MapInfo` block, which is the first block in
the file, and stops there. Monster names come from the admin console because the
name table sits behind the item table in the same file.

## Game mechanics learned

Deer are AI 2, the `Deer` behaviour class. One in seven rolls `_runAway` at
spawn: it never fights back, walks directly away from its attacker, moves
faster, and carries a `Quality` of 0–14000 against a normal deer's 0–3000, so
the fleeing ones are worth more when skinned. They look identical.

## Known issues

- Sell and repair prices are computed in the browser by a port of
  `UserItem.Price()` and `RepairPrice()`, pinned by matching tests on both
  sides, but never confirmed against an NPC in game.
- The storage password path is covered by unit tests only.
- `ObjectHide` forces `Hidden = false`, so a stealthed monster receiving a Hide
  becomes visible for the animation. Inherited from the original Hydra path, now
  applying to 21 monsters.
- `Envir/Quests/PrajnaIsland\PIVillage/2.txt` is a Windows-separator path that
  does not resolve on macOS. Logged at startup, cosmetic.
- log4net 3.0.3 carries a moderate advisory (NU1902).
- `gan` cannot run until its weight is under the level-10 cap.
- Nothing in the mir-176 pack has been verified by a human in game: the monsters
  rendering, the drops, the darkness on dark maps, the four new panels and
  Sabuk's shop surcharge are all checked only by tests, validators and rendered
  harnesses.
- Guild and conquest polish is deprioritised by the user. The 17 castle shop
  surcharges and the refine window both need an owning guild to be seen
  end-to-end.
- ~~`152 GhastlyLeeche`~~ settled: the user confirmed 恶灵尸王 stays on 88
  ToxicGhoul. 152 is unclaimed and nothing in the pack needs it.

## Tests

```sh
dotnet run --project Tests/Regression/Regression.csproj   # engine, 36 checks
cd Client.Web && npm test                                 # 238 JS, then 165 gateway
python3 Tools/Mir176Import/monster-audit.py               # sprite table consistency
```

`npm test` runs the sources. **It says nothing about what the browser is
running** -- see the bundle warning above.

`Tests/Regression` uses a plain array of named checks in `Program.cs`, not a
test framework.

## Working practices that paid off here

Two independent reviews per change, one for spec compliance and one for code
quality, caught an authentication bypass, a storage bound that disconnected
players in a loop, and a level setter that could spin a character to 65535.
Reviewers were told to verify against the server source rather than trust the
implementer's report, and that repeatedly overturned premises — including
several of mine.

Do not type passwords into web forms. Where a live check needs a game login, the
user must do it.

The `superpowers` plugin was uninstalled at the user's request; the three
modified config files are backed up in
`~/.claude/plugins-backup-20260907-161635`.

## Documents

| File | Contents |
| --- | --- |
| `docs/architecture-review.md` | Client / Shared / Server structure and early bug findings |
| `docs/web-client-checkpoint.md` | Dated progress log of the web client migration |
| `docs/web-client-gap-analysis.md` | Native vs web feature comparison and roadmap |
| `docs/web-client-animation-audit.md` | Animation comparison, what is done, what remains |
| `docs/sprite-upscaling-research.md` | Upscaling tool evidence, landmines and verdict |
| `Tools/SpriteHD/README.md` | How to build and preview HD sprite overrides |
| `Tools/DumpSpawns/dump_spawns.py` | Every map's respawn table, read out of `Server.MirDB` |
| `docs/research/legend-176-sources.md` | Downloaded 1.76 packs, revisions, licences |
| `Packs/mir-176/README.md` | Per-stage import account, sprite evidence, source faults |
| `docs/reports/mir-176-import.md` | Regenerated by every import run; how a stage is signed off |
| `docs/reports/classic-pack-report.json` | Content pack validation baseline |
| `Server.Admin/README.md` | Admin console setup and security model |
| `PORTING_LOG.md` | The original Windows to macOS client port |
