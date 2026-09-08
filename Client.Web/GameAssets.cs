using System.Collections.Concurrent;
using System.IO.Compression;
using System.Runtime.InteropServices;
using Client.MirObjects;
using Microsoft.Extensions.Caching.Memory;
using SkiaSharp;

namespace Crystal.Web;

public static class WebMapDiagnostics
{
    public static bool LogErrors => true;
    public static void SaveError(string error) => throw new InvalidDataException("Cannot decode map: " + error);
}

public sealed class GameAssets : IDisposable
{
    private readonly string root;
    private readonly Dictionary<string, string> libraries;
    private readonly Dictionary<string, string> maps;
    private readonly Dictionary<string, string> sounds;
    private readonly Dictionary<int, string> soundNames = new();
    private readonly ConcurrentDictionary<string, LibraryData> manifests = new(StringComparer.OrdinalIgnoreCase);
    private readonly MemoryCache cache = new(new MemoryCacheOptions { SizeLimit = 128 * 1024 * 1024 });

    public GameAssets(string root)
    {
        this.root = root;
        var soundRoot = Path.Combine(root, "Sound");
        sounds = Directory.Exists(soundRoot) ? Directory.EnumerateFiles(soundRoot, "*", SearchOption.AllDirectories)
            .Where(path => Path.GetExtension(path).Equals(".wav", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(path => Path.GetRelativePath(soundRoot, path).Replace('\\', '/'), path => path, StringComparer.OrdinalIgnoreCase)
            : new(StringComparer.OrdinalIgnoreCase);
        var listPath = Path.Combine(soundRoot, "SoundList.lst");
        if (File.Exists(listPath)) foreach (var line in File.ReadLines(listPath))
        {
            var fields = line.Replace(" ", "").Split(':', '\t');
            if (fields.Length > 1 && int.TryParse(fields[0], out int id)) soundNames.TryAdd(id, fields[^1].Trim().Replace('\\', '/'));
        }
        libraries = Directory.EnumerateFiles(Path.Combine(root, "Data"), "*", SearchOption.AllDirectories)
            .Where(path => Path.GetExtension(path).Equals(".lib", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(path => Path.GetRelativePath(Path.Combine(root, "Data"), path)[..^4].Replace('\\', '/'), path => path, StringComparer.OrdinalIgnoreCase);
        maps = Directory.EnumerateFiles(Path.Combine(root, "Map"), "*", SearchOption.AllDirectories)
            .Where(path => Path.GetExtension(path).Equals(".map", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(path => Path.GetRelativePath(Path.Combine(root, "Map"), path)[..^4].Replace('\\', '/'), path => path, StringComparer.OrdinalIgnoreCase);
    }

    public sealed record FrameData(int Width, int Height, int X, int Y, int Position, int Length);
    public string? Sound(int id)
    {
        if (id < 0 || id > 999999) return null;
        var name = soundNames.GetValueOrDefault(id) ?? (id > 20000 ? $"M{(id - 20000) / 10}-{id % 10}" : $"{id / 10:000}-{id % 10}");
        if (!name.EndsWith(".wav", StringComparison.OrdinalIgnoreCase)) name += ".wav";
        return sounds.GetValueOrDefault(name);
    }
    // Blend is the second flag on the stream: native draws the body additively when the
    // action's own Blend byte is set (Client/MirObjects/MonsterObject.cs:4306). It used
    // to be read and thrown away here.
    public sealed record Animation(int Start, int Count, int Skip, int Interval, bool Reverse, bool Blend);
    public sealed record LibraryData(FrameData?[] Frames, Dictionary<string, Animation> Animations);
    public sealed record ImageData(byte[] Png);

    public LibraryData Manifest(string library)
    {
        if (!libraries.TryGetValue(library, out var path)) throw new FileNotFoundException();
        return manifests.GetOrAdd(library, _ =>
        {
            using var reader = new BinaryReader(File.OpenRead(path));
            int version = reader.ReadInt32();
            if (version is < 2 or > 3) throw new InvalidDataException("Unsupported library version");
            int count = reader.ReadInt32();
            if (count < 0 || count > 200000) throw new InvalidDataException("Invalid frame count");
            int animationPosition = version >= 3 ? reader.ReadInt32() : 0;
            int[] positions = Enumerable.Range(0, count).Select(_ => reader.ReadInt32()).ToArray();
            var frames = new FrameData?[count];
            for (int i = 0; i < count; i++)
            {
                if (positions[i] <= 0 || positions[i] + 17 > reader.BaseStream.Length) continue;
                reader.BaseStream.Position = positions[i];
                int width = reader.ReadInt16(), height = reader.ReadInt16();
                int x = reader.ReadInt16(), y = reader.ReadInt16();
                reader.ReadInt16(); reader.ReadInt16(); reader.ReadByte();
                int length = reader.ReadInt32();
                if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || length <= 0) continue;
                frames[i] = new(width, height, x, y, checked((int)reader.BaseStream.Position), length);
            }
            var animations = new Dictionary<string, Animation>();
            if (animationPosition > 0)
            {
                reader.BaseStream.Position = animationPosition;
                int animationCount = reader.ReadInt32();
                for (int i = 0; i < animationCount; i++)
                {
                    string name = ((MirAction)reader.ReadByte()).ToString();
                    int start = reader.ReadInt32(), frameCount = reader.ReadInt32(), skip = reader.ReadInt32(), interval = reader.ReadInt32();
                    for (int e = 0; e < 4; e++) reader.ReadInt32();
                    bool reverse = reader.ReadBoolean();
                    bool blend = reader.ReadBoolean();
                    animations[name] = new(start, frameCount, skip, interval, reverse, blend);
                }
            }
            return new(frames, animations);
        });
    }

    public ImageData? Frame(string library, int index)
    {
        string key = $"frame:{library}:{index}";
        if (cache.TryGetValue(key, out ImageData? cached)) return cached;
        var manifest = Manifest(library);
        if (index < 0 || index >= manifest.Frames.Length || manifest.Frames[index] is not { } frame) return null;
        using var input = File.OpenRead(libraries[library]);
        input.Position = frame.Position;
        byte[] compressed = new byte[frame.Length];
        input.ReadExactly(compressed);
        using var gzip = new GZipStream(new MemoryStream(compressed), CompressionMode.Decompress);
        byte[] pixels = new byte[checked(frame.Width * frame.Height * 4)];
        gzip.ReadExactly(pixels);
        for (int i = 0; i < pixels.Length; i += 4)
            if (pixels[i + 3] == 0 && (pixels[i] != 0 || pixels[i + 1] != 0 || pixels[i + 2] != 0)) pixels[i + 3] = 255;
        using var bitmap = new SKBitmap(frame.Width, frame.Height, SKColorType.Bgra8888, SKAlphaType.Unpremul);
        Marshal.Copy(pixels, 0, bitmap.GetPixels(), pixels.Length);
        using var png = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        var result = new ImageData(png.ToArray());
        cache.Set(key, result, new MemoryCacheEntryOptions { Size = result.Png.Length, SlidingExpiration = TimeSpan.FromMinutes(10) });
        return result;
    }

    public object Map(string name)
    {
        name = name.Replace('\\', '/');
        if (name.EndsWith(".map", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        if (!maps.TryGetValue(name, out var path)) throw new FileNotFoundException();
        var map = new MapReader(path);
        var cells = new int[checked(map.Width * map.Height)][];
        for (int y = 0; y < map.Height; y++)
        for (int x = 0; x < map.Width; x++)
        {
            var cell = map.MapCells[x, y] ?? throw new InvalidDataException("Incomplete map");
            cells[y * map.Width + x] = new[]
            {
                (int)cell.BackIndex, (cell.BackImage & 0x1FFFFFFF) - 1,
                cell.MiddleIndex, cell.MiddleImage - 1,
                cell.FrontIndex, (cell.FrontImage & 0x7FFF) - 1,
                (cell.BackImage & 0x20000000) != 0 || (cell.FrontImage & 0x8000) != 0 ? 1 : 0,
                cell.FrontAnimationFrame, cell.FrontAnimationTick,
                cell.MiddleAnimationFrame, cell.MiddleAnimationTick,
                cell.TileAnimationImage, cell.TileAnimationOffset, cell.TileAnimationFrames
            };
        }
        return new { map.Width, map.Height, Cells = cells, Libraries = MapLibraries() };
    }

    private static Dictionary<int, string> MapLibraries()
    {
        var result = new Dictionary<int, string>
        {
            [0] = "Map/WemadeMir2/Tiles", [1] = "Map/WemadeMir2/Smtiles", [2] = "Map/WemadeMir2/Objects",
            [90] = "Map/WemadeMir2/Objects_32bit", [100] = "Map/ShandaMir2/Tiles",
            [110] = "Map/ShandaMir2/SmTiles", [120] = "Map/ShandaMir2/Objects", [190] = "Map/ShandaMir2/AniTiles1"
        };
        for (int i = 2; i < 28; i++) result[i + 1] = "Map/WemadeMir2/Objects" + i;
        for (int i = 1; i < 10; i++)
        {
            result[100 + i] = "Map/ShandaMir2/Tiles" + (i + 1);
            result[110 + i] = "Map/ShandaMir2/SmTiles" + (i + 1);
        }
        for (int i = 1; i < 31; i++) result[120 + i] = "Map/ShandaMir2/Objects" + (i + 1);
        string[] regions = { "", "wood", "sand", "snow", "forest" };
        string[] names = { "Tilesc", "Tiles30c", "Tiles5c", "Smtilesc", "Housesc", "Cliffsc", "Dungeonsc", "Innersc", "Furnituresc", "Wallsc", "smObjectsc", "Animationsc", "Object1c", "Object2c" };
        for (int r = 0; r < regions.Length; r++)
        for (int n = 0; n < names.Length; n++)
        {
            result[200 + r * 15 + n] = "Map/WemadeMir3/" + (r == 0 ? "" : regions[r] + "/") + names[n];
            result[300 + r * 15 + n] = "Map/ShandaMir3/" + names[n] + regions[r];
        }
        return result;
    }

    public void Dispose() => cache.Dispose();
}
