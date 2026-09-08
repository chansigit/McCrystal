using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts Envir/mapinfo.txt and StartPoint.txt into Crystal MapInfo records.</summary>
public static class MapStage
{
    // 1.76 carries a safe zone's centre but not its radius, and Crystal needs one. This is
    // the tool's number, not the source's, and the report says so.
    private const ushort SafeZoneRadius = 10;

    public sealed record Result(List<MapInfo> Maps, List<string> MapFiles, string Report, int Errors);

    public static Result Convert(List<MapSection> sections, List<StartPoint> starts,
        Dictionary<string, int> miniMaps, string mapDirectory)
    {
        var report = new StringBuilder();
        var notes = new List<string>();
        var maps = new List<MapInfo>();
        var byFile = new Dictionary<string, MapInfo>(StringComparer.OrdinalIgnoreCase);
        var attributes = new SortedDictionary<string, int>(StringComparer.Ordinal);
        int errors = 0, movements = 0, dangling = 0, missingFiles = 0, withMiniMap = 0;

        foreach (var section in sections)
        {
            var info = new MapInfo
            {
                Index = maps.Count + 1,
                FileName = section.File,
                Title = section.Title,
                Light = LightSetting.Normal,
            };
            // Without this every map in the pack shows an empty radar and an empty world map,
            // because MapInfo.MiniMap defaults to 0 and both the browser and native clients
            // look the picture up by that number. 1.76 keeps the numbers in their own file
            // rather than in mapinfo.txt, which is how the whole set came to be missed.
            // BigMap takes the same number: 1.76 has only the one column, and Crystal's own
            // classic database sets the two equal on 396 of its 463 maps.
            if (miniMaps.TryGetValue(section.File, out int miniMap))
            {
                info.MiniMap = (ushort)miniMap;
                info.BigMap = (ushort)miniMap;
                withMiniMap++;
            }
            foreach (var attribute in section.Attributes)
            {
                string name = attribute;
                string argument = null;
                int bracket = attribute.IndexOf('(');
                if (bracket >= 0)
                {
                    name = attribute[..bracket];
                    argument = attribute[(bracket + 1)..].TrimEnd(')');
                }
                attributes[name] = attributes.GetValueOrDefault(name) + 1;
                switch (name)
                {
                    case "DAY": info.Light = LightSetting.Day; break;
                    case "DARK": info.Light = LightSetting.Night; break;
                    // M2's FIGHT marks a map where players may fight each other, which is
                    // Crystal's Fight rather than its NoFight. FIGHT3 is the same permission
                    // with M2's own duel variant, which Crystal does not model separately.
                    case "FIGHT":
                    case "FIGHT3": info.Fight = true; break;
                    // A whole-map safe zone. Crystal expresses safety as zones on a map, so
                    // the closest whole-map equivalent is to forbid fighting outright.
                    case "SAFE": info.NoFight = true; break;
                    case "NORECALL": info.NoRecall = true; break;
                    case "NORANDOMMOVE": info.NoRandom = true; break;
                    case "NOPOSITIONMOVE": info.NoPosition = true; break;
                    case "NODRUG": info.NoDrug = true; break;
                    case "NEEDHOLE": info.NeedHole = true; break;
                    case "MINE": info.MineIndex = 1; break;
                    // NOREBONNECT is a typo in the source file, twice, and means the same.
                    case "NORECONNECT":
                    case "NOREBONNECT":
                        info.NoReconnect = true;
                        info.NoReconnectMap = argument ?? string.Empty;
                        break;
                    // QUIZ drives M2's own quiz event and has no counterpart here.
                    case "QUIZ": break;
                    default:
                        notes.Add($"WARN   {section.File}: unhandled attribute {attribute}");
                        break;
                }
            }
            maps.Add(info);
            byFile[section.File] = info;
        }

        foreach (var section in sections)
        {
            foreach (var move in section.Movements)
            {
                // The section is a grouping, not the owner: attaching a movement to the
                // section rather than to the map its line names puts it on the wrong map,
                // where its coordinates are somewhere else entirely or off the edge.
                if (!byFile.TryGetValue(move.FromFile, out var from))
                {
                    dangling++;
                    notes.Add($"WARN   [{section.File}] 里 {move.FromFile} {move.FromX},{move.FromY} "
                        + "-> 源地图不存在");
                    continue;
                }
                if (!byFile.TryGetValue(move.ToFile, out var to))
                {
                    dangling++;
                    notes.Add($"WARN   {move.FromFile} {move.FromX},{move.FromY} -> unknown map {move.ToFile}");
                    continue;
                }
                from.Movements.Add(new MovementInfo
                {
                    MapIndex = to.Index,
                    Source = new System.Drawing.Point(move.FromX, move.FromY),
                    Destination = new System.Drawing.Point(move.ToX, move.ToY),
                });
                movements++;
            }
        }

        foreach (var start in starts)
        {
            if (!byFile.TryGetValue(start.File, out var info))
            {
                notes.Add($"ERROR  start point on unknown map {start.File}");
                errors++;
                continue;
            }
            info.SafeZones.Add(new SafeZoneInfo
            {
                Info = info,
                Location = new System.Drawing.Point(start.X, start.Y),
                Size = SafeZoneRadius,
                StartPoint = true,
            });
        }
        if (!maps.SelectMany(m => m.SafeZones).Any(z => z.StartPoint))
        {
            notes.Add("ERROR  no start point survived: the server refuses to start without one");
            errors++;
        }

        var files = new List<string>();
        foreach (var info in maps)
        {
            var path = Path.Combine(mapDirectory, info.FileName + ".map");
            if (File.Exists(path)) files.Add(path);
            else
            {
                missingFiles++;
                notes.Add($"ERROR  {info.FileName}: declared in mapinfo.txt but {info.FileName}.map is missing");
                errors++;
            }
        }
        var declared = new HashSet<string>(maps.Select(m => m.FileName), StringComparer.OrdinalIgnoreCase);
        var orphans = Directory.Exists(mapDirectory)
            ? Directory.EnumerateFiles(mapDirectory, "*.map")
                .Select(Path.GetFileNameWithoutExtension)
                .Where(name => !declared.Contains(name)).ToList()
            : new List<string>();

        report.AppendLine("## 地图 mapinfo.txt -> MapInfo");
        report.AppendLine();
        report.AppendLine($"读入 {sections.Count} 段，写出 {maps.Count} 张地图，错误 {errors} 条。");
        report.AppendLine($"传送点 {movements} 条已接上，{dangling} 条指向未声明的地图（丢弃）。");
        report.AppendLine($"出生点 {maps.SelectMany(m => m.SafeZones).Count(z => z.StartPoint)} 个，安全区半径 {SafeZoneRadius}（1.76 没有这个字段，本工具给的默认值）。");
        report.AppendLine($"地图文件：需要 {maps.Count}，缺 {missingFiles}；`Map/` 里另有 {orphans.Count} 个文件没有被 mapinfo.txt 声明，不会进包。");
        report.AppendLine($"小地图（MiniMap.txt）：{miniMaps.Count} 条，配上 {withMiniMap} 张，剩下 {maps.Count - withMiniMap} 张没有小地图图号。");
        report.AppendLine();
        report.AppendLine("| 属性 | 出现 | 对应到 |");
        report.AppendLine("| --- | ---: | --- |");
        foreach (var (name, count) in attributes)
            report.AppendLine($"| {name} | {count} | {Explain(name)} |");
        if (notes.Count > 0)
        {
            report.AppendLine();
            report.AppendLine("### 需要注意的条目");
            report.AppendLine();
            foreach (var n in notes.Take(40)) report.AppendLine($"- {n}");
            if (notes.Count > 40) report.AppendLine($"- …另有 {notes.Count - 40} 条同类");
        }
        return new Result(maps, files, report.ToString(), errors);
    }

    private static string Explain(string name) => name switch
    {
        "DAY" => "`Light = Day`",
        "DARK" => "`Light = Night`",
        "FIGHT" or "FIGHT3" => "`Fight`（允许 PK，不是 Crystal 的 NoFight）",
        "SAFE" => "`NoFight`（整图安全区，Crystal 只有分区安全区）",
        "NORECALL" => "`NoRecall`",
        "NORANDOMMOVE" => "`NoRandom`",
        "NOPOSITIONMOVE" => "`NoPosition`",
        "NODRUG" => "`NoDrug`",
        "NEEDHOLE" => "`NeedHole`",
        "MINE" => "`MineIndex = 1`",
        "NORECONNECT" or "NOREBONNECT" => "`NoReconnect` + `NoReconnectMap`（后者是原文里的拼写错误）",
        "QUIZ" => "**丢弃**，Crystal 没有对应机制",
        _ => "**未处理**",
    };
}
