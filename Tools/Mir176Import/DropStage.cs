using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts Envir/MonItems into Crystal's Envir/Drops.</summary>
/// <remarks>
/// The two formats agree line for line: `1/60 攻击神水` means one chance in sixty, and gold
/// carries an amount. Only two things have to change. M2 writes the gold entry with the
/// item name 金币, where Crystal's parser looks for the literal Gold. And 1.76 splits its
/// tables by monster name, one file each, which is exactly how Crystal finds them, so a
/// file is only useful if its name is a monster the pack imported.
///
/// Everything else this stage does is refusal. An item name that does not resolve is
/// dropped and counted, never approximated: a wrong item in a drop table is invisible until
/// someone kills the monster ten thousand times and gets the wrong reward.
/// </remarks>
public static class DropStage
{
    public sealed record Script(string Path, string Text);

    public sealed record Result(List<Script> Files, string Report, int Errors);

    public static Result Convert(string dropDirectory, List<MonsterInfo> monsters, List<ItemInfo> items)
    {
        var report = new StringBuilder();
        var notes = new List<string>();
        var files = new List<Script>();
        var unknownItems = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var orphanFiles = new List<string>();
        int lines = 0, dropped = 0, unparsed = 0;

        var byName = monsters.ToDictionary(m => m.Name, StringComparer.Ordinal);
        var itemNames = new HashSet<string>(items.Select(i => i.Name), StringComparer.Ordinal);
        var withDrops = new HashSet<string>(StringComparer.Ordinal);

        foreach (var path in Directory.EnumerateFiles(dropDirectory, "*.txt").OrderBy(p => p, StringComparer.Ordinal))
        {
            string monster = Path.GetFileNameWithoutExtension(path);
            if (!byName.ContainsKey(monster))
            {
                orphanFiles.Add(monster);
                continue;
            }

            var body = new StringBuilder();
            foreach (var raw in GeeM2Source.ReadGbk(path))
            {
                var line = raw.Trim();
                // Source comments are the original Korean team's notes, in a code page the
                // pack does not otherwise use. A blank line groups drops by item class and
                // is worth keeping.
                if (line.Length == 0) { body.AppendLine(); continue; }
                if (line.StartsWith(';')) continue;

                var f = line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                if (f.Length < 2 || !Chance(f[0]))
                {
                    notes.Add($"WARN   {monster}: 读不懂的行 {Trim(line)}");
                    unparsed++;
                    continue;
                }
                lines++;

                if (f[1] == "金币")
                {
                    if (f.Length < 3 || !uint.TryParse(f[2], out uint gold) || gold == 0)
                    {
                        notes.Add($"WARN   {monster}: 金币行没有数额 {Trim(line)}");
                        dropped++;
                        continue;
                    }
                    body.AppendLine($"{f[0]} Gold {gold}");
                    continue;
                }

                string item = Resolve(f[1], itemNames);
                if (item == null)
                {
                    unknownItems[f[1]] = unknownItems.GetValueOrDefault(f[1]) + 1;
                    dropped++;
                    continue;
                }
                body.AppendLine($"{f[0]} {item}");
            }

            withDrops.Add(monster);
            files.Add(new Script($"{monster}.txt", body.ToString().TrimEnd() + Environment.NewLine));
        }

        // Crystal writes a template into Drops/ for every monster that has no file there
        // (Envir.ReloadDrops, DropInfo.Load with createIfNotExists), so a pack that omits
        // them is rewritten by its own server on first start and never matches what was
        // committed. Writing the placeholder here keeps the pack the authority.
        var withoutDrops = monsters.Where(m => !withDrops.Contains(m.Name)).Select(m => m.Name).ToList();
        foreach (var name in withoutDrops)
            files.Add(new Script($"{name}.txt", ";1.76 的 Envir/MonItems 里没有这只怪的爆率表" + Environment.NewLine));

        report.AppendLine("## 爆率");
        report.AppendLine();
        report.AppendLine($"{withDrops.Count} 张爆率表，{lines} 行，其中 {dropped} 行因为物品对不上被丢弃，" +
            $"{unparsed} 行格式读不懂。");
        report.AppendLine($"另有 {withoutDrops.Count} 只怪 1.76 就没给爆率表（守卫、城门、活动怪居多），" +
            $"写成空表占位；{orphanFiles.Count} 张源表没有对应的怪，跳过。");
        report.AppendLine();
        if (unknownItems.Count > 0)
        {
            report.AppendLine($"### 爆率里点名但 1.76 物品表没有的物品（{unknownItems.Count} 种）");
            report.AppendLine();
            report.AppendLine("| 物品 | 出现次数 |");
            report.AppendLine("|---|---|");
            foreach (var (name, count) in unknownItems.OrderByDescending(p => p.Value))
                report.AppendLine($"| {name} | {count} |");
            report.AppendLine();
        }
        if (orphanFiles.Count > 0)
        {
            report.AppendLine("没有对应怪物的爆率表：" + string.Join('、', orphanFiles));
            report.AppendLine();
        }
        MonsterStage.AppendNotes(report, notes);
        return new Result(files, report.ToString(), 0);
    }

    // `1/60`, and nothing else in 15,887 lines of the recovered tables.
    private static bool Chance(string field)
        => field.StartsWith("1/") && int.TryParse(field[2..], out int n) && n > 0;

    // The only spelling difference between the two tables is the width of a bracket:
    // 布衣（女） against 布衣(女). That is typography, not a different item, so it is
    // normalised. Nothing else is guessed at.
    private static string Resolve(string name, HashSet<string> items)
    {
        if (items.Contains(name)) return name;
        string narrowed = name.Replace('（', '(').Replace('）', ')');
        return items.Contains(narrowed) ? narrowed : null;
    }

    private static string Trim(string line) => line.Length <= 40 ? line : line[..40] + "…";
}
