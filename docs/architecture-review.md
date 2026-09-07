# Architecture review

## Project layout

- `Shared`: packet IDs, binary serialization, item definitions, stats and enums.
  Both client and server reference this assembly, so protocol changes affect both.
- `Server.Console`: cross-platform process entry point, configuration and shutdown.
- `Server.MirForms`: Windows administration interface for the same server library.
- `Server/MirNetwork`: TCP connections, receive queues and game-stage dispatch.
  Client operations are routed to server-owned player objects.
- `Server/MirEnvir`: environment lifecycle, world loop, maps, spawning, auctions
  and persistence. The main loop processes connections and world objects; optional
  worker threads process monsters.
- `Server/MirObjects`: authoritative gameplay. `MapObject` is the world-object
  base; `HumanObject` shares character mechanics; `PlayerObject` handles player
  transactions and interactions. Monsters, NPCs, heroes and spells have their own
  objects. NPC scripts live under `Server/MirObjects/NPC`.
- `Server/MirDatabase`: persisted accounts, characters and world definitions.
  The server uses binary files rather than a relational database.
- `Client`: MonoGame/SkiaSharp client with login, character selection and game
  scenes, local input/rendering, network dispatch and gameplay dialogs.
- `LibraryEditor`, `LibraryViewer`, `AutoPatcherAdmin`, `Tools`: asset editing,
  patch distribution and generated reference pages.

## Gameplay flow

1. Client input produces a packet defined in `Shared/ClientPackets.cs`.
2. `MirConnection` decodes and queues it, then checks the connection stage before
   routing it to player logic during server processing.
3. Player logic validates and updates authoritative character/world state.
4. Server packets update the client scene, objects and dialogs.
5. Environment save operations persist accounts, guilds and other world state.

UI restrictions are insufficient: every inventory or currency operation must
validate its preconditions on the server before changing state.

## Fixed findings

| Priority | Location | Trigger and effect | Fix |
| --- | --- | --- | --- |
| High | `PlayerObject.DepositTradeItem` | A deposit packet outside a trade moves inventory into the transient trade array. `TradeCancel` returns when there is no partner, and character saving does not serialize that array. Items can be lost on logout. | Require a reciprocal trade partner before moving items. |
| High | `PlayerObject.TradeGold` | Adding gold repeatedly, with replenishment between additions, can wrap the escrow's `uint` total and lose deposited currency. | Reject additions exceeding the remaining escrow range before changing either balance. |
| Medium | `Packet.ReceivePacket` | Declared lengths 0 or 1 remain buffered indefinitely; lengths 2 or 3 reach invalid payload handling inconsistently. Subsequent data cannot advance past the bad header. | Reject every length below the four-byte header. |
| Medium | `Packet.ReceivePacket` | Compressed payload slicing drops the last four bytes, omitting part of the GZip trailer and bypassing complete trailer validation. | Pass the complete frame payload to decompression. |
| Medium | `HumanObject.CanGainItems` | Existing partial stacks and stacks created by incoming items are not credited correctly. Valid trades, mail collection and quest rewards are refused. | Reserve existing stack capacity and new slots in incoming-item order without mutating inventory. |

## Verification and scope

The regression executable covers each finding, partial and concatenated network
frames, exact currency boundaries, non-mutating capacity checks and 500 inventory
scenarios compared with actual insertion behavior. Tests were run against the
original implementations first to confirm failures, then against the fixes.

This is a focused source review of architecture, protocol framing, inventory and
trade paths. It is not an exhaustive audit of all combat skills, NPC scripts,
monster AI, threading or persistence failure modes. No live account data was
modified and no full multiplayer gameplay session was performed.
