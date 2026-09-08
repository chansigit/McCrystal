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

Coverage: 97 of 279 server packets handled, 33 of 153 client packets sendable.
Unhandled packets are logged to the console rather than dropped silently;
`window.__unhandledPackets` lists what a session saw.

Done: town revive, character creation and deletion, item drop and split, drop
gold, NPC sell and repair with prices, NPC storage, the character stat panel,
the experience bar and the weight block, the hair layer, skill hotkeys on
F1..F8 and Ctrl+F1..F8, and the animation work below.

**`src/*.js` is not what the browser runs.** `index.html` loads
`wwwroot/client.js`, an esbuild bundle. Editing a module changes nothing in the
browser until `cd Client.Web && npm run build` regenerates it -- and the unit
tests import the sources directly, so a green test run says nothing about what is
being served. `style.css` and `index.html` are served raw, so a CSS fix appears
to work while the JavaScript beside it silently does not: that mix is what makes
this trap hard to see. Rebuild, then confirm in the browser rather than
reasoning about it.

The gateway serves `wwwroot` from the source tree, so once rebuilt the bundle is
live and the user only needs a cache-busting reload. Chrome caches `client.js`,
`index.html` and `style.css` heuristically. A background agent doing web work
should use a **git worktree** so the user's live client is not disturbed.

`window.__debug` (the world and the session state) and `window.__monsters()`
(what the server said about every monster in view) are the console handles for
telling a rendering bug apart from a server state faithfully rendered.

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
done. **Groups 1 and 2 are complete**, and Group 3 is complete except for the
two classes this pack turns off.

Landed: the frame cursor anchored to each action's own start; per-monster attack
duration; the `Blend` flag; native's action fallbacks; Struck and Revive; attack
variants; `ObjectRangeAttack`; Show and Hide with the burrowers and the statues;
per-monster draw offsets; a statue's spawn-time stoned state; the 275-call
monster overlay table over 85 monsters; ground spells (`S.ObjectSpell`);
attached effects with real lifetimes (`S.ObjectEffect`); the one projectile
(`S.ObjectProjectile`); poison tints and status dots; the complete player frame
set with Struck, Stance, the attack variants, Revive, Mine and Lunge; mounts;
wings; and transforms.

Deliberately not done: the Assassin and Archer body sets. `Configs/Setup.ini`
carries `AllowCreateAssassin=False` and `AllowCreateArcher=False`, which is
right for a 1.76 pack, so no character on this server can reach that code.

Two techniques worth reusing. The overlay table was **generated** from the C# by
a parser and then checked by evaluating all 275 frame expressions in both
languages over nine frame-and-direction pairs; hand transcription of 1,260 lines
would have been worse in every way. And the Hydra overlay, the one entry that
had been verified by hand before, is kept as a regression guard: its generated
row must reproduce the old shortcut exactly.

## Sprite upscaling

`docs/sprite-upscaling-research.md` has the full evidence. The verdict is xBRZ
rather than any AI model, because the art is pre-rendered 3D downsampled rather
than pixel art, so every "correct" pixel-art scaler degenerates to nearest
neighbour on it, and because the whole ncnn family upscales alpha with a bicubic
layer outside the network.

It is built and running.

- `Tools/SpriteHD/` decodes a `.Lib`, runs the pre-passes, upscales 2x through
  the xBRZ WASM port in one long-lived node process, and writes
  `Data/HD/<library>/<index>.png`.
- The gateway serves an override in place of the decoded frame, and `assetScale`
  in `entity-presentation.js` halves the sprite scale when a texture arrives at
  exactly twice its manifest size. Nothing in the protocol changed.
- Monsters 0-99 are converted: 23,653 frames, 92 seconds, 616 MB. Everything
  from 100 up is untouched and renders as before, which makes it a live control.
- All monsters would be 188,013 frames, about 13 minutes and 5.3 GB. The whole
  corpus is 1,870,142 frames, about 2 hours and roughly 50 GB, and there were
  27 GB free when this was written.

Two things that silently ruin a frame if skipped, both verified rather than
assumed. The RGB under transparent pixels has to be zeroed *before* upscaling:
without it xBRZ leaves 192 of 256 output pixels that the client loader's
`a == 0 && rgb != 0` rule would force opaque, and with it, exactly zero. And the
shadow dither has to be detected per frame *and* per colour, because a
whole-frame parity test only reaches 93% and the parity flips within a single
walk cycle.

The shadow fix is the change you notice first, and it is not upscaling at all.
The shadow in this art is a 50% checkerboard of `RGBA(16,8,8,255)` faking half
opacity on 1999 hardware; replacing it with a solid region at alpha 128 gives a
better shadow than the original engine could draw. It is on 100% of `AArmour`,
71% of `CArmour` and 60% of monster frames -- exactly the things that cast one.

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
cd Client.Web && npm test                                 # 205 JS + 131 gateway
```

`npm test` runs the sources. **It says nothing about what the browser is
running** -- see the bundle warning above.

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
| `Tools/SpriteHD/README.md` | How to build and preview HD sprite overrides |
| `Tools/DumpSpawns/dump_spawns.py` | Every map's respawn table, read out of `Server.MirDB` |
| `docs/research/legend-176-sources.md` | Downloaded 1.76 packs, revisions, licences |
| `docs/reports/classic-pack-report.json` | Content pack validation baseline |
| `Server.Admin/README.md` | Admin console setup and security model |
| `PORTING_LOG.md` | The original Windows to macOS client port |
