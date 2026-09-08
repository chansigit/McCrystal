# Project status

As of 2026-09-07, `main` at `0c908485`. Living document — update the date and
the sections that changed rather than starting a new file.

## What runs where

| Service | Address | Notes |
| --- | --- | --- |
| Game server | `127.0.0.1:7000` | `Server.Console`, run from `Build/Server/Debug` |
| Web client gateway | `http://127.0.0.1:5080` | `Client.Web`, serves the browser client |
| GM admin console | `http://127.0.0.1:5081` | Loopback only, password `asdfasdfHPC` in `[Admin]` of `Configs/Setup.ini` |
| Server status port | `127.0.0.1:3000` | Native, unchanged |

Changing the admin password requires stopping the server first: it writes its
in-memory settings back over `Setup.ini` on shutdown, so an edit made while it
runs is silently overwritten.

macOS AirPlay Receiver also listens on `*:7000`. The game server binds
`127.0.0.1:7000` specifically and normally coexists with it, but if AirPlay
restarts and grabs the port first the server fails to bind. The failure shows as
`[outer workloop error]` with `Address already in use`, the game loop never
starts, and every admin action then times out while read-only queries still work.

**Never identify the game server by port alone** — `lsof` on 7000 also returns
the macOS ControlCenter process. Filter on `dotnet`.

### launchd jobs

An earlier session registered two transient jobs with `launchctl submit`, which
restarted the processes on exit. That is why killing the server appeared not to
work, and why it came back without `--pack classic`.

`com.mccrystal.server` has been removed, because it kept resurrecting the server
with a stale `Setup.ini`. The game server is now started by hand:

```sh
cd Build/Server/Debug && dotnet Server.Console.dll --pack classic
```

`com.mccrystal.web` still manages the web gateway. Both jobs are transient — no
plist file — so nothing survives a reboot. Drop the remaining one with
`launchctl remove com.mccrystal.web`.

`Client.Web/play.sh` is the portable way to bring the stack up. Prefer it over a
macOS-specific launchd plist.

## The account and its characters

Account `cocofly`. **One connection per account** — logging in kicks whoever is
already on, so a background agent must never log in while the user is playing.

| Character | Class | Level | Note |
| --- | --- | --- | --- |
| `kzs` | Wizard | 40 | Was 65535, lowered to 1 for testing, raised to 40 to fix weight |
| `gan` | Warrior | 10 | Was 65535, still overweight, cannot run |

Both reached 65535 through the experience-curve bug described below. Lowering a
level through the admin console also zeroes `Experience`, which is required —
stale experience re-levels the character on the next kill.

**Lowering a level collapses the weight caps.** `CanRun`
(`Server/MirObjects/HumanObject.cs:135`) requires
`CurrentBagWeight <= Stats[Stat.BagWeight]`; `CanWalk` does not. So an
overweight character walks but cannot run, and a character carrying a max-level
inventory at level 10 is far over the cap. Authentic behaviour, and the
explanation for "right-click running stopped working".

Native also refuses to run below 10 HP (`Client/MirScenes/GameScene.cs:11527`),
faithfully ported — another reason a freshly-lowered character cannot run.

The admin console only acts on **online** characters. A watcher script polling
`/api/players` and applying the change when the character appears is the way to
do this without making the user wait.

## GM admin console

Hosted inside `Server.Console`, bound to loopback. Overview, online players with
actions, accounts and characters, live logs with server actions, read-only
database browsing, statistics. Every mutation runs on the engine thread through
`Envir.AdminActions` and is logged with an `[Admin]` prefix. Setup and security
rules in `Server.Admin/README.md`.

Two defects found in review, both worth remembering because they recur:

- The path guard compared case-sensitively while ASP.NET routing matches
  case-insensitively, so `GET /API/overview` reached every endpoint with no
  cookie. Fixed with `StartsWithSegments(..., OrdinalIgnoreCase)` plus a required
  `X-Admin-Console` header on state-changing methods. **Any command the gateway
  rejects tears down the whole session**, so an over-strict validator produces a
  disconnect loop rather than an error — that is what an 80-slot bound did to
  accounts with expanded 160-slot storage.
- Setting a level above the configured experience curve makes
  `RefreshMaxExperience` return 0, and `GainExp` then loops a character to 65535
  on their next kill. The console now bounds levels by `ExperienceList.Count`,
  which `ExpList.ini` populates to 500.

## Web client

Coverage: 87 of 279 server packets handled, 32 of 153 client packets sendable.
Unhandled packets are logged to the console rather than dropped silently;
`window.__unhandledPackets` lists what a session saw.

Done: town revive, character creation and deletion, item drop and split, drop
gold, NPC sell and repair with prices, NPC storage, the character stat panel,
the experience bar, the hair layer, and the animation foundation below.

The gateway serves `wwwroot` **straight from the source tree**, so a rebuild is
live immediately and the user only needs a cache-busting reload. Chrome caches
`index.html` and `style.css` heuristically. A background agent doing web work
should use a **git worktree** so the user's live client is not disturbed.

Two findings worth keeping:

- `S.UserInformation` does **not** carry a player's computed stats. The native
  client derives all of them in `UserObject.RefreshStats`. The stat panel is a
  port of that whole chain in float-exact arithmetic — the level formulas are C#
  `float`, so every step needs `Math.fround`, including `Gain`/`GainRate` after
  JSON parsing.
- `Stats.Count` is `Values.Sum(Math.Abs)`, a sum of magnitudes rather than a key
  count, so the gateway's flattening of `Stats` to a name-value map preserves
  everything needed to compute item prices in the browser. An earlier assumption
  that this data was destroyed was wrong.

Full native-versus-web comparison and roadmap: `docs/web-client-gap-analysis.md`.

## Animation

`docs/web-client-animation-audit.md` is the specification and records what is
now done.

The foundation is complete. Every actor carries a current action and the
timestamp it began, and frames are measured from that start —
`src/entity-action.js` holds the rules. This replaced a `performance.now()`
modulo that put every monster of the same image on the same frame at the same
instant. Also done: attack duration from the manifest, the `Blend` flag through
the gateway, native's action fallbacks, Struck and Revive, attack variants from
`Type`, `ObjectRangeAttack`, generalised Show and Hide, and per-monster draw
offsets.

**The largest remaining item** is the 275-call per-monster overlay table: native
has overlays for 71 monsters, the web implements one, the Hydra, and that one is
exactly right. The Scarecrow's burning death overlay is among the 70 missing and
was never implemented. The table is indexed by frame index, which now exists, so
it is no longer blocked.

After that come the effect model with real lifetimes, projectiles, ground
spells, and the Assassin and Archer body sets.

## Sprite upscaling

`docs/sprite-upscaling-research.md` has the full evidence, measured on this
repository's own assets. Conclusions:

- The art is **not pixel art** — pre-rendered 3D downsampled, about 97 colours
  per frame — so every "correct" pixel-art scaler degenerates to nearest
  neighbour on it. The choice is xBRZ or nothing.
- xBRZ verified: zero alpha contamination, temporal ratio 1.159 against a 1.000
  floor, perturbations bounded to a 3-pixel halo so shimmer is structurally
  impossible, whole corpus in about 4 minutes.
- Upscayl and the ncnn family are ruled out at source level: the alpha channel
  never enters the network. `ffmpeg -vf xbr` silently drops alpha entirely.
- **The shadows are a 50% checkerboard dither in 81% of frames.** Replacing them
  with real alpha is more valuable than the upscaling itself.
- A GPU buys nothing for xBRZ. The Stanford Sherlock allocation, which the user
  has cleared for this, is only relevant to the AI route.
- Per-frame offsets **must be doubled** on re-import, and the client's
  `a == 0 && rgb != 0 → a = 255` rule must be applied *before* upscaling.

Next step is a single-monster experiment judged by flipbooking a walk cycle —
shimmer is invisible in stills, so every still comparison is blind to the
failure mode that matters. Deer is `Monster/004.Lib`.

## Finding where a monster lives

Respawn tables exist only inside the binary `Server.MirDB`, and the admin console
does not expose them, so "which map has Zuma statues" cannot be answered from
memory — Zuma Temple 1F and 2F have none at all, despite the name.

```sh
curl -s -b jar 'http://127.0.0.1:5081/api/db/monsters?q=' > monsters.json
python3 Tools/DumpSpawns/dump_spawns.py --monsters monsters.json --monster ZumaStatue
```

The script parses the header and the `MapInfo` block, which is the first block in
the file, and stops there. Monster names come from the admin console because the
name table sits behind the item table in the same file.

## Game mechanics learned

Deer are AI 2, the `Deer` behaviour class. One in seven rolls `_runAway` at
spawn: it never fights back, walks directly away from its attacker, moves
faster, and carries a `Quality` of 0–14000 against a normal deer's 0–3000, so
the fleeing ones are worth more when skinned. They look identical.

## Known issues

- Sell and repair prices are computed in the browser by a port of
  `UserItem.Price()` and `RepairPrice()`, pinned by matching tests on both
  sides, but never confirmed against an NPC in game.
- The storage password path is covered by unit tests only.
- `ObjectHide` forces `Hidden = false`, so a stealthed monster receiving a Hide
  becomes visible for the animation. Inherited from the original Hydra path, now
  applying to 21 monsters.
- `Envir/Quests/PrajnaIsland\PIVillage/2.txt` is a Windows-separator path that
  does not resolve on macOS. Logged at startup, cosmetic.
- log4net 3.0.3 carries a moderate advisory (NU1902).
- `gan` cannot run until its weight is under the level-10 cap.

## Tests

```sh
dotnet run --project Tests/Regression/Regression.csproj   # engine, 36 checks
cd Client.Web && npm test                                 # 166 JS + 127 gateway
```

`Tests/Regression` uses a plain array of named checks in `Program.cs`, not a
test framework.

## Working practices that paid off here

Two independent reviews per change, one for spec compliance and one for code
quality, caught an authentication bypass, a storage bound that disconnected
players in a loop, and a level setter that could spin a character to 65535.
Reviewers were told to verify against the server source rather than trust the
implementer's report, and that repeatedly overturned premises — including
several of mine.

Do not type passwords into web forms. Where a live check needs a game login, the
user must do it.

The `superpowers` plugin was uninstalled at the user's request; the three
modified config files are backed up in
`~/.claude/plugins-backup-20260907-161635`.

## Documents

| File | Contents |
| --- | --- |
| `docs/architecture-review.md` | Client / Shared / Server structure and early bug findings |
| `docs/web-client-checkpoint.md` | Dated progress log of the web client migration |
| `docs/web-client-gap-analysis.md` | Native vs web feature comparison and roadmap |
| `docs/web-client-animation-audit.md` | Animation comparison, what is done, what remains |
| `docs/sprite-upscaling-research.md` | Upscaling tool evidence, landmines and verdict |
| `Tools/DumpSpawns/dump_spawns.py` | Every map's respawn table, read out of `Server.MirDB` |
| `docs/research/legend-176-sources.md` | Downloaded 1.76 packs, revisions, licences |
| `docs/reports/classic-pack-report.json` | Content pack validation baseline |
| `Server.Admin/README.md` | Admin console setup and security model |
| `PORTING_LOG.md` | The original Windows to macOS client port |
