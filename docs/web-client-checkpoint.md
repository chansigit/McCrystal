# Web Client Checkpoint: 2026-09-05

Work-in-progress migration, not a feature-complete or release-ready native client replacement.

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
