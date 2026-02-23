public static class DbReader
{
    public static List<ItemInfo> ReadItemInfoList(string dbPath)
    {
        using var stream = File.OpenRead(dbPath);
        using var reader = new BinaryReader(stream);

        int version = reader.ReadInt32();
        int customVersion = reader.ReadInt32();

        Console.WriteLine($"  DB Version: {version}, CustomVersion: {customVersion}");

        // Skip indices
        reader.ReadInt32(); // MapIndex
        reader.ReadInt32(); // ItemIndex
        reader.ReadInt32(); // MonsterIndex
        reader.ReadInt32(); // NPCIndex
        reader.ReadInt32(); // QuestIndex

        if (version >= 63) reader.ReadInt32(); // GameshopIndex
        if (version >= 66) reader.ReadInt32(); // ConquestIndex
        if (version >= 68) reader.ReadInt32(); // RespawnIndex

        // Skip MapInfoList
        int count = reader.ReadInt32();
        Console.WriteLine($"  Skipping {count} MapInfo records...");
        for (int i = 0; i < count; i++)
            SkipMapInfo(reader, version);

        // Read ItemInfoList
        count = reader.ReadInt32();
        var items = new List<ItemInfo>(count);
        for (int i = 0; i < count; i++)
            items.Add(new ItemInfo(reader, version, customVersion));

        return items;
    }

    private static void SkipMapInfo(BinaryReader reader, int version)
    {
        reader.ReadInt32();  // Index
        reader.ReadString(); // FileName
        reader.ReadString(); // Title
        reader.ReadUInt16(); // MiniMap
        reader.ReadByte();   // Light
        reader.ReadUInt16(); // BigMap

        // SafeZones
        int count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            reader.ReadInt32(); reader.ReadInt32(); // Location
            reader.ReadUInt16(); // Size
            reader.ReadBoolean(); // StartPoint
        }

        // Respawns
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            reader.ReadInt32(); // MonsterIndex
            reader.ReadInt32(); reader.ReadInt32(); // Location
            reader.ReadUInt16(); // Count
            reader.ReadUInt16(); // Spread
            reader.ReadUInt16(); // Delay
            reader.ReadByte();   // Direction
            reader.ReadString(); // RoutePath
            if (version > 67)
            {
                reader.ReadUInt16(); // RandomDelay
                reader.ReadInt32();  // RespawnIndex
                reader.ReadBoolean(); // SaveRespawnTime
                reader.ReadUInt16(); // RespawnTicks
            }
        }

        // Movements
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            reader.ReadInt32(); // MapIndex
            reader.ReadInt32(); reader.ReadInt32(); // Source
            reader.ReadInt32(); reader.ReadInt32(); // Destination
            reader.ReadBoolean(); // NeedHole
            reader.ReadBoolean(); // NeedMove
            if (version >= 69) reader.ReadInt32(); // ConquestIndex
            if (version >= 95)
            {
                reader.ReadBoolean(); // ShowOnBigMap
                reader.ReadInt32();   // Icon
            }
        }

        // Map properties
        reader.ReadBoolean(); // NoTeleport
        reader.ReadBoolean(); // NoReconnect
        reader.ReadString();  // NoReconnectMap
        reader.ReadBoolean(); // NoRandom
        reader.ReadBoolean(); // NoEscape
        reader.ReadBoolean(); // NoRecall
        reader.ReadBoolean(); // NoDrug
        reader.ReadBoolean(); // NoPosition
        reader.ReadBoolean(); // NoThrowItem
        reader.ReadBoolean(); // NoDropPlayer
        reader.ReadBoolean(); // NoDropMonster
        reader.ReadBoolean(); // NoNames
        reader.ReadBoolean(); // Fight
        reader.ReadBoolean(); // Fire
        reader.ReadInt32();   // FireDamage
        reader.ReadBoolean(); // Lightning
        reader.ReadInt32();   // LightningDamage
        reader.ReadByte();    // MapDarkLight

        // MineZones
        count = reader.ReadInt32();
        for (int i = 0; i < count; i++)
        {
            reader.ReadInt32(); reader.ReadInt32(); // Location
            reader.ReadUInt16(); // Size
            reader.ReadByte();   // Mine
        }

        reader.ReadByte();    // MineIndex
        reader.ReadBoolean(); // NoMount
        reader.ReadBoolean(); // NeedBridle
        reader.ReadBoolean(); // NoFight
        reader.ReadUInt16();  // Music

        if (version >= 78) reader.ReadBoolean(); // NoTownTeleport
        if (version >= 79) reader.ReadBoolean(); // NoReincarnation
        if (version >= 110) reader.ReadUInt16(); // WeatherParticles
        if (version >= 111)
        {
            reader.ReadBoolean(); // GT
            reader.ReadByte();    // GTIndex
        }
        if (version >= 114)
        {
            reader.ReadBoolean(); // NoExperience
            reader.ReadBoolean(); // NoGroup
            reader.ReadBoolean(); // NoPets
            reader.ReadBoolean(); // NoIntelligentCreatures
            reader.ReadBoolean(); // NoHero
            reader.ReadInt32();   // RequiredGroupSize
            reader.ReadBoolean(); // RequiredGroup
            reader.ReadBoolean(); // FireWallLimit
            reader.ReadInt32();   // FireWallCount
        }
    }
}
