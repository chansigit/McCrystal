using Microsoft.Data.Sqlite;

namespace Mir176Import;

/// <summary>The 1.76 Magic table, as the Delphi engine stored it.</summary>
/// <remarks>
/// Two of these columns are read through an inference rather than a specification,
/// because no M2Server source survives in ThirdParty/legend-176 -- ten archives, zero
/// .pas files. Both inferences are recorded in the conversion report rather than
/// buried here.
///
/// Power/MaxPower is read as the level-0 damage range and DefPower/DefMaxPower as the
/// range added per level. Supporting it: on that reading GreatFireBall only overtakes
/// FireBall at high level, which is how the game actually plays, and every solved
/// conversion lands on sane non-negative numbers.
///
/// Delay is read as hundredths of a second. On that reading FireBall is 600ms and
/// FireWall 1200ms, and every passive skill is 0.
/// </remarks>
public sealed record Magic(
    int Id, string Name, int Spell, int Power, int MaxPower,
    int DefSpell, int DefPower, int DefMaxPower, int Job,
    int NeedL1, int NeedL2, int NeedL3,
    int L1Train, int L2Train, int L3Train, int Delay);

/// <summary>A row of the 1.76 StdItems table.</summary>
/// <remarks>
/// Three fields change meaning with StdMode, which is the whole difficulty of this table:
///
/// Ac/Mac are armour on equipment and the amount restored on a potion -- 金创药(小量)
/// carries Ac 20 and 魔法药(小量) Mac 30, which are their classic heal and mana values.
///
/// Shape is the item's appearance except on a skill book, where it is the class that can
/// read it; Crystal reads a book's Shape as the Spell it teaches (HumanObject.cs:1238),
/// so the field has to be rebuilt rather than copied.
///
/// DuraMax is durability except on a skill book, where it is the level needed to read it.
/// That is checkable: it equals the skill's own NeedL1 in the Magic table.
/// </remarks>
public sealed record Item(
    int Index, string Name, int StdMode, int Shape, int Weight, int Looks, int DuraMax,
    int Ac, int Ac2, int Mac, int Mac2, int Dc, int Dc2, int Mc, int Mc2, int Sc, int Sc2,
    int Need, int NeedLevel, int Price, int Stock);

/// <summary>One map section of Envir/mapinfo.txt, plus the movements leaving it.</summary>
public sealed record MapSection(string File, string Title, List<string> Attributes)
{
    public List<Movement> Movements { get; } = new();
}

public sealed record Movement(string ToFile, int FromX, int FromY, int ToX, int ToY);

public sealed record StartPoint(string File, int X, int Y);

public sealed class GeeM2Source
{
    private readonly string root;

    public GeeM2Source(string root) => this.root = root;

    public string DatabasePath => Path.Combine(root, "GEEM2.db");

    public List<Magic> Magics()
    {
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Mode=ReadOnly");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "select MagID, MagName, Spell, Power, MaxPower, DefSpell, DefPower, DefMaxPower, " +
            "Job, NeedL1, NeedL2, NeedL3, L1Train, L2Train, L3Train, Delay from Magic order by MagID";
        using var reader = command.ExecuteReader();
        var magics = new List<Magic>();
        while (reader.Read())
            magics.Add(new Magic(
                reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7),
                reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11),
                reader.GetInt32(12), reader.GetInt32(13), reader.GetInt32(14), reader.GetInt32(15)));
        return magics;
    }

    public List<Item> Items()
    {
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Mode=ReadOnly");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "select Idx, Name, Stdmode, Shape, Weight, Looks, DuraMax, Ac, Ac2, Mac, Mac2, " +
            "Dc, Dc2, Mc, Mc2, Sc, Sc2, Need, NeedLevel, Price, Stock from StdItems order by Idx";
        using var reader = command.ExecuteReader();
        var items = new List<Item>();
        while (reader.Read())
            items.Add(new Item(
                reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7),
                reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11),
                reader.GetInt32(12), reader.GetInt32(13), reader.GetInt32(14), reader.GetInt32(15),
                reader.GetInt32(16), reader.GetInt32(17), reader.GetInt32(18), reader.GetInt32(19),
                reader.GetInt32(20)));
        return items;
    }

    // The file is CP936 and its sections look like `[0 比奇省 0] DARK NORECALL`, with
    // movement lines `0 346,186 -> 0122 11,41` following the section they leave. The third
    // field of every one of the 387 headers is 0, so it carries nothing.
    private static readonly System.Text.RegularExpressions.Regex Header =
        new(@"^\[\s*(\S+)\s+(.*?)\s+(\S+)\s*\](.*)$");
    // 103 of the 2,401 movement lines separate their coordinates with a space rather than
    // a comma -- `D71601 17 12 -> D71609 36 34` -- so both are accepted. Requiring the
    // comma silently drops the teleports into the illusion dungeons.
    private static readonly System.Text.RegularExpressions.Regex Move =
        new(@"^(\S+)\s+(\d+)[\s,]+(\d+)\s*->\s*(\S+)\s+(\d+)[\s,]+(\d+)");
    private static readonly System.Text.RegularExpressions.Regex Attribute =
        new(@"[A-Z][A-Z0-9_]*(\([^)]*\))?");

    public List<MapSection> Maps()
    {
        var maps = new List<MapSection>();
        MapSection current = null;
        foreach (var raw in ReadGbk(Path.Combine(root, "Envir", "mapinfo.txt")))
        {
            var line = raw.Split(';')[0].Trim();
            if (line.Length == 0) continue;
            var header = Header.Match(line);
            if (header.Success)
            {
                var attributes = Attribute.Matches(header.Groups[4].Value)
                    .Select(m => m.Value).ToList();
                var file = header.Groups[1].Value;
                // D12 is declared twice with the same attributes in a different order. A
                // repeated section continues the first rather than replacing it, so its
                // movements are kept.
                var existing = maps.FirstOrDefault(m => string.Equals(m.File, file, StringComparison.OrdinalIgnoreCase));
                if (existing != null)
                {
                    foreach (var a in attributes)
                        if (!existing.Attributes.Contains(a)) existing.Attributes.Add(a);
                    current = existing;
                    continue;
                }
                current = new MapSection(file, header.Groups[2].Value.Trim(), attributes);
                maps.Add(current);
                continue;
            }
            var move = Move.Match(line);
            if (move.Success && current != null)
                current.Movements.Add(new Movement(move.Groups[4].Value,
                    int.Parse(move.Groups[2].Value), int.Parse(move.Groups[3].Value),
                    int.Parse(move.Groups[5].Value), int.Parse(move.Groups[6].Value)));
        }
        return maps;
    }

    public List<StartPoint> StartPoints()
    {
        var points = new List<StartPoint>();
        foreach (var raw in ReadGbk(Path.Combine(root, "Envir", "StartPoint.txt")))
        {
            var fields = raw.Split(';')[0].Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length >= 3 && int.TryParse(fields[1], out int x) && int.TryParse(fields[2], out int y))
                points.Add(new StartPoint(fields[0], x, y));
        }
        return points;
    }

    public string MapDirectory => Path.Combine(root, "Map");

    private static IEnumerable<string> ReadGbk(string path)
    {
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        return File.ReadAllLines(path, System.Text.Encoding.GetEncoding(936));
    }
}
