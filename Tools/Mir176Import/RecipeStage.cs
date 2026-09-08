using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts Envir/MakeItem.txt into Crystal's Envir/Recipe files.</summary>
/// <remarks>
/// M2 keeps every recipe in one file, `[产物]` followed by `材料 数量` lines. Crystal keeps
/// one file per recipe and takes the product from the file name, so this stage is mostly a
/// split. Neither engine stores a craft price here: the 100-gold fee and the gold bar the
/// 合成师 asks for are TAKE lines in its own script, which the NPC stage already carries.
///
/// The recipes are only reachable through an NPC that lists them, which is why the NPC
/// stage has to know which products exist -- see NpcStage.Crafts.
/// </remarks>
public static class RecipeStage
{
    public sealed record Script(string Path, string Text);

    public sealed record Result(List<Script> Files, HashSet<string> Products, string Report, int Errors);

    public static Result Convert(string makeItemPath, List<ItemInfo> items)
    {
        var report = new StringBuilder();
        var notes = new List<string>();
        var files = new List<Script>();
        var products = new HashSet<string>(StringComparer.Ordinal);
        var itemNames = new HashSet<string>(items.Select(i => i.Name), StringComparer.Ordinal);
        int ingredients = 0, dropped = 0;

        string current = null;
        var body = new StringBuilder();
        void Close()
        {
            if (current == null) return;
            if (body.Length == 0)
            {
                notes.Add($"WARN   {current}: 没有材料，跳过");
                dropped++;
            }
            else
            {
                files.Add(new Script($"{current}.txt", "[ingredients]" + Environment.NewLine + body));
                products.Add(current);
            }
            current = null;
            body.Clear();
        }

        foreach (var raw in GeeM2Source.ReadGbk(makeItemPath))
        {
            var line = raw.Replace('\t', ' ').Trim();
            if (line.Length == 0 || line.StartsWith(';')) continue;
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                Close();
                string product = line[1..^1].Trim();
                if (!itemNames.Contains(product))
                {
                    notes.Add($"ERROR  产物 {product} 不在 176 物品表里，整条配方跳过");
                    dropped++;
                    continue;
                }
                current = product;
                continue;
            }
            if (current == null) continue;

            var f = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (f.Length < 2 || !int.TryParse(f[1], out int count) || count <= 0)
            {
                notes.Add($"WARN   {current}: 读不懂的材料行 {line}");
                continue;
            }
            if (!itemNames.Contains(f[0]))
            {
                notes.Add($"ERROR  {current}: 材料 {f[0]} 不在 176 物品表里");
                dropped++;
                continue;
            }
            body.AppendLine($"{f[0]} {count}");
            ingredients++;
        }
        Close();

        report.AppendLine("## 合成");
        report.AppendLine();
        report.AppendLine($"MakeItem.txt {files.Count} 条配方，{ingredients} 条材料，跳过 {dropped} 条。");
        report.AppendLine();
        if (files.Count > 0)
        {
            report.AppendLine("| 产物 | 材料 |");
            report.AppendLine("|---|---|");
            foreach (var file in files)
                report.AppendLine($"| {Path.GetFileNameWithoutExtension(file.Path)} | " +
                    string.Join('、', file.Text.Split('\n').Skip(1)
                        .Where(l => l.Trim().Length > 0).Select(l => l.Trim().Replace(' ', '×'))) + " |");
            report.AppendLine();
        }
        MonsterStage.AppendNotes(report, notes);
        return new Result(files, products, report.ToString(), 0);
    }
}
