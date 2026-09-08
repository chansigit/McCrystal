using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts the 1.76 Monster table into Crystal MonsterInfo records.</summary>
/// <remarks>
/// Two things the source cannot supply come from tables kept beside the pack, so that both
/// are reviewable as data rather than buried as code:
///
/// monster-sprites.tsv answers "what does it look like", because 1.76's Appr and Crystal's
/// Monster enum are unrelated numberings. monster-ai.tsv answers "how does it behave",
/// because M2Server dispatches on Race and Crystal dispatches on AI.
///
/// A monster with no sprite is excluded from the pack rather than given a wrong one. A
/// monster whose Race is not in the AI table is an error: guessing there would produce a
/// monster that loads, spawns, and behaves like something else, which is the kind of fault
/// nobody finds by reading a report.
/// </remarks>
public static class MonsterStage
{
    // Structural monsters: town guards, castle gates and walls, training dummies, treasure
    // chests. Nothing pushes them and nothing tames them.
    private static readonly HashSet<byte> Fixtures = new() { 3, 6, 56, 57, 81, 82 };

    public sealed record Pairing(string Sprite, string Evidence);

    public sealed record Result(List<MonsterInfo> Monsters, string Report, int Errors);

    public static Result Convert(List<MonsterRow> rows, string packDirectory)
    {
        var report = new StringBuilder();
        var notes = new List<string>();
        var monsters = new List<MonsterInfo>();
        int errors = 0, excluded = 0;

        var sprites = ReadSprites(Path.Combine(packDirectory, "monster-sprites.tsv"));
        var (raceAi, nameAi) = ReadAi(Path.Combine(packDirectory, "monster-ai.tsv"));

        foreach (var row in rows)
        {
            if (!sprites.TryGetValue(row.Name, out string sprite))
            {
                notes.Add($"ERROR  {row.Name}: 不在 monster-sprites.tsv 里");
                errors++;
                continue;
            }
            if (string.IsNullOrEmpty(sprite))
            {
                excluded++;
                continue;
            }
            if (!ushort.TryParse(sprite, out ushort image))
            {
                notes.Add($"ERROR  {row.Name}: 贴图号 {sprite} 不是数字");
                errors++;
                continue;
            }

            if (!nameAi.TryGetValue(row.Name, out byte ai) && !raceAi.TryGetValue(row.Race, out ai))
            {
                notes.Add($"ERROR  {row.Name}: Race {row.Race} 不在 monster-ai.tsv 里");
                errors++;
                continue;
            }

            var info = new MonsterInfo
            {
                Index = monsters.Count + 1,
                Name = row.Name,
                Image = (Monster)image,
                AI = ai,
                Level = (ushort)row.Level,
                CoolEye = (byte)row.CoolEye,
                Undead = row.Undead != 0,
                Experience = (uint)Math.Max(0, row.Experience),
                // 1.76 stores milliseconds in both columns and so does Crystal. A zero
                // walk speed means a monster that never moves; Crystal reads it the same
                // way, so it is copied rather than clamped.
                AttackSpeed = (ushort)Math.Clamp(row.AttackSpeed, 0, ushort.MaxValue),
                MoveSpeed = (ushort)Math.Clamp(row.WalkSpeed, 0, ushort.MaxValue),
                CanPush = !Fixtures.Contains(ai),
                CanTame = !Fixtures.Contains(ai),
            };
            info.Stats[Stat.HP] = row.HP;
            info.Stats[Stat.MP] = row.MP;
            info.Stats[Stat.MinAC] = row.AC;
            info.Stats[Stat.MaxAC] = row.AC;
            info.Stats[Stat.MinMAC] = row.MAC;
            info.Stats[Stat.MaxMAC] = row.MAC;
            info.Stats[Stat.MinDC] = row.DC;
            info.Stats[Stat.MaxDC] = Math.Max(row.DC, row.DCMax);
            info.Stats[Stat.MinMC] = row.MC;
            info.Stats[Stat.MaxMC] = row.MC;
            info.Stats[Stat.MinSC] = row.SC;
            info.Stats[Stat.MaxSC] = row.SC;
            info.Stats[Stat.Accuracy] = row.Hit;
            info.Stats[Stat.Agility] = row.Speed;
            monsters.Add(info);
        }

        report.AppendLine("## 怪物");
        report.AppendLine();
        report.AppendLine($"源里 {rows.Count} 只，导入 {monsters.Count} 只，" +
            $"按 monster-sprites.tsv 留空排除 {excluded} 只。");
        report.AppendLine();

        var byAi = monsters.GroupBy(m => m.AI).OrderByDescending(g => g.Count());
        report.AppendLine("| AI | 只数 | 例子 |");
        report.AppendLine("|---|---|---|");
        foreach (var group in byAi)
            report.AppendLine($"| {group.Key} | {group.Count()} | " +
                string.Join('、', group.Take(3).Select(m => m.Name)) + " |");
        report.AppendLine();

        // A monster that shares a sprite with another is normal in 1.76 and worth a number
        // in the report rather than a warning per row: 389 monsters draw from 240-odd
        // sprites, and the README explains why.
        int shared = monsters.GroupBy(m => m.Image).Count(g => g.Count() > 1);
        report.AppendLine($"{monsters.Select(m => m.Image).Distinct().Count()} 张贴图，" +
            $"其中 {shared} 张被多只怪共用。");
        report.AppendLine();
        AppendNotes(report, notes);
        return new Result(monsters, report.ToString(), errors);
    }

    /// <summary>Monster name to Crystal sprite number; an empty value excludes the monster.</summary>
    public static Dictionary<string, string> ReadSprites(string path)
    {
        var sprites = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in File.ReadAllLines(path))
        {
            if (raw.StartsWith('#') || raw.Trim().Length == 0) continue;
            var f = raw.Split('\t');
            if (f.Length < 2) continue;
            sprites[f[0]] = f[1].Trim();
        }
        return sprites;
    }

    private static (Dictionary<int, byte> Race, Dictionary<string, byte> Name) ReadAi(string path)
    {
        var race = new Dictionary<int, byte>();
        var name = new Dictionary<string, byte>(StringComparer.Ordinal);
        foreach (var raw in File.ReadAllLines(path))
        {
            if (raw.StartsWith('#') || raw.Trim().Length == 0) continue;
            var f = raw.Split('\t');
            if (f.Length < 3 || !byte.TryParse(f[2].Trim(), out byte ai)) continue;
            if (f[0] == "race" && int.TryParse(f[1].Trim(), out int number)) race[number] = ai;
            else if (f[0] == "name") name[f[1]] = ai;
        }
        return (race, name);
    }

    internal static void AppendNotes(StringBuilder report, List<string> notes)
    {
        if (notes.Count == 0) return;
        report.AppendLine("```");
        foreach (var note in notes.Take(60)) report.AppendLine(note);
        if (notes.Count > 60) report.AppendLine($"... 另有 {notes.Count - 60} 条");
        report.AppendLine("```");
        report.AppendLine();
    }
}
