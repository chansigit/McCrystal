# Crystal Web client

A local browser client for the existing Crystal server. This is a first playable
prototype, not a feature-complete replacement for the native client.

## Run

Requires .NET 8, Node.js 20+, and the existing client/server resources in `Build`.
From the repository root:

```sh
./Client.Web/play.sh
```

Open <http://127.0.0.1:5080>. The launcher reuses a server already running from
this checkout, or starts one. It does not start the native client. Ctrl+C stops
the gateway and any game server started by this invocation.

Existing accounts and characters work. Do not use the same character in the
native client and browser simultaneously. Passwords are sent to the local game
server for verification and are not stored in browser storage or source files.

For frontend-only edits:

```sh
cd Client.Web
npm run build
```

Refresh the browser after rebuilding. Backend edits require restarting the gateway.

## Controls

- Click a map cell to walk there; WASD and arrow keys move one direction.
- Right-click to run to a cell, hold the right button to keep running toward
  the pointer. Running starts after a walking
  step and falls back to walking at corners or when the server rejects a run.
  The browser context menu is disabled only on the game canvas.
- Click an adjacent monster, use Space, or press the sword button to attack.
- Shift + left-click attacks in place toward the pointer, including empty ground.
  Hold both to repeat; releasing either stops. Shift does not enable running.
- The hand button picks up items under the player.
- The backpack button or I opens inventory and equipment.
- Select an item to inspect it. Double-click or right-click to use/equip it, or
  use the action button. The Equipment tab supports unequipping. Drag between
  slots to move items, or select an item then an empty slot.
- Keys 1-6 and the six belt buttons activate the corresponding inventory slots.
- K or the wand button opens learned skills. Select an active skill, then click
  a monster/ground target; self skills cast directly. F1-F8 select the character's
  existing server-side skill bindings. Esc/right-click/movement cancels targeting.
  Basic mana, range and cooldown checks happen locally; the server decides the
  actual result, including status restrictions and required materials.
- Enter focuses chat; Escape cancels a walking path and closes inventory.
- Enter in chat submits normal messages and native `@` commands unchanged.
  GM permissions and command availability are enforced by the game server.
- Click an NPC to open its script dialogue; click a dialogue option to change
  pages. Escape closes the dialogue. Shops and storage transactions are not yet supported.
- The local radar crops the original MMap resource around the player. Its controls
  collapse it, toggle translucency, and open the full map (M); Tab collapses radar.
  The full map shows the current area and the server-configured world atlas,
  with region selection and an opacity slider. NPCs and exits use server map info.
- Sound unlocks after a click/key press. The header controls volume and mute.
- The top-right exit button logs out the character.

## Architecture

```text
Browser: native HTML interface + PixiJS world renderer + PathFinding.js
    | same-origin WebSocket, JSON commands and server events
Client.Web: ASP.NET Core gateway + resource conversion
    | existing binary packets from Shared, TCP 127.0.0.1:7000
Server.Console / Server.Library: existing authoritative game server
```

- The gateway serializes existing `ClientPackets` and decodes `ServerPackets`.
  Account checks, collisions, movement timing, item ownership and combat remain
  server-side. It does not load or rewrite the account database.
- Only an explicit command allowlist is accepted. WebSockets enforce Origin;
  HTTP requests require loopback connections and a localhost/127.0.0.1 Host.
  The gateway is a local development service, not an Internet deployment.
- Asset requests resolve against a catalog of local `.Lib` and `.map` files,
  not arbitrary paths supplied by the browser. PNG decoding preserves the
  native client's BGRA/zero-alpha compatibility behavior.
- Map parsing source-links `Client/MirObjects/MapCode.cs` under `WEB_CLIENT`;
  only gameplay-object methods are excluded. Unsupported/corrupt map reads fail
  explicitly in the web build. No MonoGame renderer runs in the gateway.
- Sprite PNGs are cached with a 128 MiB server-side limit. The browser loads
  visible sprites on demand and limits concurrent texture loads.

## Current scope

Implemented: real account login, existing-character selection, map layers,
basic character/monster/NPC sprites, server-confirmed movement, basic melee
commands, chat, item pickup commands, inventory movement, item use, equipment
changes, item details, six belt slots, and item/durability synchronization.
Common weapon sprites/effects follow body frames and native direction layering.
Basic NPC dialogue, script choices and native-resource local/full/world maps are connected.
Walking, running, melee, potion and supported casting sounds use native WAV assets.
Walking footsteps trigger at phases corresponding to frames 1 and 4, alternating
left/right. Running retains a faster audio cadence independently of its visual
frames; both walk and run visuals play one cycle per movement interval.
Network movement timing remains unchanged. Scrolls use the item sound, not the
food/potion sound, and teleport events play the native teleport sound.
Static scenery uses image-bound spatial indexing so tall/wide sprites remain
visible when their tile anchor leaves the viewport.
The skills panel supports a conservative allowlist of active warrior, wizard and
taoist spells, existing F-key bindings, cooldown feedback and cast results.
Damage numbers, misses, critical hits and monster health bars use server events.
Fireball/GreatFireball impact, ElectricShock, ThunderBolt and Healing reuse native
effect frames; projectile travel and other spell visuals are not yet ported.

Not yet implemented: account/character creation UI, password reset UI, complete
spell coverage/effects, skill rebinding, archer ranged combat, NPC shops/input prompts, trading,
quests, guilds, heroes, music/full sound coverage, animated tiles/doors, complete armour/weapon/hair
composition, and special monster animation overrides. Assassins/archers and
transformed characters do not yet have their correct animation sets.

HP/MP uses the native Prguse liquid orb and bottom-up clipping, including the
red-only orb without MP labels for warriors below level 28. Health/mana text shows authoritative values; fill ranges use the highest value
observed since login because native maximum-stat calculation has not been ported.
Inventory operations wait for server confirmation. Timeout locks further changes
until re-login. Pickup uses the native potion/amulet belt-placement rules.
Browser textures are
retained for the session; long exploration needs an eviction policy before this
can replace the native client for extended sessions.

## Verification

```sh
dotnet run --project Tests/WebRegression/WebRegression.csproj
dotnet run --project Tests/Regression/Regression.csproj
dotnet build Client/Client.csproj
```

Web checks cover real binary login round trips, JSON projection, 64-bit item IDs,
command allowlists, null inputs, credential lengths, movement directions and
spell target serialization. `npm test` in Client.Web also covers movement,
inventory, melee targeting, death animation timing and spell preconditions.
Interactive verification used the existing local server: login, character
selection and the WhiteDragonPassage map rendered with actual game resources.

Research and follow-up design: [web-client-research.md](../docs/web-client-research.md).
