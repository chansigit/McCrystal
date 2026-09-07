# Web Client Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the six gaps that stop a web-client player from doing normal things: dying permanently, being unable to create a character, and being unable to drop, sell, repair or bank items. Plus make every remaining gap visible instead of silent.

**Architecture:** Each feature needs three edits — a command name plus validator in the gateway allowlist (`Client.Web/GameSession.cs:161-219`), a case in the browser packet switch (`Client.Web/src/main.js:216-580`), and UI in `Client.Web/wwwroot/index.html` driven from a module in `Client.Web/src/`. The gateway already forwards every server packet to the browser, so no gateway change is needed for incoming.

**Tech Stack:** .NET 8 WebSocket gateway, plain ES2017 modules, node --test for the JS unit tests, `Tests/WebRegression` for the gateway.

Source of the gap list: `docs/web-client-gap-analysis.md`.

---

## Conventions for every task

- dotnet: `export PATH=/opt/homebrew/Cellar/dotnet@8/8.0.124/bin:$PATH`.
- Build the web client: `cd Client.Web && npm run build`. Frontend unit tests live beside their modules as `*.test.js`; run them the way `package.json` defines.
- Gateway tests: `Tests/WebRegression`. Engine regression suite: `dotnet run --project Tests/Regression/Regression.csproj` (36 checks, must stay green).
- Commits: no `Co-Authored-By` trailer. Short imperative subject. One commit per task.
- Keep the existing code style: two-space indent in JS, Chinese UI strings, `$("id")` helper, `send(type, data)` for outgoing commands.
- Every new command needs a validator in `ParseCommand`. A missing validator is a security hole: the browser is untrusted input.
- Do not touch `Server/` or `Client/`.

## Packet reference (verified against Shared/)

Outgoing (`ClientPackets`):

| Packet | Fields |
| --- | --- |
| `TownRevive` | none |
| `NewCharacter` | `Name` string, `Gender` MirGender, `Class` MirClass |
| `DeleteCharacter` | `CharacterIndex` int |
| `DropItem` | `UniqueID` ulong, `Count` ushort, `HeroInventory` bool |
| `DropGold` | `Amount` uint |
| `SplitItem` | `Grid` MirGridType, `UniqueID` ulong, `Count` ushort |
| `SellItem` | `UniqueID` ulong, `Count` ushort |
| `RepairItem` | `UniqueID` ulong |
| `StoreItem` | `From` int, `To` int |
| `TakeBackItem` | `From` int, `To` int |

Incoming (`ServerPackets`):

| Packet | Fields |
| --- | --- |
| `Death` | `Location` Point |
| `Revived` | none |
| `ObjectRevived` | `ObjectID`, `Effect` |
| `NewCharacter` | `Result` byte (failure) |
| `NewCharacterSuccess` | the new character info |
| `DeleteCharacter` | `Result` byte (failure) |
| `DeleteCharacterSuccess` | `CharacterIndex` int |
| `DropItem` | `UniqueID`, `Count`, `HeroItem`, `Success` |
| `SplitItem` | `Item` UserItem, `Grid` |
| `SplitItem1` | `Grid`, `UniqueID`, `Count`, `Success` |
| `SellItem` | `UniqueID`, `Count`, `Success` |
| `RepairItem` | `UniqueID` |
| `NPCStorage` | none (opens the vault) |
| `UserStorage` | `Storage` UserItem[] |
| `StoreItem` | `From`, `To`, `Success` |
| `TakeBackItem` | `From`, `To`, `Success` |

---

### Task 1: Make unhandled packets visible

The browser switch has no `default:` branch, so every unimplemented system fails silently. This must land first: it is how the later tasks get diagnosed.

**Files:** `Client.Web/src/main.js`

- [ ] **Step 1** Add a `default:` case at the end of the switch in `main.js` that records the packet type. Keep a `Set` of type names already seen so each unknown type is reported once per session, not once per packet. Log to the browser console as `[unhandled] <Type>`; do not spam the in-game chat.
- [ ] **Step 2** Expose the set as `window.__unhandledPackets` so it can be inspected from the console during manual testing.
- [ ] **Step 3** Load the page against the running server, play for a minute, and record in the commit message which packet types showed up. That list is real data about what a live session actually needs.
- [ ] **Step 4** Commit: `Report unhandled server packets in the web client`.

---

### Task 2: Town revive

Without this a dead character is stuck forever. `Death` and `Revived` are both currently unhandled for the local player: `ObjectDied` sets `Dead` when the id matches, but the dedicated `Death`/`Revived` packets are dropped.

**Files:** `Client.Web/GameSession.cs`, `Client.Web/src/main.js`, `Client.Web/wwwroot/index.html`

- [ ] **Step 1** Gateway: add `"TownRevive" => typeof(C.TownRevive)` to the allowlist. It has no fields, so no validator beyond the envelope is needed.
- [ ] **Step 2** Browser: handle `Death` (set `state.user.Dead = true`, store the location) and `Revived` / `ObjectRevived` for the local player (clear `Dead`, clear `diedAt` and `deathPlaybackAt` the same way `ObjectRevived` already does for other entities).
- [ ] **Step 3** UI: when the local player is dead, show a centred overlay with the text 你已经死亡 and a 回城复活 button that sends `TownRevive`. Hide it as soon as `Dead` clears. Style it with the existing panel classes.
- [ ] **Step 4** Play the death sound and the revive sound if a sound id exists for them; check `src/sound-events.js` for the established pattern and skip it if there is none rather than inventing an id.
- [ ] **Step 5** Test: a unit test asserting the overlay shows when `Dead` is set and hides when cleared, following the pattern of the existing `*.test.js` files.
- [ ] **Step 6** Verify live: log in, die (a GM can use the admin console to set a low level, or find a strong monster), confirm the button appears and revives you in town.
- [ ] **Step 7** Commit: `Add town revive to the web client`.

---

### Task 3: Character creation and deletion

The gateway already allows `NewCharacter` but nothing sends it, so a fresh account is a dead end.

**Files:** `Client.Web/GameSession.cs`, `Client.Web/src/main.js`, `Client.Web/wwwroot/index.html`

- [ ] **Step 1** Gateway: add a validator for the already-allowed `NewCharacter` — name non-empty, length within `Globals.MinCharacterNameLength`..`MaxCharacterNameLength`, no control characters, `Gender` and `Class` both `Enum.IsDefined`. Read the real bounds from `Shared/Globals.cs`; do not invent them.
- [ ] **Step 2** Gateway: add `"DeleteCharacter" => typeof(C.DeleteCharacter)` with a validator requiring `CharacterIndex > 0`.
- [ ] **Step 3** Browser: handle `NewCharacterSuccess` (append the character and re-render the list), `NewCharacter` (map `Result` to a Chinese error message — read the native client's mapping in `Client/MirScenes/SelectScene.cs` so the wording matches the real cause), `DeleteCharacterSuccess` (remove from the list) and `DeleteCharacter` (error message).
- [ ] **Step 4** UI: a 创建角色 button on the character screen opening a form with name, gender and class. Classes are 战士 / 法师 / 道士 / 刺客 / 弓手 — the same array already used in `showCharacters()`. Respect the server's `AllowCreateAssassin` / `AllowCreateArcher` settings if the browser can know them; if it cannot, let the server reject and surface the error.
- [ ] **Step 5** UI: a 删除 control per character row, behind a confirmation that requires typing the character name, matching how destructive the action is.
- [ ] **Step 6** Test: unit tests for the class list rendering and for the delete confirmation gate.
- [ ] **Step 7** Verify live: create a character on the `cocofly` account, log in as it, then delete it.
- [ ] **Step 8** Commit: `Add character creation and deletion to the web client`.

---

### Task 4: Drop and split items

**Files:** `Client.Web/GameSession.cs`, `Client.Web/src/inventory-ui.js`, `Client.Web/src/main.js`, `Client.Web/wwwroot/index.html`

- [ ] **Step 1** Gateway: allow `DropItem`, `DropGold` and `SplitItem`. Validators: `DropItem` requires `UniqueID != 0`, `Count > 0` and `HeroInventory == false`; `DropGold` requires `Amount > 0`; `SplitItem` requires `Grid == MirGridType.Inventory`, `UniqueID != 0` and `Count > 0`.
- [ ] **Step 2** Browser: handle `DropItem` (on `Success`, remove or decrement the stack; on failure show why), `SplitItem` (insert the returned `Item` into the first free slot) and `SplitItem1` (adjust the source stack).
- [ ] **Step 3** UI: a 丢弃 action in the item detail pane, with a confirmation. For a stack, ask for a count. Add a 拆分 action for stacks of more than one.
- [ ] **Step 4** UI: a 丢弃金币 control next to the gold display.
- [ ] **Step 5** Respect the existing pending-lock discipline in `inventory-ui.js`, and make sure a failed drop releases the lock — the current code can dead-lock the inventory on timeout, so do not add another path into that state.
- [ ] **Step 6** Test: unit tests for the count prompt clamping to the stack size and for the lock being released on both success and failure.
- [ ] **Step 7** Verify live: drop a stack partially, drop it fully, split a stack, drop gold.
- [ ] **Step 8** Commit: `Add item drop and split to the web client`.

---

### Task 5: Sell and repair at NPCs

Both are currently stubs printing a placeholder (`main.js:244-252`).

**Files:** `Client.Web/GameSession.cs`, `Client.Web/src/shop.js`, `Client.Web/src/main.js`, `Client.Web/wwwroot/index.html`

- [ ] **Step 1** Gateway: allow `SellItem` (`UniqueID != 0`, `Count > 0`) and `RepairItem` (`UniqueID != 0`). Note `SRepairItem` (special repair) is out of scope for this task.
- [ ] **Step 2** Browser: replace the `NPCSell` stub with a real sell panel — the player's inventory on one side, click an item to sell it, ask for a count on stacks. Handle the `SellItem` reply, decrementing on `Success`.
- [ ] **Step 3** Browser: replace the `NPCRepair` stub with a repair panel listing damaged equipment and inventory items, showing current and max durability, and sending `RepairItem`. Handle the `RepairItem` reply by refreshing that item's durability.
- [ ] **Step 4** Both panels reuse the NPC dialog frame that `src/npc.js` and `src/shop.js` already establish; do not build a third window style.
- [ ] **Step 5** Sell prices come from the server. Do not compute a price in the browser — `ShopPrices.cs` exists for the buy side; check whether it applies before duplicating logic.
- [ ] **Step 6** Test: unit tests for the sell count clamp and for the repair list filtering to items whose durability is below maximum.
- [ ] **Step 7** Verify live: sell an item to a shop NPC and repair a damaged weapon.
- [ ] **Step 8** Commit: `Add NPC sell and repair to the web client`.

---

### Task 6: Storage

**Files:** `Client.Web/GameSession.cs`, a new `Client.Web/src/storage.js`, `Client.Web/src/main.js`, `Client.Web/wwwroot/index.html`

- [ ] **Step 1** Gateway: allow `StoreItem` and `TakeBackItem`, both validated as `From >= 0` and `To >= 0` within the storage bounds. Read the real storage size from `Shared/Globals.cs` rather than hardcoding 80.
- [ ] **Step 2** Browser: handle `NPCStorage` (open the vault window), `UserStorage` (render the grid), `StoreItem` and `TakeBackItem` (move the item on `Success`, revert on failure).
- [ ] **Step 3** UI: a storage window showing the vault grid beside the inventory grid, supporting click-to-move in both directions and drag between the two, matching how `inventory-ui.js` already handles moves.
- [ ] **Step 4** Storage passwords (`UnlockStorage`, `SetStoragePassword`, `StorageUnlockResult`, `StoragePasswordResult`) are out of scope. If the server demands a password the panel should say so clearly rather than failing silently.
- [ ] **Step 5** Test: unit tests for the two-grid move logic including the failure revert.
- [ ] **Step 6** Verify live: store an item, log out and back in, take it back.
- [ ] **Step 7** Commit: `Add NPC storage to the web client`.

---

## Out of scope

Quests, groups, buffs and the character stat panel are the next tier and are not part of this plan. Guilds, mail, trade, hero, pets, mounts, fishing, marriage, mentor, rental, socketing, crafting, refining, awakening, auction, game shop and rankings are Tier 2 in the gap analysis.

## Definition of done

All six tasks committed, the engine regression suite still at 36/36, the web
client unit tests green, and each feature exercised against the live server with
the `cocofly` account.
