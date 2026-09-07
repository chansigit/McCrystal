# Browser client research

Reviewed 2026-09-05 against the public repositories and current Crystal checkout.

## Relevant projects

| Project | Verified scope | Relevance here |
| --- | --- | --- |
| [jootm2/client](https://github.com/jootm2/client) | HTML5 port of the small-torch Mir client, with PixiJS, actor/map/scene modules and Apache-2.0 license. | Closest structural reference for a Mir browser renderer. Its protocol is not Crystal's binary protocol, so this is not a drop-in client. |
| [jootnet/JootM2](https://github.com/jootnet/JootM2) | MIT-licensed browser rendering framework for the international Legend 2 version. Requires a separate resource site. | Reference for separating game rendering from resource delivery. |
| [c-zhuo/Mir2](https://github.com/c-zhuo/Mir2) | JavaScript/Canvas/Node demonstration of characters, equipment, combat and multiplayer. Its README says implementation code has not been published. | Evidence that the presentation is feasible, not a reusable engine implementation. |
| [Kaetram-Open](https://github.com/Kaetram/Kaetram-Open) | HTML5 MMORPG derived from BrowserQuest. The current README explicitly states the open-source version has not been updated for years and the current game is no longer open-source. | Useful architectural reference for chunking and multiplayer; not selected as a maintained foundation. |
| [PixiJS](https://pixijs.com/8.x/guides/getting-started/quick-start) | Maintained browser 2D renderer with sprite, asset and scene-container APIs. | Selected for rendering while preserving Crystal's game rules and protocol. |

The first implementation does not copy source from the Mir reference projects.
It uses PixiJS and PathFinding.js dependencies and the existing repository's
protocol definitions and map parser. Existing game assets remain local.

## Decision

Keep the existing server, account files and authoritative gameplay. Add an
independent ASP.NET Core gateway that translates browser WebSocket commands to
the existing TCP binary protocol. Use native HTML for readable text and forms,
and PixiJS for the actual map/character scene.

This avoids porting the entire WinForms compatibility layer and avoids coupling
the browser to a different game's server. The gateway can decode the existing
shared C# packets, including complex user/item data, without a second hand-written
binary parser in JavaScript. Whitelisted JSON commands remain small enough for
the first local client; protocol optimization can follow measured traffic.

The browser cannot simply open the server's raw TCP socket. A WebSocket-capable
transport is required. The current gateway is bound to loopback and is deliberately
not deployed to a hosted site: it needs access to this machine's running game server
and local game assets.

## Next increments

1. Extract map and sprite decoding into a reusable pure asset package, with
   format fixtures and full animation metadata tests.
2. Port full appearance composition, monster-specific animation rules, movement
   reconciliation tests, dynamic map animations, doors and texture eviction.
3. Port native item placement/stat calculation, then inventory/equipment actions
   and NPC dialogue/shops, with conservation and protocol tests.
4. Add magic casting, effects, ranged attacks and sound, then quests/heroes/guilds.
5. Before remote access, design TLS, gateway rate limits/session controls,
   resource delivery authorization and a deployment topology for the game server.

Replacing the complete native client is a staged port. The current branch contains
an actual connected prototype; it does not claim native feature parity.
