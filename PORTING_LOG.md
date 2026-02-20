# Crystal Client macOS Porting Log

## Overview

Successfully ported the Crystal game client (Legend of Mir 2, .NET 8.0 C#) from Windows to macOS. The client originally depended on SlimDX (DirectX 9), WinForms, NAudio, and other Windows-only technologies. All were replaced with cross-platform alternatives.

**Status**: Working. Login scene renders correctly, can log in, create characters, and enter the game world. Windowed mode functional.

**Date**: 2026-02-20

---

## Technology Replacements

| Original (Windows-only)     | Replacement (Cross-platform)                |
|-----------------------------|---------------------------------------------|
| SlimDX (DirectX 9)          | MonoGame.Framework.DesktopGL 3.8.2          |
| System.Drawing / GDI+       | SkiaSharp 2.88.9                            |
| NAudio                      | MonoGame built-in audio (`SoundEffect`)     |
| WinForms (`RenderForm`)     | MonoGame `Game` class                       |
| WinForms `TextBox`          | Custom text input (MonoGame `TextInput` event) |
| `EnumDisplaySettings` P/Invoke | `GraphicsAdapter.DefaultAdapter.SupportedDisplayModes` |
| WebView2 (Launcher)         | Skipped (not needed for game client)        |

---

## Files Changed (56 files total)

### Phase 0: Project Configuration

**`Client/Client.csproj`**
- `<TargetFramework>` changed from `net8.0-windows7.0` to `net8.0`
- Removed `<UseWindowsForms>true</UseWindowsForms>`
- Removed SlimDX, NAudio, WebView2, Microsoft.AspNet.WebApi.Client package references
- Added: `MonoGame.Framework.DesktopGL` 3.8.2.1105, `SkiaSharp` 2.88.9
- Excluded launcher/patcher WinForms files (`AMain.cs`, `Config.cs`) via `<Compile Remove>`

### Phase 1: Core Graphics Layer

**`Client/MirGraphics/DXManager.cs`** (complete rewrite ~480 lines)
- `Device` type: SlimDX `Device` -> MonoGame `GraphicsDevice`
- `Sprite`: SlimDX `Sprite` -> MonoGame `SpriteBatch`
- `MainSurface`/`CurrentSurface`: SlimDX `Surface` -> `RenderTarget2D` (null = back buffer)
- `Draw()`: delegates to `SpriteBatch.Draw()`, handles both `Vector2` and `Vector3` overloads
- `SetSurface()`: `SpriteBatch.End()` -> `Device.SetRenderTarget(rt)` -> `SpriteBatch.Begin(...)`
- `SetBlend()`: creates custom `BlendState` objects (AlphaBlend, Additive, InverseLight)
- `SetGrayscale()`/`SetNormal()`/`SetBlendMagic()`: swaps `Effect` via SpriteBatch restart
- `CreateLights()`: SkiaSharp radial gradient ellipse -> `Texture2D.SetData()`
- `DrawLine()`: 1x1 white pixel texture stretched/rotated (replaces SlimDX `Line`)
- `DrawRectangleBorder()`/`DrawFilledRectangle()`: using white pixel texture
- `MultiplyBlend`: custom `BlendState` for lighting overlay (src * dst)
- `BeginSpriteBatch()`/`EndSpriteBatch()`: manages SpriteBatch state (deferred mode, PointClamp sampler)

**`Client/MirGraphics/MLibrary.cs`** (moderate changes)
- `MImage.Image`/`MaskImage`: SlimDX `Texture` -> MonoGame `Texture2D`
- `CreateTexture()`: replaced `LockRectangle`/`UnlockRectangle` with `Texture2D.SetData<byte>()`
- Pixel format conversion: BGRA (SlimDX/A8R8G8B8) -> RGBA (MonoGame/SurfaceFormat.Color)
  - R/B channel swap in decompression
  - Alpha fix: A=0 with colored pixels -> A=255 (prevents invisible sprites)
- `VisiblePixel()`: changed from `unsafe byte*` pointer to `byte[]` array access

### Phase 2: Game Loop & Window

**`Client/Program.cs`** (simplified ~70 lines)
- Removed WinForms `Application.Run()` and `Application.Idle` game loop
- Removed launcher/patcher logic
- Now creates `CMain` (MonoGame `Game`) and calls `Form.Run()`

**`Client/Forms/CMain.cs`** (major rewrite ~800 lines)
- Inherits `Game` instead of WinForms `RenderForm`
- `GraphicsDeviceManager` for display settings
- Game loop: `Update()` (logic) + `Draw()` (rendering) replace `Application.Idle` + manual rendering
- Input system: polls `Mouse.GetState()`/`Keyboard.GetState()` each frame, converts to event-style `MouseEventArgs`/`KeyEventArgs` for compatibility with existing MirControl event handlers
- HiDPI support: scales mouse coordinates from window space to back buffer space
- `Window.TextInput` event for character input (MirTextBox)
- Screenshots: `GetBackBufferData()` + SkiaSharp `SKImage.Encode(PNG)`
- Compatibility stubs: `Controls` collection, `ActiveControl`, `Close()`, `IsKeyLocked()`
- `IsKeyLocked()`: uses SDL2 `SDL_GetModState()` for CapsLock/NumLock detection

**`Client/Forms/CMain.Designer.cs`** (kept but minimized)
- Retained for partial class compatibility, WinForms designer code inert

**`Client/Resolution/DisplayResolutions.cs`** (rewritten)
- Replaced `EnumDisplaySettings` P/Invoke with `GraphicsAdapter.DefaultAdapter.SupportedDisplayModes`
- Added fallback: if no modes detected, assume all common resolutions supported

### Phase 3: UI Control System

**`Client/MirControls/MirControl.cs`** (moderate changes)
- `ControlTexture`: SlimDX `Texture` -> MonoGame `RenderTarget2D`
- `CreateTexture()`: uses `RenderTarget2D` + `GraphicsDevice.SetRenderTarget()`
- `DrawBorder()`: uses `DXManager.DrawRectangleBorder()` (1x1 white pixel) instead of SlimDX `Line`
- `Highlight()`: adapted for MonoGame coordinate system
- Removed `System.Drawing` references, using `Microsoft.Xna.Framework` types

**`Client/MirControls/MirLabel.cs`** (moderate changes - SkiaSharp text)
- `CreateTexture()`: renders text via SkiaSharp pipeline:
  1. Create `SKBitmap` + `SKCanvas`
  2. Configure `SKPaint` (font family, size, color, anti-aliasing)
  3. `canvas.DrawText()` with word-wrapping and alignment
  4. Extract pixel bytes -> `Texture2D.SetData<byte>()`
- `MeasureText()`: uses `SKPaint.MeasureText()` + `SKPaint.FontMetrics`
- Font mapping: `System.Drawing.Font` replaced by `SKFont`/`SKPaint`

**`Client/MirControls/MirScene.cs`** (moderate changes)
- `DrawControlTexture = false`: scenes draw directly to back buffer (no intermediate RT)
- `BackColour = Color.Black`
- `Draw()` override: calls `DrawControl()` (scene-specific content) then `DrawChildControls()` (UI)
- `FindControlAtPoint()`: tree-walking fallback for mouse hit testing when `Highlight()` guard blocks
- Mouse event dispatching: falls back to `FindControlAtPoint()` when `MouseControl`/`ActiveControl` not set

**`Client/MirControls/MirTextBox.cs`** (complete rewrite ~590 lines)
- Removed WinForms `TextBox` wrapper entirely
- Custom text input using MonoGame `Window.TextInput` event
- Manual cursor position tracking, text selection, blinking cursor
- Clipboard support via SDL2 (`SDL_GetClipboardText`/`SDL_SetClipboardText`)
- Renders text via SkiaSharp (same pipeline as MirLabel)
- Password masking (replaces characters with '*')
- IME composition support

**`Client/MirControls/MirButton.cs`** - Minor type changes
**`Client/MirControls/MirCheckBox.cs`** - Minor type changes
**`Client/MirControls/MirDropDownBox.cs`** - Minor type changes
**`Client/MirControls/MirGoodsCell.cs`** - Type conversions
**`Client/MirControls/MirImageControl.cs`** - Minor type changes
**`Client/MirControls/MirItemCell.cs`** - Minor type changes
**`Client/MirControls/MirScrollingLabel.cs`** - Minor type changes

### Phase 4: Audio System

**`Client/MirSounds/SoundManager.cs`** (moderate rewrite)
- Uses MonoGame `SoundEffect.FromStream()` to load `.wav` files
- `SoundEffectInstance` for playback control (volume, looping, play/stop)

**`Client/MirSounds/Libraries/CachedSound.cs`** (rewrite)
- Wraps MonoGame `SoundEffect` (loaded from file stream)
- `Play()` creates `SoundEffectInstance` with volume control

**`Client/MirSounds/Libraries/LoopProvider.cs`** (rewrite)
- Uses `SoundEffectInstance.IsLooped = true` for looping playback
- Volume control via `SoundEffectInstance.Volume`

**`Client/MirSounds/Libraries/OneShotProvider.cs`** (simplified)

### Phase 5: Scene & Dialog Files (batch changes)

All ~20 dialog/scene files received similar changes:
- Removed `using SlimDX` / `using SlimDX.Direct3D9`
- `System.Drawing.Color` -> `Microsoft.Xna.Framework.Color`
- `new Font(...)` constructor calls adapted
- File path separators: `\\` -> `/` or `Path.Combine()`

Files: `GameScene.cs`, `LoginScene.cs`, `BigMapDialog.cs`, `ChatOptionDialog.cs`, `CompassDialog.cs`, `FriendDialog.cs`, `GameshopDialog.cs`, `GuildDialog.cs`, `GuildTerritoryDialog.cs`, `HelpDialog.cs`, `IntelligentCreatureDialogs.cs`, `InventoryDialog.cs`, `KeyboardLayoutDialog.cs`, `MainDialogs.cs`, `MentorDialog.cs`, `NPCDialogs.cs`, `NoticeDialog.cs`, `QuestDialogs.cs`, `RelationshipDialog.cs`, `TrustMerchantDialog.cs`

### Phase 6: Game Objects

**`Client/MirObjects/`** - Minor type changes across 7 files:
- `Effect.cs`, `ItemObject.cs`, `MapObject.cs`, `MonsterObject.cs`, `NPCObject.cs`, `PlayerObject.cs`, `UserObject.cs`, `UserHeroObject.cs`
- Removed SlimDX imports, adapted Color/Vector types

### Phase 7: Miscellaneous

**`Client/MirGraphics/ParticleEngine.cs`** - Type conversions for particles
**`Client/MirGraphics/Particles/FogParticle.cs`** - Type conversions
**`Client/MirGraphics/Particles/Particle.cs`** - Removed unused SlimDX fields
**`Client/Settings.cs`** - Path separators to cross-platform, `FullScreen` default to `false`
**`Client/Utils/BrowserHelper.cs`** - Simplified for macOS (uses `Process.Start` with `open` command)
**`Server/MirObjects/NPC/NPCScript.cs`** - Minor fix
**`Shared/Functions/IniReader.cs`** - Minor fix for cross-platform file handling

---

## Key Architecture Decisions

### Rendering Pipeline (MirScene)
- `DrawControlTexture = false` on MirScene: scenes render directly to the back buffer, avoiding an unnecessary intermediate render target
- `MirScene.Draw()` calls `DrawControl()` first (for scene content like map), then `DrawChildControls()` (for UI elements)
- GameScene's `MapControl` still uses its own `RenderTarget2D` for the map (FloorTexture + LightTexture compositing)

### Pixel Format Handling
- SlimDX uses A8R8G8B8 (ARGB/BGRA byte order), MonoGame uses SurfaceFormat.Color (RGBA byte order)
- All `.Lib` image decompression performs B<->R channel swap
- Transparent pixels with RGB data have alpha forced to 255 (prevents invisible colored sprites)

### Input Adaptation
- MonoGame uses polling (`Mouse.GetState()` each frame), but Crystal's MirControl system expects WinForms-style events
- CMain polls each frame and generates synthetic `MouseEventArgs`/`KeyEventArgs` events
- Mouse coordinates are scaled for HiDPI/Retina displays (window points -> back buffer pixels)

### Blending Modes
- `BlendState.AlphaBlend` for normal rendering
- Additive blend (`Blend.One` destination) for magic effects
- Inverse light blend (`Blend.BlendFactor` + `Blend.InverseSourceColor`) for light effects
- Multiply blend (`src * dst`) for lighting overlay compositing

---

## Environment Setup (macOS)

### Tested Environment
- **macOS**: 26.3 (Darwin 25.3.0)
- **Architecture**: Apple Silicon (arm64 / M-series)
- **.NET SDK**: 8.0.124 (installed via Homebrew)
- **Runtime**: .NET 8.0.24 (osx-arm64)

### Step 1: Install .NET 8 SDK

```bash
# Install .NET 8 via Homebrew
brew install dotnet@8

# The SDK installs to /opt/homebrew/Cellar/dotnet@8/8.0.124/libexec
# Add to PATH (add to ~/.zshrc for persistence):
export DOTNET_ROOT="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec"
export PATH="$DOTNET_ROOT:$PATH"

# Verify installation
dotnet --version
# Should output: 8.0.124 (or similar 8.0.x)
```

**Note**: If `dotnet` is not found after install, the Homebrew formula for `dotnet@8` is keg-only. You must explicitly set the PATH as shown above.

### Step 2: Restore NuGet Packages

```bash
cd /Users/chensijie/codes/Crystal
dotnet restore Client/Client.csproj
```

This downloads:
- `MonoGame.Framework.DesktopGL` 3.8.2.1105 (rendering, audio, input)
- `SkiaSharp` 2.88.9 (text rendering, image processing)

### Step 3: Build

```bash
dotnet build Client/Client.csproj
```

Output goes to `Build/Client/Debug/` (configured in `Client.csproj` via `<BaseOutputPath>`).

### Step 4: Run the Game

```bash
# CRITICAL: Must run from the Build/Client/Debug directory!
# The game loads .Lib data files from ./Data/ relative to the working directory.
cd /Users/chensijie/codes/Crystal/Build/Client/Debug
dotnet run --project /Users/chensijie/codes/Crystal/Client/Client.csproj
```

**Why `cd` to Build/Client/Debug?**
The game uses relative paths (e.g., `./Data/ChrSel.Lib`) to load sprite libraries, map files, and sounds. These asset files exist only in `Build/Client/Debug/`. Running `dotnet run` from the `Client/` source directory will produce a black screen because no data files are found.

### Directory Structure (Build/Client/Debug/)

```
Build/Client/Debug/
├── Client.dll              # Compiled game client
├── Shared.dll              # Shared protocol library
├── MonoGame.Framework.dll  # MonoGame runtime
├── SkiaSharp.dll           # SkiaSharp runtime
├── Data/                   # Game asset files (.Lib sprite libraries)
│   ├── ChrSel.Lib          # Character selection screen sprites
│   ├── Prguse.Lib          # UI element sprites
│   ├── Background.Lib      # Background images
│   └── ...                 # Many more .Lib files
├── Map/                    # Map data files (.map)
├── Sound/                  # Audio files (.wav)
├── Localization/           # Language files (English.json, Chinese.json)
├── Mir2Test.ini            # Debug configuration file
└── runtimes/               # Platform-specific native libraries
```

### Configuration

Debug mode (`#if DEBUG`) automatically sets `UseTestConfig = true`, which reads `Mir2Test.ini` instead of `Mir2Config.ini`.

Key settings in `Mir2Test.ini` (located at project root, copied to build output):
```ini
[Graphics]
FullScreen=False        # Windowed mode
Borderless=True
Resolution=1024         # 1024x768

[Network]
UseConfig=False         # Uses hardcoded server address

[Game]
Language=English
```

### Quick Run Script

For convenience, create a script:

```bash
#!/bin/bash
# run_crystal.sh - Run Crystal client on macOS
export DOTNET_ROOT="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec"
export PATH="$DOTNET_ROOT:$PATH"

cd "$(dirname "$0")/Build/Client/Debug"
dotnet run --project "$(dirname "$0")/Client/Client.csproj"
```

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Black screen (no UI) | Data files not found | Run from `Build/Client/Debug/` directory |
| `dotnet: command not found` | PATH not set | `export PATH="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec:$PATH"` |
| Game launches fullscreen | `Mir2Test.ini` has `FullScreen=True` | Edit `Mir2Test.ini`, set `FullScreen=False` |
| NuGet restore fails | No internet / wrong SDK version | Ensure .NET 8 SDK is installed |
| Window appears but is all black | Graphics device issue on first run | Try running again; MonoGame needs OpenGL context |

---

## Known Issues / Future Work

1. **Exterior world map rendering**: May show white gradients instead of tiles in some cases. Interior maps work fine. The FloorTexture + DrawLights pipeline has been restored but needs testing.
2. **Screen blinking**: Reported during gameplay, may be related to SpriteBatch Begin/End cycling.
3. **NPC dialog text**: Clickable text in NPC dialogs reported as blurry (SkiaSharp text rendering).
4. **Custom cursors**: `.CUR` cursor files not loaded (using default system cursor).
5. **Shader effects**: Grayscale, normal, and magic pixel shaders are stub-loaded (effects are null). The game runs without them but visual effects are missing.
6. **Audio format**: `.mp3` files may need conversion to `.wav`/`.ogg` for MonoGame compatibility.
7. **Launcher/Patcher**: Excluded from port (requires WebView2/WinForms).

---

## Compatibility Layer

Global using aliases and extension methods bridge the type gap:

```csharp
// MonoGame types used directly where WinForms/System.Drawing types were before:
// Color = Microsoft.Xna.Framework.Color
// Point = Microsoft.Xna.Framework.Point
// Rectangle = Microsoft.Xna.Framework.Rectangle

// Extension methods for Point arithmetic:
// point.Add(x, y), point.Add(otherPoint), point.Subtract(otherPoint)

// WinForms compatibility types defined in MirControls:
// MouseEventArgs, KeyEventArgs, KeyPressEventArgs, MouseButtons, Keys
// TextFormatFlags, SystemInformation, ControlCollection
```
