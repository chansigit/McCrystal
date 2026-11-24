# McCrystal

A headless simulation of a Legend of Mir 2 world for AI agents, built on the open-source
[Crystal](https://github.com/Suprcode/Crystal) server, together with a macOS port of the Crystal client.

The server can run without a network, on a virtual clock, hundreds of times faster than real time,
and repeat a run exactly from its seed. Characters are driven from inside the process or from Python,
through the same packets a human player's client sends, so every rule of the game applies to them unchanged.

- **Fast.** One world of 100 characters: about 160,000 character-steps per second through the Python bridge.
- **Repeatable.** Same seed and same actions give the same world, byte for byte.
- **The real game.** Movement, combat, drops, shops, repairs and death are the original server logic, not a re-implementation.
- **A baseline to beat.** A scripted policy that hunts, loots, sells, buys and repairs; and a PPO trainer.

The original macOS client port and the playable server are still here: see [Playing it yourself](#playing-it-yourself).
The code before the simulation work is on the [`classic`](https://github.com/chansigit/McCrystal/tree/classic) branch.

## Contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [What an agent sees and does](#what-an-agent-sees-and-does)
- [Baselines](#baselines)
- [Speed](#speed)
- [Training](#training)
- [Looking at a run](#looking-at-a-run)
- [Repository layout](#repository-layout)
- [Status and limits](#status-and-limits)
- [Playing it yourself](#playing-it-yourself)
- [Licence and game data](#licence-and-game-data)
- [Links](#links)

## Quick start

You need the .NET 8 SDK and Python 3.9 or newer. The examples write `dotnet`; on macOS with Homebrew's keg-only
`dotnet@8` that is `/opt/homebrew/Cellar/dotnet@8/<version>/bin/dotnet`.

**1. Get the maps.** The `mir-176` content pack ships its database, scripts and settings, but not its map files.
Rebuild them from the Mir2-GeeM2 archive at the pinned revision:

```sh
mkdir -p ThirdParty/legend-176/repos ThirdParty/legend-176/snapshots/geem2-official-176
git clone --filter=blob:none --no-checkout https://github.com/cjlaaa/Mir2-GeeM2 ThirdParty/legend-176/repos/mir2-geem2
git -C ThirdParty/legend-176/repos/mir2-geem2 archive 48bfebd | tar -x -C ThirdParty/legend-176/snapshots/geem2-official-176
dotnet run --project Tools/Mir176Import -- --source ThirdParty/legend-176/snapshots/geem2-official-176 \
    --pack Packs/mir-176/pack.yaml --report docs/reports/mir-176-import.md --write
```

**2. Cut the world down to one map.** Training uses Bichon province only (map 0): 87 spawn points, about 3,000 monsters, 21 NPCs.

```sh
dotnet run --project Tools/PackTrim -- --from Packs/mir-176 --to Packs/mir-176-bichon --maps 0 \
    --id mir-176-bichon --port 7200 --status-port 3200 --admin-port 5083
```

**3. Build and run the scripted baseline** for six game hours with 100 warriors (about a minute and a half):

```sh
dotnet build Server.Console/Server.Console.csproj -c Release
cd Build/Server/Release
dotnet Server.Console.dll --pack ../../../Packs/mir-176-bichon/pack.yaml --state /tmp/mccrystal-state \
    --sim --sim-seed 42 --sim-agents 100 --sim-policy script --sim-until 21600
```

It prints a summary: levels, kills, deaths, gold, and what the script spent its time on.

**4. Drive it from Python.**

```sh
python3 -m venv .venv && .venv/bin/pip install numpy torch
PYTHONPATH=python .venv/bin/python python/bench.py --agents 100 --steps 20000
```

```python
from mccrystal import CrystalVecEnv

with CrystalVecEnv(agents=100, seed=1) as env:
    obs, stats = env.reset()
    for _ in range(1000):
        actions = my_policy(obs["grid"], obs["self"], obs["mask"])   # int[100]
        obs, stats = env.step(actions)
```

On Linux, `sh python/setup_linux.sh` does steps 3 and 4 in one go (it installs .NET 8 under `~/.dotnet`, no root needed).

## How it works

Crystal is one process holding the whole world in memory, with a single main loop. The simulation mode changes
how that loop is fed, not what it does.

| Piece | What it does |
| --- | --- |
| Virtual clock | With `--sim`, time advances by a fixed step per loop (50 ms by default) instead of following the wall clock. The world runs as fast as the machine allows. |
| Seeded randomness | One generator seeded from `--sim-seed`; the monster worker threads are off. A run repeats exactly. `--sim-hash N` prints a hash of the world every N game seconds to prove it. |
| Characters without sockets | An agent holds a virtual connection and injects real client packets (`Walk`, `Attack`, `BuyItem`, ...). The server cannot tell it from a player. |
| Decision step | Every 4 ticks (200 ms of game time) all agents observe the same moment, a policy picks one action each, and the actions are carried out. |
| Policies | `script` (the baseline), `random`, or `remote`: a memory-mapped file shared with another process, with one byte each way per step to say whose turn it is. |
| Content packs | `--pack` selects the game data and `--state` the directory for accounts and saves, so many worlds can run side by side. |

Options, all on `Server.Console`:

| Option | Meaning |
| --- | --- |
| `--sim` | Virtual clock; no network ports unless `--sim-listen` |
| `--sim-seed N`, `--sim-until SECONDS` | Seed; game time at which to stop and print the summary |
| `--sim-agents N`, `--sim-policy script\|random\|remote` | Characters to create and what drives them |
| `--sim-view R`, `--sim-decision-ticks N` | View radius (default 7, so a 15×15 grid); ticks between decisions (default 4) |
| `--sim-script-off a,b` | Switch parts of the script off: `flee`, `potion`, `rest`, `select`, `memory`, `resupply` |
| `--sim-trace FILE`, `--sim-trace-seconds N` | Record the run for the replay page |
| `--sim-remote DIR` | Directory shared with the trainer when the policy is `remote` |
| `--sim-no-relief` | Turn off the bankruptcy relief described below |
| `--sim-hash N`, `--sim-speed X`, `--sim-tick MS` | State hashes; hold the world to X times real time; tick length |

## What an agent sees and does

Full field tables are in [docs/sim-interface.md](docs/sim-interface.md) (Chinese). In short:

- **Grid** `float32[14, 15, 15]`, centred on the character: walkable ground, blocked cells, monsters with their health and
  level and whether they are after you, other players, items on the ground, NPCs and what each shop does, corpses you can
  still cut up, and town guards.
- **Self** `float32[33]`: health, level and progress, what you can do right now, potions, bag space and weight, gold,
  position and facing, the state of your gear, and the direction and distance to the nearest town.
- **Actions**, 41 discrete: walk, run and attack in eight directions; pick up; drink; cut up a corpse in eight directions;
  and four compound trades with a nearby NPC (sell loot, buy a potion, buy the best gear you can afford, repair).
- **Mask** `uint8[41]`: which of those are possible now. An action outside the mask is dropped.

New characters start with a wooden sword and cloth armour. Two rules exist only in the simulation: a dead character is
sent back to town and carries on, and a character with no weapon and no money is handed a starter sword again
(otherwise a low-level warrior who drops his weapon can never earn another).

## Baselines

100 warriors in Bichon province for six game hours. Five seeds each; mean ± standard deviation across seeds.
"Level" counts progress to the next level: 9.40 is level 9 and 40% of the way to 10.

| Policy | Level | Kills per character | Deaths per character | Gold held |
| --- | --- | --- | --- | --- |
| Scripted baseline | 10.19 ± 0.13 | 743 ± 27 | 1.32 ± 0.13 | 5178 ± 269 |
| Script without trips to town | 7.06 ± 0.20 | 279 ± 15 | 3.75 ± 0.18 | 256 ± 28 |
| Random | 1.67 ± 0.05 | 14 ± 1 | 16.46 ± 1.24 | 51 ± 6 |

The script reads the same observation an agent gets, plus the map and its own memory. It will not fight guards,
stays near its starting town until level 7, leaves alone monsters far above its level, picks targets by walking
distance, cuts meat from what it kills, and goes to town to sell, repair, buy gear and stock up on potions.

## Speed

Release build, Bichon province. "Mac" is an Apple Silicon laptop with 10 cores.

| Setup | Speed |
| --- | --- |
| Empty world | about 2,300× real time |
| 100 scripted characters, in process | about 220× real time |
| 100 characters through the Python bridge, cheap policy | 158,768 character-steps/s (318× real time) |
| 300 characters through the bridge | 177,869 character-steps/s |
| Six worlds of 100 in parallel | about 443,000 character-steps/s in total |
| The full 1.76 world (55,000 objects), empty | about 44× real time, 1.5 GB |

## Training

```sh
PYTHONPATH=python .venv/bin/python python/train_ppo.py --name first --minutes 30
PYTHONPATH=python .venv/bin/python python/eval_policy.py runs/first/policy.pt
sh python/long_run.sh NAME --worlds 16      # train for ever, evaluate every hour; `touch runs/NAME/stop` to end
```

`train_ppo.py` is a single-file PPO in PyTorch. Several worlds run side by side and form one batch; each world is
replaced by a new one, with new level 1 characters, after six game hours. The reward is built from differences of
running totals: level gained, blows landed, gold earned, minus deaths. `eval_policy.py` plays a trained policy under
the same conditions as the table above. More in [python/README.md](python/README.md) (Chinese).

Training is at an early stage: a network learns to hunt within minutes, but it has not yet matched the script.

## Looking at a run

Add `--sim-trace run.json` to any run, copy the file into `Tools/SimReplay/data/`, and open `Tools/SimReplay/index.html`
through a local web server. The page replays the characters on the map and shows growth curves, how time was spent,
what was killed and what killed, and where the gold came from and went.

## Repository layout

| Path | What is there |
| --- | --- |
| `Server/MirEnvir/Envir.cs`, `GameClock.cs` | Main loop, virtual clock, seeding, state hash |
| `Server/MirEnvir/SimEnv.cs`, `SimAgent.cs` | Observation, mask and actions; characters without sockets |
| `Server/MirEnvir/ScriptedSimPolicy.cs` | The scripted baseline |
| `Server/MirEnvir/RemoteSimPolicy.cs` | The bridge to another process |
| `Server/MirEnvir/SimTrace.cs`, `Tools/SimReplay/` | Recording a run and replaying it |
| `python/mccrystal/`, `python/train_ppo.py` | Python environment, model, trainer, evaluation |
| `Tools/PackTrim/`, `Tools/Mir176Import/` | Cutting a pack down to a few maps; rebuilding the 1.76 pack |
| `Packs/` | Content packs: `classic`, `mir-176` |
| `Tests/Regression/` | Regression tests: `dotnet run --project Tests/Regression -c Release` |
| `docs/headless-sim-plan.md` | Design decisions, milestones, measurements and known pitfalls (Chinese) |
| `Client/`, `Server.Console/`, `Server.Admin/` | The macOS client, the console server, the GM web console |

## Status and limits

- Warriors only, and normal attacks only: no skills or magic yet.
- One map. The full 1.76 world loads and runs, but the baselines and the trainer use Bichon province.
- No reset inside a world. A fresh start is a new world, which takes about three seconds.
- No storage, no dropping items, no buying mana potions, no player trading.
- The network policy has no memory.
- Mixing human players into a simulated world is not supported yet (`--sim-listen` opens the ports, but connection
  timeouts are not handled under the virtual clock).

---

# Playing it yourself

The rest of this page is about running the server for human players and building the macOS client.

## macOS Client Port

This fork includes a complete port of the Crystal client to macOS. The client originally depended on SlimDX (DirectX 9), WinForms, NAudio, and other Windows-only technologies. All were replaced with cross-platform alternatives.

**Status**: Working on macOS. Login scene renders, can log in, create characters, and enter the game world. Windowed mode functional.

### Technology Replacements

| Original (Windows-only)        | Replacement (Cross-platform)                          |
|--------------------------------|-------------------------------------------------------|
| SlimDX (DirectX 9)             | MonoGame.Framework.DesktopGL 3.8.2                    |
| System.Drawing / GDI+          | SkiaSharp 2.88.9                                      |
| NAudio                         | MonoGame built-in audio (`SoundEffect`)               |
| WinForms (`RenderForm`)        | MonoGame `Game` class                                 |
| WinForms `TextBox`             | Custom text input (MonoGame `TextInput` event + SDL2)  |
| `EnumDisplaySettings` P/Invoke | `GraphicsAdapter.DefaultAdapter.SupportedDisplayModes` |
| WebView2 (Launcher)            | Skipped (not needed for game client)                   |

For a full list of all 56 changed files and detailed technical notes, see [PORTING_LOG.md](PORTING_LOG.md).

---

## Obtaining Game Resources

The Crystal client and server need game resource files (sprites, maps, sounds, configs, databases) to run. These are **not** included in the source repository due to their large size.

### Option 1: Download the Official Crystal Database (Recommended)

The LOMCN community maintains a complete resource package:

1. Go to https://github.com/Suprcode/Crystal.Database
2. Download the latest release archive
3. Extract it - you will get folders like `Data/`, `Map/`, `Sound/`, `Envir/`, `Maps/`, `Configs/`, etc.

### Option 2: Download from LOMCN Directly

1. Visit https://www.lomcn.net/forum/forums/crystalm2-releases.635/
2. Look for the latest Crystal release thread
3. Download the full package which includes both binaries and game files

### Option 3: Use MirFiles.com

1. Visit https://mirfiles.co.uk/ (community resource archive)
2. Navigate to the Mir 2 section
3. Download the client files and server files separately

### Where to Place the Files

After downloading, place the resource files in the build output directories:

**Client resources** -> `Build/Client/Debug/`

```
Build/Client/Debug/
├── Data/                   # Sprite libraries (.Lib files)
│   ├── ChrSel.Lib          # Character selection sprites
│   ├── Prguse.Lib          # UI elements
│   ├── Background.Lib      # Backgrounds
│   ├── Items.Lib            # Item sprites
│   ├── Magic.Lib            # Magic effect sprites
│   ├── Monster/             # Monster sprite folders
│   ├── NPC/                 # NPC sprite folders
│   └── ...                  # ~60 .Lib files and sprite folders
├── Map/                    # Map data files (.map)
│   ├── WemadeMir2/          # Map tile libraries
│   └── *.map                # Individual map files
├── Sound/                  # Audio files (.wav)
│   ├── 003-0.wav            # Sound effects
│   └── ...                  # Hundreds of .wav files
├── Mir2Test.ini            # Client configuration (debug mode)
└── Localization/           # Language files (included in source)
```

**Server resources** -> `Build/Server/Debug/`

```
Build/Server/Debug/
├── Configs/                # Server configuration files
│   ├── Setup.ini            # Main server config (IP, port, permissions)
│   ├── ExpList.ini          # Experience tables
│   ├── BaseStats*.ini       # Character stats by class
│   └── ...                  # ~37 config files
├── Maps/                   # Server-side map files (.map)
│   └── ...                  # ~500 map files
├── Envir/                  # Game environment data
│   ├── NPCs/                # NPC scripts and definitions
│   ├── Drops/               # Monster drop tables
│   ├── Quests/              # Quest scripts
│   ├── Recipe/              # Crafting recipes
│   ├── Goods/               # Shop item lists
│   ├── Routes/              # NPC patrol routes
│   └── ...
├── Server.MirDB            # Game database (items, monsters, maps, NPCs)
├── Server.MirADB           # Account database
├── Guilds/                 # Guild data (created at runtime)
└── Logs/                   # Server logs (created at runtime)
```

---

## Environment Setup (macOS)

### Prerequisites

- **macOS**: Tested on macOS 26.3, Apple Silicon (arm64)
- **.NET SDK**: 8.0 (installed via Homebrew)

### Step 1: Install .NET 8 SDK

```bash
# Install .NET 8 via Homebrew
brew install dotnet@8

# The SDK installs to /opt/homebrew/Cellar/dotnet@8/<version>/libexec
# Add to PATH (add to ~/.zshrc for persistence):
export DOTNET_ROOT="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec"
export PATH="$DOTNET_ROOT:$PATH"

# Verify installation
dotnet --version
# Should output: 8.0.124 (or similar 8.0.x)
```

**Note**: The Homebrew formula for `dotnet@8` is keg-only. You must explicitly set the PATH as shown above, or `dotnet` will not be found.

### Step 2: Clone and Restore

```bash
git clone <repository-url> Crystal
cd Crystal
dotnet restore Client/Client.csproj
dotnet restore Server.Console/Server.Console.csproj
```

### Step 3: Obtain Game Resources

Download the game resource files (see [Obtaining Game Resources](#obtaining-game-resources) above) and place them in `Build/Client/Debug/` and `Build/Server/Debug/`.

### Step 4: Build

```bash
# Build server (console version, cross-platform)
dotnet build Server.Console/Server.Console.csproj

# Build client (macOS-ported version)
dotnet build Client/Client.csproj
```

### Step 5: Run the Server

```bash
# Must run from the Build/Server/Debug directory where config and data files are
cd Build/Server/Debug
dotnet run --project ../../../Server.Console/Server.Console.csproj
```

The server will:
1. Load configuration from `Configs/Setup.ini`
2. Load game database from `Server.MirDB`
3. Load all maps, items, monsters, NPCs, quests
4. Start listening on port **7000** (configurable in `Setup.ini`)
5. Print `Server started. Press Ctrl+C to stop.`

**Server configuration** (`Configs/Setup.ini`):
```ini
[Network]
IPAddress=127.0.0.1     # Listen address
Port=7000               # Game port

[Permission]
AllowNewAccount=True    # Allow account registration
AllowLogin=True         # Allow login
AllowNewCharacter=True  # Allow character creation
AllowStartGame=True     # Allow entering game
```

### Step 6: Run the Client

Open a **new terminal** (keep the server running):

```bash
# Must run from the Build/Client/Debug directory where Data files are
cd Build/Client/Debug
dotnet run --project ../../../Client/Client.csproj
```

The client will:
1. Open a 1024x768 game window
2. Show the login screen
3. Connect to the server at 127.0.0.1:7000

**Client configuration** (`Mir2Test.ini`):
```ini
[Graphics]
FullScreen=False        # Windowed mode
Resolution=1024         # 1024x768

[Network]
UseConfig=False         # Use hardcoded server address (127.0.0.1:7000)
```

### Quick Start Script

Save this as `run.sh` in the project root:

```bash
#!/bin/bash
# Crystal quick start script for macOS
export DOTNET_ROOT="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec"
export PATH="$DOTNET_ROOT:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

case "$1" in
  server)
    echo "Starting Crystal server..."
    cd "$PROJECT_ROOT/Build/Server/Debug"
    dotnet run --project "$PROJECT_ROOT/Server.Console/Server.Console.csproj"
    ;;
  client)
    echo "Starting Crystal client..."
    cd "$PROJECT_ROOT/Build/Client/Debug"
    dotnet run --project "$PROJECT_ROOT/Client/Client.csproj"
    ;;
  build)
    echo "Building Crystal..."
    cd "$PROJECT_ROOT"
    dotnet build Server.Console/Server.Console.csproj
    dotnet build Client/Client.csproj
    echo "Build complete."
    ;;
  *)
    echo "Usage: $0 {server|client|build}"
    echo "  server  - Start the game server"
    echo "  client  - Start the game client"
    echo "  build   - Build both server and client"
    exit 1
    ;;
esac
```

```bash
chmod +x run.sh
./run.sh build      # Build both projects
./run.sh server     # Start server (in one terminal)
./run.sh client     # Start client (in another terminal)
```

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Client shows black screen | Data files not found | Run from `Build/Client/Debug/` directory |
| `dotnet: command not found` | PATH not set | `export PATH="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec:$PATH"` |
| Game launches fullscreen | `Mir2Test.ini` has `FullScreen=True` | Edit `Mir2Test.ini`, set `FullScreen=False` |
| Client can't connect | Server not running | Start server first, check port 7000 is available |
| Server fails to start | Missing configs/data | Ensure `Configs/Setup.ini` and `Maps/` exist in `Build/Server/Debug/` |
| NuGet restore fails | No internet or wrong SDK | Ensure .NET 8 SDK is installed and internet is available |

---

---

## Licence and game data

- This repository has no licence file of its own yet. Upstream Crystal publishes its server under GPL-3.0-only and its
  client and `Shared` code under MIT; treat this fork's changes as subject to the same terms until that is settled here.
- The database, scripts and settings in `Packs/mir-176` derive from the original Legend of Mir 2 (ActozSoft / Wemade).
  Map files, sprites and sounds are not in the repository. Check your right to use any of this before you publish or deploy it.
- `Packs/mir-176/Configs/Setup.ini` contains a default admin console password. Change it before exposing a server to a network.

## Links

### LOMCN Community

- [Build Guide](https://www.lomcn.net/wiki/index.php/Getting_Started)
- [Wiki](https://www.lomcn.net/wiki/index.php/Crystal)
- [Help Forum](https://www.lomcn.net/forum/forums/crystalm2-help.663/)
- [Tutorials](https://www.lomcn.net/forum/forums/crystalm2-tutorials.634/)

### Project Links

- [Databases](https://github.com/Suprcode/Crystal.Database)
- [Map Editor](https://github.com/Suprcode/Crystal.MapEditor)

### Official Links

- [Wemade Mir 2](https://mir2.mironline.co.kr/)

---

## Contributors

> [Community Contributors](https://github.com/Suprcode/Crystal/graphs/contributors)

---

## Other Projects

- [Mir 1](https://github.com/JevLOMCN/mir1/) | [Database](https://github.com/Suprcode/Carbon.Database) - Remake of ActozSoft's 1997 _The Legend Of Mir 1_
- [Mir 2](https://github.com/Suprcode/Crystal) | [Database](https://github.com/Suprcode/Crystal.Database) | [Map Editor](https://github.com/Suprcode/Crystal.MapEditor) - Remake of ActozSoft/Wemade's 1999 _The Legend Of Mir 2_
- [Mir 3](https://github.com/Suprcode/Zircon) | [Database](https://mirfiles.com/resources/mir3/zircon/Database.7z) | [Map Editor](https://www.lomcn.net/forum/threads/map-editor.109317/) - Remake of Wemade's 2003 _The Legend Of Mir 3_
- [Mir 3D (Moon Spirit)](https://github.com/mir-ethernity/mir-eternal) | [Mir 3D (Holy Cow)](https://github.com/JevLOMCN/Eternal-Legend) - Remake of Shanda Games' 2016 _Legend Eternal_
- [Mir 4](https://github.com/JevLOMCN/mir4) - Remake of Wemade's 2021 _Mir 4_
