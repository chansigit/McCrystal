using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Server.MirEnvir;

namespace Server.ContentPacks
{
    public enum ContentIssueSeverity
    {
        Info,
        Warning,
        Error
    }

    public sealed class ContentPackIssue
    {
        public ContentIssueSeverity Severity { get; init; }
        public string Code { get; init; }
        public string Message { get; init; }
        public string Path { get; init; }
        public string Entity { get; init; }
    }

    public sealed class ContentPackReport
    {
        [JsonIgnore]
        public string ContentRoot { get; init; }

        public string PackId { get; init; }
        public string PackVersion { get; init; }
        public DateTime GeneratedAtUtc { get; init; } = DateTime.UtcNow;
        public Dictionary<string, int> Inventory { get; init; } = new Dictionary<string, int>();
        public List<ContentPackIssue> Issues { get; init; } = new List<ContentPackIssue>();

        public int ErrorCount => Issues.Count(issue => issue.Severity == ContentIssueSeverity.Error);

        public int WarningCount => Issues.Count(issue => issue.Severity == ContentIssueSeverity.Warning);

        public void WriteJson(string path)
        {
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            var options = new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            options.Converters.Add(new JsonStringEnumConverter());
            File.WriteAllText(fullPath, JsonSerializer.Serialize(this, options));
        }
    }

    public static class ContentPackInspector
    {
        private static readonly Regex DropLinePattern = new Regex(@"^\s*(\d+)\/(\d+)\s+(\S+)", RegexOptions.Compiled);
        private static readonly Regex InsertPattern = new Regex(@"^\s*#INSERT\s+\[(.+?)\]", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static ContentPackReport Inspect(ContentPack pack)
        {
            var report = new ContentPackReport
            {
                ContentRoot = pack.ContentRoot,
                PackId = pack.Manifest.Id,
                PackVersion = pack.Manifest.Version
            };

            Inventory(pack, report);

            var environment = Envir.Edit;
            try
            {
                if (!environment.LoadDB())
                {
                    Add(report, ContentIssueSeverity.Error, "DATABASE_LOAD_FAILED", "Server.MirDB could not be loaded.", pack.DatabasePath);
                    return report;
                }
            }
            catch (Exception ex)
            {
                Add(report, ContentIssueSeverity.Error, "DATABASE_LOAD_FAILED", ex.Message, pack.DatabasePath);
                return report;
            }

            report.Inventory["database.maps"] = environment.MapInfoList.Count;
            report.Inventory["database.items"] = environment.ItemInfoList.Count;
            report.Inventory["database.monsters"] = environment.MonsterInfoList.Count;
            report.Inventory["database.npcs"] = environment.NPCInfoList.Count;
            report.Inventory["database.quests"] = environment.QuestInfoList.Count;
            report.Inventory["database.magic"] = environment.MagicInfoList.Count;

            CheckDuplicateIndexes(environment.MapInfoList.Select(value => (value.Index, value.FileName)), "map", report);
            CheckDuplicateIndexes(environment.ItemInfoList.Select(value => (value.Index, value.Name)), "item", report);
            CheckDuplicateIndexes(environment.MonsterInfoList.Select(value => (value.Index, value.Name)), "monster", report);
            CheckDuplicateIndexes(environment.NPCInfoList.Select(value => (value.Index, value.Name)), "npc", report);

            var maps = environment.MapInfoList.GroupBy(map => map.Index).ToDictionary(group => group.Key, group => group.First());
            var monsters = environment.MonsterInfoList.GroupBy(monster => monster.Index).ToDictionary(group => group.Key, group => group.First());
            CheckMaps(pack, environment, maps, monsters, report);
            CheckGeometry(environment, maps, report);
            CheckNpcs(pack, environment, maps, report);
            CheckQuests(pack, environment, report);
            CheckDrops(pack, environment, report);

            return report;
        }

        private static void Inventory(ContentPack pack, ContentPackReport report)
        {
            report.Inventory["files.configs"] = CountFiles(pack.ConfigPath, "*", SearchOption.TopDirectoryOnly);
            var mapFiles = Directory.EnumerateFiles(pack.MapPath, "*.map", SearchOption.AllDirectories).ToArray();
            report.Inventory["files.maps"] = mapFiles.Length;
            foreach (var mapPath in mapFiles)
            {
                var inspection = MapFileInspector.Inspect(mapPath);
                var formatKey = $"files.maps.format.{inspection.Format}";
                report.Inventory[formatKey] = report.Inventory.GetValueOrDefault(formatKey) + 1;
                if (!inspection.IsValid)
                    Add(report, ContentIssueSeverity.Error, "MAP_FILE_INVALID", inspection.Error, mapPath);
            }
            report.Inventory["files.drops"] = CountFiles(Path.Combine(pack.EnvirPath, "Drops"), "*.txt", SearchOption.AllDirectories);
            report.Inventory["files.npcs"] = CountFiles(Path.Combine(pack.EnvirPath, "NPCs"), "*.txt", SearchOption.AllDirectories);
            report.Inventory["files.quests"] = CountFiles(Path.Combine(pack.EnvirPath, "Quests"), "*.txt", SearchOption.AllDirectories);
            report.Inventory["files.goods"] = CountFiles(Path.Combine(pack.EnvirPath, "Goods"), "*.msd", SearchOption.AllDirectories);
            report.Inventory["files.recipes"] = CountFiles(Path.Combine(pack.EnvirPath, "Recipe"), "*.txt", SearchOption.AllDirectories);
            report.Inventory["files.routes"] = CountFiles(Path.Combine(pack.EnvirPath, "Routes"), "*.txt", SearchOption.AllDirectories);
            report.Inventory["files.nonPortable"] = Directory.EnumerateFiles(pack.EnvirPath, "*", SearchOption.AllDirectories)
                .Count(path => Path.GetFileName(path).Contains('\\'));
        }

        private static void CheckMaps(ContentPack pack, Envir environment, Dictionary<int, Server.MirDatabase.MapInfo> maps,
            Dictionary<int, Server.MirDatabase.MonsterInfo> monsters, ContentPackReport report)
        {
            foreach (var map in environment.MapInfoList)
            {
                var mapPath = Path.Combine(pack.MapPath, map.FileName + ".map");
                if (!File.Exists(mapPath))
                    Add(report, ContentIssueSeverity.Error, "MAP_FILE_MISSING", $"Map '{map.Title}' references missing file '{map.FileName}.map'.", mapPath, map.FileName);

                foreach (var movement in map.Movements)
                {
                    if (!maps.ContainsKey(movement.MapIndex))
                        Add(report, ContentIssueSeverity.Error, "MOVEMENT_MAP_MISSING",
                            $"Map '{map.FileName}' movement at {movement.Source.X},{movement.Source.Y} targets unknown map index {movement.MapIndex} at {movement.Destination.X},{movement.Destination.Y}.",
                            entity: map.FileName);
                }

                foreach (var respawn in map.Respawns)
                {
                    if (!monsters.ContainsKey(respawn.MonsterIndex))
                        Add(report, ContentIssueSeverity.Error, "RESPAWN_MONSTER_MISSING", $"Map '{map.FileName}' respawns unknown monster index {respawn.MonsterIndex}.", entity: map.FileName);
                    if (!string.IsNullOrWhiteSpace(respawn.RoutePath))
                    {
                        var routePath = ReferencePath(Path.Combine(pack.EnvirPath, "Routes"), respawn.RoutePath, ".txt");
                        if (!File.Exists(routePath))
                            Add(report, ContentIssueSeverity.Error, "ROUTE_FILE_MISSING", $"Map '{map.FileName}' references missing route '{respawn.RoutePath}'.", routePath, map.FileName);
                    }
                }
            }
        }

        /// <summary>
        /// Opens every map that something is placed on and checks the placements against the
        /// terrain. Nothing else in this inspector reads a map's cells, so a coordinate that
        /// lands in a wall or off the edge passes every other check -- and the engine answers
        /// such a placement by silently skipping it (Map.cs:493), which is how a shop NPC or a
        /// teleport can be simply absent with no error anywhere.
        /// </summary>
        private static void CheckGeometry(Envir environment, Dictionary<int, Server.MirDatabase.MapInfo> maps,
            ContentPackReport report)
        {
            // Loaded through the engine's own Map so the verdict here is the verdict at run
            // time, wall rules and map format variants included. Only the walkable bits are
            // kept: a Map holds a cell object per square, and holding 386 of those at once
            // costs gigabytes, where the same answer fits in one bit per square.
            var walkable = new Dictionary<int, (int Width, int Height, System.Collections.BitArray Cells)>();
            (int Width, int Height, System.Collections.BitArray Cells)? Open(int index)
            {
                if (walkable.TryGetValue(index, out var cached))
                    return cached.Cells == null ? null : cached;
                if (!maps.TryGetValue(index, out var info))
                {
                    walkable[index] = default;
                    return null;
                }
                var map = new Map(info);
                if (!map.Load())
                {
                    walkable[index] = default;
                    return null;
                }
                var bits = new System.Collections.BitArray(map.Width * map.Height);
                for (int x = 0; x < map.Width; x++)
                    for (int y = 0; y < map.Height; y++)
                        bits[y * map.Width + x] = map.ValidPoint(x, y);
                var entry = (map.Width, map.Height, bits);
                walkable[index] = entry;
                return entry;
            }
            static bool Valid((int Width, int Height, System.Collections.BitArray Cells) map, System.Drawing.Point at)
                => at.X >= 0 && at.X < map.Width && at.Y >= 0 && at.Y < map.Height
                    && map.Cells[at.Y * map.Width + at.X];

            static bool AnyWalkable((int Width, int Height, System.Collections.BitArray Cells) map,
                System.Drawing.Point centre, int spread)
            {
                int left = Math.Max(0, centre.X - spread), right = Math.Min(map.Width - 1, centre.X + spread);
                int top = Math.Max(0, centre.Y - spread), bottom = Math.Min(map.Height - 1, centre.Y + spread);
                for (int y = top; y <= bottom; y++)
                    for (int x = left; x <= right; x++)
                        if (map.Cells[y * map.Width + x]) return true;
                return false;
            }

            int blockedNpcs = 0, blockedMovements = 0, offMapZones = 0, blockedRespawns = 0;
            foreach (var map in environment.MapInfoList)
            {
                if (Open(map.Index) is not { } loadedMap) continue;

                foreach (var npc in map.NPCs)
                    if (!Valid(loadedMap, npc.Location))
                    {
                        blockedNpcs++;
                        Add(report, ContentIssueSeverity.Error, "NPC_CELL_BLOCKED",
                            $"NPC '{npc.Name}' stands at {npc.Location.X},{npc.Location.Y} on '{map.FileName}', "
                            + "which is off the map or a wall, so the engine will not spawn it.",
                            entity: npc.Name);
                    }

                foreach (var movement in map.Movements)
                {
                    if (!Valid(loadedMap, movement.Source))
                    {
                        blockedMovements++;
                        Add(report, ContentIssueSeverity.Warning, "MOVEMENT_SOURCE_BLOCKED",
                            $"Map '{map.FileName}' has a movement whose source {movement.Source.X},{movement.Source.Y} "
                            + "cannot be stood on, so it can never trigger.", entity: map.FileName);
                    }
                    if (Open(movement.MapIndex) is { } target && !Valid(target, movement.Destination))
                    {
                        blockedMovements++;
                        Add(report, ContentIssueSeverity.Error, "MOVEMENT_DESTINATION_BLOCKED",
                            $"Map '{map.FileName}' sends {movement.Source.X},{movement.Source.Y} to "
                            + $"{movement.Destination.X},{movement.Destination.Y} on map {movement.MapIndex}, "
                            + "which is off the map or a wall.", entity: map.FileName);
                    }
                }

                foreach (var zone in map.SafeZones)
                    if (!Valid(loadedMap, zone.Location))
                    {
                        offMapZones++;
                        Add(report, ContentIssueSeverity.Warning, "SAFEZONE_CENTRE_BLOCKED",
                            $"Map '{map.FileName}' has a safe zone centred on {zone.Location.X},{zone.Location.Y}, "
                            + "which is off the map or a wall.", entity: map.FileName);
                    }

                // The engine picks a spawn cell from the walkable cells inside the spread
                // box (Map.cs:479), so what matters is whether that box holds any -- not
                // whether the centre itself does. A centre outside the map is normal in the
                // 1.76 tables and still works when the spread reaches back in. An empty box
                // never spawns anything, and Map.cs only logs that after five failures.
                foreach (var respawn in map.Respawns)
                {
                    if (AnyWalkable(loadedMap, respawn.Location, respawn.Spread)) continue;
                    blockedRespawns++;
                    // A warning, not an error: these are faults in 1.76's own tables and
                    // they fail the same way on the original engine, so the pack is a
                    // faithful copy with them in it.
                    Add(report, ContentIssueSeverity.Warning, "RESPAWN_NOWHERE_TO_STAND",
                        $"Map '{map.FileName}' spawns monster {respawn.MonsterIndex} at "
                        + $"{respawn.Location.X},{respawn.Location.Y} with spread {respawn.Spread}, "
                        + "and no cell in that area can be stood on, so nothing ever spawns there.",
                        entity: map.FileName);
                }
            }

            report.Inventory["geometry.npcs.blocked"] = blockedNpcs;
            report.Inventory["geometry.movements.blocked"] = blockedMovements;
            report.Inventory["geometry.safezones.blocked"] = offMapZones;
            report.Inventory["geometry.respawns.blocked"] = blockedRespawns;
        }

        private static void CheckNpcs(ContentPack pack, Envir environment, Dictionary<int, Server.MirDatabase.MapInfo> maps,
            ContentPackReport report)
        {
            var npcRoot = Path.Combine(pack.EnvirPath, "NPCs");
            foreach (var npc in environment.NPCInfoList)
            {
                if (!maps.ContainsKey(npc.MapIndex))
                    Add(report, ContentIssueSeverity.Error, "NPC_MAP_MISSING", $"NPC '{npc.Name}' references unknown map index {npc.MapIndex}.", entity: npc.Name);

                var scriptPath = ReferencePath(npcRoot, npc.FileName, ".txt");
                if (!File.Exists(scriptPath))
                {
                    Add(report, ContentIssueSeverity.Error, "NPC_SCRIPT_MISSING", $"NPC '{npc.Name}' references missing script '{npc.FileName}'.", scriptPath, npc.Name);
                    continue;
                }

                if (!File.ReadLines(scriptPath).Any(line => line.Trim().Equals("[@MAIN]", StringComparison.OrdinalIgnoreCase)))
                    Add(report, ContentIssueSeverity.Warning, "NPC_MAIN_MISSING", $"NPC '{npc.Name}' script has no [@MAIN] page.", scriptPath, npc.Name);
            }
        }

        private static void CheckQuests(ContentPack pack, Envir environment, ContentPackReport report)
        {
            var questRoot = Path.Combine(pack.EnvirPath, "Quests");
            foreach (var quest in environment.QuestInfoList)
            {
                var questPath = ReferencePath(questRoot, quest.FileName, ".txt");
                if (!File.Exists(questPath))
                    Add(report, ContentIssueSeverity.Error, "QUEST_FILE_MISSING", $"Quest '{quest.Name}' references missing file '{quest.FileName}'.", questPath, quest.Name);
            }
        }

        private static void CheckDrops(ContentPack pack, Envir environment, ContentPackReport report)
        {
            var dropRoot = Path.Combine(pack.EnvirPath, "Drops");
            var itemNames = environment.ItemInfoList
                .Select(item => NormalizeItemName(item.Name))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var duplicate in environment.ItemInfoList.GroupBy(item => NormalizeItemName(item.Name), StringComparer.OrdinalIgnoreCase).Where(group => group.Count() > 1))
                Add(report, ContentIssueSeverity.Warning, "ITEM_NAME_DUPLICATE", $"Multiple items resolve from the normalized name '{duplicate.Key}'.", entity: duplicate.Key);

            var pendingFiles = new Queue<string>();
            var activeFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var monster in environment.MonsterInfoList)
            {
                var relativePath = string.IsNullOrWhiteSpace(monster.DropPath) ? monster.Name : monster.DropPath;
                var dropPath = ReferencePath(dropRoot, relativePath, ".txt");
                if (File.Exists(dropPath))
                {
                    pendingFiles.Enqueue(dropPath);
                    continue;
                }

                var literalPath = LiteralReferencePath(dropRoot, relativePath, ".txt");
                if (File.Exists(literalPath))
                {
                    Add(report, ContentIssueSeverity.Error, "NON_PORTABLE_PATH", $"Monster '{monster.Name}' drop table uses backslashes in a filename instead of directories.", literalPath, monster.Name);
                    continue;
                }

                var severity = string.IsNullOrWhiteSpace(monster.DropPath) ? ContentIssueSeverity.Warning : ContentIssueSeverity.Error;
                Add(report, severity, "MONSTER_DROP_MISSING", $"Monster '{monster.Name}' references missing drop table '{relativePath}'.", dropPath, monster.Name);
            }

            foreach (var systemDrop in SystemDropPaths(dropRoot))
                if (File.Exists(systemDrop)) pendingFiles.Enqueue(systemDrop);

            while (pendingFiles.Count > 0)
            {
                var dropPath = Path.GetFullPath(pendingFiles.Dequeue());
                if (!activeFiles.Add(dropPath)) continue;
                var lineNumber = 0;
                foreach (var line in File.ReadLines(dropPath))
                {
                    lineNumber++;
                    var insert = InsertPattern.Match(line);
                    if (insert.Success)
                    {
                        var insertedPath = ReferencePath(dropRoot, insert.Groups[1].Value);
                        if (!File.Exists(insertedPath))
                            Add(report, ContentIssueSeverity.Error, "DROP_INSERT_MISSING", $"Drop include on line {lineNumber} does not exist.", insertedPath, Relative(pack, dropPath));
                        else
                            pendingFiles.Enqueue(insertedPath);
                        continue;
                    }

                    var match = DropLinePattern.Match(line);
                    if (!match.Success) continue;
                    if (!int.TryParse(match.Groups[2].Value, out var chance) || chance < 1)
                    {
                        Add(report, ContentIssueSeverity.Error, "DROP_CHANCE_INVALID", $"Drop chance on line {lineNumber} must have a positive denominator.", dropPath);
                        continue;
                    }

                    var itemName = match.Groups[3].Value;
                    if (itemName.Equals("Gold", StringComparison.OrdinalIgnoreCase) || itemName.StartsWith("Group", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!itemNames.Contains(NormalizeItemName(itemName)))
                        Add(report, ContentIssueSeverity.Error, "DROP_ITEM_MISSING", $"Drop item '{itemName}' on line {lineNumber} is not in Server.MirDB.", dropPath, itemName);
                }
            }

            report.Inventory["files.drops.active"] = activeFiles.Count;
        }

        private static IEnumerable<string> SystemDropPaths(string dropRoot)
        {
            yield return Path.Combine(dropRoot, "00Awakening.txt");
            yield return Path.Combine(dropRoot, "00Strongbox.txt");
            yield return Path.Combine(dropRoot, "00Blackstone.txt");
            yield return Path.Combine(dropRoot, "DragonItem.txt");
            for (var i = 0; i < 19; i++) yield return Path.Combine(dropRoot, $"00Fishing{i:D2}.txt");
        }

        private static void CheckDuplicateIndexes(IEnumerable<(int Index, string Name)> values, string kind, ContentPackReport report)
        {
            foreach (var duplicate in values.GroupBy(value => value.Index).Where(group => group.Count() > 1))
                Add(report, ContentIssueSeverity.Error, "DUPLICATE_INDEX", $"Duplicate {kind} index {duplicate.Key}: {string.Join(", ", duplicate.Select(value => value.Name))}.");
        }

        private static string ReferencePath(string root, string relativePath, string extension = "")
        {
            var normalized = relativePath.Replace('\\', Path.DirectorySeparatorChar).Replace('/', Path.DirectorySeparatorChar);
            if (!string.IsNullOrEmpty(extension) && !normalized.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) normalized += extension;
            return Path.GetFullPath(Path.Combine(root, normalized));
        }

        private static string LiteralReferencePath(string root, string relativePath, string extension)
        {
            var value = relativePath;
            if (!value.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) value += extension;
            return Path.GetFullPath(Path.Combine(root, value));
        }

        private static string NormalizeItemName(string name) => name.Replace(" ", string.Empty);

        private static int CountFiles(string path, string pattern, SearchOption option) =>
            Directory.Exists(path) ? Directory.EnumerateFiles(path, pattern, option).Count() : 0;

        private static string Relative(ContentPack pack, string path) => Path.GetRelativePath(pack.ContentRoot, path);

        private static void Add(ContentPackReport report, ContentIssueSeverity severity, string code, string message,
            string path = null, string entity = null)
        {
            report.Issues.Add(new ContentPackIssue
            {
                Severity = severity,
                Code = code,
                Message = message,
                Path = PortablePath(report, path),
                Entity = entity
            });
        }

        private static string PortablePath(ContentPackReport report, string path)
        {
            if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(report.ContentRoot) || !Path.IsPathRooted(path)) return path;
            return Path.GetRelativePath(report.ContentRoot, path).Replace(Path.DirectorySeparatorChar, '/');
        }
    }
}
