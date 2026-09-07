# Admin console

A local browser console for the running game server. It is hosted inside
`Server.Console` and listens on `127.0.0.1` only.

## Enable

In the server's `Configs/Setup.ini`:

```ini
[Admin]
Enabled=True
Port=5081
Password=choose-a-password
```

An empty password keeps the console off. Start the server, then open
<http://127.0.0.1:5081> and log in with the password. The session cookie is a
random token held in memory, so every restart invalidates existing sessions.

## What it does

- Overview: uptime, content pack, database version, online count, loop time, memory.
- Online players: give items and gold, teleport, set level, whisper, kick.
- Accounts: search, reset password, grant or revoke the admin (GM) flag, inspect
  inventory, equipment and storage.
- Server: live log stream, broadcast, save now, reload drop tables and NPC scripts.
- Database: read-only item, monster, map and NPC lists.
- Statistics: account, character, class and level counts; busiest maps; gold totals.

Every action runs on the engine thread through `Envir.AdminActions` and is
logged with an `[Admin]` prefix.

## Security

The console is meant for a local machine and has no HTTPS. Two rules keep it
from being reachable by anything else in the browser:

- Every `/api/` path except `/api/login` requires the session cookie. The path
  check is case-insensitive because ASP.NET routing is; a case-sensitive check
  let `/API/overview` through unauthenticated.
- Every state-changing request must also carry `X-Admin-Console: 1`. A browser
  cannot set that header cross-origin without a CORS preflight, which no policy
  allows, so another page cannot trigger an action even from a same-site port.
  GET and HEAD are exempt because `EventSource` cannot send headers.

Do not expose the port beyond the loopback interface.

## Tests

```sh
dotnet run --project Tests/Regression/Regression.csproj
```
