using Server.ContentPacks;
using Server.MirEnvir;

namespace PackTrim;

// Cuts a content pack down to a few maps, for simulation and training runs that do not
// need the whole world. The full mir-176 world is 386 maps and 54,000 monsters; a single
// province is a fraction of the memory and runs correspondingly faster.
//
//   dotnet run --project Tools/PackTrim -- \
//       --from Packs/mir-176 --to Packs/mir-176-bichon --maps 0 \
//       --id mir-176-bichon --port 7200 --status-port 3200 --admin-port 5083
//
// --maps takes map file names (the FileName column, "0" for Bichon Province), comma
// separated. The output is a complete pack: Configs and Envir are copied whole, the
// database keeps only the named maps, and only their .map files are copied.
//
// What is removed with a map: its spawns and safe zones (they live on the map record),
// the NPCs standing on it, any conquest held there, and every movement on a kept map
// that leads to a map that is gone -- a door to nowhere would strand whoever used it.
// Map, monster, item and NPC indexes are left as they were, so drop tables, scripts and
// saved characters keep referring to the same things.
//
// The database is read and written through Envir's own LoadDB and SaveDB, the same way
// Mir176Import does, so this tool cannot disagree with the engine about the format.
public static class Program
{
    public static int Main(string[] args)
    {
        string from = Option(args, "--from");
        string to = Option(args, "--to");
        string mapsOption = Option(args, "--maps");
        if (from == null || to == null || mapsOption == null)
        {
            Console.Error.WriteLine("Usage: PackTrim --from <pack dir> --to <pack dir> --maps <file,file> " +
                                    "[--id <pack id>] [--port N] [--status-port N] [--admin-port N]");
            return 2;
        }

        from = Path.GetFullPath(from);
        to = Path.GetFullPath(to);
        var keepNames = new HashSet<string>(
            mapsOption.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            StringComparer.OrdinalIgnoreCase);

        if (!File.Exists(Path.Combine(from, "pack.yaml")))
        {
            Console.Error.WriteLine($"No pack.yaml under {from}");
            return 2;
        }
        if (string.Equals(from, to, StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine("--to must be a different directory from --from.");
            return 2;
        }

        // Start from a clean copy so nothing from an earlier trim survives.
        if (Directory.Exists(to)) Directory.Delete(to, true);
        Directory.CreateDirectory(to);
        CopyDirectory(Path.Combine(from, "Configs"), Path.Combine(to, "Configs"));
        CopyDirectory(Path.Combine(from, "Envir"), Path.Combine(to, "Envir"));
        Directory.CreateDirectory(Path.Combine(to, "Maps"));
        File.Copy(Path.Combine(from, "Server.MirDB"), Path.Combine(to, "Server.MirDB"));

        string id = Option(args, "--id") ?? Path.GetFileName(to);
        var manifest = File.ReadAllLines(Path.Combine(from, "pack.yaml"))
            .Select(line => line.StartsWith("id:", StringComparison.Ordinal) ? $"id: {id}"
                : line.StartsWith("name:", StringComparison.Ordinal) ? $"{line} ({mapsOption})"
                : line);
        File.WriteAllLines(Path.Combine(to, "pack.yaml"), manifest);

        SetIni(Path.Combine(to, "Configs", "Setup.ini"), "Network", "Port", Option(args, "--port"));
        SetIni(Path.Combine(to, "Configs", "Setup.ini"), "Network", "StatusPort", Option(args, "--status-port"));
        SetIni(Path.Combine(to, "Configs", "Setup.ini"), "Admin", "Port", Option(args, "--admin-port"));

        // Envir.DatabasePath is a static taken from the configured pack, so the pack has to
        // be selected before anything touches Envir. SaveDB also drops a backup of the file
        // it replaces into the state directory; point that somewhere disposable.
        var scratch = Path.Combine(Path.GetTempPath(), "packtrim-" + Guid.NewGuid().ToString("N"));
        ContentPack.Configure(new[] { "--pack", Path.Combine(to, "pack.yaml"), "--state", scratch });

        try
        {
            var envir = Envir.Edit;
            if (!envir.LoadDB())
            {
                Console.Error.WriteLine($"Could not load {ContentPack.Current.DatabasePath}");
                return 2;
            }

            var kept = envir.MapInfoList.Where(m => keepNames.Contains(m.FileName)).ToList();
            var missing = keepNames.Where(n => kept.All(m => !string.Equals(m.FileName, n, StringComparison.OrdinalIgnoreCase))).ToList();
            if (missing.Count > 0)
            {
                Console.Error.WriteLine($"No map with file name: {string.Join(", ", missing)}");
                return 1;
            }

            var keptIndexes = kept.Select(m => m.Index).ToHashSet();
            int mapsBefore = envir.MapInfoList.Count, npcsBefore = envir.NPCInfoList.Count,
                conquestsBefore = envir.ConquestInfoList.Count;

            int movementsRemoved = 0;
            foreach (var map in kept)
                movementsRemoved += map.Movements.RemoveAll(m => !keptIndexes.Contains(m.MapIndex));

            envir.MapInfoList.RemoveAll(m => !keptIndexes.Contains(m.Index));
            envir.NPCInfoList.RemoveAll(n => !keptIndexes.Contains(n.MapIndex));
            envir.ConquestInfoList.RemoveAll(c => !keptIndexes.Contains(c.MapIndex));

            if (kept.Sum(m => m.SafeZones.Count(z => z.StartPoint)) == 0)
            {
                Console.Error.WriteLine("None of the kept maps has a start point; the server would refuse to start.");
                return 1;
            }

            envir.SaveDB();

            foreach (var map in kept)
            {
                var source = Directory.GetFiles(Path.Combine(from, "Maps"), "*.map")
                    .FirstOrDefault(f => string.Equals(Path.GetFileNameWithoutExtension(f), map.FileName, StringComparison.OrdinalIgnoreCase));
                if (source == null)
                {
                    Console.Error.WriteLine($"Map file for {map.FileName} is not in {Path.Combine(from, "Maps")}. " +
                                            "Rebuild the source pack's maps first (docs/headless-sim-plan.md).");
                    return 1;
                }
                File.Copy(source, Path.Combine(to, "Maps", Path.GetFileName(source)), true);
            }

            Console.WriteLine($"Wrote {to}");
            Console.WriteLine($"  maps      {kept.Count} of {mapsBefore}: {string.Join(", ", kept.Select(m => $"{m.Title} ({m.FileName})"))}");
            Console.WriteLine($"  spawns    {kept.Sum(m => m.Respawns.Count)} entries, {kept.Sum(m => m.Respawns.Sum(r => r.Count))} monsters");
            Console.WriteLine($"  NPCs      {envir.NPCInfoList.Count} of {npcsBefore}");
            Console.WriteLine($"  movements {movementsRemoved} removed (led to maps that are gone), {kept.Sum(m => m.Movements.Count)} kept");
            Console.WriteLine($"  conquests {envir.ConquestInfoList.Count} of {conquestsBefore}");
            return 0;
        }
        finally
        {
            if (Directory.Exists(scratch)) Directory.Delete(scratch, true);
        }
    }

    private static string Option(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
            if (args[i] == name) return args[i + 1];
        return null;
    }

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(source, directory)));
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            File.Copy(file, Path.Combine(target, Path.GetRelativePath(source, file)), true);
    }

    // Replaces key=value inside one section of an ini file, leaving every other byte alone.
    private static void SetIni(string path, string section, string key, string value)
    {
        if (value == null) return;

        var lines = File.ReadAllLines(path);
        var inSection = false;
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (line.StartsWith("[", StringComparison.Ordinal))
            {
                inSection = string.Equals(line, $"[{section}]", StringComparison.OrdinalIgnoreCase);
                continue;
            }
            if (inSection && line.StartsWith(key + "=", StringComparison.OrdinalIgnoreCase))
            {
                lines[i] = $"{key}={value}";
                File.WriteAllLines(path, lines);
                return;
            }
        }

        throw new InvalidOperationException($"{key} not found in [{section}] of {path}");
    }
}
