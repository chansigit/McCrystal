using Server.MirDatabase;
using Server.MirObjects;
using S = ServerPackets;

var tests = new (string Name, Action Run)[]
{
    ("Windows drop paths and nested inserts resolve on the host platform", DropPaths),
    ("Compressed goods round trip and following packet", CompressedRoundTrip),
    ("Compressed goods validates the complete gzip trailer", CompressedTrailer),
    ("Invalid frame lengths are rejected", InvalidLengths),
    ("Incomplete frames remain buffered", IncompleteFrames),
    ("Full inventory accepts items into existing stacks", ExistingStacks),
    ("Overflowing stack needs only one free slot", OverflowStack),
    ("Incoming stacks share new slots without overbooking", IncomingStacks),
    ("Capacity checks do not mutate items", CapacityDoesNotMutate),
    ("Capacity matches actual AddItem across 500 inventories", CapacityMatchesInsertion),
    ("Trade deposits require a reciprocal partner", InvalidTradeDeposit),
    ("Trade gold rejects overflow without changing balances", TradeGoldOverflow),
    ("Trade gold accepts the exact maximum", TradeGoldMaximum)
};

int failed = 0;
foreach (var test in tests)
{
    try
    {
        test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception ex)
    {
        failed++;
        Console.WriteLine($"FAIL {test.Name}: {ex.Message}");
    }
}
Console.WriteLine($"{tests.Length - failed}/{tests.Length} passed");
return failed == 0 ? 0 : 1;

static void Check(bool condition)
{
    if (!condition) throw new Exception("Assertion failed");
}

static void DropPaths()
{
    string root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    try
    {
        Directory.CreateDirectory(Path.Combine(root, "Provinces"));
        Directory.CreateDirectory(Path.Combine(root, "Shared"));
        string insert = Path.Combine(root, "Shared", "Bonus.txt").Replace(Path.DirectorySeparatorChar, '\\');
        File.WriteAllText(Path.Combine(root, "Provinces", "Oma.txt"), $"1/1 Gold 100\n#INSERT [{insert}]\n");
        File.WriteAllText(Path.Combine(root, "Shared", "Bonus.txt"), "1/2 Gold 200\n");
        var drops = new List<DropInfo>();
        DropInfo.Load(drops, "Oma", Path.Combine(root, "Provinces\\Oma.txt"), createIfNotExists: false);
        Check(drops.Count == 2 && drops[0].Gold == 100 && drops[1].Gold == 200);
        if (Path.DirectorySeparatorChar != '\\') Check(!File.Exists(Path.Combine(root, "Provinces\\Oma.txt")));
    }
    finally
    {
        Directory.Delete(root, true);
    }
}

static void InvalidData(Action action)
{
    try { action(); }
    catch (InvalidDataException) { return; }
    throw new Exception("Expected InvalidDataException");
}

static S.NPCGoods Goods() => new()
{
    Rate = 1.25f,
    HideAddedStats = true,
    List = new List<UserItem> { Item(new ItemInfo { Index = 123, StackSize = 20 }, 7) }
};

static void CompressedRoundTrip()
{
    Packet.IsServer = false;
    var goods = Goods();
    var following = new S.Connected().GetPacketBytes().ToArray();
    var bytes = goods.GetPacketBytes().Concat(following).ToArray();
    var decoded = (S.NPCGoods)Packet.ReceivePacket(bytes, out var extra);
    Check(decoded.Rate == goods.Rate && decoded.HideAddedStats);
    Check(decoded.List.Count == 1 && decoded.List[0].Count == 7);
    Check(decoded.List[0].ItemIndex == 123 && extra.SequenceEqual(following));
    Check(Packet.ReceivePacket(extra, out extra) is S.Connected && extra.Length == 0);
}

static void CompressedTrailer()
{
    Packet.IsServer = false;
    var bytes = Goods().GetPacketBytes().ToArray();
    bytes[^1] ^= 0x80;
    InvalidData(() => Packet.ReceivePacket(bytes, out _));
}

static void InvalidLengths()
{
    Packet.IsServer = true;
    for (ushort length = 0; length < 4; length++)
    {
        byte[] bytes = { (byte)length, 0, (byte)ClientPacketIds.Disconnect, 0 };
        InvalidData(() => Packet.ReceivePacket(bytes, out _));
    }
}

static void IncompleteFrames()
{
    Packet.IsServer = false;
    var bytes = Goods().GetPacketBytes().ToArray();
    for (int length = 0; length < bytes.Length; length++)
    {
        var partial = bytes[..length];
        Check(Packet.ReceivePacket(partial, out var extra) == null);
        Check(extra.SequenceEqual(partial));
    }
}

static UserItem Item(ItemInfo info, ushort count) => new(info) { Count = count };
static HumanObject Human(params UserItem[] inventory) => new()
{
    Info = new CharacterInfo { Inventory = inventory }
};

static void ExistingStacks()
{
    var info = new ItemInfo { StackSize = 20 };
    Check(Human(Item(info, 18), Item(info, 17)).CanGainItems(new[] { Item(info, 5) }));
    Check(!Human(Item(info, 18), Item(info, 17)).CanGainItems(new[] { Item(info, 6) }));
}

static void OverflowStack()
{
    var info = new ItemInfo { StackSize = 20 };
    Check(Human(Item(info, 19), null).CanGainItems(new[] { Item(info, 20) }));
}

static void IncomingStacks()
{
    var info = new ItemInfo { StackSize = 20 };
    var human = Human(new UserItem[1]);
    Check(human.CanGainItems(new[] { Item(info, 10), Item(info, 10) }));
    Check(!human.CanGainItems(new[] { Item(info, 11), Item(info, 10) }));
    var other = new ItemInfo { StackSize = 20 };
    Check(!human.CanGainItems(new[] { Item(info, 1), Item(other, 1) }));
    var equipment = new ItemInfo { StackSize = 1 };
    Check(!human.CanGainItems(new[] { Item(equipment, 1), Item(equipment, 1) }));
    Check(human.CanGainItems(new UserItem[] { null }));
}

static void CapacityDoesNotMutate()
{
    var info = new ItemInfo { StackSize = 20 };
    var existing = Item(info, 19);
    var incoming = Item(info, 10);
    var human = Human(existing, null);
    Check(human.CanGainItems(new[] { incoming }));
    Check(existing.Count == 19 && incoming.Count == 10);
    Check(ReferenceEquals(human.Info.Inventory[0], existing) && human.Info.Inventory[1] == null);
}

static void InvalidTradeDeposit()
{
    var item = Item(new ItemInfo { StackSize = 1 }, 1);
    var player = new TestPlayer { Info = new CharacterInfo() };
    player.Info.Inventory[0] = item;
    player.DepositTradeItem(0, 0);
    Check(ReferenceEquals(player.Info.Inventory[0], item) && player.Info.Trade[0] == null);
    Check(player.Packets.Last() is S.DepositTradeItem { Success: false });
    player.TradePartner = new TestPlayer { Info = new CharacterInfo() };
    player.DepositTradeItem(0, 0);
    Check(ReferenceEquals(player.Info.Inventory[0], item) && player.Info.Trade[0] == null);
}

static void CapacityMatchesInsertion()
{
    var random = new Random(731);
    var infos = new[]
    {
        new ItemInfo { StackSize = 20, Type = ItemType.Potion },
        new ItemInfo { StackSize = 10, Type = ItemType.Scroll },
        new ItemInfo { StackSize = 50, Type = ItemType.Amulet },
        new ItemInfo { StackSize = 1, Type = ItemType.Weapon }
    };
    UserItem NextItem()
    {
        var info = infos[random.Next(infos.Length)];
        return Item(info, (ushort)random.Next(1, info.StackSize + 1));
    }

    for (int sample = 0; sample < 500; sample++)
    {
        var human = new TestHuman { Info = new CharacterInfo() };
        for (int slot = 0; slot < human.Info.Inventory.Length; slot++)
            human.Info.Inventory[slot] = random.Next(20) == 0 ? null : NextItem();
        var incoming = Enumerable.Range(0, random.Next(1, 12)).Select(_ => NextItem()).ToArray();
        int[] expected = infos.Select(info => human.Info.Inventory.Concat(incoming)
            .Where(item => item?.Info == info).Sum(item => (int)item.Count)).ToArray();
        bool canGain = human.CanGainItems(incoming);
        foreach (var item in incoming) human.Insert(item);
        int[] actual = infos.Select(info => human.Info.Inventory
            .Where(item => item?.Info == info).Sum(item => (int)item.Count)).ToArray();
        Check(canGain == expected.SequenceEqual(actual));
    }
}

static void TradeGoldOverflow()
{
    var player = new TestPlayer { Account = new AccountInfo { Gold = 10 } };
    player.TradePartner = new TestPlayer { TradePartner = player };
    player.TradeGoldAmount = uint.MaxValue - 5;
    player.TradeGold(6);
    Check(player.Account.Gold == 10 && player.TradeGoldAmount == uint.MaxValue - 5);
    Check(player.Packets.Count == 0);
}

static void TradeGoldMaximum()
{
    var player = new TestPlayer { Account = new AccountInfo { Gold = 10 } };
    var partner = new TestPlayer { TradePartner = player };
    player.TradePartner = partner;
    player.TradeGoldAmount = uint.MaxValue - 5;
    player.TradeGold(5);
    Check(player.Account.Gold == 5 && player.TradeGoldAmount == uint.MaxValue);
    Check(player.Packets.Single() is S.LoseGold { Gold: 5 });
    Check(partner.Packets.Single() is S.TradeGold { Amount: uint.MaxValue });
}

sealed class TestPlayer : PlayerObject
{
    public List<Packet> Packets { get; } = new();
    public override void Enqueue(Packet packet) => Packets.Add(packet);
}

sealed class TestHuman : HumanObject
{
    public void Insert(UserItem item) => AddItem(item);
}
