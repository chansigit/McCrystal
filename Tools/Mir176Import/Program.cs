using Server.ContentPacks;
using Server.MirEnvir;

namespace Mir176Import;

// Rebuilds a 1.76 content pack's Server.MirDB from the recovered GPL sources. Every run
// reads the sources again and writes the whole database, so there is no incremental state
// to drift; re-running is always the way to pick up a fix.
//
// The database is written through Envir's own SaveDB and each record through its own
// Save, so the tool cannot disagree with the engine about the format. That is the whole
// reason this is a C# tool rather than a Python one alongside DumpSpawns and SpriteHD.
//
//   dotnet run --project Tools/Mir176Import -- \
//       --source ThirdParty/legend-176/snapshots/geem2-official-176 \
//       --pack Packs/mir-176/pack.yaml --report docs/reports/mir-176-import.md [--write]
//
// Without --write nothing is written and the report is still produced, which is the
// intended way to review a stage before it lands.
public static class Program
{
    public static int Main(string[] args)
    {
        string source = Option(args, "--source") ?? "ThirdParty/legend-176/snapshots/geem2-official-176";
        string pack = Option(args, "--pack") ?? "Packs/mir-176/pack.yaml";
        string report = Option(args, "--report");
        // Preview mode writes no database, so the scripts have nowhere to be read from.
        // This puts them somewhere reviewable without committing to the import.
        string scriptsOut = Option(args, "--scripts-out");
        bool write = args.Contains("--write");

        if (!File.Exists(Path.Combine(source, "GEEM2.db")))
        {
            Console.Error.WriteLine($"No GEEM2.db under {source}");
            return 2;
        }

        // Envir.DatabasePath is a static readonly taken from the configured pack, so the
        // pack has to be selected before anything touches Envir.
        ContentPack.Configure(new[] { "--pack", Path.GetFullPath(pack) });

        var geeM2 = new GeeM2Source(source);
        var rawMagics = geeM2.Magics();
        var magics = MagicStage.Convert(rawMagics);
        var items = ItemStage.Convert(geeM2.Items(), rawMagics);
        var maps = MapStage.Convert(geeM2.Maps(), geeM2.StartPoints(), geeM2.MapDirectory);
        var npcs = NpcStage.Convert(geeM2.Merchants(), geeM2.SpecialNpcs(), geeM2.ScriptDirectory,
            maps.Maps, items.Items);
        int errors = magics.Errors + items.Errors + maps.Errors + npcs.Errors;

        var text = $"# mir-176 导入报告\n\n源：`{source}`\n包：`{pack}`\n\n{maps.Report}\n{magics.Report}\n{items.Report}\n{npcs.Report}";
        if (report != null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
            File.WriteAllText(report, text);
            Console.WriteLine($"报告写入 {report}");
        }
        else Console.WriteLine(text);

        if (errors > 0)
        {
            Console.Error.WriteLine($"{errors} 条错误，未写入数据库");
            return 1;
        }
        if (scriptsOut != null)
        {
            Directory.CreateDirectory(scriptsOut);
            foreach (var script in npcs.Scripts)
                File.WriteAllText(Path.Combine(scriptsOut, script.Path), script.Text);
            Console.WriteLine($"{npcs.Scripts.Count} 个脚本预览写入 {scriptsOut}");
        }

        if (!write)
        {
            Console.WriteLine("预览模式，未写入数据库。确认后加 --write。");
            return 0;
        }

        var envir = new Envir();
        envir.MagicInfoList.AddRange(magics.Magics);
        envir.ItemInfoList.AddRange(items.Items);
        envir.ItemIndex = items.Items.Count == 0 ? 0 : items.Items.Max(i => i.Index);
        envir.MapInfoList.AddRange(maps.Maps);
        envir.MapIndex = maps.Maps.Count;
        envir.NPCInfoList.AddRange(npcs.Npcs);
        envir.NPCIndex = npcs.Npcs.Count;
        envir.SaveDB();

        // Scripts live beside the database in the pack, and the whole set is rewritten so a
        // script dropped from the source cannot survive as a stale file.
        var npcTarget = Path.Combine(ContentPack.Current.EnvirPath, "NPCs");
        Directory.CreateDirectory(npcTarget);
        foreach (var stale in Directory.GetFiles(npcTarget, "*.txt"))
            if (!Path.GetFileName(stale).StartsWith("00")) File.Delete(stale);
        foreach (var script in npcs.Scripts)
            File.WriteAllText(Path.Combine(npcTarget, script.Path), script.Text);

        // The pack keeps its own copy of every map it declares, so it stays self-contained
        // and nothing reaches back into ThirdParty at run time.
        var mapTarget = ContentPack.Current.MapPath;
        Directory.CreateDirectory(mapTarget);
        foreach (var file in maps.MapFiles)
            File.Copy(file, Path.Combine(mapTarget, Path.GetFileName(file)), true);
        Console.WriteLine($"写入 {ContentPack.Current.DatabasePath}：" +
            $"{magics.Magics.Count} 个技能，{items.Items.Count} 件物品，{maps.Maps.Count} 张地图" +
            $"，{npcs.Npcs.Count} 个 NPC" +
            $"（复制了 {maps.MapFiles.Count} 个地图文件，{npcs.Scripts.Count} 个脚本）");
        return 0;
    }

    private static string Option(string[] args, string name)
    {
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
