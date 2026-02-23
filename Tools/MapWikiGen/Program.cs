using System.Net;
using System.Text;

#region Data Records

class SafeZoneData
{
    public int X, Y;
    public ushort Size;
    public bool StartPoint;
}

class MovementData
{
    public int MapIndex;
    public int SrcX, SrcY, DstX, DstY;
    public bool NeedHole, NeedMove;
}

class RespawnData
{
    public int MonsterIndex;
    public int X, Y;
    public ushort Count, Spread, Delay;
    public byte Direction;
    public string RoutePath = "";
}

class MineZoneData
{
    public int X, Y;
    public ushort Size;
    public byte Mine;
}

class NpcData
{
    public int Index, MapIndex;
    public string Name = "", FileName = "";
    public int X, Y;
}

class MapRecord
{
    public int Index;
    public string FileName = "", Title = "";
    public ushort MiniMap, BigMap, Music;
    public byte Light, MapDarkLight, MineIndex, GTIndex;
    public ushort WeatherParticles;

    // Flags
    public bool NoTeleport, NoReconnect, NoRandom, NoEscape, NoRecall, NoDrug, NoPosition;
    public bool NoThrowItem, NoDropPlayer, NoDropMonster, NoNames, NoMount, NeedBridle;
    public bool Fight, NoFight, Fire, Lightning, GT;
    public bool NoTownTeleport, NoReincarnation, NoExperience, NoGroup, NoPets;
    public bool NoIntelligentCreatures, NoHero, RequiredGroup, FireWallLimit;

    public string NoReconnectMap = "";
    public int FireDamage, LightningDamage, RequiredGroupSize, FireWallCount;

    public List<SafeZoneData> SafeZones = new();
    public List<MovementData> Movements = new();
    public List<RespawnData> Respawns = new();
    public List<MineZoneData> MineZones = new();
}

#endregion

class Program
{
    static int Version, CustomVersion;

    static void Main(string[] args)
    {
        string repoRoot = FindRepoRoot();
        string dbPath = Path.Combine(repoRoot, "Build", "Server", "Debug", "Server.MirDB");
        string outputPath = Path.Combine(repoRoot, "MapWiki.html");

        if (args.Length >= 1) dbPath = args[0];
        if (args.Length >= 2) outputPath = args[1];

        Console.WriteLine($"Database: {dbPath}");
        Console.WriteLine($"Output:   {outputPath}");

        if (!File.Exists(dbPath))
        {
            Console.WriteLine("ERROR: Database file not found!");
            return;
        }

        Console.WriteLine("Reading database...");
        var (maps, monsters, npcs) = ReadDb(dbPath);
        Console.WriteLine($"  Loaded {maps.Count} maps, {monsters.Count} monsters, {npcs.Count} NPCs.");

        // Group NPCs by map index
        var npcsByMap = new Dictionary<int, List<NpcData>>();
        foreach (var npc in npcs)
        {
            if (!npcsByMap.ContainsKey(npc.MapIndex))
                npcsByMap[npc.MapIndex] = new List<NpcData>();
            npcsByMap[npc.MapIndex].Add(npc);
        }

        Console.WriteLine("Generating HTML...");
        string html = GenerateHtml(maps, monsters, npcsByMap);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        File.WriteAllText(outputPath, html);

        var fileSize = new FileInfo(outputPath).Length;
        Console.WriteLine($"  Written: {outputPath}");
        Console.WriteLine($"  Size: {fileSize / 1024.0:F0} KB");
        Console.WriteLine("Done!");
    }

    #region Database Reading

    static (List<MapRecord> maps, Dictionary<int, string> monsters, List<NpcData> npcs) ReadDb(string dbPath)
    {
        using var stream = File.OpenRead(dbPath);
        using var reader = new BinaryReader(stream);

        Version = reader.ReadInt32();
        CustomVersion = reader.ReadInt32();
        Console.WriteLine($"  DB Version: {Version}, CustomVersion: {CustomVersion}");

        // Skip indices
        reader.ReadInt32(); // MapIndex
        reader.ReadInt32(); // ItemIndex
        reader.ReadInt32(); // MonsterIndex
        reader.ReadInt32(); // NPCIndex
        reader.ReadInt32(); // QuestIndex
        if (Version >= 63) reader.ReadInt32(); // GameshopIndex
        if (Version >= 66) reader.ReadInt32(); // ConquestIndex
        if (Version >= 68) reader.ReadInt32(); // RespawnIndex

        // Read MapInfoList
        int count = reader.ReadInt32();
        Console.WriteLine($"  Reading {count} maps...");
        var maps = new List<MapRecord>(count);
        for (int i = 0; i < count; i++)
            maps.Add(ReadMapInfo(reader));

        // Skip ItemInfoList
        count = reader.ReadInt32();
        Console.WriteLine($"  Skipping {count} items...");
        for (int i = 0; i < count; i++)
            SkipItemInfo(reader);

        // Read MonsterInfoList (name only)
        count = reader.ReadInt32();
        Console.WriteLine($"  Reading {count} monster names...");
        var monsters = new Dictionary<int, string>();
        for (int i = 0; i < count; i++)
        {
            var (idx, name) = ReadMonsterNameAndSkip(reader);
            monsters[idx] = name;
        }

        // Read NPCInfoList
        count = reader.ReadInt32();
        Console.WriteLine($"  Reading {count} NPCs...");
        var npcs = new List<NpcData>(count);
        for (int i = 0; i < count; i++)
            npcs.Add(ReadNpcInfoAndSkip(reader));

        return (maps, monsters, npcs);
    }

    static MapRecord ReadMapInfo(BinaryReader reader)
    {
        var map = new MapRecord();

        map.Index = reader.ReadInt32();
        map.FileName = reader.ReadString();
        map.Title = reader.ReadString();
        map.MiniMap = reader.ReadUInt16();
        map.Light = reader.ReadByte();
        map.BigMap = reader.ReadUInt16();

        // SafeZones
        int count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            var sz = new SafeZoneData();
            sz.X = reader.ReadInt32();
            sz.Y = reader.ReadInt32();
            sz.Size = reader.ReadUInt16();
            sz.StartPoint = reader.ReadBoolean();
            map.SafeZones.Add(sz);
        }

        // Respawns
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            var r = new RespawnData();
            r.MonsterIndex = reader.ReadInt32();
            r.X = reader.ReadInt32();
            r.Y = reader.ReadInt32();
            r.Count = reader.ReadUInt16();
            r.Spread = reader.ReadUInt16();
            r.Delay = reader.ReadUInt16();
            r.Direction = reader.ReadByte();
            r.RoutePath = reader.ReadString();
            if (Version > 67)
            {
                reader.ReadUInt16(); // RandomDelay
                reader.ReadInt32();  // RespawnIndex
                reader.ReadBoolean(); // SaveRespawnTime
                reader.ReadUInt16(); // RespawnTicks
            }
            map.Respawns.Add(r);
        }

        // Movements
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            var m = new MovementData();
            m.MapIndex = reader.ReadInt32();
            m.SrcX = reader.ReadInt32();
            m.SrcY = reader.ReadInt32();
            m.DstX = reader.ReadInt32();
            m.DstY = reader.ReadInt32();
            m.NeedHole = reader.ReadBoolean();
            m.NeedMove = reader.ReadBoolean();
            if (Version >= 69) reader.ReadInt32(); // ConquestIndex
            if (Version >= 95) { reader.ReadBoolean(); reader.ReadInt32(); } // ShowOnBigMap, Icon
            map.Movements.Add(m);
        }

        // Flags
        map.NoTeleport = reader.ReadBoolean();
        map.NoReconnect = reader.ReadBoolean();
        map.NoReconnectMap = reader.ReadString();
        map.NoRandom = reader.ReadBoolean();
        map.NoEscape = reader.ReadBoolean();
        map.NoRecall = reader.ReadBoolean();
        map.NoDrug = reader.ReadBoolean();
        map.NoPosition = reader.ReadBoolean();
        map.NoThrowItem = reader.ReadBoolean();
        map.NoDropPlayer = reader.ReadBoolean();
        map.NoDropMonster = reader.ReadBoolean();
        map.NoNames = reader.ReadBoolean();
        map.Fight = reader.ReadBoolean();
        map.Fire = reader.ReadBoolean();
        map.FireDamage = reader.ReadInt32();
        map.Lightning = reader.ReadBoolean();
        map.LightningDamage = reader.ReadInt32();
        map.MapDarkLight = reader.ReadByte();

        // MineZones
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            var mz = new MineZoneData();
            mz.X = reader.ReadInt32();
            mz.Y = reader.ReadInt32();
            mz.Size = reader.ReadUInt16();
            mz.Mine = reader.ReadByte();
            map.MineZones.Add(mz);
        }

        map.MineIndex = reader.ReadByte();
        map.NoMount = reader.ReadBoolean();
        map.NeedBridle = reader.ReadBoolean();
        map.NoFight = reader.ReadBoolean();
        map.Music = reader.ReadUInt16();

        if (Version >= 78) map.NoTownTeleport = reader.ReadBoolean();
        if (Version >= 79) map.NoReincarnation = reader.ReadBoolean();
        if (Version >= 110) map.WeatherParticles = reader.ReadUInt16();
        if (Version >= 111) { map.GT = reader.ReadBoolean(); map.GTIndex = reader.ReadByte(); }
        if (Version >= 114)
        {
            map.NoExperience = reader.ReadBoolean();
            map.NoGroup = reader.ReadBoolean();
            map.NoPets = reader.ReadBoolean();
            map.NoIntelligentCreatures = reader.ReadBoolean();
            map.NoHero = reader.ReadBoolean();
            map.RequiredGroupSize = reader.ReadInt32();
            map.RequiredGroup = reader.ReadBoolean();
            map.FireWallLimit = reader.ReadBoolean();
            map.FireWallCount = reader.ReadInt32();
        }

        return map;
    }

    static void SkipStats(BinaryReader reader)
    {
        int count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            reader.ReadByte();  // Stat enum
            reader.ReadInt32(); // Value
        }
    }

    static void SkipItemInfo(BinaryReader reader)
    {
        reader.ReadInt32();  // Index
        reader.ReadString(); // Name
        reader.ReadByte();   // Type
        reader.ReadByte();   // Grade
        reader.ReadByte();   // RequiredType
        reader.ReadByte();   // RequiredClass
        reader.ReadByte();   // RequiredGender
        reader.ReadByte();   // Set
        reader.ReadInt16();  // Shape
        reader.ReadByte();   // Weight
        reader.ReadByte();   // Light
        reader.ReadByte();   // RequiredAmount
        reader.ReadUInt16(); // Image
        reader.ReadUInt16(); // Durability

        if (Version <= 84)
            reader.ReadUInt32(); // StackSize as uint32
        else
            reader.ReadUInt16(); // StackSize as ushort

        reader.ReadUInt32(); // Price

        if (Version <= 84)
        {
            // Old inline stats: 10 bytes + 2 ushorts + 2 bytes + 2 sbytes = 18 bytes
            reader.ReadBytes(10); // MinAC..MaxSC
            reader.ReadUInt16(); reader.ReadUInt16(); // HP, MP
            reader.ReadByte(); reader.ReadByte(); // Accuracy, Agility
            reader.ReadSByte(); reader.ReadSByte(); // Luck, AttackSpeed
        }

        reader.ReadBoolean(); // StartItem

        if (Version <= 84)
            reader.ReadBytes(3); // BagWeight, HandWeight, WearWeight

        reader.ReadByte(); // Effect

        if (Version <= 84)
            reader.ReadBytes(10); // Strong..CriticalDamage

        reader.ReadByte(); // Bools (packed flags)

        if (Version <= 84)
            reader.ReadBytes(5); // MaxACRate..PoisonAttack

        reader.ReadInt16(); // Bind

        if (Version <= 84)
            reader.ReadBytes(2); // Reflect, HPDrainRate

        reader.ReadInt16();  // Unique
        reader.ReadByte();   // RandomStatsId
        reader.ReadBoolean(); // CanFastRun
        reader.ReadBoolean(); // CanAwakening

        if (Version > 83)
            reader.ReadByte(); // Slots

        if (Version > 84)
            SkipStats(reader); // Stats object

        bool hasTooltip = reader.ReadBoolean();
        if (hasTooltip)
            reader.ReadString(); // ToolTip
    }

    static (int index, string name) ReadMonsterNameAndSkip(BinaryReader reader)
    {
        int index = reader.ReadInt32();
        string name = reader.ReadString();

        reader.ReadUInt16(); // Image
        reader.ReadByte();   // AI
        reader.ReadByte();   // Effect

        if (Version < 62)
            reader.ReadByte(); // Level as byte
        else
            reader.ReadUInt16(); // Level as ushort

        reader.ReadByte(); // ViewRange
        reader.ReadByte(); // CoolEye

        if (Version > 84)
        {
            SkipStats(reader);
        }

        if (Version <= 84)
        {
            reader.ReadUInt32(); // HP
            if (Version < 62)
                reader.ReadBytes(10); // stats as bytes
            else
                reader.ReadBytes(20); // stats as ushorts
            reader.ReadByte(); // Accuracy
            reader.ReadByte(); // Agility
        }

        reader.ReadByte();   // Light
        reader.ReadUInt16(); // AttackSpeed
        reader.ReadUInt16(); // MoveSpeed
        reader.ReadUInt32(); // Experience
        reader.ReadBoolean(); // CanPush
        reader.ReadBoolean(); // CanTame

        if (Version >= 18)
        {
            reader.ReadBoolean(); // AutoRev
            reader.ReadBoolean(); // Undead
        }

        if (Version >= 89)
            reader.ReadString(); // DropPath

        if (Version >= 115)
            reader.ReadBoolean(); // CanRecall

        if (Version >= 116)
            reader.ReadBoolean(); // IsBoss

        return (index, name);
    }

    static NpcData ReadNpcInfoAndSkip(BinaryReader reader)
    {
        var npc = new NpcData();
        npc.Index = reader.ReadInt32();
        npc.MapIndex = reader.ReadInt32();

        // CollectQuestIndexes
        int count = reader.ReadInt32();
        for (int i = 0; i < count; i++) reader.ReadInt32();

        // FinishQuestIndexes
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++) reader.ReadInt32();

        npc.FileName = reader.ReadString();
        npc.Name = reader.ReadString();
        npc.X = reader.ReadInt32();
        npc.Y = reader.ReadInt32();

        if (Version >= 72)
            reader.ReadUInt16(); // Image
        else
            reader.ReadByte(); // Image

        reader.ReadUInt16(); // Rate

        if (Version >= 64)
        {
            reader.ReadBoolean(); // TimeVisible
            reader.ReadByte();    // HourStart
            reader.ReadByte();    // MinuteStart
            reader.ReadByte();    // HourEnd
            reader.ReadByte();    // MinuteEnd
            reader.ReadInt16();   // MinLev
            reader.ReadInt16();   // MaxLev
            reader.ReadString();  // DayofWeek
            reader.ReadString();  // ClassRequired
            if (Version >= 66)
                reader.ReadInt32(); // Conquest
            else
                reader.ReadBoolean(); // Sabuk
            reader.ReadInt32();   // FlagNeeded
        }

        if (Version > 95)
        {
            reader.ReadBoolean(); // ShowOnBigMap
            reader.ReadInt32();   // BigMapIcon
        }

        if (Version > 96)
            reader.ReadBoolean(); // CanTeleportTo

        if (Version >= 107)
            reader.ReadBoolean(); // ConquestVisible

        return npc;
    }

    #endregion

    #region HTML Generation

    static string GenerateHtml(List<MapRecord> maps, Dictionary<int, string> monsters, Dictionary<int, List<NpcData>> npcsByMap)
    {
        // Build map index lookup for movement cross-references
        var mapLookup = new Dictionary<int, MapRecord>();
        foreach (var m in maps) mapLookup[m.Index] = m;

        var sb = new StringBuilder();
        sb.AppendLine("<!DOCTYPE html>");
        sb.AppendLine("<html lang=\"en\">");
        sb.AppendLine("<head>");
        sb.AppendLine("<meta charset=\"utf-8\">");
        sb.AppendLine("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
        sb.AppendLine("<title>Map Wiki - Crystal</title>");
        sb.AppendLine("<style>");
        sb.AppendLine(GetCss());
        sb.AppendLine("</style>");
        sb.AppendLine("</head>");
        sb.AppendLine("<body>");
        sb.AppendLine("<h1>Map Wiki</h1>");
        sb.AppendLine($"<p class=\"subtitle\">{maps.Count} maps loaded from Server.MirDB</p>");

        // Search bar
        sb.AppendLine("<div class=\"search-bar\">");
        sb.AppendLine("  <input type=\"text\" id=\"searchInput\" placeholder=\"Search maps by name, filename, or index...\" oninput=\"filterMaps()\">");
        sb.AppendLine("  <label class=\"filter-label\"><input type=\"checkbox\" id=\"filterRestricted\" onchange=\"filterMaps()\"> Has Restrictions</label>");
        sb.AppendLine("  <label class=\"filter-label\"><input type=\"checkbox\" id=\"filterStartPoint\" onchange=\"filterMaps()\"> Has Start Point</label>");
        sb.AppendLine("  <label class=\"filter-label\"><input type=\"checkbox\" id=\"filterNpcs\" onchange=\"filterMaps()\"> Has NPCs</label>");
        sb.AppendLine("  <span id=\"resultCount\" class=\"result-count\"></span>");
        sb.AppendLine("</div>");

        // Quick stats
        int mapsWithNpcs = maps.Count(m => npcsByMap.ContainsKey(m.Index));
        int mapsWithMovements = maps.Count(m => m.Movements.Count > 0);
        int mapsWithRespawns = maps.Count(m => m.Respawns.Count > 0);
        int startPointMaps = maps.Count(m => m.SafeZones.Any(sz => sz.StartPoint));
        int totalRespawns = maps.Sum(m => m.Respawns.Count);
        int totalNpcs = npcsByMap.Values.Sum(n => n.Count);

        sb.AppendLine("<div class=\"stats-bar\">");
        sb.AppendLine($"  <span class=\"stat-item\">Start Points: <b>{startPointMaps}</b></span>");
        sb.AppendLine($"  <span class=\"stat-item\">Maps with NPCs: <b>{mapsWithNpcs}</b></span>");
        sb.AppendLine($"  <span class=\"stat-item\">Total NPCs: <b>{totalNpcs}</b></span>");
        sb.AppendLine($"  <span class=\"stat-item\">Maps with Portals: <b>{mapsWithMovements}</b></span>");
        sb.AppendLine($"  <span class=\"stat-item\">Maps with Spawns: <b>{mapsWithRespawns}</b></span>");
        sb.AppendLine($"  <span class=\"stat-item\">Total Spawn Points: <b>{totalRespawns}</b></span>");
        sb.AppendLine("</div>");

        // Map cards
        sb.AppendLine("<div id=\"mapContainer\">");
        foreach (var map in maps.OrderBy(m => m.Index))
        {
            var mapNpcs = npcsByMap.ContainsKey(map.Index) ? npcsByMap[map.Index] : new List<NpcData>();
            WriteMapCard(sb, map, monsters, mapLookup, mapNpcs);
        }
        sb.AppendLine("</div>");

        sb.AppendLine("<footer>Generated by MapWikiGen</footer>");

        // JavaScript
        sb.AppendLine("<script>");
        sb.AppendLine(GetJs());
        sb.AppendLine("</script>");

        sb.AppendLine("</body>");
        sb.AppendLine("</html>");

        return sb.ToString();
    }

    static void WriteMapCard(StringBuilder sb, MapRecord map, Dictionary<int, string> monsters,
        Dictionary<int, MapRecord> mapLookup, List<NpcData> npcs)
    {
        // Collect active flags
        var flags = GetActiveFlags(map);
        bool hasRestrictions = flags.Count > 0;
        string restrictedAttr = hasRestrictions ? "data-restricted=\"1\"" : "";
        string startPointAttr = map.SafeZones.Any(sz => sz.StartPoint) ? "data-startpoint=\"1\"" : "";
        string npcAttr = npcs.Count > 0 ? "data-npcs=\"1\"" : "";

        sb.AppendLine($"<div class=\"map-card\" data-index=\"{map.Index}\" data-name=\"{Esc(map.Title)}\" data-file=\"{Esc(map.FileName)}\" {restrictedAttr} {startPointAttr} {npcAttr}>");

        // Header
        sb.AppendLine($"  <div class=\"map-header\" onclick=\"toggleDetails(this)\">");
        sb.AppendLine($"    <span class=\"map-index\">#{map.Index}</span>");
        sb.AppendLine($"    <span class=\"map-title\">{Esc(map.Title)}</span>");
        sb.AppendLine($"    <span class=\"map-file\">{Esc(map.FileName)}</span>");

        // Badge row
        sb.Append("    <span class=\"badges\">");
        if (map.SafeZones.Any(sz => sz.StartPoint))
            sb.Append("<span class=\"badge badge-start\">Start Point</span>");
        if (npcs.Count > 0)
            sb.Append($"<span class=\"badge badge-npc\">{npcs.Count} NPC{(npcs.Count > 1 ? "s" : "")}</span>");
        if (map.Movements.Count > 0)
            sb.Append($"<span class=\"badge badge-portal\">{map.Movements.Count} Portal{(map.Movements.Count > 1 ? "s" : "")}</span>");
        if (map.Respawns.Count > 0)
            sb.Append($"<span class=\"badge badge-spawn\">{map.Respawns.Count} Spawn{(map.Respawns.Count > 1 ? "s" : "")}</span>");
        if (map.MineZones.Count > 0)
            sb.Append($"<span class=\"badge badge-mine\">Mine</span>");
        if (hasRestrictions)
            sb.Append($"<span class=\"badge badge-restrict\">{flags.Count} Restriction{(flags.Count > 1 ? "s" : "")}</span>");
        sb.AppendLine("</span>");

        sb.AppendLine($"    <span class=\"expand-icon\">&#9660;</span>");
        sb.AppendLine("  </div>");

        // Details (hidden by default)
        sb.AppendLine("  <div class=\"map-details\" style=\"display:none\">");

        // Properties table
        sb.AppendLine("    <div class=\"detail-section\">");
        sb.AppendLine("      <h3>Properties</h3>");
        sb.AppendLine("      <table class=\"props-table\">");
        sb.AppendLine($"        <tr><td>Light</td><td>{LightName(map.Light)}</td></tr>");
        sb.AppendLine($"        <tr><td>MapDarkLight</td><td>{map.MapDarkLight}</td></tr>");
        sb.AppendLine($"        <tr><td>MiniMap</td><td>{map.MiniMap}</td></tr>");
        sb.AppendLine($"        <tr><td>BigMap</td><td>{map.BigMap}</td></tr>");
        if (map.Music > 0)
            sb.AppendLine($"        <tr><td>Music</td><td>{map.Music}</td></tr>");
        if (map.WeatherParticles > 0)
            sb.AppendLine($"        <tr><td>Weather</td><td>{WeatherName(map.WeatherParticles)}</td></tr>");
        if (map.GT)
            sb.AppendLine($"        <tr><td>GT</td><td>Yes (Index: {map.GTIndex})</td></tr>");
        if (map.Fire)
            sb.AppendLine($"        <tr><td>Fire Damage</td><td>{map.FireDamage}</td></tr>");
        if (map.Lightning)
            sb.AppendLine($"        <tr><td>Lightning Damage</td><td>{map.LightningDamage}</td></tr>");
        if (map.MineIndex > 0)
            sb.AppendLine($"        <tr><td>Mine Index</td><td>{map.MineIndex}</td></tr>");
        if (map.RequiredGroup)
            sb.AppendLine($"        <tr><td>Required Group Size</td><td>{map.RequiredGroupSize}</td></tr>");
        if (map.FireWallLimit)
            sb.AppendLine($"        <tr><td>FireWall Limit</td><td>{map.FireWallCount}</td></tr>");
        if (!string.IsNullOrEmpty(map.NoReconnectMap))
            sb.AppendLine($"        <tr><td>Reconnect Map</td><td>{Esc(map.NoReconnectMap)}</td></tr>");
        sb.AppendLine("      </table>");
        sb.AppendLine("    </div>");

        // Restrictions
        if (flags.Count > 0)
        {
            sb.AppendLine("    <div class=\"detail-section\">");
            sb.AppendLine("      <h3>Restrictions</h3>");
            sb.AppendLine("      <div class=\"flag-grid\">");
            foreach (var (name, category) in flags)
                sb.AppendLine($"        <span class=\"flag flag-{category}\">{name}</span>");
            sb.AppendLine("      </div>");
            sb.AppendLine("    </div>");
        }

        // Safe Zones
        if (map.SafeZones.Count > 0)
        {
            sb.AppendLine("    <div class=\"detail-section\">");
            sb.AppendLine("      <h3>Safe Zones</h3>");
            sb.AppendLine("      <table class=\"data-table\"><thead><tr><th>Location</th><th>Size</th><th>Start Point</th></tr></thead><tbody>");
            foreach (var sz in map.SafeZones)
                sb.AppendLine($"        <tr><td>({sz.X}, {sz.Y})</td><td>{sz.Size}</td><td>{(sz.StartPoint ? "Yes" : "")}</td></tr>");
            sb.AppendLine("      </tbody></table>");
            sb.AppendLine("    </div>");
        }

        // NPCs
        if (npcs.Count > 0)
        {
            sb.AppendLine("    <div class=\"detail-section\">");
            sb.AppendLine("      <h3>NPCs</h3>");
            sb.AppendLine("      <table class=\"data-table\"><thead><tr><th>Name</th><th>Location</th><th>File</th></tr></thead><tbody>");
            foreach (var npc in npcs.OrderBy(n => n.Name))
                sb.AppendLine($"        <tr><td class=\"npc-name\">{Esc(npc.Name)}</td><td>({npc.X}, {npc.Y})</td><td class=\"dim\">{Esc(npc.FileName)}</td></tr>");
            sb.AppendLine("      </tbody></table>");
            sb.AppendLine("    </div>");
        }

        // Movements / Portals
        if (map.Movements.Count > 0)
        {
            sb.AppendLine("    <div class=\"detail-section\">");
            sb.AppendLine("      <h3>Portals / Movements</h3>");
            sb.AppendLine("      <table class=\"data-table\"><thead><tr><th>From</th><th>To Map</th><th>Destination</th><th>Requires</th></tr></thead><tbody>");
            foreach (var mv in map.Movements)
            {
                string destMapName = mapLookup.ContainsKey(mv.MapIndex)
                    ? $"<a href=\"#\" onclick=\"scrollToMap({mv.MapIndex});return false;\">{Esc(mapLookup[mv.MapIndex].Title)}</a> (#{mv.MapIndex})"
                    : $"Map #{mv.MapIndex}";
                string requires = "";
                if (mv.NeedHole) requires += "Hole ";
                if (mv.NeedMove) requires += "Move ";
                sb.AppendLine($"        <tr><td>({mv.SrcX}, {mv.SrcY})</td><td>{destMapName}</td><td>({mv.DstX}, {mv.DstY})</td><td>{requires}</td></tr>");
            }
            sb.AppendLine("      </tbody></table>");
            sb.AppendLine("    </div>");
        }

        // Respawns (grouped by monster)
        if (map.Respawns.Count > 0)
        {
            sb.AppendLine("    <div class=\"detail-section\">");
            sb.AppendLine("      <h3>Monster Spawns</h3>");

            // Group by monster
            var grouped = map.Respawns.GroupBy(r => r.MonsterIndex)
                .OrderBy(g => monsters.ContainsKey(g.Key) ? monsters[g.Key] : $"#{g.Key}");

            sb.AppendLine("      <table class=\"data-table\"><thead><tr><th>Monster</th><th>Points</th><th>Total Count</th><th>Locations</th></tr></thead><tbody>");
            foreach (var g in grouped)
            {
                string monsterName = monsters.ContainsKey(g.Key) ? Esc(monsters[g.Key]) : $"#{g.Key}";
                int totalCount = g.Sum(r => r.Count);
                string locations = string.Join(", ", g.Select(r => $"({r.X},{r.Y})x{r.Count}"));
                if (locations.Length > 120) locations = locations[..120] + "...";
                sb.AppendLine($"        <tr><td class=\"monster-name\">{monsterName}</td><td>{g.Count()}</td><td>{totalCount}</td><td class=\"dim\">{locations}</td></tr>");
            }
            sb.AppendLine("      </tbody></table>");
            sb.AppendLine("    </div>");
        }

        // Mine Zones
        if (map.MineZones.Count > 0)
        {
            sb.AppendLine("    <div class=\"detail-section\">");
            sb.AppendLine("      <h3>Mine Zones</h3>");
            sb.AppendLine("      <table class=\"data-table\"><thead><tr><th>Location</th><th>Size</th><th>Mine Type</th></tr></thead><tbody>");
            foreach (var mz in map.MineZones)
                sb.AppendLine($"        <tr><td>({mz.X}, {mz.Y})</td><td>{mz.Size}</td><td>{mz.Mine}</td></tr>");
            sb.AppendLine("      </tbody></table>");
            sb.AppendLine("    </div>");
        }

        sb.AppendLine("  </div>"); // map-details
        sb.AppendLine("</div>"); // map-card
    }

    static List<(string name, string category)> GetActiveFlags(MapRecord map)
    {
        var flags = new List<(string, string)>();

        // Movement restrictions (red)
        if (map.NoTeleport) flags.Add(("NoTeleport", "move"));
        if (map.NoRandom) flags.Add(("NoRandom", "move"));
        if (map.NoEscape) flags.Add(("NoEscape", "move"));
        if (map.NoRecall) flags.Add(("NoRecall", "move"));
        if (map.NoReconnect) flags.Add(("NoReconnect", "move"));
        if (map.NoTownTeleport) flags.Add(("NoTownTeleport", "move"));
        if (map.NoPosition) flags.Add(("NoPosition", "move"));

        // Combat restrictions (orange)
        if (map.NoFight) flags.Add(("NoFight", "combat"));
        if (map.Fight) flags.Add(("ForceFight", "combat"));
        if (map.NoDrug) flags.Add(("NoDrug", "combat"));
        if (map.NoReincarnation) flags.Add(("NoReincarnation", "combat"));

        // Item restrictions (yellow)
        if (map.NoThrowItem) flags.Add(("NoThrowItem", "item"));
        if (map.NoDropPlayer) flags.Add(("NoDropPlayer", "item"));
        if (map.NoDropMonster) flags.Add(("NoDropMonster", "item"));

        // Mount restrictions (blue)
        if (map.NoMount) flags.Add(("NoMount", "mount"));
        if (map.NeedBridle) flags.Add(("NeedBridle", "mount"));

        // Player restrictions (purple)
        if (map.NoNames) flags.Add(("NoNames", "player"));
        if (map.NoGroup) flags.Add(("NoGroup", "player"));
        if (map.NoPets) flags.Add(("NoPets", "player"));
        if (map.NoHero) flags.Add(("NoHero", "player"));
        if (map.NoIntelligentCreatures) flags.Add(("NoIntelligentCreatures", "player"));
        if (map.NoExperience) flags.Add(("NoExperience", "player"));
        if (map.RequiredGroup) flags.Add(("RequiredGroup", "player"));

        // Environment (green)
        if (map.Fire) flags.Add(("Fire", "env"));
        if (map.Lightning) flags.Add(("Lightning", "env"));
        if (map.FireWallLimit) flags.Add(("FireWallLimit", "env"));

        return flags;
    }

    static string LightName(byte light) => light switch
    {
        0 => "Normal",
        1 => "Dawn",
        2 => "Day",
        3 => "Evening",
        4 => "Night",
        _ => $"Unknown ({light})"
    };

    static string WeatherName(ushort weather)
    {
        if (weather == 0) return "None";
        var parts = new List<string>();
        if ((weather & 1) != 0) parts.Add("Fog");
        if ((weather & 2) != 0) parts.Add("RedEmber");
        if ((weather & 4) != 0) parts.Add("WhiteEmber");
        if ((weather & 8) != 0) parts.Add("YellowEmber");
        if ((weather & 16) != 0) parts.Add("FireParticle");
        if ((weather & 32) != 0) parts.Add("Snow");
        if ((weather & 64) != 0) parts.Add("Rain");
        if ((weather & 128) != 0) parts.Add("Leaves");
        if ((weather & 256) != 0) parts.Add("FireyLeaves");
        if ((weather & 512) != 0) parts.Add("PurpleLeaves");
        return parts.Count > 0 ? string.Join(", ", parts) : weather.ToString();
    }

    static string Esc(string s) => WebUtility.HtmlEncode(s ?? "");

    static string GetCss() => @"
*, *::before, *::after { box-sizing: border-box; }
body {
    background: #0d1117; color: #c9d1d9;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0; padding: 0 20px 40px;
    max-width: 1400px; margin: 0 auto;
}
h1 {
    color: #f0c040; text-align: center;
    margin: 24px 0 4px; font-size: 2em;
    text-shadow: 0 0 12px rgba(240,192,64,0.3);
}
.subtitle { text-align: center; color: #8b949e; margin: 0 0 16px; }
h3 { color: #f0c040; margin: 12px 0 8px; font-size: 0.95em; border-bottom: 1px solid #21262d; padding-bottom: 4px; }

/* Search */
.search-bar {
    position: sticky; top: 0; z-index: 100;
    background: #0d1117ee; backdrop-filter: blur(8px);
    padding: 12px 0; border-bottom: 2px solid #f0c040;
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.search-bar input[type=text] {
    flex: 1; min-width: 200px; padding: 8px 14px;
    background: #161b22; border: 1px solid #30363d; border-radius: 6px;
    color: #c9d1d9; font-size: 0.95em;
}
.search-bar input[type=text]:focus { border-color: #f0c040; outline: none; }
.filter-label { color: #8b949e; font-size: 0.85em; cursor: pointer; white-space: nowrap; }
.filter-label input { margin-right: 4px; }
.result-count { color: #8b949e; font-size: 0.85em; }

/* Stats bar */
.stats-bar {
    display: flex; flex-wrap: wrap; gap: 8px 20px;
    padding: 10px 0; margin-bottom: 8px;
    border-bottom: 1px solid #21262d;
}
.stat-item { color: #8b949e; font-size: 0.85em; }
.stat-item b { color: #f0c040; }

/* Map cards */
.map-card {
    background: #161b22; border: 1px solid #21262d; border-radius: 8px;
    margin-bottom: 6px; overflow: hidden;
    transition: border-color 0.2s;
}
.map-card:hover { border-color: #30363d; }
.map-card.highlight { border-color: #f0c040; }
.map-header {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; cursor: pointer; flex-wrap: wrap;
}
.map-header:hover { background: #1c2333; }
.map-index { color: #8b949e; font-size: 0.85em; min-width: 50px; }
.map-title { color: #e6edf3; font-weight: 600; min-width: 160px; }
.map-file { color: #6e7681; font-family: monospace; font-size: 0.85em; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
.badge {
    font-size: 0.72em; padding: 2px 7px; border-radius: 10px;
    font-weight: 500; white-space: nowrap;
}
.badge-start { background: #1a7f37; color: #aff5b4; }
.badge-npc { background: #1f6feb33; color: #58a6ff; }
.badge-portal { background: #8957e533; color: #d2a8ff; }
.badge-spawn { background: #da363333; color: #ff7b72; }
.badge-mine { background: #9e6a0033; color: #d29922; }
.badge-restrict { background: #f8514933; color: #ff7b72; }
.expand-icon { color: #484f58; font-size: 0.7em; margin-left: 8px; transition: transform 0.2s; }
.map-card.open .expand-icon { transform: rotate(180deg); }

/* Details */
.map-details { padding: 0 14px 14px; }
.detail-section { margin-bottom: 12px; }

/* Properties table */
.props-table { border-collapse: collapse; }
.props-table td { padding: 3px 12px 3px 0; font-size: 0.88em; }
.props-table td:first-child { color: #8b949e; font-weight: 500; min-width: 140px; }

/* Data tables */
.data-table { border-collapse: collapse; width: 100%; font-size: 0.85em; }
.data-table th {
    background: #0d1117; color: #f0c040; padding: 6px 8px;
    border: 1px solid #21262d; text-align: left; font-size: 0.9em;
}
.data-table td { padding: 4px 8px; border: 1px solid #21262d; }
.data-table tbody tr:nth-child(even) { background: #0d111766; }
.data-table tbody tr:hover { background: #1c2333; }
.npc-name { color: #58a6ff; font-weight: 500; }
.monster-name { color: #ff7b72; font-weight: 500; }
.dim { color: #6e7681; }
.data-table a { color: #d2a8ff; text-decoration: none; }
.data-table a:hover { text-decoration: underline; }

/* Flags */
.flag-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.flag {
    font-size: 0.78em; padding: 3px 8px; border-radius: 4px;
    font-weight: 500; border: 1px solid;
}
.flag-move { background: #f8514915; color: #ff7b72; border-color: #f8514933; }
.flag-combat { background: #d2922215; color: #e3b341; border-color: #d2922233; }
.flag-item { background: #9e6a0015; color: #d29922; border-color: #9e6a0033; }
.flag-mount { background: #1f6feb15; color: #58a6ff; border-color: #1f6feb33; }
.flag-player { background: #8957e515; color: #d2a8ff; border-color: #8957e533; }
.flag-env { background: #1a7f3715; color: #3fb950; border-color: #1a7f3733; }

footer {
    text-align: center; color: #484f58;
    padding: 24px 0; font-size: 0.8em;
}
";

    static string GetJs() => @"
function filterMaps() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const restrictedOnly = document.getElementById('filterRestricted').checked;
    const startOnly = document.getElementById('filterStartPoint').checked;
    const npcOnly = document.getElementById('filterNpcs').checked;
    const cards = document.querySelectorAll('.map-card');
    let visible = 0;
    cards.forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const file = (card.dataset.file || '').toLowerCase();
        const index = card.dataset.index || '';
        const matchesSearch = !query || name.includes(query) || file.includes(query) || index === query;
        const matchesRestricted = !restrictedOnly || card.dataset.restricted === '1';
        const matchesStart = !startOnly || card.dataset.startpoint === '1';
        const matchesNpc = !npcOnly || card.dataset.npcs === '1';
        const show = matchesSearch && matchesRestricted && matchesStart && matchesNpc;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    document.getElementById('resultCount').textContent = query || restrictedOnly || startOnly || npcOnly
        ? visible + ' / ' + cards.length + ' maps'
        : '';
}

function toggleDetails(header) {
    const card = header.parentElement;
    const details = card.querySelector('.map-details');
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : '';
    card.classList.toggle('open', !isOpen);
}

function scrollToMap(index) {
    const card = document.querySelector('.map-card[data-index=""' + index + '""]');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlight');
        // Open it
        const details = card.querySelector('.map-details');
        if (details.style.display === 'none') {
            details.style.display = '';
            card.classList.add('open');
        }
        setTimeout(() => card.classList.remove('highlight'), 2000);
    }
}
";

    #endregion

    static string FindRepoRoot()
    {
        string dir = Directory.GetCurrentDirectory();
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir, "Build")) &&
                Directory.Exists(Path.Combine(dir, "Shared")))
                return dir;
            dir = Path.GetDirectoryName(dir);
        }
        return Directory.GetCurrentDirectory();
    }
}
