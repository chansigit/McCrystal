# GM admin console design

Date: 2026-09-07

## Goal

Give the macOS server a browser-based game master console that replaces the
Windows-only `Server.MirForms` management UI for day-to-day operation: watch
the server, act on online players, manage accounts, browse the gameplay
database, and read statistics. Editing gameplay definitions is out of scope.

## Architecture

New project `Server.Admin/` (class library, net8.0) referenced by
`Server.Console`. It references `Server.Library` and the
`Microsoft.AspNetCore.App` framework. `Server.Console` calls
`AdminConsole.Start()` after `Envir.Main.Start()` and `AdminConsole.Stop()`
before `Envir.Main.Stop()`.

Layers:

- `AdminService.cs`: plain C# over `Envir.Main`. Every query and action lives
  here. No HTTP types. This is what the regression tests exercise.
- `AdminEndpoints.cs`: ASP.NET Core minimal API mapping `AdminService` to
  `/api/...` JSON routes, plus `/api/logs/stream` as server-sent events.
- `wwwroot/index.html` plus one plain JavaScript file: a single page with a
  left-hand tab list. No build step, no framework. Dark theme in the style of
  the existing `GMCommands.html`.

The existing `Server/Utils/HttpServer.cs` (unauthenticated website hooks on
port 5679) is left untouched and stays disabled.

## Threading

The engine main loop runs on its own thread. HTTP requests run on thread-pool
threads.

- Read-only queries read engine objects directly, as `SMain` does. Lists that
  the main loop mutates (`Players`, `Connections`, per-map `Players`) are
  copied to a snapshot before iteration.
- Every mutating action is posted to a new `ConcurrentQueue<Action>` on
  `Envir` that the main loop drains once per tick. The HTTP side waits on a
  completion signal with a 5 second timeout and reports success, the action's
  error message, or a timeout. Password resets and AdminAccount toggles go
  through the same queue because the main loop also reads account objects.
- Each executed action writes a line to `MessageQueue`, for example
  `[Admin] gave kzs 1 TeleportRing`.

## Binding and authentication

- Listens on `127.0.0.1` only. Default port 5081 (the web client uses 5080).
- `Setup.ini` gains an `[Admin]` section: `Enabled=True`, `Port=5081`,
  `Password=`. An empty password logs a warning and the console does not
  start.
- `POST /api/login` with the password sets an HttpOnly session cookie. The
  token is random, held in memory, and dies with the process. Every other
  `/api/*` route returns 401 without a valid cookie.
- No HTTPS. The console is a local tool and must not be exposed publicly.

## Pages

### Overview

Uptime, active content pack id and database version, online player count,
main loop time (`Envir.LastRunTime`), process memory, connection count, total
monster count. Polled every 2 seconds.

### Online players

Table: character name, account id, class, level, map and coordinates, IP,
session duration. Selecting a row exposes actions:

| Action | Engine entry |
| --- | --- |
| Give item (item name search, quantity) | `Envir.CreateFreshItem` + `HumanObject.GainItem` |
| Give gold | `GainGold` |
| Teleport (map, optional coordinates) | `HumanObject.Teleport`, random location when none given |
| Set level | `Level` setter then `RefreshStats` |
| Kick | `MirConnection.SendDisconnect` |
| Whisper | `ReceiveChat` with `ChatType.WhisperIn` |

### Accounts and characters

Searchable account list: account id, character count, creation date, last
login, AdminAccount flag, banned flag. Actions: reset password (assigns
`AccountInfo.Password`, which hashes with the stored salt) and toggle
AdminAccount. Opening an account lists its characters with level, gold,
inventory and equipment (read-only: item name, count, durability). Data comes
from `CharacterList`, for online and offline characters alike.

### Server and logs

Live log view fed by `MessageLog`, `DebugLog`, and `ChatLog`, filterable by
keyword. Today only `Server.Console` drains these queues. The console loop is
changed to push each line into a shared ring buffer (last 2000 lines) that
both the terminal and the admin page read from.

Buttons: broadcast (`Envir.Broadcast` of a system chat packet), save now
(`SaveDB` and `SaveAccounts`), reload drops (`ReloadDrops`), reload NPC
scripts (`ReloadNPCs`).

### Database browser

Read-only, searchable tables:

- Items: name, type, required level and class, base stats.
- Monsters: name, level, experience, AI, drop path.
- Maps: index, file name, title, current player and monster counts.
- NPCs: name, map, script file name.

### Statistics

Computed on request, no persistence, shown as tables:

- Accounts, characters, class distribution, level distribution in 10-level
  bands, current online count.
- Top 20 maps by live monster count and by player count.
- Total gold across inventories and storage, total item count, top 10
  characters by gold.
- Runtime metrics as on the overview.

## Out of scope for this version

Editing item, monster, map, or NPC definitions; IP bans; game shop; guild
management; charts.

## Testing

- `Tests/Regression` gains `AdminService` checks built on in-memory `Envir`
  data (accounts, characters, item definitions): search, statistics, password
  reset, AdminAccount toggle, action queue draining, and action timeout. No
  network is started.
- An HTTP check starts the admin host on a random port and verifies that
  `/api/*` returns 401 without a cookie or with a wrong password and 200 after
  a correct login.
- Manual: start the server, open port 5081, give the `cocofly` character an
  item, confirm it arrives in game.
