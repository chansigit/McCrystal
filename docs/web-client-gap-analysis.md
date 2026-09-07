# Web client gap analysis

Date: 2026-09-07. Compares `Client.Web/` against the native `Client/` at commit
`98e39322`. Every claim below was read out of the source; file:line references
point at the evidence.

## Headline coverage

| Direction | Native | Web |
| --- | --- | --- |
| Server packets handled | 279 / 279 | 73 / 279 (70 excluding stubs) |
| Client packets sendable | 148 / 153 | 23 / 153 |

The native dispatch is four chained `ProcessPacket` switches
(`Client/MirScenes/GameScene.cs:1342`, `LoginScene.cs:98`, `SelectScene.cs:292`,
`Client/MirControls/MirScene.cs:221`). The web dispatch is one switch in
`Client.Web/src/main.js:216`.

Two structural facts shape all the work below.

**Incoming is browser-limited, not gateway-limited.** `GameSession.ReadServer`
forwards every server packet to the browser as `{type, data}`
(`Client.Web/GameSession.cs:88`). Anything unhandled is dropped silently because
the JS switch has no `default:` branch. A guild invite, a trade request or a
quest completion produces no message at all. Adding a `default:` that logs the
packet name is the cheapest way to make the remaining gaps visible.

**Outgoing is a closed allowlist.** `ParseCommand`
(`Client.Web/GameSession.cs:161-177`) accepts 23 command names and validates
them at `:179-219`. Every missing system therefore needs a gateway edit as well
as a UI, so none of them is a pure frontend task.

## Tier 1 — blocks ordinary play

These stop a player from doing something normal. Roughly in order of severity.

1. **Death is permanent.** `TownRevive` is not in the allowlist and appears
   nowhere in `Client.Web/`. Once `Dead` is set, movement, attack and harvest are
   all gated off (`src/main.js:653, 670, 887`) with no way to clear it. The
   native client sends `C.TownRevive` from a keybind (`GameScene.cs:1280`).
2. **Character creation is unreachable.** The gateway accepts `NewCharacter`
   (`GameSession.cs:175`) but no JS ever sends it. A new account lands on
   "该账号暂无角色" (`main.js:606`) and stops there. Deletion is also missing.
3. **Cannot sell or repair.** Both are explicit stubs printing a placeholder
   (`main.js:244-252`). Without selling, gold is pickup-only; without repair, all
   equipment eventually breaks for good.
4. **Cannot use storage.** Same stub. The 46-slot bag is the entire game's
   storage.
5. **Cannot drop or split items.** `DropItem` and `SplitItem` are not in the
   allowlist, so a full bag can only be cleared by consuming things.
6. **No quest system.** All ten classes in `QuestDialogs.cs` are absent and the
   five quest packets are dropped.
7. **No group or party.** Invites arrive as unhandled packets, so the player is
   never even told they were invited.
8. **No character stat panel.** AC/MAC/DC/MC/SC, experience and weight are
   invisible, so gear cannot be compared. `CharacterDialog` exists only as an
   equipment grid.
9. **No buff, debuff or poison display.** Neither the icon strip
   (`BuffDialog.cs:79`) nor the in-world auras (`MapObject.cs:210-298`) nor the
   poison status dots (`MapObject.cs:508-568`).
10. **Inventory can dead-lock.** A pending operation that times out leaves the
    inventory locked until re-login (`src/inventory-ui.js:28-33`).

## Tier 2 — whole systems with no support at all

Not a stub, not a packet handler, not a menu entry. A player can level and fight
without these, but they are most of the game's content.

Guilds including territory and war (`GuildDialog.cs`, 2243 lines), mail,
player-to-player trade, friends, hero/companion, intelligent creatures (pets),
mounts as a usable system, fishing, marriage, mentor, item rental (five
dialogs), socketing, crafting, refining, awakening, trust merchant / auction
(`TrustMerchantDialog.cs`, 1639 lines), game shop, rankings, inspecting another
player, roll, script timers, compass.

Also here: the skill bar and spell-to-key assignment. F1-F8 fires bindings the
character already had (`src/skills.js:117`), but a web-only player can never
bind a newly learned spell, because that needs `AssignKeyPanel` and `C.MagicKey`
(`MainDialogs.cs:3292`).

## Tier 3 — presentation

### Rendering

Missing outright: all lighting and the day/night cycle (also needs a gateway
change, since `GameAssets.Map()` never exports the per-cell `Light` byte,
`GameAssets.cs:135-148`); weather particles, all ten flags; hair and head layer;
wings; mount and transform sprites; projectiles in flight; ground spell objects
such as fire walls; melee skill trails; buff auras; level-up effect.

The web draws body plus one weapon layer against the native seven-pass stack
(`PlayerObject.cs:4877-4926`), and always uses `CArmour`, so Assassins and
Archers get warrior animation sets. Spell effects are a hand-coded table of 38
cast and 18 impact effects against roughly 200 native spawn sites.

Two gameplay-relevant ones that read as bugs rather than missing polish:

- **The player can be fully hidden behind scenery.** Native re-draws the user
  above the front tile layer (`GameScene.cs:10945-10969`); the web has no such
  pass.
- **Ground loot is hard to see.** Native `DropView` defaults on and labels every
  ground item permanently (`GameScene.cs:10596`); the web shows a hover tooltip
  only, and has no `Tab` pickup key to compensate.

Already correct in the web client: depth sorting, animated tiles and water,
death and skeleton animations, damage numbers, minimap and big map, monster name
line splitting, weapon glow.

### Audio

Present: map and menu music, footstep walk/run and left/right foot arithmetic,
item click and use sounds, gold, teleport, server-forced sounds.

Partial or missing: footsteps always play the grass sample instead of choosing
among seven surface classes (`PlayerObject.cs:3571-3664`); two weapon swing
sounds instead of eight; skill sounds only on cast, never the fly or impact
variant; monster sounds four of ten offsets; no ground-spell sounds; no
level-up, revive, fishing or pet sounds; one volume slider for both music and
effects, not persisted.

### Input

The native client has 96 default bindings across 98 actions, all rebindable
through `KeyboardLayoutDialog` and saved to `KeyBinds.ini`. The web has a
hardcoded set in `src/main.js:791-870` and no rebinding at all.

Conflicting rebinds a returning player will trip over: `Tab` collapses the radar
instead of picking up loot, `M` opens the map instead of mounting, `K` opens
skills where native uses `S` and `K` is ranking, `D` moves right instead of
toggling autorun.

Missing: skill bars 2 and 3 (`Ctrl+F1-F8`, `Shift+F1-F8`), belt slots 7-8, pet
mode keys, `Insert` camera mode, screenshot, `Alt+Enter` fullscreen, middle-click
autorun, `Ctrl`+right-click inspect, mouse wheel scrolling, and the four item
cell modifiers (shift-split, shift-link to chat, ctrl-socket, alt-quick-sell).

One real regression: native deliberately forwards `F1`-`F12` and `Tab` back into
the game while the chat box has focus (`MainDialogs.cs:1132-1181`). The web
blocks every game key whenever an input is focused (`main.js:792`), so you cannot
cast while typing.

## Where the web client is ahead

Worth knowing before anyone files these as regressions.

- Dropped items have an additive glint; the native `ItemObject.Draw` is a bare
  blit with no shine at all.
- A mute button, and distance-based audio culling at 12 tiles.
- Real HTML5 drag and drop for inventory, on top of native's click-to-place.
- `SpellTargetLock` actually works; the native `TargetSpellLockOn` is dead code
  outside the hero branch (`GameScene.cs:12012`).
- Death animation frames are preloaded so the animation never stutters.

## Not gaps, despite appearances

This MonoGame port has dead shader paths. `DXManager.LoadEffects` computes the
paths for `normal.fx`, `grayscale.fx` and `magic.fx` and discards them
(`DXManager.cs:78-90`), so `SetGrayscale`, `SetNormal` and `SetBlendMagic`
early-return and `SetOpacity` is a no-op (`:185-203, 263-268`). Death greyscale,
poison tint, hidden-object transparency and the user silhouette are already
broken in the native client. Of the eight declared blend modes only two are
implemented (`:270-312`).

Neither client has zoom, music crossfade, an ambient sound bed, or audio
distance falloff in native.

## Suggested order

1. The Tier 1 blockers, cheapest first: revive, character creation, drop and
   split, sell, repair, storage. Each is one gateway allowlist entry plus a small
   UI.
2. A `default:` branch in the packet switch that logs unhandled types, so the
   rest of the gaps stop being invisible.
3. Buffs and the character stat panel, which are read-only and unblock informed
   play.
4. Quests and groups, the two Tier 1 systems that are real feature work.
5. Presentation, in the order players notice it: lighting and day/night, the
   missing character layers, occlusion, weather.
6. Tier 2 systems as needed.
