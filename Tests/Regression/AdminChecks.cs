using System.Net.Http;
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

    public static void ActionRunnerReturnsResult()
    {
        var envir = new Envir();
        var runner = new Server.Admin.AdminActionRunner(envir, TimeSpan.FromSeconds(2));

        var drain = new Thread(() =>
        {
            while (envir.AdminActions.IsEmpty) Thread.Yield();
            envir.ProcessAdminActions();
        });
        drain.Start();
        var ok = runner.Run(() => "done");
        drain.Join();
        Check(ok.Ok && ok.Message == "done", "successful action not reported");

        drain = new Thread(() =>
        {
            while (envir.AdminActions.IsEmpty) Thread.Yield();
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
        var ran = false;
        var result = runner.Run(() => { ran = true; return "never"; });
        Check(!result.Ok, "timeout reported as success");
        Check(result.Message.Contains("game loop"), "timeout message missing");
        envir.ProcessAdminActions(); // late execution must not throw
        Check(!ran, "abandoned action ran after timeout");
    }

    public static void ActionRunnerLogsInternalErrors()
    {
        var envir = new Envir();
        var runner = new Server.Admin.AdminActionRunner(envir, TimeSpan.FromSeconds(2));

        var drain = new Thread(() =>
        {
            while (envir.AdminActions.IsEmpty) Thread.Yield();
            envir.ProcessAdminActions();
        });
        drain.Start();
        var result = runner.Run(() => throw new InvalidOperationException("secret detail"));
        drain.Join();

        Check(!result.Ok, "internal error reported as success");
        Check(result.Message == "Internal error; see server log.", "internal error message not sanitized");
        Check(!result.Message.Contains("secret"), "internal error leaked detail to caller");
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

    static Envir SampleEnvir()
    {
        var envir = new Envir();
        envir.ItemInfoList.Add(new ItemInfo { Index = 1, Name = "Wooden Sword", Type = ItemType.Weapon, StackSize = 1, Durability = 5000, Price = 100 });
        envir.ItemInfoList.Add(new ItemInfo { Index = 2, Name = "Gold Ore", Type = ItemType.Ore, StackSize = 20, Durability = 0 });
        envir.MonsterInfoList.Add(new Server.MirDatabase.MonsterInfo { Index = 1, Name = "Deer", Level = 3, Experience = 10, AI = 1, DropPath = "Deer" });
        envir.MonsterInfoList.Add(new Server.MirDatabase.MonsterInfo { Index = 2, Name = "Hen", Level = 1, Experience = 1, AI = 1, DropPath = "" });
        envir.MapInfoList.Add(new Server.MirDatabase.MapInfo { Index = 1, FileName = "0", Title = "Bichon" });
        envir.MapInfoList.Add(new Server.MirDatabase.MapInfo { Index = 2, FileName = "3", Title = "" });
        envir.NPCInfoList.Add(new Server.MirDatabase.NPCInfo { Index = 1, Name = "Blacksmith", FileName = "Blacksmith", MapIndex = 1, Location = new System.Drawing.Point(300, 600) });
        envir.NPCInfoList.Add(new Server.MirDatabase.NPCInfo { Index = 2, Name = "Guard", FileName = "Guard", MapIndex = 2, Location = new System.Drawing.Point(1, 2) });

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
        Check(service.SearchAccounts("", 0).Count == 0, "limit 0 must return nothing");
        Check(service.SearchAccounts("", 1).Count == 1, "limit must cap results");
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
        Check(service.SearchMonsters("hen")[0].DropPath == "Hen", "empty DropPath must fall back to name");
        Check(service.SearchMaps("bich")[0].Index == 1, "map search failed");
        var npc = service.SearchNpcs("black")[0];
        Check(npc.MapTitle == "Bichon" && npc.X == 300, "npc row wrong");
        Check(service.SearchNpcs("guard")[0].MapTitle == "3", "empty map title must fall back to file name");
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
        }) { IsBackground = true };
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
            // Settings.ExperienceList is empty in this test process, so the level bound
            // collapses to [1, 1]; use a level within that bound to reach the online check.
            Check(service.SetLevel("nobody", 1).Message.Contains("not online"), "set level");
            Check(service.Kick("nobody").Message.Contains("not online"), "kick");
            Check(service.Whisper("nobody", "hi").Message.Contains("not online"), "whisper");
            Check(service.SetLevel("kzs", 0).Message.Contains("Level must be"), "level 0 must be rejected for the argument, not the lookup");
            Check(service.GiveGold("kzs", 0).Message.Contains("positive"), "zero gold must be rejected for the argument, not the lookup");
            Check(service.Whisper("kzs", "  ").Message.Contains("empty"), "empty whisper must be rejected for the argument, not the lookup");
            Check(service.Broadcast(" ").Message.Contains("empty"), "empty broadcast must be rejected for the argument, not the lookup");
        }
        finally { stop.Cancel(); loop.Join(); stop.Dispose(); }
    }

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

    public static void HttpRejectsActionsWithoutLogin()
    {
        var envir = SampleEnvir();
        var console = new Server.Admin.AdminConsole(envir, "hunter2", port: 0);
        console.Start();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(console.BaseUrl) };
            var body = new StringContent("{\"admin\":true}", System.Text.Encoding.UTF8, "application/json");
            var response = client.PostAsync("/api/accounts/guest/admin", body).Result;
            Check(response.StatusCode == System.Net.HttpStatusCode.Unauthorized, "anonymous action must be 401");
            Check(!envir.GetAccount("guest").AdminAccount, "anonymous action must not run");
        }
        finally { console.Stop(); }
    }

    public static void HttpGuardIsCaseInsensitive()
    {
        var envir = SampleEnvir();
        var console = new Server.Admin.AdminConsole(envir, "hunter2", port: 0);
        console.Start();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(console.BaseUrl) };

            foreach (var path in new[] { "/API/overview", "/Api/Overview", "/%41PI/overview" })
            {
                var response = client.GetAsync(path).Result;
                Check(response.StatusCode == System.Net.HttpStatusCode.Unauthorized, $"{path} must require login");
            }

            // A cross-origin form POST must not reach an action, even one that binds no body.
            var form = client.PostAsync("/API/server/reload-drops",
                new StringContent("a=b", System.Text.Encoding.UTF8, "application/x-www-form-urlencoded")).Result;
            Check(form.StatusCode == System.Net.HttpStatusCode.Unauthorized
                  || form.StatusCode == System.Net.HttpStatusCode.Forbidden, "form POST must be rejected before the action runs");

            // /apifoo must not be treated as an API path at all (it has no route, so 404).
            var sibling = client.GetAsync("/apifoo").Result;
            Check(sibling.StatusCode == System.Net.HttpStatusCode.NotFound, "unrelated path must not be guarded as /api");

            // A valid session cookie is not enough on its own for a state-changing action: a
            // cross-site form post carries the cookie (it's same-site on 127.0.0.1) but cannot
            // set the X-Admin-Console header, so it must still be rejected - this is the case
            // the header check actually defends against.
            var login = client.PostAsync("/api/login",
                new StringContent("{\"password\":\"hunter2\"}", System.Text.Encoding.UTF8, "application/json")).Result;
            Check(login.IsSuccessStatusCode, "login failed");
            var cookie = login.Headers.GetValues("Set-Cookie").First().Split(';')[0];

            var request = new HttpRequestMessage(HttpMethod.Post, "/api/server/reload-drops");
            request.Headers.Add("Cookie", cookie);
            var csrf = client.SendAsync(request).Result;
            Check(csrf.StatusCode == System.Net.HttpStatusCode.Forbidden, "valid cookie without the header must still be rejected");
        }
        finally { console.Stop(); }
    }
}
