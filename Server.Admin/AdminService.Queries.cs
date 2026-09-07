using Server.ContentPacks;
using Server.MirDatabase;
using Server.MirEnvir;
using Server.MirObjects;

namespace Server.Admin
{
    public sealed partial class AdminService
    {
        // ---------- queries ----------

        public OverviewModel GetOverview()
        {
            int connections;
            lock (envir.Connections) connections = envir.Connections.Count;

            return new OverviewModel
            {
                Running = envir.Running,
                UptimeSeconds = envir.Stopwatch.Elapsed.TotalSeconds,
                PackId = ContentPack.Current.Manifest.Id,
                PackVersion = ContentPack.Current.Manifest.Version,
                DatabaseVersion = Envir.LoadVersion,
                OnlinePlayers = envir.Players.Count,
                Connections = connections,
                Monsters = envir.MonsterCount,
                LoopMilliseconds = Envir.LastRunTime,
                MemoryBytes = Environment.WorkingSet
            };
        }

        public List<OnlinePlayerModel> GetOnlinePlayers()
        {
            var players = envir.Players.ToArray();
            var rows = new List<OnlinePlayerModel>(players.Length);
            foreach (var p in players)
            {
                if (p == null || p.Info == null) continue;
                var connection = p.Connection;
                rows.Add(new OnlinePlayerModel
                {
                    Name = p.Name,
                    AccountId = p.Account == null ? string.Empty : p.Account.AccountID,
                    Class = p.Class.ToString(),
                    Level = p.Level,
                    MapIndex = p.CurrentMap == null ? 0 : p.CurrentMap.Info.Index,
                    Map = MapName(p.CurrentMap == null ? null : p.CurrentMap.Info),
                    X = p.CurrentLocation.X,
                    Y = p.CurrentLocation.Y,
                    Ip = connection == null ? string.Empty : connection.IPAddress,
                    SessionSeconds = connection == null ? 0 : Math.Max(0, (envir.Time - connection.TimeConnected) / 1000)
                });
            }
            return rows.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }

        public List<AccountSummaryModel> SearchAccounts(string query, int limit = 200)
        {
            query = (query ?? string.Empty).Trim();
            var rows = new List<AccountSummaryModel>();
            if (limit <= 0) return rows;

            lock (Envir.AccountLock)
            {
                foreach (var account in envir.AccountList)
                {
                    if (query.Length > 0 && !Matches(account.AccountID, query)
                        && !account.Characters.Any(c => Matches(c.Name, query)))
                        continue;

                    rows.Add(new AccountSummaryModel
                    {
                        AccountId = account.AccountID,
                        CharacterCount = account.Characters.Count(c => !c.Deleted),
                        CreationDate = account.CreationDate,
                        LastDate = account.LastDate,
                        Admin = account.AdminAccount,
                        Banned = account.Banned,
                        Online = account.Connection != null && account.Connection.Connected
                    });
                    if (rows.Count >= limit) break;
                }
            }
            return rows;
        }

        public AccountDetailModel GetAccount(string accountId)
        {
            lock (Envir.AccountLock)
            {
                var account = envir.GetAccount(accountId);
                if (account == null) return null;

                var detail = new AccountDetailModel
                {
                    AccountId = account.AccountID,
                    Admin = account.AdminAccount,
                    Banned = account.Banned,
                    BanReason = account.BanReason,
                    Gold = account.Gold,
                    CreationDate = account.CreationDate,
                    LastDate = account.LastDate,
                    LastIp = account.LastIP,
                    Storage = ItemRows(account.Storage)
                };

                foreach (var character in account.Characters)
                {
                    detail.Characters.Add(new CharacterDetailModel
                    {
                        Name = character.Name,
                        Class = character.Class.ToString(),
                        Gender = character.Gender.ToString(),
                        Level = character.Level,
                        Online = character.Player != null,
                        Deleted = character.Deleted,
                        LastLoginDate = character.LastLoginDate,
                        Inventory = ItemRows(character.Inventory),
                        Equipment = ItemRows(character.Equipment)
                    });
                }
                return detail;
            }
        }

        public List<ItemInfoModel> SearchItems(string query, int limit = 300)
        {
            query = (query ?? string.Empty).Trim();
            return envir.ItemInfoList
                .Where(i => Matches(i.Name, query))
                .Take(limit)
                .Select(i => new ItemInfoModel
                {
                    Index = i.Index,
                    Name = i.Name,
                    Type = i.Type.ToString(),
                    Grade = i.Grade.ToString(),
                    RequiredType = i.RequiredType.ToString(),
                    RequiredAmount = i.RequiredAmount,
                    RequiredClass = i.RequiredClass.ToString(),
                    Price = i.Price,
                    StackSize = i.StackSize,
                    Durability = i.Durability
                })
                .ToList();
        }

        public List<MonsterInfoModel> SearchMonsters(string query, int limit = 300)
        {
            query = (query ?? string.Empty).Trim();
            return envir.MonsterInfoList
                .Where(m => Matches(m.Name, query))
                .Take(limit)
                .Select(m => new MonsterInfoModel
                {
                    Index = m.Index,
                    Name = m.Name,
                    Level = m.Level,
                    Experience = m.Experience,
                    AI = m.AI,
                    DropPath = string.IsNullOrEmpty(m.DropPath) ? m.Name : m.DropPath,
                    DropCount = m.Drops.Count
                })
                .ToList();
        }

        public List<MapInfoModel> SearchMaps(string query, int limit = 500)
        {
            query = (query ?? string.Empty).Trim();
            return envir.MapInfoList
                .Where(m => Matches(m.Title, query) || Matches(m.FileName, query))
                .Take(limit)
                .Select(m =>
                {
                    var live = envir.GetMap(m.Index);
                    return new MapInfoModel
                    {
                        Index = m.Index,
                        FileName = m.FileName,
                        Title = m.Title,
                        Players = live == null ? 0 : live.Players.Count,
                        Monsters = live == null ? 0 : live.MonsterCount
                    };
                })
                .ToList();
        }

        public List<NpcInfoModel> SearchNpcs(string query, int limit = 500)
        {
            query = (query ?? string.Empty).Trim();
            return envir.NPCInfoList
                .Where(n => Matches(n.Name, query) || Matches(n.FileName, query))
                .Take(limit)
                .Select(n => new NpcInfoModel
                {
                    Index = n.Index,
                    Name = n.Name,
                    FileName = n.FileName,
                    MapIndex = n.MapIndex,
                    MapTitle = MapName(envir.GetMapInfo(n.MapIndex)),
                    X = n.Location.X,
                    Y = n.Location.Y
                })
                .ToList();
        }

        public StatisticsModel GetStatistics()
        {
            AccountInfo[] accounts;
            CharacterInfo[] characters;
            lock (Envir.AccountLock)
            {
                accounts = envir.AccountList.ToArray();
                characters = envir.CharacterList.Where(c => !c.Deleted).ToArray();
            }

            var stats = new StatisticsModel
            {
                Accounts = accounts.Length,
                Characters = characters.Length,
                Online = envir.Players.Count,
                Runtime = GetOverview()
            };

            foreach (MirClass mirClass in Enum.GetValues(typeof(MirClass)))
                stats.ClassCounts[mirClass.ToString()] = characters.Count(c => c.Class == mirClass);

            foreach (var group in characters.GroupBy(c => (Math.Max(1, (int)c.Level) - 1) / 10).OrderBy(g => g.Key))
                stats.LevelBands[$"{group.Key * 10 + 1}-{group.Key * 10 + 10}"] = group.Count();

            var maps = envir.MapList.ToArray();
            stats.TopMapsByMonsters = maps.Where(m => m.MonsterCount > 0)
                .OrderByDescending(m => m.MonsterCount).Take(20)
                .Select(m => new MapCountModel { MapIndex = m.Info.Index, Map = MapName(m.Info), Count = m.MonsterCount }).ToList();
            stats.TopMapsByPlayers = maps.Where(m => m.Players.Count > 0)
                .OrderByDescending(m => m.Players.Count).Take(20)
                .Select(m => new MapCountModel { MapIndex = m.Info.Index, Map = MapName(m.Info), Count = m.Players.Count }).ToList();

            lock (Envir.AccountLock)
            {
                ulong gold = 0;
                int items = 0;
                foreach (var account in accounts)
                {
                    gold += account.Gold;
                    items += account.Storage.Count(i => i != null);
                    foreach (var character in account.Characters)
                    {
                        if (character.Deleted) continue;
                        items += character.Inventory.Count(i => i != null);
                        items += character.Equipment.Count(i => i != null);
                    }
                }
                stats.TotalGold = gold;
                stats.TotalItems = items;
                stats.TopGold = accounts.OrderByDescending(a => a.Gold).Take(10)
                    .Select(a => new GoldRowModel
                    {
                        AccountId = a.AccountID,
                        Characters = string.Join(", ", a.Characters.Where(c => !c.Deleted).Select(c => c.Name)),
                        Gold = a.Gold
                    }).ToList();
            }
            return stats;
        }
    }
}
