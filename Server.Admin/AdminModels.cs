namespace Server.Admin
{
    public sealed class OverviewModel
    {
        public bool Running { get; set; }
        public double UptimeSeconds { get; set; }
        public string PackId { get; set; }
        public string PackVersion { get; set; }
        public int DatabaseVersion { get; set; }
        public int OnlinePlayers { get; set; }
        public int Connections { get; set; }
        public int Monsters { get; set; }
        public long LoopMilliseconds { get; set; }
        public long MemoryBytes { get; set; }
    }

    public sealed class OnlinePlayerModel
    {
        public string Name { get; set; }
        public string AccountId { get; set; }
        public string Class { get; set; }
        public int Level { get; set; }
        public int MapIndex { get; set; }
        public string Map { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public string Ip { get; set; }
        public long SessionSeconds { get; set; }
    }

    public sealed class AccountSummaryModel
    {
        public string AccountId { get; set; }
        public int CharacterCount { get; set; }
        public DateTime CreationDate { get; set; }
        public DateTime LastDate { get; set; }
        public bool Admin { get; set; }
        public bool Banned { get; set; }
        public bool Online { get; set; }
    }

    public sealed class ItemRowModel
    {
        public int Slot { get; set; }
        public string Name { get; set; }
        public int Count { get; set; }
        public uint CurrentDura { get; set; }
        public uint MaxDura { get; set; }
    }

    public sealed class CharacterDetailModel
    {
        public string Name { get; set; }
        public string Class { get; set; }
        public string Gender { get; set; }
        public int Level { get; set; }
        public bool Online { get; set; }
        public bool Deleted { get; set; }
        public DateTime LastLoginDate { get; set; }
        public List<ItemRowModel> Inventory { get; set; } = new List<ItemRowModel>();
        public List<ItemRowModel> Equipment { get; set; } = new List<ItemRowModel>();
    }

    public sealed class AccountDetailModel
    {
        public string AccountId { get; set; }
        public bool Admin { get; set; }
        public bool Banned { get; set; }
        public string BanReason { get; set; }
        public uint Gold { get; set; }
        public DateTime CreationDate { get; set; }
        public DateTime LastDate { get; set; }
        public string LastIp { get; set; }
        public List<CharacterDetailModel> Characters { get; set; } = new List<CharacterDetailModel>();
        public List<ItemRowModel> Storage { get; set; } = new List<ItemRowModel>();
    }

    public sealed class ItemInfoModel
    {
        public int Index { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public string Grade { get; set; }
        public string RequiredType { get; set; }
        public int RequiredAmount { get; set; }
        public string RequiredClass { get; set; }
        public uint Price { get; set; }
        public int StackSize { get; set; }
        public int Durability { get; set; }
    }

    public sealed class MonsterInfoModel
    {
        public int Index { get; set; }
        public string Name { get; set; }
        public int Level { get; set; }
        public uint Experience { get; set; }
        public int AI { get; set; }
        public string DropPath { get; set; }
        public int DropCount { get; set; }
    }

    public sealed class MapInfoModel
    {
        public int Index { get; set; }
        public string FileName { get; set; }
        public string Title { get; set; }
        public int Players { get; set; }
        public int Monsters { get; set; }
    }

    public sealed class NpcInfoModel
    {
        public int Index { get; set; }
        public string Name { get; set; }
        public string FileName { get; set; }
        public int MapIndex { get; set; }
        public string MapTitle { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
    }

    public sealed class MapCountModel
    {
        public int MapIndex { get; set; }
        public string Map { get; set; }
        public int Count { get; set; }
    }

    public sealed class GoldRowModel
    {
        public string AccountId { get; set; }
        public string Characters { get; set; }
        public uint Gold { get; set; }
    }

    public sealed class StatisticsModel
    {
        public int Accounts { get; set; }
        public int Characters { get; set; }
        public int Online { get; set; }
        public Dictionary<string, int> ClassCounts { get; set; } = new Dictionary<string, int>();
        public Dictionary<string, int> LevelBands { get; set; } = new Dictionary<string, int>();
        public List<MapCountModel> TopMapsByMonsters { get; set; } = new List<MapCountModel>();
        public List<MapCountModel> TopMapsByPlayers { get; set; } = new List<MapCountModel>();
        public ulong TotalGold { get; set; }
        public int TotalItems { get; set; }
        public List<GoldRowModel> TopGold { get; set; } = new List<GoldRowModel>();
        public OverviewModel Runtime { get; set; }
    }
}
