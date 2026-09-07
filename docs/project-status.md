# Project status

As of 2026-09-07, `main` at `47e85a16`. Living document — update the date and
the sections that changed rather than starting a new file.

## What runs where

| Service | Address | Notes |
| --- | --- | --- |
| Game server | `127.0.0.1:7000` | `Server.Console`, run from `Build/Server/Debug` |
| Web client gateway | `http://127.0.0.1:5080` | `Client.Web`, serves the browser client |
| GM admin console | `http://127.0.0.1:5081` | Loopback only, password in `[Admin]` of `Configs/Setup.ini` |
| Server status port | `127.0.0.1:3000` | Native, unchanged |

macOS AirPlay Receiver also listens on `*:7000`. The game server binds
`127.0.0.1:7000` specifically and normally coexists with it, but if AirPlay
restarts and grabs the port first the server fails to bind. The failure appears
as `[outer workloop error]` with `Address already in use`, and the game loop
never starts, so the server accepts nothing. Turn AirPlay Receiver off in System
Settings if it recurs.

### launchd jobs

An earlier session registered two transient launchd jobs with `launchctl
submit`. They restart both processes automatically, which is why killing the
server appears not to work:

```
com.mccrystal.server   → cd Build/Server/Debug && dotnet Server.Console.dll
com.mccrystal.web      → the Client.Web gateway
```

They have no plist file, so they disappear on reboot. Note the server job does
not pass `--pack classic`. To take manual control:

```sh
launchctl remove com.mccrystal.server
launchctl remove com.mccrystal.web
```

## Content packs

`Packs/classic/pack.yaml` registers the existing `Build/Server/Debug` data as
the pack `crystal-classic 1.0.0`, database schema 111. Nothing was moved; the
manifest points at the original directories. Validate with:

```sh
cd Build/Server/Debug && dotnet Server.Console.dll --pack classic --validate-pack
```

Downloaded Mir 1.76 source material lives in `ThirdParty/legend-176/`
(git-ignored, about 1.8 GB). The clean GPL baseline is GeeM2 commit `48bfebd`,
564 maps, before hero and later content was added. Inventory and licences are in
`docs/research/legend-176-sources.md`. A `classic-176` pack still needs a
converter from that SQLite database to `Server.MirDB`.

## GM admin console

Browser console hosted inside `Server.Console`, bound to loopback. Overview,
online players with actions, accounts and characters, live logs with server
actions, read-only database browsing, statistics. Every mutation runs on the
engine thread through `Envir.AdminActions` and is logged with an `[Admin]`
prefix. Setup and the security rules are in `Server.Admin/README.md`.

Two defects were found and fixed during review, both worth remembering because
they are the kind that recur:

- The path guard compared case-sensitively while ASP.NET routing matches
  case-insensitively, so `GET /API/overview` reached every endpoint with no
  cookie. Fixed with `StartsWithSegments(..., OrdinalIgnoreCase)` plus a
  required `X-Admin-Console` header on state-changing methods.
- Setting a level above the configured experience curve makes
  `RefreshMaxExperience` return 0, and `GainExp` then loops a character to 65535
  on their next kill. The console now bounds levels by `ExperienceList.Count`.

## Web client

Coverage after the Tier 1 work: 87 of 279 server packets handled, 32 of 153
client packets sendable. Unhandled packets are logged to the console rather than
dropped silently; `window.__unhandledPackets` lists what a session saw.

Closed: town revive, character creation and deletion, item drop and split, drop
gold, NPC sell and repair with prices, NPC storage. The inventory pending-lock
dead-lock was fixed at the same time.

The full comparison against the native client, the remaining tiers and the
suggested order are in `docs/web-client-gap-analysis.md`. The cheapest next work
is the read-only displays whose data already arrives: experience bar, character
stat panel from `BaseStatsInfo`, buff and poison icons from `AddBuff`, and day
and night from `TimeOfDay`. None of those needs a gateway change.

## Known issues

- **Characters `kzs` and `gan` are level 65535.** Caused by the experience-curve
  bug above, before it was fixed. They need setting back to a sane level by
  hand; the admin console will now accept 1 to 500.
- Sell and repair prices are computed in the browser by a port of
  `UserItem.Price()` and `RepairPrice()`. The arithmetic is pinned by matching
  tests on both sides, but the rendered numbers were never confirmed against an
  NPC in game.
- The storage password path (`RequireStoragePassword`) is covered by unit tests
  only; no account here has a vault password set.
- `Envir/Quests/PrajnaIsland\PIVillage/2.txt` is a Windows-separator path that
  does not resolve on macOS. The server logs it at startup. Cosmetic for now.
- log4net 3.0.3 carries a moderate advisory (NU1902) and is unpatched.

## Tests

```sh
dotnet run --project Tests/Regression/Regression.csproj   # engine, 36 checks
cd Client.Web && npm test                                 # 126 JS + 124 gateway
```

`Tests/Regression` uses a plain array of named checks in `Program.cs`, not a
test framework. Add new checks there.

## Documents

| File | Contents |
| --- | --- |
| `docs/architecture-review.md` | Client / Shared / Server structure and early bug findings |
| `docs/web-client-checkpoint.md` | Dated progress log of the web client migration |
| `docs/web-client-gap-analysis.md` | Native vs web feature comparison and roadmap |
| `docs/research/legend-176-sources.md` | Downloaded 1.76 packs, revisions, licences |
| `docs/reports/classic-pack-report.json` | Content pack validation baseline |
| `Server.Admin/README.md` | Admin console setup and security model |
| `PORTING_LOG.md` | The original Windows to macOS client port |
