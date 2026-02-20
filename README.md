# Legend of Mir 2 - Crystal Source

[![Latest Release](https://img.shields.io/github/v/release/JevLOMCN/mir4?label=release&style=flat-square)](https://github.com/Suprcode/Crystal/releases/latest)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg?style=flat-square)](LICENSE)
![C#](https://img.shields.io/badge/c%23-%23239120.svg?style=flat-square&logo=csharp&logoColor=white)

Crystal is the most widely used open-source server and client engine for The Legend of Mir 2, developed and maintained by the LOMCN community. Originally created by Jamie and contributors, Crystal is a modern, fully managed C# implementation of the classic Mir 2 server architecture, designed to be stable, flexible, and easy to build upon.

The project faithfully recreates the gameplay systems of the original 1999 MMORPG by ActozSoft and Wemade Entertainment, while also introducing modern improvements such as:

- Modular, readable C# codebase for both client and server
- Custom map editor and data tools
- Performance improvements and bug fixes over legacy server files
- Support for custom content, new features, and community expansions
- **macOS client support** (ported from SlimDX/WinForms to MonoGame/SkiaSharp)

Crystal has become the foundation for most private Legend of Mir 2 servers worldwide, serving as a cornerstone of the Mir development scene since its public release on LOMCN.

---

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

## Quick Links

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
