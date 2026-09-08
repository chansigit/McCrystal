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
        bool write = args.Contains("--write");

        if (!File.Exists(Path.Combine(source, "GEEM2.db")))
        {
            Console.Error.WriteLine($"No GEEM2.db under {source}");
            return 2;
        }

        // Envir.DatabasePath is a static readonly taken from the configured pack, so the
        // pack has to be selected before anything touches Envir.
        ContentPack.Configure(new[] { "--pack", Path.GetFullPath(pack) });

        var magics = MagicStage.Convert(new GeeM2Source(source).Magics());

        var text = $"# mir-176 导入报告\n\n源：`{source}`\n包：`{pack}`\n\n{magics.Report}";
        if (report != null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
            File.WriteAllText(report, text);
            Console.WriteLine($"报告写入 {report}");
        }
        else Console.WriteLine(text);

        if (magics.Errors > 0)
        {
            Console.Error.WriteLine($"{magics.Errors} 条错误，未写入数据库");
            return 1;
        }
        if (!write)
        {
            Console.WriteLine("预览模式，未写入数据库。确认后加 --write。");
            return 0;
        }

        var envir = new Envir();
        envir.MagicInfoList.AddRange(magics.Magics);
        envir.SaveDB();
        Console.WriteLine($"写入 {ContentPack.Current.DatabasePath}：{magics.Magics.Count} 个技能");
        return 0;
    }

    private static string Option(string[] args, string name)
    {
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
