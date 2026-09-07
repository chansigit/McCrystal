# GM Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-based game master console served by the macOS server process, replacing the Windows-only `Server.MirForms` UI for daily operation.

**Architecture:** New `Server.Admin` class library hosts an ASP.NET Core minimal API inside `Server.Console`. `AdminService` reads engine state directly and posts every mutation to a new action queue that the engine main loop drains once per tick. A single static HTML page in `Server.Admin/AdminConsole/` calls the JSON routes.

**Tech Stack:** .NET 8, ASP.NET Core minimal API (framework reference, no NuGet), System.Text.Json, plain HTML/JS, existing `Tests/Regression` runner.

Spec: `docs/superpowers/specs/2026-09-07-gm-admin-console-design.md`

---

## Conventions for every task

- dotnet: `/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet` (call it `dotnet` below; put it on `PATH` first with `export PATH=/opt/homebrew/Cellar/dotnet@8/8.0.124/bin:$PATH`).
- Regression tests: `dotnet run --project Tests/Regression/Regression.csproj`. Prints `PASS`/`FAIL` per check and `N/N passed`. Add new checks to the `tests` array at the top of `Tests/Regression/Program.cs`.
- Commits: no `Co-Authored-By` trailers (user rule). Short imperative subject.
- `Nullable` is disabled in server projects. Do not use `?` on reference types or `!`.
- `ItemInfo` and `UserItem` live in the global namespace (`Shared/Data/ItemData.cs`). `Point` is `System.Drawing.Point`.
- `Envir` has a public constructor; tests build `new Envir()` and fill its lists. `Envir.Main` is the live instance.

## File structure

| File | Responsibility |
| --- | --- |
| `Server/MirEnvir/Envir.cs` (modify) | `AdminActions` queue and `ProcessAdminActions()` drained in the main loop |
| `Server/Settings.cs` (modify) | `[Admin]` section: `AdminEnabled`, `AdminPort`, `AdminPassword` |
| `Server.Admin/Server.Admin.csproj` (create) | Class library with ASP.NET Core framework reference |
| `Server.Admin/AdminActionRunner.cs` (create) | Post an action to the queue, wait with timeout, return result |
| `Server.Admin/LogBuffer.cs` (create) | Ring buffer of the last 2000 log lines with sequence numbers |
| `Server.Admin/AdminModels.cs` (create) | DTO records returned to the page |
| `Server.Admin/AdminService.cs` (create) | Queries and actions over an `Envir` |
| `Server.Admin/AdminConsole.cs` (create) | Start/stop the web host, auth, routes |
| `Server.Admin/AdminConsole/index.html` (create) | The page |
| `Server.Admin/AdminConsole/admin.js` (create) | Page logic |
| `Server.Console/Program.cs` (modify) | Start/stop console, feed the log buffer |
| `Server.Console/Server.Console.csproj` (modify) | Reference `Server.Admin` |
| `Tests/Regression/Regression.csproj` (modify) | Reference `Server.Admin` |
| `Tests/Regression/Program.cs` (modify) | New checks |
| `Tests/Regression/AdminChecks.cs` (create) | Admin check bodies |
| `Server.Admin/README.md` (create) | How to enable and use |

---

### Task 1: Engine action queue

**Files:**
- Modify: `Server/MirEnvir/Envir.cs` (fields near line 152, loop near line 2056)
- Modify: `Tests/Regression/Program.cs`
- Create: `Tests/Regression/AdminChecks.cs`

- [ ] **Step 1: Write the failing test**

Create `Tests/Regression/AdminChecks.cs`:

```csharp
using Server.MirEnvir;

static class AdminChecks
{
    static void Check(bool condition, string message = "Assertion failed")
    {
        if (!condition) throw new Exception(message);
    }

    public static void ActionQueueDrainsInOrder()
    {
        var envir = new Envir();
        var order = new List<int>();
        envir.AdminActions.Enqueue(() => order.Add(1));
        envir.AdminActions.Enqueue(() => throw new InvalidOperationException("boom"));
        envir.AdminActions.Enqueue(() => order.Add(3));

        envir.ProcessAdminActions();

        Check(order.SequenceEqual(new[] { 1, 3 }), "actions ran out of order or a failure stopped the queue");
        Check(envir.AdminActions.IsEmpty, "queue not drained");
    }
}
```

Register it in `Tests/Regression/Program.cs` by adding this line at the top of the `tests` array (before `"Content packs resolve gameplay separately from runtime state"`):

```csharp
    ("Admin action queue drains in order and survives failures", AdminChecks.ActionQueueDrainsInOrder),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: build error `'Envir' does not contain a definition for 'AdminActions'`.

- [ ] **Step 3: Add the queue to Envir**

In `Server/MirEnvir/Envir.cs`, directly after the line `public Dictionary<string, Timer> Timers = new Dictionary<string, Timer>();` (around line 155) add:

```csharp
        // Work posted by the admin console. Drained once per main loop tick so
        // mutations happen on the engine thread.
        public readonly ConcurrentQueue<Action> AdminActions = new ConcurrentQueue<Action>();

        public void ProcessAdminActions()
        {
            while (AdminActions.TryDequeue(out var action))
            {
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    MessageQueue.Enqueue(ex);
                }
            }
        }
```

`System.Collections.Concurrent` is already imported at the top of the file.

Then in the main loop, find (around line 2054):

```csharp
                    while (Running)
                    {
                        Time = Stopwatch.ElapsedMilliseconds;
```

and change it to:

```csharp
                    while (Running)
                    {
                        Time = Stopwatch.ElapsedMilliseconds;
                        ProcessAdminActions();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: `PASS Admin action queue drains in order and survives failures` and `20/20 passed`.

- [ ] **Step 5: Commit**

```bash
git add Server/MirEnvir/Envir.cs Tests/Regression/AdminChecks.cs Tests/Regression/Program.cs
git commit -m "Add engine action queue for admin work"
```

---

### Task 2: Admin settings

**Files:**
- Modify: `Server/Settings.cs` (fields near line 79, `Load()` near line 403, `Save()` near line 690)

- [ ] **Step 1: Add fields**

After the line `public static string HTTPTrustedIPAddress = "127.0.0.1";` add:

```csharp
        //Admin console
        public static bool AdminEnabled = true;
        public static int AdminPort = 5081;
        public static string AdminPassword = string.Empty;
```

- [ ] **Step 2: Load them**

In `Load()`, after `HTTPTrustedIPAddress = Reader.ReadString("Network", "HTTPTrustedIPAddress", HTTPTrustedIPAddress);` add:

```csharp
            //Admin console
            AdminEnabled = Reader.ReadBoolean("Admin", "Enabled", AdminEnabled);
            AdminPort = Reader.ReadInt32("Admin", "Port", AdminPort);
            AdminPassword = Reader.ReadString("Admin", "Password", AdminPassword);
```

- [ ] **Step 3: Save them**

In `Save()`, after `Reader.Write("Network", "HTTPTrustedIPAddress", HTTPTrustedIPAddress);` add:

```csharp
            //Admin console
            Reader.Write("Admin", "Enabled", AdminEnabled);
            Reader.Write("Admin", "Port", AdminPort);
            Reader.Write("Admin", "Password", AdminPassword);
```

- [ ] **Step 4: Build**

Run: `dotnet build Server/Server.Library.csproj`
Expected: `Build succeeded` (the pre-existing log4net vulnerability warning is fine).

- [ ] **Step 5: Commit**

```bash
git add Server/Settings.cs
git commit -m "Add admin console settings section"
```

---

### Task 3: Server.Admin project, action runner, log buffer

**Files:**
- Create: `Server.Admin/Server.Admin.csproj`
- Create: `Server.Admin/AdminActionRunner.cs`
- Create: `Server.Admin/LogBuffer.cs`
- Modify: `Tests/Regression/Regression.csproj`
- Modify: `Tests/Regression/AdminChecks.cs`, `Tests/Regression/Program.cs`
- Modify: `Legend of Mir.sln`

- [ ] **Step 1: Create the project**

`Server.Admin/Server.Admin.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Server.Admin</RootNamespace>
  </PropertyGroup>

  <PropertyGroup>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
    <AppendRuntimeIdentifierToOutputPath>false</AppendRuntimeIdentifierToOutputPath>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\Server\Server.Library.csproj" />
    <ProjectReference Include="..\Shared\Shared.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Content Include="AdminConsole\**">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
  </ItemGroup>

</Project>
```

Add it to the solution:

```bash
dotnet sln "Legend of Mir.sln" add Server.Admin/Server.Admin.csproj
```

- [ ] **Step 2: Write failing tests for the runner and buffer**

Append to `Tests/Regression/AdminChecks.cs` inside the class:

```csharp
    public static void ActionRunnerReturnsResult()
    {
        var envir = new Envir();
        var runner = new Server.Admin.AdminActionRunner(envir, TimeSpan.FromSeconds(2));

        var drain = new Thread(() =>
        {
            Thread.Sleep(50);
            envir.ProcessAdminActions();
        });
        drain.Start();
        var ok = runner.Run(() => "done");
        drain.Join();
        Check(ok.Ok && ok.Message == "done", "successful action not reported");

        drain = new Thread(() =>
        {
            Thread.Sleep(50);
            envir.ProcessAdminActions();
        });
        drain.Start();
        var failed = runner.Run(() => throw new Server.Admin.AdminException("no such player"));
        drain.Join();
        Check(!failed.Ok && failed.Message == "no such player", "failure message not reported");
    }

    public static void ActionRunnerTimesOut()
    {
        var envir = new Envir();
        var runner = new Server.Admin.AdminActionRunner(envir, TimeSpan.FromMilliseconds(100));
        var result = runner.Run(() => "never");
        Check(!result.Ok, "timeout reported as success");
        Check(result.Message.Contains("game loop"), "timeout message missing");
        envir.ProcessAdminActions(); // late execution must not throw
    }

    public static void LogBufferKeepsLastLines()
    {
        var buffer = new Server.Admin.LogBuffer(3);
        buffer.Append("server", "a");
        buffer.Append("server", "b");
        buffer.Append("chat", "c");
        buffer.Append("debug", "d");

        var all = buffer.After(0);
        Check(all.Count == 3, "capacity not enforced");
        Check(all[0].Text == "b" && all[2].Text == "d", "oldest line not evicted");
        Check(all[0].Sequence == 2 && all[2].Sequence == 4, "sequence numbers wrong");

        var tail = buffer.After(3);
        Check(tail.Count == 1 && tail[0].Kind == "debug", "After(sequence) wrong");
        Check(buffer.LastSequence == 4, "LastSequence wrong");
    }
```

Register in `Program.cs` (add after the Task 1 line):

```csharp
    ("Admin action runner reports success and failure", AdminChecks.ActionRunnerReturnsResult),
    ("Admin action runner times out without the game loop", AdminChecks.ActionRunnerTimesOut),
    ("Admin log buffer keeps the last lines", AdminChecks.LogBufferKeepsLastLines),
```

Add to `Tests/Regression/Regression.csproj` inside the existing `<ItemGroup>`:

```xml
    <ProjectReference Include="../../Server.Admin/Server.Admin.csproj" />
```

and add a new item group:

```xml
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: build error, `AdminActionRunner` not found.

- [ ] **Step 4: Implement the runner**

`Server.Admin/AdminActionRunner.cs`:

```csharp
using Server.MirEnvir;

namespace Server.Admin
{
    /// <summary>Thrown by admin actions for user-facing failures (unknown player, bad item name).</summary>
    public sealed class AdminException : Exception
    {
        public AdminException(string message) : base(message) { }
    }

    public sealed class AdminActionResult
    {
        public bool Ok { get; set; }
        public string Message { get; set; }
    }

    /// <summary>Posts work to the engine thread and waits for it to finish.</summary>
    public sealed class AdminActionRunner
    {
        private readonly Envir envir;
        private readonly TimeSpan timeout;

        public AdminActionRunner(Envir envir, TimeSpan? timeout = null)
        {
            this.envir = envir;
            this.timeout = timeout ?? TimeSpan.FromSeconds(5);
        }

        public AdminActionResult Run(Func<string> action)
        {
            var done = new ManualResetEventSlim(false);
            string message = null;
            Exception error = null;

            envir.AdminActions.Enqueue(() =>
            {
                try
                {
                    message = action();
                }
                catch (Exception ex)
                {
                    error = ex;
                }
                finally
                {
                    done.Set();
                }
            });

            if (!done.Wait(timeout))
                return new AdminActionResult { Ok = false, Message = "Timed out waiting for the game loop. Is the server running?" };

            if (error != null)
                return new AdminActionResult { Ok = false, Message = error.Message };

            return new AdminActionResult { Ok = true, Message = message ?? "OK" };
        }
    }
}
```

- [ ] **Step 5: Implement the log buffer**

`Server.Admin/LogBuffer.cs`:

```csharp
namespace Server.Admin
{
    public sealed class LogEntry
    {
        public long Sequence { get; set; }
        public string Kind { get; set; }
        public string Text { get; set; }
        public DateTime Time { get; set; }
    }

    /// <summary>Fixed-capacity ring of recent log lines shared by the terminal and the admin page.</summary>
    public sealed class LogBuffer
    {
        private readonly object gate = new object();
        private readonly LinkedList<LogEntry> entries = new LinkedList<LogEntry>();
        private readonly int capacity;
        private long lastSequence;

        public LogBuffer(int capacity = 2000)
        {
            this.capacity = capacity;
        }

        public long LastSequence
        {
            get { lock (gate) return lastSequence; }
        }

        public LogEntry Append(string kind, string text)
        {
            lock (gate)
            {
                var entry = new LogEntry
                {
                    Sequence = ++lastSequence,
                    Kind = kind,
                    Text = text.TrimEnd('\r', '\n'),
                    Time = DateTime.Now
                };
                entries.AddLast(entry);
                while (entries.Count > capacity) entries.RemoveFirst();
                return entry;
            }
        }

        /// <summary>Entries with a sequence greater than <paramref name="sequence"/>, oldest first.</summary>
        public List<LogEntry> After(long sequence)
        {
            lock (gate)
            {
                return entries.Where(e => e.Sequence > sequence).ToList();
            }
        }
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: `23/23 passed`.

- [ ] **Step 7: Commit**

```bash
git add Server.Admin "Legend of Mir.sln" Tests/Regression
git commit -m "Add Server.Admin action runner and log buffer"
```

---

### Task 4: AdminService read queries

**Files:**
- Create: `Server.Admin/AdminModels.cs`
- Create: `Server.Admin/AdminService.cs`
- Modify: `Tests/Regression/AdminChecks.cs`, `Tests/Regression/Program.cs`

- [ ] **Step 1: Write failing tests**

Append to `AdminChecks.cs`:

```csharp
    static Envir SampleEnvir()
    {
        var envir = new Envir();
        envir.ItemInfoList.Add(new ItemInfo { Index = 1, Name = "Wooden Sword", Type = ItemType.Weapon, StackSize = 1, Durability = 5000, Price = 100 });
        envir.ItemInfoList.Add(new ItemInfo { Index = 2, Name = "Gold Ore", Type = ItemType.Ore, StackSize = 20, Durability = 0 });
        envir.MonsterInfoList.Add(new Server.MirDatabase.MonsterInfo { Index = 1, Name = "Deer", Level = 3, Experience = 10, AI = 1, DropPath = "Deer" });
        envir.MapInfoList.Add(new Server.MirDatabase.MapInfo { Index = 1, FileName = "0", Title = "Bichon" });
        envir.NPCInfoList.Add(new Server.MirDatabase.NPCInfo { Index = 1, Name = "Blacksmith", FileName = "Blacksmith", MapIndex = 1, Location = new System.Drawing.Point(300, 600) });

        var admin = new Server.MirDatabase.AccountInfo { Index = 1, AccountID = "cocofly", AdminAccount = true, Gold = 5000, CreationDate = new DateTime(2026, 1, 1) };
        var warrior = new Server.MirDatabase.CharacterInfo { Index = 1, Name = "kzs", Class = MirClass.Warrior, Level = 27, AccountInfo = admin };
        warrior.Inventory[0] = new UserItem(envir.ItemInfoList[0]) { UniqueID = 1, Count = 1, CurrentDura = 4000, MaxDura = 5000 };
        warrior.Inventory[3] = new UserItem(envir.ItemInfoList[1]) { UniqueID = 2, Count = 7 };
        admin.Characters.Add(warrior);
        var wizard = new Server.MirDatabase.CharacterInfo { Index = 2, Name = "Merlin", Class = MirClass.Wizard, Level = 41, AccountInfo = admin };
        admin.Characters.Add(wizard);

        var other = new Server.MirDatabase.AccountInfo { Index = 2, AccountID = "guest", Gold = 12 };
        var deleted = new Server.MirDatabase.CharacterInfo { Index = 3, Name = "Ghost", Class = MirClass.Taoist, Level = 9, Deleted = true, AccountInfo = other };
        other.Characters.Add(deleted);

        envir.AccountList.Add(admin);
        envir.AccountList.Add(other);
        envir.CharacterList.Add(warrior);
        envir.CharacterList.Add(wizard);
        envir.CharacterList.Add(deleted);
        return envir;
    }

    public static void AccountSearchMatchesIdAndCharacter()
    {
        var service = new Server.Admin.AdminService(SampleEnvir());

        var byId = service.SearchAccounts("COCO");
        Check(byId.Count == 1 && byId[0].AccountId == "cocofly", "search by account id failed");
        Check(byId[0].Admin && byId[0].CharacterCount == 2, "account summary wrong");

        var byCharacter = service.SearchAccounts("merlin");
        Check(byCharacter.Count == 1 && byCharacter[0].AccountId == "cocofly", "search by character failed");

        Check(service.SearchAccounts("").Count == 2, "empty search must list all");
        Check(service.SearchAccounts("zzz").Count == 0, "unexpected match");
    }

    public static void AccountDetailListsInventory()
    {
        var service = new Server.Admin.AdminService(SampleEnvir());
        var detail = service.GetAccount("cocofly");
        Check(detail != null && detail.Gold == 5000, "account detail missing");
        Check(detail.Characters.Count == 2, "characters missing");
        var kzs = detail.Characters.First(c => c.Name == "kzs");
        Check(kzs.Inventory.Count == 2, "inventory should list only occupied slots");
        Check(kzs.Inventory[0].Slot == 0 && kzs.Inventory[0].Name == "Wooden Sword" && kzs.Inventory[0].CurrentDura == 4000, "item row wrong");
        Check(kzs.Inventory[1].Slot == 3 && kzs.Inventory[1].Count == 7, "stack row wrong");
        Check(service.GetAccount("nobody") == null, "unknown account should be null");
    }

    public static void DatabaseSearchFiltersByName()
    {
        var service = new Server.Admin.AdminService(SampleEnvir());
        Check(service.SearchItems("sword").Count == 1, "item search failed");
        Check(service.SearchItems("").Count == 2, "item list failed");
        Check(service.SearchMonsters("dee")[0].DropPath == "Deer", "monster search failed");
        Check(service.SearchMaps("bich")[0].Index == 1, "map search failed");
        var npc = service.SearchNpcs("black")[0];
        Check(npc.MapTitle == "Bichon" && npc.X == 300, "npc row wrong");
    }

    public static void StatisticsCountCharactersAndGold()
    {
        var service = new Server.Admin.AdminService(SampleEnvir());
        var stats = service.GetStatistics();
        Check(stats.Accounts == 2, "account count");
        Check(stats.Characters == 2, "deleted characters must be excluded");
        Check(stats.ClassCounts["Warrior"] == 1 && stats.ClassCounts["Wizard"] == 1, "class counts");
        Check(stats.LevelBands["21-30"] == 1 && stats.LevelBands["41-50"] == 1, "level bands");
        Check(stats.TotalGold == 5012, "total gold");
        Check(stats.TotalItems == 2, "total items");
        Check(stats.TopGold[0].AccountId == "cocofly" && stats.TopGold[0].Characters == "kzs, Merlin", "top gold");
    }

    public static void OverviewReportsPackAndCounts()
    {
        var service = new Server.Admin.AdminService(SampleEnvir());
        var overview = service.GetOverview();
        Check(overview.OnlinePlayers == 0 && overview.Running == false, "overview counts");
        Check(overview.UptimeSeconds >= 0 && overview.MemoryBytes > 0, "overview metrics");
        Check(!string.IsNullOrEmpty(overview.PackId), "pack id missing");
    }
```

Register in `Program.cs` after the Task 3 lines:

```csharp
    ("Admin account search matches id and character", AdminChecks.AccountSearchMatchesIdAndCharacter),
    ("Admin account detail lists inventory", AdminChecks.AccountDetailListsInventory),
    ("Admin database search filters by name", AdminChecks.DatabaseSearchFiltersByName),
    ("Admin statistics count characters and gold", AdminChecks.StatisticsCountCharactersAndGold),
    ("Admin overview reports pack and counts", AdminChecks.OverviewReportsPackAndCounts),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: build error, `AdminService` not found.

- [ ] **Step 3: Write the models**

`Server.Admin/AdminModels.cs`:

```csharp
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
```

- [ ] **Step 4: Write the service (queries only)**

`Server.Admin/AdminService.cs`:

```csharp
using System.Diagnostics;
using Server.ContentPacks;
using Server.MirDatabase;
using Server.MirEnvir;
using Server.MirObjects;

namespace Server.Admin
{
    /// <summary>Queries and actions over one <see cref="Envir"/>. Knows nothing about HTTP.</summary>
    public sealed class AdminService
    {
        private readonly Envir envir;
        private readonly AdminActionRunner runner;

        public AdminService(Envir envir, AdminActionRunner runner = null)
        {
            this.envir = envir;
            this.runner = runner ?? new AdminActionRunner(envir);
        }

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
            foreach (var account in envir.AccountList.ToArray())
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
            return rows;
        }

        public AccountDetailModel GetAccount(string accountId)
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

        public List<ItemInfoModel> SearchItems(string query, int limit = 300)
        {
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
            var accounts = envir.AccountList.ToArray();
            var characters = envir.CharacterList.Where(c => !c.Deleted).ToArray();
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
            return stats;
        }

        // ---------- helpers ----------

        private static bool Matches(string value, string query)
        {
            if (string.IsNullOrEmpty(query)) return true;
            return value != null && value.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        private static string MapName(MapInfo info)
        {
            if (info == null) return string.Empty;
            return string.IsNullOrEmpty(info.Title) ? info.FileName : info.Title;
        }

        private static List<ItemRowModel> ItemRows(UserItem[] items)
        {
            var rows = new List<ItemRowModel>();
            if (items == null) return rows;
            for (int i = 0; i < items.Length; i++)
            {
                var item = items[i];
                if (item == null) continue;
                rows.Add(new ItemRowModel
                {
                    Slot = i,
                    Name = item.Info == null ? $"#{item.ItemIndex}" : item.Info.Name,
                    Count = item.Count,
                    CurrentDura = item.CurrentDura,
                    MaxDura = item.MaxDura
                });
            }
            return rows;
        }
    }
}
```

Note: `UserItem.ItemIndex` exists in `Shared/Data/ItemData.cs`; if the build says otherwise, use `item.Info.Name` guarded by null and `"?"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: `28/28 passed`. If `StatisticsCountCharactersAndGold` fails on `TopGold[0].Characters`, confirm the sample's character order (`kzs`, `Merlin`) matches `account.Characters` insertion order.

- [ ] **Step 6: Commit**

```bash
git add Server.Admin Tests/Regression
git commit -m "Add admin service queries"
```

---

### Task 5: AdminService actions

**Files:**
- Modify: `Server.Admin/AdminService.cs`, split into `AdminService.cs` / `AdminService.Queries.cs` / `AdminService.Actions.cs` (partial class)
- Modify: `Tests/Regression/AdminChecks.cs`, `Tests/Regression/Program.cs`
- Modify: `Server/MirEnvir/Envir.cs` (adds `BeginSaveAll()`, next to `BeginSaveAccounts()`) — an allowed, narrow exception to "don't touch `Server/`", needed so the console can trigger the engine's own periodic save instead of a blocking one
- Modify: `Server/Server.Library.csproj` (adds `InternalsVisibleTo` for the `Regression` test assembly, so the tests can call `Server.Utils.Crypto.HashPassword` directly instead of re-implementing it)

Online-player actions need a live `PlayerObject` with a connection, which the tests cannot build. Tests cover the offline actions (password, admin flag) and the "unknown player" path, which is the argument validation every online action shares.

A code review after the first pass of this task found three real engine-interaction bugs (not just transcription slips), fixed below: `SetLevel` could spin a character's level to 65535 or immediately re-level them back down; `SaveNow` blocked the whole game loop and rewrote static gameplay data the console never edits; and GM-given items weren't marked `GMMade` for traceability. `SetAdmin`'s message was also corrected to note that revoking a connected GM's admin flag only takes effect at their next login (`IsGM` is read once, at `PlayerObject` construction).

- [ ] **Step 0: Split the file**

Before adding ~180 lines of actions to an already ~290-line file, split `AdminService.cs` into partial classes:
- `AdminService.cs` keeps the class declaration (`public sealed partial class AdminService`), the two fields, the constructor, and the private helpers `Matches`, `MapName`, `ItemRows`.
- `AdminService.Queries.cs` holds the existing query methods (`GetOverview`, `GetOnlinePlayers`, `SearchAccounts`, `GetAccount`, `SearchItems`, `SearchMonsters`, `SearchMaps`, `SearchNpcs`, `GetStatistics`), moved verbatim.
- `AdminService.Actions.cs` holds the new actions (Step 3 below).

Run the suite and confirm it is still green before adding anything.

- [ ] **Step 1: Write failing tests**

Append to `AdminChecks.cs` (no `using System.Security.Cryptography;`/`using System.Text;` needed — the test calls `Server.Utils.Crypto.HashPassword` directly via the `InternalsVisibleTo` added in Step 3a):

```csharp
    static Server.Admin.AdminService ServiceWithLoop(Envir envir, out Thread loop, out CancellationTokenSource stop)
    {
        stop = new CancellationTokenSource();
        var token = stop.Token;
        loop = new Thread(() =>
        {
            while (!token.IsCancellationRequested)
            {
                envir.ProcessAdminActions();
                Thread.Sleep(5);
            }
        }) { IsBackground = true }; // never blocks process exit if a caller forgets to Join()
        loop.Start();
        return new Server.Admin.AdminService(envir, new Server.Admin.AdminActionRunner(envir, TimeSpan.FromSeconds(2)));
    }

    public static void ResetPasswordRehashes()
    {
        var envir = SampleEnvir();
        var service = ServiceWithLoop(envir, out var loop, out var stop);
        try
        {
            var account = envir.GetAccount("cocofly");
            var saltBefore = account.Salt;
            var passwordBefore = account.Password;

            var result = service.ResetPassword("cocofly", "newSecret1");
            Check(result.Ok, result.Message);
            Check(account.Password == Server.Utils.Crypto.HashPassword("newSecret1", account.Salt), "password not rehashed with account salt");
            Check(account.Salt != saltBefore, "salt must be regenerated on reset");
            Check(account.Password != passwordBefore, "stored value must change on reset");
            Check(account.Password != "newSecret1", "plaintext must not be stored");

            // The setter regenerates the salt every time, so even resetting to the same
            // password must change the stored value — the hash comparison alone can't show this.
            var saltAfterFirstReset = account.Salt;
            var passwordAfterFirstReset = account.Password;
            Check(service.ResetPassword("cocofly", "newSecret1").Ok, "second reset of same password should succeed");
            Check(account.Salt != saltAfterFirstReset, "salt must be regenerated on every reset");
            Check(account.Password != passwordAfterFirstReset, "resetting to the same password must still change the stored value (fresh salt)");

            Check(!service.ResetPassword("nobody", "x").Ok, "unknown account must fail");
            Check(!service.ResetPassword("cocofly", "").Ok, "empty password must fail");
        }
        finally { stop.Cancel(); loop.Join(); stop.Dispose(); }
    }

    public static void ToggleAdminFlag()
    {
        var envir = SampleEnvir();
        var service = ServiceWithLoop(envir, out var loop, out var stop);
        try
        {
            Check(service.SetAdmin("guest", true).Ok, "set admin failed");
            Check(envir.GetAccount("guest").AdminAccount, "flag not set");
            Check(service.SetAdmin("guest", false).Ok, "clear admin failed");
            Check(!envir.GetAccount("guest").AdminAccount, "flag not cleared");
            Check(!service.SetAdmin("nobody", true).Ok, "unknown account must fail");
        }
        finally { stop.Cancel(); loop.Join(); stop.Dispose(); }
    }

    public static void OnlineActionsRejectUnknownPlayer()
    {
        var envir = SampleEnvir();
        var service = ServiceWithLoop(envir, out var loop, out var stop);
        try
        {
            Check(service.GiveItem("nobody", "Wooden Sword", 1).Message.Contains("not online"), "give item");
            Check(service.GiveGold("nobody", 10).Message.Contains("not online"), "give gold");
            Check(service.Teleport("nobody", 1, null, null).Message.Contains("not online"), "teleport");
            // Settings.ExperienceList is empty in the test process, so the level bound
            // collapses to [1, 1]; use a level within that bound to reach the online check.
            Check(service.SetLevel("nobody", 1).Message.Contains("not online"), "set level");
            Check(service.Kick("nobody").Message.Contains("not online"), "kick");
            Check(service.Whisper("nobody", "hi").Message.Contains("not online"), "whisper");
            // Assert the actual rejection reason, not just !Ok — otherwise these would still
            // pass if the player lookup ran first and failed with "not online" instead.
            Check(service.SetLevel("kzs", 0).Message.Contains("Level must be"), "level 0 must be rejected for the argument, not the lookup");
            Check(service.GiveGold("kzs", 0).Message.Contains("positive"), "zero gold must be rejected for the argument, not the lookup");
            Check(service.Whisper("kzs", "  ").Message.Contains("empty"), "empty whisper must be rejected for the argument, not the lookup");
            Check(service.Broadcast(" ").Message.Contains("empty"), "empty broadcast must be rejected for the argument, not the lookup");
        }
        finally { stop.Cancel(); loop.Join(); stop.Dispose(); }
    }
```

Register in `Program.cs` after the Task 4 lines:

```csharp
    ("Admin password reset rehashes with the account salt", AdminChecks.ResetPasswordRehashes),
    ("Admin toggles the account admin flag", AdminChecks.ToggleAdminFlag),
    ("Admin online actions reject unknown players", AdminChecks.OnlineActionsRejectUnknownPlayer),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: build error, `ResetPassword` not found.

- [ ] **Step 3a: Let the tests see `Crypto`, and give the console an async save path**

`Server.Utils.Crypto` has no access modifier (defaults to `internal`), so `Server.Utils.Crypto.HashPassword` isn't visible from the `Regression` test assembly across the `ProjectReference` boundary. Add to `Server/Server.Library.csproj` (next to the existing `ProjectReference` item group):

```xml
  <ItemGroup>
    <InternalsVisibleTo Include="Regression" />
  </ItemGroup>
```

Separately, `SaveNow` must not call `Envir.SaveAccounts()` directly (it opens with `while (Saving) Thread.Sleep(1)`, which blocks the whole game loop until the periodic async save finishes) or `Envir.SaveDB()` (a bare `File.Create` rewrite of static gameplay data the console never edits). Instead, add a method that starts the same save the work loop performs periodically. In `Server/MirEnvir/Envir.cs`, next to `BeginSaveAccounts()`:

```csharp
        /// <summary>Starts the same save the work loop performs periodically. False when one is already running.</summary>
        public bool BeginSaveAll()
        {
            if (Saving) return false;

            BeginSaveAccounts();
            SaveGuilds(true);
            SaveGoods(true);
            SaveConquests(true);
            return true;
        }
```

- [ ] **Step 3b: Add the actions**

Create `AdminService.Actions.cs` (`public sealed partial class AdminService`) with `using System.Drawing;`, `using Server.MirDatabase;`, `using Server.MirEnvir;`, `using Server.MirObjects;`, `using S = ServerPackets;`:

```csharp
        // ---------- actions (run on the engine thread) ----------

        public AdminActionResult GiveItem(string playerName, string itemName, int count)
        {
            return runner.Run(() =>
            {
                var player = OnlinePlayer(playerName);
                var info = envir.GetItemInfo((itemName ?? string.Empty).Replace(" ", ""));
                if (info == null) throw new AdminException($"No item named '{itemName}'.");

                var item = envir.CreateFreshItem(info);
                item.Count = (ushort)Math.Clamp(count, 1, Math.Max(1, (int)info.StackSize));
                item.GMMade = true; // matches @MAKE (PlayerObject.cs:2391) so console-created items stay traceable
                if (!player.CanGainItem(item)) throw new AdminException($"{player.Name} cannot carry {item.Count} x {info.Name}.");

                player.GainItem(item);
                return Log($"gave {player.Name} {item.Count} x {info.Name}");
            });
        }

        public AdminActionResult GiveGold(string playerName, uint amount)
        {
            return runner.Run(() =>
            {
                if (amount == 0) throw new AdminException("Amount must be positive.");
                var player = OnlinePlayer(playerName);
                player.GainGold(amount);
                return Log($"gave {player.Name} {amount} gold");
            });
        }

        public AdminActionResult Teleport(string playerName, int mapIndex, int? x, int? y)
        {
            return runner.Run(() =>
            {
                var player = OnlinePlayer(playerName);
                var map = envir.GetMap(mapIndex);
                if (map == null) throw new AdminException($"Map {mapIndex} is not loaded.");

                bool moved;
                if (x.HasValue && y.HasValue)
                {
                    var point = new Point(x.Value, y.Value);
                    if (!map.ValidPoint(point)) throw new AdminException($"({x}, {y}) is not walkable on {MapName(map.Info)}.");
                    moved = player.Teleport(map, point);
                }
                else
                {
                    moved = player.TeleportRandom(200, 0, map);
                }
                if (!moved) throw new AdminException("Teleport was refused by the engine.");
                return Log($"teleported {player.Name} to {MapName(map.Info)} {player.CurrentLocation.X},{player.CurrentLocation.Y}");
            });
        }

        public AdminActionResult SetLevel(string playerName, int level)
        {
            return runner.Run(() =>
            {
                // Above the configured curve MaxExperience is 0, which makes GainExp's
                // level-up loop spin to 65535 on the next kill (PlayerObject.cs:905-919).
                var max = Math.Max(1, Settings.ExperienceList.Count);
                if (level < 1 || level > max) throw new AdminException($"Level must be between 1 and {max}.");
                var player = OnlinePlayer(playerName);
                var old = player.Level;
                player.Level = (ushort)level;
                if (level < old) player.Experience = 0; // stale exp would re-level them immediately
                player.LevelUp();
                return Log($"changed {player.Name} level {old} -> {player.Level}");
            });
        }

        public AdminActionResult Kick(string playerName)
        {
            return runner.Run(() =>
            {
                var player = OnlinePlayer(playerName);
                if (player.Connection == null) throw new AdminException($"{player.Name} has no connection.");
                player.Connection.SendDisconnect(4); // client shows "kicked by admin"
                return Log($"kicked {player.Name}");
            });
        }

        public AdminActionResult Whisper(string playerName, string message)
        {
            return runner.Run(() =>
            {
                if (string.IsNullOrWhiteSpace(message)) throw new AdminException("Message is empty.");
                var player = OnlinePlayer(playerName);
                player.ReceiveChat("[Admin] " + message.Trim(), ChatType.WhisperIn);
                return Log($"whispered {player.Name}: {message.Trim()}");
            });
        }

        public AdminActionResult Broadcast(string message)
        {
            return runner.Run(() =>
            {
                if (string.IsNullOrWhiteSpace(message)) throw new AdminException("Message is empty.");
                envir.Broadcast(new S.Chat { Message = message.Trim(), Type = ChatType.Announcement });
                return Log($"broadcast: {message.Trim()}");
            });
        }

        public AdminActionResult ResetPassword(string accountId, string newPassword)
        {
            return runner.Run(() =>
            {
                if (string.IsNullOrEmpty(newPassword)) throw new AdminException("Password is empty.");
                var account = Account(accountId);
                account.Password = newPassword;
                account.WrongPasswordCount = 0;
                account.RequirePasswordChange = false;
                return Log($"reset password for {account.AccountID}");
            });
        }

        public AdminActionResult SetAdmin(string accountId, bool admin)
        {
            return runner.Run(() =>
            {
                var account = Account(accountId);
                account.AdminAccount = admin;
                return Log($"{(admin ? "granted" : "revoked")} admin on {account.AccountID} (takes effect at next login)");
            });
        }

        public AdminActionResult SaveNow()
        {
            return runner.Run(() =>
            {
                // Async, like the engine's own periodic save. A synchronous SaveAccounts()
                // blocks the game loop, and SaveDB() rewrites static data the console never edits.
                if (!envir.BeginSaveAll()) throw new AdminException("A save is already in progress.");
                return Log("started a save of accounts, guilds, goods and conquests");
            });
        }

        public AdminActionResult ReloadDrops()
        {
            return runner.Run(() =>
            {
                envir.ReloadDrops();
                return Log("reloaded drop tables");
            });
        }

        public AdminActionResult ReloadNpcs()
        {
            return runner.Run(() =>
            {
                envir.ReloadNPCs();
                return Log("reloaded NPC scripts");
            });
        }

        private PlayerObject OnlinePlayer(string name)
        {
            var player = envir.GetPlayer(name ?? string.Empty);
            if (player == null) throw new AdminException($"'{name}' is not online.");
            return player;
        }

        private AccountInfo Account(string accountId)
        {
            var account = envir.GetAccount(accountId ?? string.Empty);
            if (account == null) throw new AdminException($"No account '{accountId}'.");
            return account;
        }

        private static string Log(string message)
        {
            MessageQueue.Instance.Enqueue("[Admin] " + message);
            return message;
        }
```

`Settings` and `MessageQueue` resolve unqualified because `Server.Admin` nests under the `Server` namespace.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: `33/33 passed`.

If `envir.GetAccount` is case-sensitive and the test fails on `"cocofly"`, that is fine: the sample uses the exact id.

- [ ] **Step 5: Commit**

```bash
git add Server.Admin Tests/Regression
git commit -m "Add admin service actions"
```

---

### Task 6: HTTP host with authentication

**Files:**
- Create: `Server.Admin/AdminConsole.cs`
- Modify: `Tests/Regression/AdminChecks.cs`, `Tests/Regression/Program.cs`

- [ ] **Step 1: Write the failing HTTP test**

Append to `AdminChecks.cs`:

```csharp
    public static void HttpRequiresLogin()
    {
        var envir = SampleEnvir();
        var console = new Server.Admin.AdminConsole(envir, "hunter2", port: 0);
        console.Start();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(console.BaseUrl) };

            var anonymous = client.GetAsync("/api/overview").Result;
            Check(anonymous.StatusCode == System.Net.HttpStatusCode.Unauthorized, "anonymous request must be 401");

            var wrong = client.PostAsync("/api/login", new StringContent("{\"password\":\"nope\"}", System.Text.Encoding.UTF8, "application/json")).Result;
            Check(wrong.StatusCode == System.Net.HttpStatusCode.Unauthorized, "wrong password must be 401");

            var login = client.PostAsync("/api/login", new StringContent("{\"password\":\"hunter2\"}", System.Text.Encoding.UTF8, "application/json")).Result;
            Check(login.IsSuccessStatusCode, "login failed");
            var cookie = login.Headers.GetValues("Set-Cookie").First().Split(';')[0];

            var request = new HttpRequestMessage(HttpMethod.Get, "/api/overview");
            request.Headers.Add("Cookie", cookie);
            var authorized = client.SendAsync(request).Result;
            Check(authorized.IsSuccessStatusCode, "cookie request failed");
            Check(authorized.Content.ReadAsStringAsync().Result.Contains("\"packId\""), "overview json missing");

            var page = client.GetAsync("/").Result;
            Check(page.IsSuccessStatusCode, "index page must be public");
        }
        finally { console.Stop(); }
    }
```

Register in `Program.cs` after the Task 5 lines:

```csharp
    ("Admin HTTP requires login", AdminChecks.HttpRequiresLogin),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: build error, `AdminConsole` not found.

- [ ] **Step 3: Implement the host**

**Auth hardening (post-review, 2026-09-07):** the version below already includes a fix for
a confirmed authentication bypass found after the initial implementation. The original guard
compared the path with `StringComparison.Ordinal` (`path.StartsWith("/api/", ...) && path !=
"/api/login"`), but ASP.NET Core routing matches paths case-insensitively, so a request to
`/API/overview` (or `/Api/Overview`, or the percent-encoded `/%41PI/overview`) skipped the
guard entirely and reached every query and all twelve actions - including password reset and
granting GM - with no cookie. A related gap: four actions (`kick`, `server/save`,
`server/reload-drops`, `server/reload-npcs`) take no request body, so they accept any content
type and were reachable by a plain cross-origin form POST once the casing trick removed the
cookie requirement. The fix below is segment-aware and case-insensitive
(`StartsWithSegments("/api", OrdinalIgnoreCase, ...)`), checks the session cookie first with a
constant-time comparison (`TokenMatches`, via `CryptographicOperations.FixedTimeEquals`) so a
fully anonymous request gets a plain 401, and then - only for state-changing methods, since a
cross-origin request cannot set a custom header without a CORS preflight and none is
configured - requires an `X-Admin-Console: 1` header, returning 403 if it's a request with a
valid cookie but no header (the actual cross-site-form-post case). `/api/login` is excluded
from both checks so it keeps working before any cookie exists. See also: the environment is
now pinned to `Production` (the host used to inherit `ASPNETCORE_ENVIRONMENT` from the calling
shell, so `Development` would leak a stack trace via the developer exception page), an
`UseExceptionHandler` logs unhandled errors to `MessageQueue.Instance` instead of losing them
silently under `ClearProviders()`, and `/api/logs/stream` links its cancellation token to
`IHostApplicationLifetime.ApplicationStopping` so an open browser tab doesn't make host
shutdown wait out the full 2s timeout.

`Server.Admin/AdminConsole.cs`:

```csharp
using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Server.MirEnvir;

namespace Server.Admin
{
    public sealed class AdminConsole
    {
        public static readonly LogBuffer Logs = new LogBuffer();

        private const string CookieName = "mc_admin";
        private readonly Envir envir;
        private readonly string password;
        private readonly int port;
        private readonly string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        private WebApplication app;

        public string BaseUrl { get; private set; }

        public AdminConsole(Envir envir, string password, int port)
        {
            this.envir = envir;
            this.password = password;
            this.port = port;
        }

        public void Start()
        {
            var service = new AdminService(envir);
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                ContentRootPath = AppContext.BaseDirectory,
                EnvironmentName = Environments.Production,
            });
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
            app = builder.Build();

            app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
            {
                var error = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
                if (error != null && error.Error != null) MessageQueue.Instance.Enqueue(error.Error);
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsJsonAsync(new { error = "Internal error; see server log." });
            }));

            // Static page from the copied AdminConsole folder next to the binaries.
            var pageRoot = Path.Combine(AppContext.BaseDirectory, "AdminConsole");
            if (Directory.Exists(pageRoot))
            {
                var files = new PhysicalFileProvider(pageRoot);
                app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
                app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
            }
            else
            {
                app.MapGet("/", () => Results.Text("Admin console page files are missing (AdminConsole/index.html).", "text/plain"));
            }

            app.Use(async (context, next) =>
            {
                // Routing matches paths case-insensitively, so this guard must too.
                if (context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase, out var rest)
                    && !rest.Equals("/login", StringComparison.OrdinalIgnoreCase))
                {
                    if (!context.Request.Cookies.TryGetValue(CookieName, out var cookie) || !TokenMatches(cookie, token))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsJsonAsync(new { error = "login required" });
                        return;
                    }

                    // CSRF guard: a browser cannot set a custom header on a cross-origin request
                    // without a CORS preflight, and no CORS policy is configured, so the preflight
                    // fails. Only state-changing methods need it - GET and HEAD are exempt because
                    // EventSource cannot set headers, and they are guarded by SameSite cookies plus
                    // having no side effects.
                    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)
                        && context.Request.Headers["X-Admin-Console"] != "1")
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        await context.Response.WriteAsJsonAsync(new { error = "missing X-Admin-Console header" });
                        return;
                    }
                }
                await next();
            });

            app.MapPost("/api/login", (LoginRequest body, HttpContext context) =>
            {
                if (body == null || body.Password != password)
                    return Results.Json(new { error = "wrong password" }, statusCode: StatusCodes.Status401Unauthorized);
                context.Response.Cookies.Append(CookieName, token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict });
                return Results.Ok(new { ok = true });
            });
            app.MapPost("/api/logout", (HttpContext context) =>
            {
                context.Response.Cookies.Delete(CookieName);
                return Results.Ok(new { ok = true });
            });

            app.MapGet("/api/overview", () => service.GetOverview());
            app.MapGet("/api/players", () => service.GetOnlinePlayers());
            app.MapGet("/api/accounts", (string q) => service.SearchAccounts(q));
            app.MapGet("/api/accounts/{id}", (string id) =>
            {
                var detail = service.GetAccount(id);
                return detail == null ? Results.NotFound(new { error = "no such account" }) : Results.Ok(detail);
            });
            app.MapGet("/api/db/items", (string q) => service.SearchItems(q));
            app.MapGet("/api/db/monsters", (string q) => service.SearchMonsters(q));
            app.MapGet("/api/db/maps", (string q) => service.SearchMaps(q));
            app.MapGet("/api/db/npcs", (string q) => service.SearchNpcs(q));
            app.MapGet("/api/stats", () => service.GetStatistics());

            app.MapGet("/api/logs", (long? after) => Logs.After(after ?? 0));
            app.MapGet("/api/logs/stream", async (HttpContext context, IHostApplicationLifetime lifetime, long? after) =>
            {
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, lifetime.ApplicationStopping);
                var cancellation = linked.Token;
                context.Response.Headers.ContentType = "text/event-stream";
                context.Response.Headers.CacheControl = "no-cache";
                long cursor = after ?? Math.Max(0, Logs.LastSequence - 200);
                try
                {
                    while (!cancellation.IsCancellationRequested)
                    {
                        foreach (var entry in Logs.After(cursor))
                        {
                            cursor = entry.Sequence;
                            await context.Response.WriteAsync($"data: {System.Text.Json.JsonSerializer.Serialize(entry, JsonOptions)}\n\n", cancellation);
                        }
                        await context.Response.Body.FlushAsync(cancellation);
                        await Task.Delay(500, cancellation);
                    }
                }
                catch (OperationCanceledException) { } // client left or the host is stopping
            });

            app.MapPost("/api/players/{name}/give-item", (string name, GiveItemRequest body) => Result(service.GiveItem(name, body.Item, body.Count)));
            app.MapPost("/api/players/{name}/give-gold", (string name, GiveGoldRequest body) => Result(service.GiveGold(name, body.Amount)));
            app.MapPost("/api/players/{name}/teleport", (string name, TeleportRequest body) => Result(service.Teleport(name, body.MapIndex, body.X, body.Y)));
            app.MapPost("/api/players/{name}/level", (string name, LevelRequest body) => Result(service.SetLevel(name, body.Level)));
            app.MapPost("/api/players/{name}/kick", (string name) => Result(service.Kick(name)));
            app.MapPost("/api/players/{name}/whisper", (string name, MessageRequest body) => Result(service.Whisper(name, body.Message)));
            app.MapPost("/api/accounts/{id}/password", (string id, PasswordRequest body) => Result(service.ResetPassword(id, body.Password)));
            app.MapPost("/api/accounts/{id}/admin", (string id, AdminRequest body) => Result(service.SetAdmin(id, body.Admin)));
            app.MapPost("/api/server/broadcast", (MessageRequest body) => Result(service.Broadcast(body.Message)));
            app.MapPost("/api/server/save", () => Result(service.SaveNow()));
            app.MapPost("/api/server/reload-drops", () => Result(service.ReloadDrops()));
            app.MapPost("/api/server/reload-npcs", () => Result(service.ReloadNpcs()));

            app.Start();
            BaseUrl = app.Urls.First();
        }

        public void Stop()
        {
            if (app == null) return;
            app.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
            app.DisposeAsync().AsTask().GetAwaiter().GetResult();
            app = null;
        }

        private static readonly System.Text.Json.JsonSerializerOptions JsonOptions =
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);

        private static bool TokenMatches(string candidate, string expected)
        {
            if (candidate == null || expected == null) return false;
            return CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.ASCII.GetBytes(candidate),
                System.Text.Encoding.ASCII.GetBytes(expected));
        }

        private static IResult Result(AdminActionResult result)
        {
            return result.Ok
                ? Results.Ok(new { ok = true, message = result.Message })
                : Results.BadRequest(new { ok = false, error = result.Message });
        }

        public sealed class LoginRequest { public string Password { get; set; } }
        public sealed class GiveItemRequest { public string Item { get; set; } public int Count { get; set; } = 1; }
        public sealed class GiveGoldRequest { public uint Amount { get; set; } }
        public sealed class TeleportRequest { public int MapIndex { get; set; } public int? X { get; set; } public int? Y { get; set; } }
        public sealed class LevelRequest { public int Level { get; set; } }
        public sealed class MessageRequest { public string Message { get; set; } }
        public sealed class PasswordRequest { public string Password { get; set; } }
        public sealed class AdminRequest { public bool Admin { get; set; } }
    }
}
```

`port: 0` makes Kestrel choose a free port; `app.Urls` reports the real one, which the test uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: `32/32 passed`.

If the test fails on `page.IsSuccessStatusCode` because no `AdminConsole/` folder exists yet in the test output, that is expected until Task 8 adds the page; the fallback `MapGet("/")` handles it, so the check should pass either way.

- [ ] **Step 4b (post-review): case-insensitive guard + CSRF header regression test**

Add `HttpGuardIsCaseInsensitive` to `AdminChecks.cs` (registered in `Program.cs` right after
`HttpRejectsActionsWithoutLogin`): it asserts `/API/overview`, `/Api/Overview`, and
`/%41PI/overview` all still require login (401); that a cross-origin-shaped form POST to
`/API/server/reload-drops` with no cookie is rejected before the action runs (401 or 403); that
an unrelated path like `/apifoo` is not treated as an API path (404, not swept into the guard);
and - the case the header actually defends - that a request carrying a *valid* session cookie
but no `X-Admin-Console` header is still rejected with 403 when POSTing to
`/api/server/reload-drops`. Run the full suite and expect `36/36 passed`, with neither of the
two pre-existing HTTP tests (`HttpRequiresLogin`, `HttpRejectsActionsWithoutLogin`) modified -
cookie-first ordering in the guard above is exactly what keeps both of those green while still
closing the bypass.

- [ ] **Step 5: Commit**

```bash
git add Server.Admin Tests/Regression
git commit -m "Add admin console HTTP host with cookie login"
```

---

### Task 7: Wire into Server.Console

**Files:**
- Modify: `Server.Console/Server.Console.csproj`
- Modify: `Server.Console/Program.cs`

- [ ] **Step 1: Reference the project**

In `Server.Console/Server.Console.csproj`, add inside the `ProjectReference` item group:

```xml
    <ProjectReference Include="..\Server.Admin\Server.Admin.csproj" />
```

- [ ] **Step 2: Start and stop the console, feed the buffer**

In `Server.Console/Program.cs`, add `using Server.Admin;` at the top. Replace the block from `System.Console.WriteLine("Starting server...");` through `Settings.Save();` with:

```csharp
                System.Console.WriteLine("Starting server...");
                Envir.Main.Start();
                System.Console.WriteLine("Server started. Press Ctrl+C to stop.");

                AdminConsole admin = null;
                if (Settings.AdminEnabled)
                {
                    if (string.IsNullOrWhiteSpace(Settings.AdminPassword))
                    {
                        System.Console.WriteLine("Admin console disabled: set [Admin] Password in Configs/Setup.ini.");
                    }
                    else
                    {
                        admin = new AdminConsole(Envir.Main, Settings.AdminPassword, Settings.AdminPort);
                        admin.Start();
                        System.Console.WriteLine($"Admin console at {admin.BaseUrl}");
                    }
                }

                // Drain message queue to console
                var cts = new CancellationTokenSource();
                System.Console.CancelKeyPress += (s, e) =>
                {
                    e.Cancel = true;
                    cts.Cancel();
                };

                var messageQueue = MessageQueue.Instance;

                while (!cts.Token.IsCancellationRequested)
                {
                    bool hadMessage = false;

                    while (messageQueue.MessageLog.TryDequeue(out string message))
                    {
                        System.Console.Write(message);
                        AdminConsole.Logs.Append("server", message);
                        hadMessage = true;
                    }

                    while (messageQueue.DebugLog.TryDequeue(out string debug))
                    {
                        System.Console.Write($"[Debug] {debug}");
                        AdminConsole.Logs.Append("debug", debug);
                        hadMessage = true;
                    }

                    while (messageQueue.ChatLog.TryDequeue(out string chat))
                    {
                        AdminConsole.Logs.Append("chat", chat);
                        hadMessage = true;
                    }

                    if (!hadMessage)
                        Thread.Sleep(100);
                }

                System.Console.WriteLine("Stopping server...");
                if (admin != null) admin.Stop();
                Envir.Main.Stop();
                System.Console.WriteLine("Server stopped.");

                Settings.Save();
```

- [ ] **Step 3: Build and check the settings file**

Run:

```bash
dotnet build Server.Console/Server.Console.csproj
grep -n -A3 '^\[Admin\]' Build/Server/Debug/Configs/Setup.ini || echo "no Admin section yet"
```

Expected: `Build succeeded`. The `[Admin]` section appears after the first server start (Settings.Load writes defaults). Set a password now so the manual check later works:

```bash
python3 - <<'EOF'
import re,io
p='Build/Server/Debug/Configs/Setup.ini'
s=open(p,encoding='utf-8').read()
if '[Admin]' not in s:
    s+='\n[Admin]\nEnabled=True\nPort=5081\nPassword=change-me\n'
else:
    s=re.sub(r'(\[Admin\][^\[]*?Password=)[^\n]*', r'\1change-me', s)
open(p,'w',encoding='utf-8').write(s)
EOF
```

`Build/Server/Debug` is not tracked by git, so this does not create a diff.

- [ ] **Step 4: Smoke start**

Run from `Build/Server/Debug` (the server needs its data files there):

```bash
cd Build/Server/Debug && timeout 40 dotnet Server.Console.dll --pack classic 2>&1 | head -40; cd -
```

Expected within the output: `Admin console at http://127.0.0.1:5081`. Map loading may still be in progress when the timeout hits; that is fine. If port 7000 is already in use because a server from `play.sh` is running, stop that one first.

- [ ] **Step 5: Commit**

```bash
git add Server.Console
git commit -m "Host the admin console from Server.Console"
```

---

### Task 8: The page

**Files:**
- Create: `Server.Admin/AdminConsole/index.html`
- Create: `Server.Admin/AdminConsole/admin.js`

- [ ] **Step 1: Write index.html**

`Server.Admin/AdminConsole/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>McCrystal GM Console</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #0d1117; color: #c9d1d9; font-size: 14px; }
  a { color: #58a6ff; }
  #login { max-width: 360px; margin: 15vh auto; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; }
  #login h1 { color: #e6a817; font-size: 1.4em; margin-bottom: 16px; }
  #app { display: none; grid-template-columns: 200px 1fr; min-height: 100vh; }
  nav { background: #161b22; border-right: 1px solid #30363d; padding: 16px 0; }
  nav h1 { color: #e6a817; font-size: 1.1em; padding: 0 16px 16px; }
  nav button { display: block; width: 100%; text-align: left; background: none; border: 0; color: #c9d1d9; padding: 10px 16px; cursor: pointer; font-size: 14px; }
  nav button.active, nav button:hover { background: #21262d; color: #58a6ff; }
  main { padding: 20px; overflow-x: auto; }
  section { display: none; }
  section.active { display: block; }
  h2 { color: #e6a817; font-size: 1.2em; margin-bottom: 12px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; }
  .card .label { color: #8b949e; font-size: 12px; }
  .card .value { font-size: 20px; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
  th, td { border-bottom: 1px solid #30363d; padding: 6px 8px; text-align: left; white-space: nowrap; }
  th { color: #8b949e; font-weight: normal; }
  tr.selectable { cursor: pointer; }
  tr.selectable:hover, tr.selected { background: #21262d; }
  input, select, button.action { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 8px; border-radius: 4px; font-size: 14px; }
  button.action { background: #21262d; cursor: pointer; }
  button.action:hover { border-color: #58a6ff; }
  button.danger { border-color: #da3633; color: #f85149; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
  .panel { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
  .panel h3 { color: #58a6ff; font-size: 1em; margin-bottom: 8px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
  #toast { position: fixed; right: 16px; bottom: 16px; background: #21262d; border: 1px solid #30363d; padding: 10px 14px; border-radius: 6px; display: none; max-width: 480px; }
  #toast.error { border-color: #da3633; }
  #log { background: #010409; border: 1px solid #30363d; height: 60vh; overflow: auto; padding: 8px; font-family: Menlo, monospace; font-size: 12px; white-space: pre-wrap; }
  .log-chat { color: #7ee787; } .log-debug { color: #8b949e; } .log-server { color: #c9d1d9; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 900px) { #app { grid-template-columns: 1fr; } nav { display: flex; overflow-x: auto; } .two { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div id="login">
  <h1>McCrystal GM Console</h1>
  <form id="login-form">
    <div class="row"><input id="password" type="password" placeholder="管理密码" autofocus style="flex:1"></div>
    <div class="row"><button class="action" type="submit">登录</button><span id="login-error" style="color:#f85149"></span></div>
  </form>
</div>

<div id="app">
  <nav>
    <h1>GM Console</h1>
    <button data-tab="overview" class="active">总览</button>
    <button data-tab="players">在线玩家</button>
    <button data-tab="accounts">账号与角色</button>
    <button data-tab="server">服务器与日志</button>
    <button data-tab="database">数据库</button>
    <button data-tab="stats">统计</button>
    <button id="logout">退出</button>
  </nav>
  <main>
    <section id="tab-overview" class="active">
      <h2>总览</h2>
      <div class="cards" id="overview-cards"></div>
    </section>

    <section id="tab-players">
      <h2>在线玩家</h2>
      <div class="toolbar"><button class="action" id="players-refresh">刷新</button><span id="players-count"></span></div>
      <table id="players-table"><thead><tr><th>角色</th><th>账号</th><th>职业</th><th>等级</th><th>地图</th><th>坐标</th><th>IP</th><th>在线</th></tr></thead><tbody></tbody></table>
      <div class="panel" id="player-actions" style="display:none">
        <h3>操作：<span id="player-name"></span></h3>
        <div class="row"><input id="give-item" placeholder="物品名" list="item-names"><input id="give-count" type="number" value="1" min="1" style="width:80px"><button class="action" data-act="give-item">发物品</button></div>
        <datalist id="item-names"></datalist>
        <div class="row"><input id="give-gold" type="number" value="10000" min="1"><button class="action" data-act="give-gold">发金币</button></div>
        <div class="row"><select id="tp-map"></select><input id="tp-x" type="number" placeholder="X" style="width:80px"><input id="tp-y" type="number" placeholder="Y" style="width:80px"><button class="action" data-act="teleport">传送</button></div>
        <div class="row"><input id="set-level" type="number" min="1" max="65535" placeholder="等级" style="width:100px"><button class="action" data-act="level">改等级</button></div>
        <div class="row"><input id="whisper" placeholder="私聊内容" style="flex:1"><button class="action" data-act="whisper">私聊</button></div>
        <div class="row"><button class="action danger" data-act="kick">踢下线</button></div>
      </div>
    </section>

    <section id="tab-accounts">
      <h2>账号与角色</h2>
      <div class="toolbar"><input id="account-query" placeholder="账号或角色名"><button class="action" id="account-search">搜索</button></div>
      <table id="accounts-table"><thead><tr><th>账号</th><th>角色数</th><th>创建</th><th>最后登录</th><th>GM</th><th>封禁</th><th>在线</th></tr></thead><tbody></tbody></table>
      <div id="account-detail"></div>
    </section>

    <section id="tab-server">
      <h2>服务器与日志</h2>
      <div class="panel">
        <div class="row"><input id="broadcast" placeholder="全服公告" style="flex:1"><button class="action" data-server="broadcast">发送</button></div>
        <div class="row">
          <button class="action" data-server="save">立即存档</button>
          <button class="action" data-server="reload-drops">重载掉落表</button>
          <button class="action" data-server="reload-npcs">重载 NPC 脚本</button>
        </div>
      </div>
      <div class="toolbar"><input id="log-filter" placeholder="过滤关键字"><label><input type="checkbox" id="log-chat" checked> 聊天</label><label><input type="checkbox" id="log-debug"> 调试</label></div>
      <div id="log"></div>
    </section>

    <section id="tab-database">
      <h2>数据库</h2>
      <div class="toolbar">
        <select id="db-kind"><option value="items">物品</option><option value="monsters">怪物</option><option value="maps">地图</option><option value="npcs">NPC</option></select>
        <input id="db-query" placeholder="名称"><button class="action" id="db-search">搜索</button><span id="db-count"></span>
      </div>
      <table id="db-table"><thead></thead><tbody></tbody></table>
    </section>

    <section id="tab-stats">
      <h2>统计</h2>
      <div class="toolbar"><button class="action" id="stats-refresh">刷新</button></div>
      <div class="cards" id="stats-cards"></div>
      <div class="two">
        <div><h3>职业分布</h3><table id="stats-class"><tbody></tbody></table></div>
        <div><h3>等级分布</h3><table id="stats-level"><tbody></tbody></table></div>
        <div><h3>怪物最多的地图</h3><table id="stats-mon"><tbody></tbody></table></div>
        <div><h3>玩家最多的地图</h3><table id="stats-ply"><tbody></tbody></table></div>
        <div><h3>金币最多的账号</h3><table id="stats-gold"><tbody></tbody></table></div>
      </div>
    </section>
  </main>
</div>

<div id="toast"></div>
<script src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write admin.js**

`Server.Admin/AdminConsole/admin.js`:

```javascript
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let selectedPlayer = null;
  let overviewTimer = null;
  let logSource = null;
  const logLines = [];

  async function api(path, body) {
    // Auth hardening (post-review, 2026-09-07): the host now requires this header on every
    // state-changing (non-GET/HEAD) /api/* request as a CSRF guard - a cross-origin request
    // cannot set a custom header without a CORS preflight, and none is configured, so the
    // preflight fails and the request never reaches the server. Send it on every POST here,
    // including /api/login, where it is accepted but not required.
    const res = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Console': '1' }, body: JSON.stringify(body)
    });
    if (res.status === 401) { showLogin(); throw new Error('login required'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function toast(text, isError) {
    const t = $('#toast');
    t.textContent = text;
    t.className = isError ? 'error' : '';
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 4000);
  }

  async function act(promise) {
    try { const r = await promise; toast(r.message || 'OK'); return true; }
    catch (e) { toast(e.message, true); return false; }
  }

  // ----- login -----
  function showLogin() {
    $('#app').style.display = 'none';
    $('#login').style.display = 'block';
    stopLive();
  }
  function showApp() {
    $('#login').style.display = 'none';
    $('#app').style.display = 'grid';
    startLive();
    loadOverview();
    loadPlayers();
    loadMaps();
    loadItemNames();
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      await api('/api/login', { password: $('#password').value });
      $('#password').value = '';
      showApp();
    } catch (err) { $('#login-error').textContent = '密码错误'; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/logout', {}); showLogin(); });

  // ----- tabs -----
  document.querySelectorAll('nav button[data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('nav button[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'players') loadPlayers();
    if (b.dataset.tab === 'stats') loadStats();
    if (b.dataset.tab === 'accounts') loadAccounts();
    if (b.dataset.tab === 'database') loadDb();
  }));

  // ----- overview -----
  const fmtDuration = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m ${s % 60}s`; };
  const fmtBytes = (b) => (b / 1048576).toFixed(0) + ' MB';
  function cards(el, entries) {
    el.innerHTML = entries.map(([label, value]) => `<div class="card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`).join('');
  }
  async function loadOverview() {
    try {
      const o = await api('/api/overview');
      cards($('#overview-cards'), [
        ['状态', o.running ? '运行中' : '已停止'], ['运行时长', fmtDuration(o.uptimeSeconds)],
        ['玩法包', `${o.packId} ${o.packVersion}`], ['数据库版本', o.databaseVersion],
        ['在线玩家', o.onlinePlayers], ['连接数', o.connections], ['怪物总数', o.monsters],
        ['主循环耗时', o.loopMilliseconds + ' ms'], ['内存', fmtBytes(o.memoryBytes)]
      ]);
    } catch (e) { /* login handled in api() */ }
  }
  function startLive() { stopLive(); overviewTimer = setInterval(loadOverview, 2000); startLogs(); }
  function stopLive() { clearInterval(overviewTimer); overviewTimer = null; if (logSource) { logSource.close(); logSource = null; } }

  // ----- players -----
  async function loadPlayers() {
    const rows = await api('/api/players').catch(() => []);
    $('#players-count').textContent = `${rows.length} 人在线`;
    $('#players-table tbody').innerHTML = rows.map((p) => `<tr class="selectable${p.name === selectedPlayer ? ' selected' : ''}" data-name="${esc(p.name)}">
      <td>${esc(p.name)}</td><td>${esc(p.accountId)}</td><td>${esc(p.class)}</td><td>${p.level}</td>
      <td>${esc(p.map)} (${p.mapIndex})</td><td>${p.x},${p.y}</td><td>${esc(p.ip)}</td><td>${fmtDuration(p.sessionSeconds)}</td></tr>`).join('');
    document.querySelectorAll('#players-table tr.selectable').forEach((tr) => tr.addEventListener('click', () => selectPlayer(tr.dataset.name)));
    if (selectedPlayer && !rows.some((p) => p.name === selectedPlayer)) selectPlayer(null);
  }
  function selectPlayer(name) {
    selectedPlayer = name;
    $('#player-name').textContent = name || '';
    $('#player-actions').style.display = name ? 'block' : 'none';
    document.querySelectorAll('#players-table tr.selectable').forEach((tr) => tr.classList.toggle('selected', tr.dataset.name === name));
  }
  $('#players-refresh').addEventListener('click', loadPlayers);
  async function loadMaps() {
    const maps = await api('/api/db/maps?q=').catch(() => []);
    $('#tp-map').innerHTML = maps.map((m) => `<option value="${m.index}">${esc(m.title || m.fileName)} (${m.index})</option>`).join('');
  }
  async function loadItemNames() {
    const items = await api('/api/db/items?q=').catch(() => []);
    $('#item-names').innerHTML = items.map((i) => `<option value="${esc(i.name)}">`).join('');
  }
  document.querySelectorAll('#player-actions button[data-act]').forEach((b) => b.addEventListener('click', async () => {
    if (!selectedPlayer) return;
    const base = `/api/players/${encodeURIComponent(selectedPlayer)}/`;
    const num = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
    let ok = false;
    switch (b.dataset.act) {
      case 'give-item': ok = await act(api(base + 'give-item', { item: $('#give-item').value, count: Number($('#give-count').value) || 1 })); break;
      case 'give-gold': ok = await act(api(base + 'give-gold', { amount: Number($('#give-gold').value) || 0 })); break;
      case 'teleport': ok = await act(api(base + 'teleport', { mapIndex: Number($('#tp-map').value), x: num('#tp-x'), y: num('#tp-y') })); break;
      case 'level': ok = await act(api(base + 'level', { level: Number($('#set-level').value) })); break;
      case 'whisper': ok = await act(api(base + 'whisper', { message: $('#whisper').value })); if (ok) $('#whisper').value = ''; break;
      case 'kick': ok = await act(api(base + 'kick', {})); break;
    }
    if (ok) loadPlayers();
  }));

  // ----- accounts -----
  async function loadAccounts() {
    const q = $('#account-query').value;
    const rows = await api('/api/accounts?q=' + encodeURIComponent(q)).catch(() => []);
    const d = (v) => v && !v.startsWith('0001') ? v.replace('T', ' ').slice(0, 16) : '-';
    $('#accounts-table tbody').innerHTML = rows.map((a) => `<tr class="selectable" data-id="${esc(a.accountId)}">
      <td>${esc(a.accountId)}</td><td>${a.characterCount}</td><td>${d(a.creationDate)}</td><td>${d(a.lastDate)}</td>
      <td>${a.admin ? '是' : ''}</td><td>${a.banned ? '是' : ''}</td><td>${a.online ? '是' : ''}</td></tr>`).join('');
    document.querySelectorAll('#accounts-table tr.selectable').forEach((tr) => tr.addEventListener('click', () => loadAccount(tr.dataset.id)));
  }
  $('#account-search').addEventListener('click', loadAccounts);
  $('#account-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAccounts(); });
  function itemTable(title, items) {
    if (!items.length) return `<h3>${esc(title)}</h3><p style="color:#8b949e;margin-bottom:8px">空</p>`;
    return `<h3>${esc(title)}</h3><table><thead><tr><th>槽</th><th>物品</th><th>数量</th><th>耐久</th></tr></thead><tbody>${items.map((i) =>
      `<tr><td>${i.slot}</td><td>${esc(i.name)}</td><td>${i.count}</td><td>${i.maxDura ? `${i.currentDura}/${i.maxDura}` : '-'}</td></tr>`).join('')}</tbody></table>`;
  }
  async function loadAccount(id) {
    let a;
    try { a = await api('/api/accounts/' + encodeURIComponent(id)); } catch (e) { toast(e.message, true); return; }
    $('#account-detail').innerHTML = `<div class="panel">
      <h3>${esc(a.accountId)} · 金币 ${a.gold} · ${a.admin ? 'GM' : '普通'}${a.banned ? ' · 已封禁 ' + esc(a.banReason) : ''} · 最后 IP ${esc(a.lastIp)}</h3>
      <div class="row"><input id="new-password" type="password" placeholder="新密码"><button class="action" id="reset-password">重置密码</button>
        <button class="action" id="toggle-admin">${a.admin ? '取消 GM' : '设为 GM'}</button></div>
      ${itemTable('仓库', a.storage)}
      ${a.characters.map((c) => `<div class="panel"><h3>${esc(c.name)} · ${esc(c.class)} · ${esc(c.gender)} · Lv ${c.level}${c.online ? ' · 在线' : ''}${c.deleted ? ' · 已删除' : ''}</h3>
        <div class="two">${itemTable('装备', c.equipment)}${itemTable('背包', c.inventory)}</div></div>`).join('')}
    </div>`;
    $('#reset-password').addEventListener('click', async () => {
      if (await act(api(`/api/accounts/${encodeURIComponent(id)}/password`, { password: $('#new-password').value }))) $('#new-password').value = '';
    });
    $('#toggle-admin').addEventListener('click', async () => {
      if (await act(api(`/api/accounts/${encodeURIComponent(id)}/admin`, { admin: !a.admin }))) { loadAccounts(); loadAccount(id); }
    });
  }

  // ----- server & logs -----
  document.querySelectorAll('button[data-server]').forEach((b) => b.addEventListener('click', async () => {
    const what = b.dataset.server;
    if (what === 'broadcast') { if (await act(api('/api/server/broadcast', { message: $('#broadcast').value }))) $('#broadcast').value = ''; return; }
    if (what === 'save' && !confirm('立即保存数据库和账号？')) return;
    await act(api('/api/server/' + what, {}));
  }));
  function renderLogs() {
    const filter = $('#log-filter').value.toLowerCase();
    const showChat = $('#log-chat').checked, showDebug = $('#log-debug').checked;
    const el = $('#log');
    const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.innerHTML = logLines.filter((l) => (l.kind !== 'chat' || showChat) && (l.kind !== 'debug' || showDebug) && (!filter || l.text.toLowerCase().includes(filter)))
      .map((l) => `<div class="log-${esc(l.kind)}">${esc(l.text)}</div>`).join('');
    if (stick) el.scrollTop = el.scrollHeight;
  }
  function startLogs() {
    if (logSource) logSource.close();
    logSource = new EventSource('/api/logs/stream');
    logSource.onmessage = (e) => {
      logLines.push(JSON.parse(e.data));
      if (logLines.length > 2000) logLines.splice(0, logLines.length - 2000);
      renderLogs();
    };
  }
  ['#log-filter', '#log-chat', '#log-debug'].forEach((s) => $(s).addEventListener('input', renderLogs));

  // ----- database -----
  const dbColumns = {
    items: [['index', '#'], ['name', '名称'], ['type', '类型'], ['grade', '品质'], ['requiredType', '需求'], ['requiredAmount', '数值'], ['requiredClass', '职业'], ['price', '价格'], ['stackSize', '叠加'], ['durability', '耐久']],
    monsters: [['index', '#'], ['name', '名称'], ['level', '等级'], ['experience', '经验'], ['ai', 'AI'], ['dropPath', '掉落表'], ['dropCount', '掉落条目']],
    maps: [['index', '#'], ['fileName', '文件'], ['title', '标题'], ['players', '玩家'], ['monsters', '怪物']],
    npcs: [['index', '#'], ['name', '名称'], ['fileName', '脚本'], ['mapIndex', '地图#'], ['mapTitle', '地图'], ['x', 'X'], ['y', 'Y']]
  };
  async function loadDb() {
    const kind = $('#db-kind').value;
    const rows = await api(`/api/db/${kind}?q=` + encodeURIComponent($('#db-query').value)).catch(() => []);
    const cols = dbColumns[kind];
    $('#db-count').textContent = `${rows.length} 条`;
    $('#db-table thead').innerHTML = '<tr>' + cols.map(([, h]) => `<th>${esc(h)}</th>`).join('') + '</tr>';
    $('#db-table tbody').innerHTML = rows.map((r) => '<tr>' + cols.map(([k]) => `<td>${esc(r[k])}</td>`).join('') + '</tr>').join('');
  }
  $('#db-search').addEventListener('click', loadDb);
  $('#db-kind').addEventListener('change', loadDb);
  $('#db-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDb(); });

  // ----- stats -----
  const pairs = (el, obj, keyLabel) => { el.innerHTML = Object.entries(obj).map(([k, v]) => `<tr><td>${esc(keyLabel ? keyLabel(k) : k)}</td><td>${esc(v)}</td></tr>`).join(''); };
  async function loadStats() {
    let s;
    try { s = await api('/api/stats'); } catch (e) { return; }
    cards($('#stats-cards'), [['账号', s.accounts], ['角色', s.characters], ['在线', s.online], ['金币总量', s.totalGold], ['物品总数', s.totalItems],
      ['主循环耗时', s.runtime.loopMilliseconds + ' ms'], ['内存', fmtBytes(s.runtime.memoryBytes)], ['连接数', s.runtime.connections]]);
    pairs($('#stats-class tbody'), s.classCounts);
    pairs($('#stats-level tbody'), s.levelBands);
    $('#stats-mon tbody').innerHTML = s.topMapsByMonsters.map((m) => `<tr><td>${esc(m.map)} (${m.mapIndex})</td><td>${m.count}</td></tr>`).join('') || '<tr><td>无</td></tr>';
    $('#stats-ply tbody').innerHTML = s.topMapsByPlayers.map((m) => `<tr><td>${esc(m.map)} (${m.mapIndex})</td><td>${m.count}</td></tr>`).join('') || '<tr><td>无</td></tr>';
    $('#stats-gold tbody').innerHTML = s.topGold.map((g) => `<tr><td>${esc(g.accountId)}</td><td>${esc(g.characters)}</td><td>${g.gold}</td></tr>`).join('');
  }
  $('#stats-refresh').addEventListener('click', loadStats);

  // ----- boot: try an authenticated call; 401 shows login -----
  api('/api/overview').then(showApp).catch(() => showLogin());
})();
```

- [ ] **Step 3: Build and confirm the page is copied**

Run:

```bash
dotnet build Server.Console/Server.Console.csproj
ls Build/Server/Debug/AdminConsole/
```

Expected: `admin.js  index.html`. If the folder is missing, transitive content copy did not happen; add to `Server.Console.csproj`:

```xml
  <ItemGroup>
    <Content Include="..\Server.Admin\AdminConsole\**" Link="AdminConsole\%(RecursiveDir)%(Filename)%(Extension)">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
  </ItemGroup>
```

- [ ] **Step 4: Run the regression suite once more**

Run: `dotnet run --project Tests/Regression/Regression.csproj`
Expected: `32/32 passed`.

- [ ] **Step 5: Commit**

```bash
git add Server.Admin/AdminConsole Server.Console/Server.Console.csproj
git commit -m "Add admin console page"
```

---

### Task 9: Manual verification and docs

**Files:**
- Create: `Server.Admin/README.md`
- Modify: `CLAUDE.md` (one line under Build)

- [ ] **Step 1: Start the server**

```bash
cd Build/Server/Debug && dotnet Server.Console.dll --pack classic
```

Wait for `Admin console at http://127.0.0.1:5081`. Leave it running in this terminal.

- [ ] **Step 2: Browser checks**

Open http://127.0.0.1:5081 and log in with `change-me`. Confirm in order:

1. Overview cards show uptime increasing and a non-zero monster count once maps finish loading.
2. Log in to the game with the native or web client as `cocofly`. The player appears under 在线玩家.
3. Select the player, give `TeleportRing` x1. The toast says `gave <name> 1 x TeleportRing` and the item is in the in-game bag.
4. Give 1000 gold; the in-game gold rises by 1000.
5. Teleport to map index 0 (Bichon) without coordinates; the character moves.
6. 服务器与日志 shows the `[Admin] gave ...` lines from steps 3 and 4. Send a broadcast; it appears in game as an announcement.
7. 账号与角色: search `coco`, open the account, verify the bag listing matches the game. Toggle GM off and back on.
8. 数据库: search items for `ring`, maps for `bichon`.
9. 统计: numbers render, top gold lists `cocofly`.
10. Kick the player; the game shows the kicked-by-admin message.

Record anything that does not behave in the final report instead of silently fixing unrelated code.

- [ ] **Step 3: Write the README**

`Server.Admin/README.md`:

```markdown
# Admin console

A local browser console for the running game server. It is hosted inside
`Server.Console` and listens on `127.0.0.1` only.

## Enable

In the server's `Configs/Setup.ini`:

```ini
[Admin]
Enabled=True
Port=5081
Password=choose-a-password
```

An empty password keeps the console off. Start the server, then open
<http://127.0.0.1:5081> and log in with the password. The session cookie dies
when the server restarts.

## What it does

- Overview: uptime, content pack, database version, online count, loop time, memory.
- Online players: give items and gold, teleport, set level, whisper, kick.
- Accounts: search, reset password, grant or revoke the admin (GM) flag, inspect
  inventory, equipment and storage.
- Server: live log stream, broadcast, save now, reload drop tables and NPC scripts.
- Database: read-only item, monster, map and NPC lists.
- Statistics: account, character, class and level counts; busiest maps; gold totals.

Every action runs on the engine thread through `Envir.AdminActions` and is
logged with an `[Admin]` prefix.

## Tests

```sh
dotnet run --project Tests/Regression/Regression.csproj
```
```

Add to `CLAUDE.md` under `## Build`, after the run-client block:

```markdown
Admin console: set `[Admin] Password` in `Build/Server/Debug/Configs/Setup.ini`, start `Server.Console`, open http://127.0.0.1:5081.
```

- [ ] **Step 4: Commit**

```bash
git add Server.Admin/README.md CLAUDE.md
git commit -m "Document the admin console"
```

---

## Self-review notes

- Spec coverage: overview (Task 4/8), online player actions (Task 5/6/8), accounts and characters incl. password and admin flag (Task 4/5/8), logs with shared ring buffer and server buttons (Task 3/6/7/8), database browser (Task 4/8), statistics (Task 4/8), auth and loopback binding (Task 6), action queue on the engine thread (Task 1/3), tests (Tasks 1, 3, 4, 5, 6), manual check (Task 9).
- Gold is stored per account in this engine (`AccountInfo.Gold`), so the "top characters by gold" table in the spec is rendered as top accounts with their character names.
- Type names used across tasks: `AdminActionRunner.Run(Func<string>)`, `AdminActionResult { Ok, Message }`, `AdminException`, `LogBuffer.Append/After/LastSequence`, `AdminService` query names `GetOverview/GetOnlinePlayers/SearchAccounts/GetAccount/SearchItems/SearchMonsters/SearchMaps/SearchNpcs/GetStatistics`, action names `GiveItem/GiveGold/Teleport/SetLevel/Kick/Whisper/Broadcast/ResetPassword/SetAdmin/SaveNow/ReloadDrops/ReloadNpcs`, `AdminConsole(envir, password, port).Start/Stop/BaseUrl`, static `AdminConsole.Logs`.
