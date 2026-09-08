using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts Envir/Castle into Crystal ConquestInfo records.</summary>
/// <remarks>
/// The two engines agree on the model, which is the whole reason this stage is short:
/// M2 makes the Sabuk gate and walls monsters with hit points, and so does Crystal --
/// ConquestGateInfo, ConquestWallInfo and ConquestArcherInfo each hold a MobIndex and a
/// Location, and ConquestGuildInfo spawns them through MonsterObject.GetMonster. The AI
/// each one needs is checked at spawn time and it is silent about a mismatch, so the
/// numbers matter: a gate must be AI 81, a wall 82, an archer 80.
///
/// A castle file is a savegame as much as a layout. Keys appear twice -- the authored
/// value first, then whatever the running server wrote back -- so this reads the first
/// occurrence of each. Taking the last would import the state of a castle whose gate was
/// standing at 10,000 hit points when it was authored and 0 when the archive was made.
///
/// The archer and guard posts have the same shape. M2 wrote the layout under localised
/// keys (弓箭卫士_N_X, 卫士_N_X) and then appended zeroed English ones (Archer_N_X,
/// Guard_N_X), so the coordinates that exist are the localised ones.
/// </remarks>
public static class ConquestStage
{
    public sealed record Result(List<ConquestInfo> Conquests, string Report, int Errors);

    public static Result Convert(string castleDirectory, List<MapInfo> maps, List<MonsterInfo> monsters)
    {
        var report = new StringBuilder();
        var notes = new List<string>();
        var conquests = new List<ConquestInfo>();
        int errors = 0, skippedGuards = 0;

        if (!Directory.Exists(castleDirectory))
        {
            report.AppendLine("## 攻城");
            report.AppendLine();
            report.AppendLine($"没有 {castleDirectory}，跳过。");
            return new Result(conquests, report.ToString(), 0);
        }

        var mapIndex = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var map in maps) mapIndex[map.FileName] = map.Index;
        var byName = new Dictionary<string, MonsterInfo>(StringComparer.Ordinal);
        foreach (var monster in monsters) byName[monster.Name] = monster;

        foreach (var directory in Directory.EnumerateDirectories(castleDirectory).OrderBy(d => d, StringComparer.Ordinal))
        {
            // A castle directory holds its own file plus an AttackXxx.txt attacker roster,
            // which is guild state rather than layout.
            var layout = Directory.GetFiles(directory, "*.txt")
                .FirstOrDefault(f => !Path.GetFileName(f).StartsWith("Attack", StringComparison.OrdinalIgnoreCase));
            if (layout == null)
            {
                notes.Add($"WARN   {directory}: 没有布局文件");
                continue;
            }

            var keys = ReadFirstOccurrences(layout);
            string name = Value(keys, "CastleName") ?? Path.GetFileName(directory);
            string mapFile = Value(keys, "CastleMap");
            if (mapFile == null || !mapIndex.TryGetValue(mapFile, out int map))
            {
                notes.Add($"ERROR  {name}: CastleMap {mapFile ?? "(缺)"} 不是包里的地图");
                errors++;
                continue;
            }

            var info = new ConquestInfo
            {
                Index = conquests.Count + 1,
                Name = name,
                MapIndex = map,
                // CastleHome is where the owning guild's members recall to, and M2's
                // CastleWarRange is the square the war is fought over. Crystal wants one
                // radius, so the larger half-extent is used.
                Location = new System.Drawing.Point(Number(keys, "CastleHomeX"), Number(keys, "CastleHomeY")),
                Size = (ushort)Math.Max(Number(keys, "CastleWarRangeX"), Number(keys, "CastleWarRangeY")),
                // M2 keeps no war schedule in these files -- the war is requested through an
                // NPC -- so this stays Crystal's Request type with no fixed weekday.
                Type = ConquestType.Request,
                Game = ConquestGame.CapturePalace,
            };
            string palace = Value(keys, "CastlePlaceMap");
            if (palace != null && mapIndex.TryGetValue(palace, out int palaceIndex))
                info.PalaceIndex = palaceIndex;
            else if (palace != null)
                notes.Add($"WARN   {name}: CastlePlaceMap {palace} 不是包里的地图，宫殿留空");
            if (Value(keys, "CastleSecretMap") is { } secret && mapIndex.TryGetValue(secret, out int secretIndex))
                info.ExtraMaps.Add(secretIndex);

            AddStructure(keys, "MainDoor", byName, info, notes, ref errors,
                (mob, at, index) => info.ConquestGates.Add(new ConquestGateInfo
                {
                    Index = index, Name = mob.Name, MobIndex = mob.Index, Location = at,
                }), 81, () => ++info.GateIndex);
            foreach (var wall in new[] { "LeftWall", "CenterWall", "RightWall" })
                AddStructure(keys, wall, byName, info, notes, ref errors,
                    (mob, at, index) => info.ConquestWalls.Add(new ConquestWallInfo
                    {
                        Index = index, Name = mob.Name, MobIndex = mob.Index, Location = at,
                    }), 82, () => ++info.WallIndex);

            // Archers are named once for the whole set, in Archer_N_Name.
            string archerName = Value(keys, "Archer_1_Name");
            for (int i = 1; ; i++)
            {
                var at = Post(keys, $"弓箭卫士_{i}_") ?? Post(keys, $"Archer_{i}_");
                if (at == null) break;
                if (archerName == null || !byName.TryGetValue(archerName, out var mob))
                {
                    notes.Add($"ERROR  {name}: 弓箭卫士 {i} 的怪物 {archerName ?? "(缺)"} 不在包里");
                    errors++;
                    continue;
                }
                if (mob.AI != 80)
                {
                    notes.Add($"ERROR  {name}: {mob.Name} 的 AI 是 {mob.AI}，"
                        + "守城弓箭手必须是 80 ConquestArcher，否则 Spawn 会静默返回");
                    errors++;
                    continue;
                }
                info.ConquestGuards.Add(new ConquestArcherInfo
                {
                    Index = ++info.GuardIndex, Name = mob.Name, MobIndex = mob.Index, Location = at.Value,
                });
            }

            // The melee posts have nowhere to go. Crystal keeps one defender list and its
            // spawn path requires the archer AI, so a 卫士 put there would silently not
            // appear. Counted and reported rather than bent into an archer.
            for (int i = 1; Post(keys, $"卫士_{i}_") != null; i++) skippedGuards++;

            conquests.Add(info);
        }

        report.AppendLine("## 攻城");
        report.AppendLine();
        report.AppendLine($"{conquests.Count} 座城。");
        report.AppendLine();
        foreach (var info in conquests)
        {
            report.AppendLine($"**{info.Name}**：地图 {info.MapIndex}，中心 {info.Location.X},{info.Location.Y}，" +
                $"半径 {info.Size}，宫殿地图 {info.PalaceIndex}");
            report.AppendLine();
            report.AppendLine("| 部件 | 怪物 | 位置 |");
            report.AppendLine("|---|---|---|");
            foreach (var gate in info.ConquestGates)
                report.AppendLine($"| 城门 | {gate.Name} | {gate.Location.X},{gate.Location.Y} |");
            foreach (var wall in info.ConquestWalls)
                report.AppendLine($"| 城墙 | {wall.Name} | {wall.Location.X},{wall.Location.Y} |");
            report.AppendLine($"| 守城弓箭手 ×{info.ConquestGuards.Count} | " +
                $"{info.ConquestGuards.FirstOrDefault()?.Name ?? "-"} | " +
                string.Join(' ', info.ConquestGuards.Select(g => $"{g.Location.X},{g.Location.Y}")) + " |");
            report.AppendLine();
        }
        if (skippedGuards > 0)
            report.AppendLine($"{skippedGuards} 个近战守卫岗位没有导入：Crystal 只有一份守城名单，"
                + "而它的 Spawn 要求 AI 80 ConquestArcher，放个 AI 6 的卫士进去会静默不刷。");
        report.AppendLine();
        report.AppendLine("攻城时间表不在 1.76 的文件里——M2 是靠 NPC 申请开战的，"
            + "所以这里保持 Crystal 的 `Request` 类型、不设固定星期。");
        report.AppendLine();
        MonsterStage.AppendNotes(report, notes);
        return new Result(conquests, report.ToString(), errors);
    }

    private static void AddStructure(Dictionary<string, string> keys, string prefix,
        Dictionary<string, MonsterInfo> byName, ConquestInfo info, List<string> notes, ref int errors,
        Action<MonsterInfo, System.Drawing.Point, int> add, byte requiredAi, Func<int> nextIndex)
    {
        string monsterName = Value(keys, prefix + "Name");
        if (string.IsNullOrEmpty(monsterName)) return;
        if (!byName.TryGetValue(monsterName, out var mob))
        {
            notes.Add($"ERROR  {prefix}: 怪物 {monsterName} 不在包里");
            errors++;
            return;
        }
        if (mob.AI != requiredAi)
        {
            notes.Add($"ERROR  {prefix}: {mob.Name} 的 AI 是 {mob.AI}，需要 {requiredAi}，"
                + "否则 ConquestGuildInfo.Spawn 会静默返回");
            errors++;
            return;
        }
        add(mob, new System.Drawing.Point(Number(keys, prefix + "X"), Number(keys, prefix + "Y")), nextIndex());
    }

    private static System.Drawing.Point? Post(Dictionary<string, string> keys, string prefix)
    {
        if (!keys.ContainsKey(prefix + "X") || !keys.ContainsKey(prefix + "Y")) return null;
        int x = Number(keys, prefix + "X"), y = Number(keys, prefix + "Y");
        // A zeroed post is an empty slot, not a position: M2 writes 0,0 for the ones it
        // never placed.
        return x == 0 && y == 0 ? null : new System.Drawing.Point(x, y);
    }

    private static string Value(Dictionary<string, string> keys, string key)
        => keys.TryGetValue(key, out string value) && value.Length > 0 ? value : null;

    private static int Number(Dictionary<string, string> keys, string key)
        => keys.TryGetValue(key, out string value) && int.TryParse(value, out int number) ? number : 0;

    private static Dictionary<string, string> ReadFirstOccurrences(string path)
    {
        var keys = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in GeeM2Source.ReadGbk(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith(';') || line.StartsWith('[')) continue;
            int equals = line.IndexOf('=');
            if (equals <= 0) continue;
            string key = line[..equals].Trim();
            if (!keys.ContainsKey(key)) keys[key] = line[(equals + 1)..].Trim();
        }
        return keys;
    }
}
