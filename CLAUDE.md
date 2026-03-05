# Crystal Project

## Build

dotnet is installed at `/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet`.

Build client: `/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet build Client/Client.csproj`

Run client (must run from Build/Client/Debug/ where Data/ exists):
```
cd Build/Client/Debug && /opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet Client.dll
```

## Architecture

- Game client ported to macOS using MonoGame (replacing WinForms/SlimDX) and SkiaSharp (replacing GDI+)
- .NET 8.0 on macOS ARM64
- `Client.Point` (in `Client/Compatibility.cs`) bridges `System.Drawing.Point` (used by Shared project) and MonoGame `Point`
- Implicit conversion operators exist but do NOT work during unboxing from `object` - must unbox to the exact boxed type first
- Server data files: `Build/Server/Debug/`
- Client data files: `Build/Client/Debug/Data/`
