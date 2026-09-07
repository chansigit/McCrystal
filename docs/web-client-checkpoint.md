# Web Client Checkpoint: 2026-09-05

Work-in-progress migration, not a feature-complete or release-ready native client replacement.

## Resume Update: 2026-09-06

- Fixed Windows separators in DropInfo.Load and nested #INSERT paths on macOS.
  Previously auto-created backslash-named empty templates shadowed populated
  directory files: actual DB Oma went from 0 to 45 parsed entries, SpittingSpider
  0 to 6, Hen/Deer 0 to 2. Hydra's own table is genuinely empty and was not changed.
  Server was rebuilt/restarted after a recent account autosave and local backup.
  Regression suite: 13/13 passed, including Windows path and insert coverage.
- Added blocked-click native Turn fallback; isolated browser observed Turn without
  Walk/Run when all adjacent cells were blocked. Added NPC removal/range cleanup,
  shop/input cancellation and ignoring late dialogue replies after close.
- Restored NPC/monster hover and selected-target additive highlight; removed the
  non-native main HUD attack button. Full original HUD layout is still unfinished.
- Added server-confirmed item-gain audio using native item-category click samples.
  This is explicit gain feedback; native GainedItem itself has no direct sound call.
  Latest frontend suite: 70 JS tests and 66 web protocol checks passed; build passed.
- User confirmed harvesting works. Mac Alt input is Option. Requested TeleportRing
  grants completed via native GM authentication/MAKE: one each to kzs and gan,
  server GainedItem confirmed item definition 396. No permanent AdminAccount changes.

- Hydra is local AI 181 / WaterDragon image 371. Native EvilCentipede behavior
  sends ObjectMonster + ObjectShow within three cells, and ObjectHide on retreat.
  Added its eight-frame, 100ms emergence and reversed retreat, texture-ready
  playback, and native additive overlay. Other special monster appearance state
  machines are not yet ported. No server visibility radius or AI was changed.
- Reduced damage/name text to the native 8pt equivalent, kept text screen-sized,
  and positioned names above standing sprite bounds to avoid covering bodies
  (an intentional layout adjustment, not exact native name coordinates).
  Names default on for living actors; corpses are not always labelled. Added a
  persistent eye toggle with hover names when disabled. Item names remain visible
  as with native DropView's default; the separate DropView setting is not ported.
- Added Alt/Option + held left harvest input, native Harvest/ObjectHarvest packets,
  harvesting animation and harvested skeleton state. Rewards remain server-only.
  Mock Chrome verified repeated Harvest, no movement/attack, stopping on release,
  and the bending animation. Actual meat reward on a live corpse is still unverified.
- Added map music streaming/loop/mute/resume, player/monster flinch and death,
  monster attack and default teleport audio. Map changes stop stale effects.
  Real AudioContext buffer starts and music playback/mute/resume were observed in
  isolated Chrome. Maps with Music=0 remain silent; full spell/environment/special
  monster sound parity is still incomplete.
- Latest suite: 68 JavaScript tests and 66 .NET checks passed; frontend build passed.
  Isolated WebSocket tests using real assets verified Hydra show/hide, compact
  damage text, name toggle/hover and 390px layout with no page errors. Screenshots
  were inspected; these tests did not log into kzs or establish live combat parity.

- Left ground clicks now queue one walk cell instead of A* travel to destination;
  holding left follows the pointer and release/leave/blur stops repeat movement.
  Native adjacent-direction fallback is retained for blocked facing cells.
  Live Chrome confirmed a single click moved one cell, holding moved three cells,
  and no new movement acknowledgements followed release.
- Added native attack-mode selector and Ctrl+H cycling, with server-confirmed state.
  Live server confirmed Peace -> Group -> Guild; restored Peace after verification.
- Added NPC gold shops: native Shared UserItem.Price quotes, quantity selection,
  search, server-confirmed inventory/gold, pending protection and timeout without retry.
  BuySub uses the native Buy command; crafting, selling and pearl shops remain unported.
  Live Merchant_Daniel purchase: one (HP)DrugSmall, LoseGold 40 and GainedItem Count 1.
  Desktop/mobile simulated purchase also verified no optimistic gold/inventory changes.
- Read-only database inspection: Royal_Archer is AI 57 (TownArcher), HP 999999,
  max AC 999 and Agility 255. It is not the invulnerable AI 6 Guard; misses and
  insufficient damage can explain ineffective attacks, independent of Peace mode.
  No combat balance or guard definitions were changed.

- Follow-up audio correction: removed the separate 2x running footstep clock.
  Both walk and run now trigger once at displayed frames 1 and 4, matching native
  PlayerObject.ProcessFrames. Running still selects run samples and covers two cells;
  walking audio timing and both movement animations/speeds are unchanged.

- Fixed launcher recovery when the web gateway is alive but the game server has
  stopped. Verified it started this checkout's server and reused the existing gateway.
- Added native NPCRequestInput/NPCConfirmInput interaction with Enter to submit,
  Escape/cancel, focus cleanup, and clearing on dialogue/map changes or disconnect.
  Gateway forwards only a matching, one-use server-issued input request; arbitrary
  pages, unsolicited responses, duplicate responses and old-map responses are rejected.
- Earlier suite: 60 JavaScript tests and 64 .NET protocol tests passed; frontend build passed.
- Independent headless Chrome against the real server: Enter login worked, gan entered
  Bichon, and movement over approximately 3.2 seconds confirmed five single-cell walk
  acknowledgements versus one starting walk and four two-cell run acknowledgements.
  No page errors occurred. This establishes live displacement, not subjective audio quality.
- Browser tests with simulated WebSocket packets and real map assets verified NPC input
  submission/cancel, 390px layout, and GA0/Bichon map changes clearing old input without
  page errors. These do not establish a real NPC script transaction or GT round trip.
- Bichon GTMerchant still links to undefined @agitmove in the supplied local script.
  No GM privileges, guild ownership, NPC scripts or account data were changed.
- Native desktop screenshot connector was unavailable; independent Playwright Chrome
  supplied screenshots and UI checks without controlling the user's browsing tabs.

## Included

- Local ASP.NET WebSocket gateway using the existing authoritative game protocol.
- Pixi rendering of native assets, movement, basic combat, inventory, equipment,
  selected skills, NPC script dialogue, chat and server-authorized GM commands.
- Native-resource local/full/world maps and opacity controls.
- Original HP/MP orb; warriors below level 28 use a red-only orb.
- Basic audio, separate scroll/food sounds, independent running audio cadence.
- MapChanged handling resets location, old paths and movement state after teleport.
- Map animation/blend flags and original front-layer offsets, including lamplight.
- Earlier protocol, inventory-capacity and trade-validation fixes and native login text improvements.

## Verification

- Latest web suite: 53 JavaScript tests and 36 .NET protocol tests passed.
- Frontend bundle and gateway build succeeded.
- Native Chrome: login and character selection, Bichon rendering, NPC dialogue
  and page changes, movement, and read-only `@MAP` response were observed.
- Native Chrome screenshots verified that lamplight black rectangles disappeared
  and glow placement returned to the lamp heads after the blend/offset fix.
- Before the fix, Chrome showed pathfinding exceptions after teleport: the old
  map grid was used with new-map coordinates. MapChanged handling and bounds
  guards now have regression coverage.

## Resume Here

1. Complete an end-to-end GTTransporter round trip. Its GA0 script moves the player
   to map 0 at 328,264. NPC page changes were verified, but the full round trip
   after the fix was not completed. A GM map-move attempt did not move this
   character; do not grant new privileges just to make a test pass.
2. Measure server-confirmed walk/run steps in a clear area, then verify animation
   and footstep timing together. Tests verify one visual cycle, faster run audio,
   and twice the interpolated displacement for a two-cell run; this is not a
   substitute for a completed visual comparison on the live server.
3. Verify combat, death, pickup, consumables and equipment as one live workflow,
   including after map transfers and reconnects. Earlier isolated checks do not
   establish the reliability of the combined workflow.
4. Port missing NPC shops/storage/input prompts and remaining gameplay packets.
   Some supplied scripts also reference undefined pages (for example the Bichon
   GTMerchant's `@agitmove`); distinguish script gaps from client packet bugs.
5. Replace observed HP/MP maxima with complete native stat calculation. Finish
   special-class/mount appearance, spell coverage, doors and scene lighting.
6. Address Pixi's deprecated `loadParser` warning, bounded browser texture caches,
   and further desktop/mobile layout verification.

## Safety and Operation

- No account database, passwords, local logs, generated game resources or build
  artifacts belong in this checkpoint.
- Run `./Client.Web/play.sh` and open http://127.0.0.1:5080.
- Rebuild frontend changes and refresh the browser; restart the gateway for C#
  changes. Reloading a WebSocket connection does not reload JavaScript.
- Do not run the same character in two clients simultaneously.
