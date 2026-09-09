using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts Envir/mongen.txt into RespawnInfo entries on the maps that own them.</summary>
/// <remarks>
/// The columns line up with Crystal's almost exactly: map, x, y, monster, spread, count,
/// minutes. Count is the population the map tries to hold rather than a number spawned per
/// wave, and Delay is minutes in both engines (Map.cs:761 multiplies it by Settings.Minute),
/// so both are copied straight across.
///
/// Direction only matters to the monsters that read it -- a town guard faces the way its
/// respawn says -- and 1.76 does not carry one, so every spawn faces up. RandomDelay is left
/// at zero, which makes a wave land on its delay exactly, the way M2 does it.
/// </remarks>
public static class SpawnStage
{
    public sealed record Result(int Count, string Report, int Errors);

    /// <summary>
    /// Names mongen.txt misspells, corrected on the user's instruction.
    ///
    /// This is the one place the pack knowingly departs from the source, so it is small and
    /// it is listed. 屠龙殿 asks for 牛头侍卫8 eighty times over; no such monster exists in
    /// 1.76's Monster table -- nor does 牛头侍卫 -- while the same spawn block names
    /// 牛魔侍卫8 twice more, and that one is real (Race 81 / Appr 176). Without the
    /// correction those eighty slots simply stay empty, which is what the original server
    /// does too.
    ///
    /// 楔蛾0 and 剧毒蜘蛛0 are left alone. The `0` suffix is a real variant family
    /// elsewhere, so the intended monster there is a guess rather than a typo with one
    /// obvious reading.
    /// </summary>
    private static readonly Dictionary<string, string> MisspelledMonsters = new(StringComparer.Ordinal)
    {
        ["牛头侍卫8"] = "牛魔侍卫8",
    };

    public static Result Convert(List<Spawn> spawns, List<MapInfo> maps, List<MonsterInfo> monsters)
    {
        var report = new StringBuilder();
        var notes = new List<string>();
        var missingMonster = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var corrected = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var missingMap = new SortedDictionary<string, int>(StringComparer.Ordinal);
        int placed = 0, index = 0;

        var byFile = new Dictionary<string, MapInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var map in maps) byFile[map.FileName] = map;
        var byName = new Dictionary<string, MonsterInfo>(StringComparer.Ordinal);
        foreach (var monster in monsters) byName[monster.Name] = monster;

        foreach (var spawn in spawns)
        {
            if (!byFile.TryGetValue(spawn.MapFile, out var map))
            {
                missingMap[spawn.MapFile] = missingMap.GetValueOrDefault(spawn.MapFile) + 1;
                continue;
            }
            var wanted = MisspelledMonsters.GetValueOrDefault(spawn.Monster, spawn.Monster);
            if (!byName.TryGetValue(wanted, out var monster))
            {
                missingMonster[spawn.Monster] = missingMonster.GetValueOrDefault(spawn.Monster) + 1;
                continue;
            }
            if (wanted != spawn.Monster)
                corrected[spawn.Monster] = corrected.GetValueOrDefault(spawn.Monster) + 1;
            map.Respawns.Add(new RespawnInfo
            {
                MonsterIndex = monster.Index,
                Location = new System.Drawing.Point(spawn.X, spawn.Y),
                Count = (ushort)Math.Clamp(spawn.Count, 0, ushort.MaxValue),
                Spread = (ushort)Math.Clamp(spawn.Spread, 0, ushort.MaxValue),
                Delay = (ushort)Math.Clamp(spawn.Minutes, 1, ushort.MaxValue),
                Direction = 0,
                RespawnIndex = ++index,
            });
            placed++;
        }

        report.AppendLine("## 刷怪");
        report.AppendLine();
        report.AppendLine($"mongen.txt {spawns.Count} 行，落到地图上 {placed} 行，" +
            $"覆盖 {maps.Count(m => m.Respawns.Count > 0)} 张地图。");
        report.AppendLine($"同时在线的怪物上限是 {spawns.Sum(s => (long)s.Count)} 只（各行 count 之和，" +
            "服务端还会乘 SpawnMultiplier）。");
        report.AppendLine();

        var byMap = maps.Where(m => m.Respawns.Count > 0)
            .OrderByDescending(m => m.Respawns.Sum(r => r.Count)).Take(10);
        report.AppendLine("| 地图 | 刷怪点 | 怪物上限 |");
        report.AppendLine("|---|---|---|");
        foreach (var map in byMap)
            report.AppendLine($"| {map.Title}（{map.FileName}） | {map.Respawns.Count} | " +
                $"{map.Respawns.Sum(r => r.Count)} |");
        report.AppendLine();

        if (corrected.Count > 0)
        {
            report.AppendLine("### mongen 里写错的怪名（按用户要求改掉，这是本包唯一一处主动偏离源数据）");
            report.AppendLine();
            report.AppendLine("| 源里写的 | 改成 | 行数 |");
            report.AppendLine("|---|---|---|");
            foreach (var (wrong, count) in corrected)
                report.AppendLine($"| {wrong} | {MisspelledMonsters[wrong]} | {count} |");
            report.AppendLine();
        }

        if (missingMonster.Count > 0)
        {
            report.AppendLine($"### mongen 点名但包里没有的怪（{missingMonster.Count} 种，" +
                $"{missingMonster.Values.Sum()} 行）");
            report.AppendLine();
            report.AppendLine("| 怪 | 行数 |");
            report.AppendLine("|---|---|");
            foreach (var (name, count) in missingMonster.OrderByDescending(p => p.Value))
                report.AppendLine($"| {name} | {count} |");
            report.AppendLine();
        }
        if (missingMap.Count > 0)
        {
            report.AppendLine("mongen 点名但 mapinfo.txt 没有的地图：" +
                string.Join('、', missingMap.Select(p => $"{p.Key}({p.Value})")));
            report.AppendLine();
        }
        MonsterStage.AppendNotes(report, notes);
        return new Result(placed, report.ToString(), 0);
    }
}
