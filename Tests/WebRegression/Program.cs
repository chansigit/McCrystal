using System.Text;
using System.Text.Json;
using Crystal.Web;

int count = 0;
void Check(bool valid, string name)
{
    if (!valid) throw new Exception(name);
    count++;
    Console.WriteLine("PASS " + name);
}
Packet Parse(string json) => GameSession.ParseCommand(Encoding.UTF8.GetBytes(json));
void Reject(string json, string name)
{
    try { Parse(json); }
    catch (Exception e) when (e is InvalidDataException or JsonException)
    { Check(true, name); return; }
    throw new Exception("Accepted invalid command: " + name);
}

var login = Parse("""{"type":"Login","data":{"AccountID":"tester","Password":"example123"}}""");
Packet.IsServer = true;
var decoded = (ClientPackets.Login)Packet.ReceivePacket(login.GetPacketBytes().ToArray(), out var extra);
Check(decoded.AccountID == "tester" && decoded.Password == "example123" && extra.Length == 0, "Browser command uses real binary login protocol");
Reject("""{"type":"DepositTradeItem","data":{"From":0,"To":0}}""", "Unsupported transaction rejected");
Reject("""{"type":"Walk","data":{"Direction":8}}""", "Invalid direction rejected");
Reject("""{"type":"Login","data":{"AccountID":null,"Password":null}}""", "Null credentials rejected");
Reject("""{"type":"Login","data":{"AccountID":"tester","Password":"1234567890123456"}}""", "Oversized credentials rejected");
var registration = Parse("""{"type":"NewAccount","data":{"AccountID":"tester","Password":"example123","BirthDate":"2000-01-02T00:00:00","UserName":"","SecretQuestion":"","SecretAnswer":"","EMailAddress":""}}""");
var decodedRegistration = (ClientPackets.NewAccount)Packet.ReceivePacket(registration.GetPacketBytes().ToArray(), out var registrationExtra);
Check(decodedRegistration.AccountID == "tester" && decodedRegistration.Password == "example123" &&
    decodedRegistration.BirthDate == new DateTime(2000, 1, 2) && registrationExtra.Length == 0,
    "Registration uses the native account protocol and permits optional profile fields");
Reject("""{"type":"NewAccount","data":{"AccountID":"ab","Password":"example123","BirthDate":"2000-01-02T00:00:00","UserName":"","SecretQuestion":"","SecretAnswer":"","EMailAddress":""}}""", "Short registration account rejected");
Reject("""{"type":"Walk","data":null}""", "Null command data rejected");
Reject("""{"data":{}}""", "Missing command type rejected");
Reject("[]", "Non-object command rejected");
Reject("""{"type":"Chat","data":{"Message":null}}""", "Null chat rejected");
var walk = (ClientPackets.Walk)Parse("""{"type":"Walk","data":{"Direction":7}}""");
Check(walk.Direction == MirDirection.UpLeft, "Valid diagonal movement retained");
var run = Parse("""{"type":"Run","data":{"Direction":3}}""");
var decodedRun = (ClientPackets.Run)Packet.ReceivePacket(run.GetPacketBytes().ToArray(), out var runExtra);
Check(decodedRun.Direction == MirDirection.DownRight && runExtra.Length == 0, "Browser run uses real binary run protocol");
Reject("""{"type":"Run","data":{"Direction":8}}""", "Invalid run direction rejected");
var use = Parse("""{"type":"UseItem","data":{"Grid":1,"UniqueID":"18446744073709551615"}}""");
var decodedUse = (ClientPackets.UseItem)Packet.ReceivePacket(use.GetPacketBytes().ToArray(), out _);
Check(decodedUse.UniqueID == ulong.MaxValue && decodedUse.Grid == MirGridType.Inventory, "Item use preserves 64-bit IDs through binary protocol");
Check(Parse("""{"type":"EquipItem","data":{"Grid":1,"UniqueID":"1","To":13}}""") is ClientPackets.EquipItem, "Valid equipment command accepted");
Check(Parse("""{"type":"RemoveItem","data":{"Grid":1,"UniqueID":"1","To":6}}""") is ClientPackets.RemoveItem, "Valid unequip command accepted");
Check(Parse("""{"type":"MoveItem","data":{"Grid":1,"From":6,"To":0}}""") is ClientPackets.MoveItem, "Bag to belt movement accepted");
Reject("""{"type":"UseItem","data":{"Grid":4,"UniqueID":"1"}}""", "Storage item use rejected");
Reject("""{"type":"UseItem","data":{"Grid":1,"UniqueID":"0"}}""", "Missing item ID rejected");
Reject("""{"type":"EquipItem","data":{"Grid":1,"UniqueID":"1","To":14}}""", "Out-of-range equipment slot rejected");
Reject("""{"type":"MoveItem","data":{"Grid":1,"From":-1,"To":0}}""", "Negative inventory slot rejected");
Reject("""{"type":"MoveItem","data":{"Grid":1,"From":0,"To":0}}""", "Same-slot inventory move rejected");
var magic = Parse("""{"type":"Magic","data":{"ObjectID":1,"Spell":31,"Direction":3,"TargetID":4294967295,"Location":{"X":100,"Y":200},"SpellTargetLock":true}}""");
var decodedMagic = (ClientPackets.Magic)Packet.ReceivePacket(magic.GetPacketBytes().ToArray(), out _);
Check(decodedMagic.Spell == Spell.FireBall && decodedMagic.TargetID == uint.MaxValue && decodedMagic.Location == new System.Drawing.Point(100, 200) && decodedMagic.SpellTargetLock,
    "Spell target, location and target lock survive binary serialization");
Reject("""{"type":"Magic","data":{"ObjectID":1,"Spell":0,"Direction":3}}""", "Empty spell rejected");
Reject("""{"type":"Magic","data":{"ObjectID":1,"Spell":255,"Direction":3}}""", "Unknown spell rejected");
Reject("""{"type":"Magic","data":{"ObjectID":1,"Spell":31,"Direction":8}}""", "Invalid casting direction rejected");
Reject("""{"type":"Magic","data":{"ObjectID":1,"Spell":31,"Direction":3,"Location":{"X":-1,"Y":2}}}""", "Negative spell target coordinates rejected");
Reject("""{"type":"Magic","data":{"ObjectID":0,"Spell":31,"Direction":3}}""", "Missing caster rejected");
var point = JsonSerializer.SerializeToElement(new ServerPackets.UserLocation
{
    Location = new System.Drawing.Point(17, 29), Direction = MirDirection.Down
}, GameSession.Json);
Check(point.GetProperty("Location").GetProperty("X").GetInt32() == 17, "Server location survives JSON projection");
var item = new UserItem(new ItemInfo()) { UniqueID = ulong.MaxValue, Count = 1 };
var projected = JsonSerializer.SerializeToElement(item, GameSession.Json);
Check(projected.GetProperty("UniqueID").GetString() == ulong.MaxValue.ToString(), "Item IDs preserve all 64 bits");
var npc = Parse("""{"type":"CallNPC","data":{"ObjectID":123,"Key":"[@Main]"}}""");
var decodedNpc = (ClientPackets.CallNPC)Packet.ReceivePacket(npc.GetPacketBytes().ToArray(), out _);
Check(decodedNpc.ObjectID == 123 && decodedNpc.Key == "[@Main]", "NPC script interaction survives binary protocol");
Reject("""{"type":"CallNPC","data":{"ObjectID":0,"Key":"[@Main]"}}""", "Missing NPC rejected");
Reject("""{"type":"CallNPC","data":{"ObjectID":123,"Key":null}}""", "Null NPC page rejected");
Reject("""{"type":"CallNPC","data":{"ObjectID":123,"Key":"Main"}}""", "Malformed NPC page rejected");
var chat = Parse("""{"type":"Chat","data":{"Message":"@INFO gan","LinkedItems":[]}}""");
var decodedChat = (ClientPackets.Chat)Packet.ReceivePacket(chat.GetPacketBytes().ToArray(), out _);
Check(decodedChat.Message == "@INFO gan", "GM commands reach the native chat protocol unchanged");
Reject(JsonSerializer.Serialize(new { type = "Chat", data = new { Message = new string('x', Globals.MaxChatLength + 1), LinkedItems = Array.Empty<object>() } }),
    "Chat beyond the native 80-character limit rejected");
var mapRequest = Parse("""{"type":"RequestMapInfo","data":{"MapIndex":42}}""");
Check(((ClientPackets.RequestMapInfo)Packet.ReceivePacket(mapRequest.GetPacketBytes().ToArray(), out _)).MapIndex == 42,
    "Global map request uses native binary protocol");
Reject("""{"type":"RequestMapInfo","data":{"MapIndex":-1}}""", "Negative map index rejected");
var inputReply = (ClientPackets.NPCConfirmInput)Parse("""{"type":"NPCConfirmInput","data":{"NPCID":123,"PageName":"[@Name]","Value":"example name"}}""");
var decodedInput = (ClientPackets.NPCConfirmInput)Packet.ReceivePacket(inputReply.GetPacketBytes().ToArray(), out _);
Check(decodedInput.NPCID == 123 && decodedInput.PageName == "[@Name]" && decodedInput.Value == "example name",
    "NPC input retains request identity and text through binary protocol");
Reject("""{"type":"NPCConfirmInput","data":{"NPCID":0,"PageName":"[@Name]","Value":"a"}}""", "NPC input without identity rejected");
Reject("""{"type":"NPCConfirmInput","data":{"NPCID":123,"PageName":null,"Value":"a"}}""", "NPC input without page rejected");
Reject("""{"type":"NPCConfirmInput","data":{"NPCID":123,"PageName":"[@Name]","Value":null}}""", "Null NPC input rejected");
Reject("""{"type":"NPCConfirmInput","data":{"NPCID":123,"PageName":"[@Name]","Value":"a\nb"}}""", "Control characters in NPC input rejected");
Reject(JsonSerializer.Serialize(new { type = "NPCConfirmInput", data = new { NPCID = 123, PageName = "[@Name]", Value = new string('x', 201) } }),
    "Oversized NPC input rejected");
var inputGate = new NpcInputRequest();
Check(!inputGate.Accept(inputReply), "Unsolicited NPC input not forwarded");
inputGate.Observe(new ServerPackets.NPCRequestInput { NPCID = 123, PageName = "[@Name]" });
Check(!inputGate.Accept(new ClientPackets.NPCConfirmInput { NPCID = 124, PageName = "[@Name]", Value = "x" }), "NPC identity substitution rejected");
Check(!inputGate.Accept(new ClientPackets.NPCConfirmInput { NPCID = 123, PageName = "[@Other]", Value = "x" }), "NPC page substitution rejected");
Check(inputGate.Accept(inputReply), "Current NPC input accepted");
Check(!inputGate.Accept(inputReply), "Repeated NPC input not forwarded");
foreach (Packet change in new Packet[] { new ServerPackets.MapChanged(), new ServerPackets.LogOutSuccess(), new ServerPackets.MapInformation() })
{
    inputGate.Observe(new ServerPackets.NPCRequestInput { NPCID = 123, PageName = "[@Name]" });
    inputGate.Observe(change);
    Check(!inputGate.Accept(inputReply), "NPC input cleared by " + change.GetType().Name);
}
inputGate.Observe(new ServerPackets.NPCRequestInput { NPCID = 123, PageName = "[@Name]" });
inputGate.Accept(new ClientPackets.CallNPC { ObjectID = 123, Key = "[@Main]" });
Check(!inputGate.Accept(inputReply), "New NPC dialogue cancels old input");
var purchase = (ClientPackets.BuyItem)Parse("""{"type":"BuyItem","data":{"ItemIndex":"18446744073709551615","Count":3,"Type":0}}""");
var decodedPurchase = (ClientPackets.BuyItem)Packet.ReceivePacket(purchase.GetPacketBytes().ToArray(), out _);
Check(decodedPurchase.ItemIndex == ulong.MaxValue && decodedPurchase.Count == 3 && decodedPurchase.Type == PanelType.Buy,
    "NPC purchase preserves advertised goods ID, quantity and native panel type");
Reject("""{"type":"BuyItem","data":{"ItemIndex":"1","Count":0,"Type":0}}""", "Zero-count purchase rejected");
Reject("""{"type":"BuyItem","data":{"ItemIndex":"0","Count":1,"Type":0}}""", "Missing goods ID rejected");
Reject("""{"type":"BuyItem","data":{"ItemIndex":"1","Count":1,"Type":2}}""", "Crafting cannot masquerade as purchase");
for (int mode = 0; mode <= 5; mode++)
{
    var command = Parse(JsonSerializer.Serialize(new { type = "ChangeAMode", data = new { Mode = mode } }));
    Check((int)((ClientPackets.ChangeAMode)Packet.ReceivePacket(command.GetPacketBytes().ToArray(), out _)).Mode == mode,
        "Native attack mode survives round trip: " + mode);
}
Reject("""{"type":"ChangeAMode","data":{"Mode":6}}""", "Unknown attack mode rejected");
var pricedInfo = new ItemInfo { Index = 99, Price = 1000, Durability = 10000 };
var pricedItem = new UserItem(pricedInfo) { UniqueID = 45, Count = 7, MaxDura = 9000, CurrentDura = 5000 };
pricedItem.AddedStats[Stat.MaxDC] = 3;
var originalPrice = pricedItem.Price();
var quote = JsonSerializer.SerializeToElement(ShopPrices.Project(new ServerPackets.NPCGoods
{
    List = new List<UserItem> { pricedItem }, Rate = 1.2f, Type = PanelType.Buy
}, new Dictionary<int, ItemInfo> { [99] = pricedInfo }), GameSession.Json);
Check(quote.GetProperty("BasePrices").GetProperty("45").GetUInt32() == originalPrice / 7,
    "Shop quote reuses native durability and added-stat pricing");
Check(pricedItem.Count == 7 && pricedItem.Price() == originalPrice, "Shop projection never mutates goods quantity");
var harvest = Parse("""{"type":"Harvest","data":{"Direction":7}}""");
Check(((ClientPackets.Harvest)Packet.ReceivePacket(harvest.GetPacketBytes().ToArray(), out _)).Direction == MirDirection.UpLeft,
    "Harvest uses the native directional protocol without inventing item rewards");
Reject("""{"type":"Harvest","data":{"Direction":8}}""", "Invalid harvest direction rejected");
var revive = Parse("""{"type":"TownRevive","data":{}}""");
Check(Packet.ReceivePacket(revive.GetPacketBytes().ToArray(), out var reviveExtra) is ClientPackets.TownRevive && reviveExtra.Length == 0,
    "Town revive uses the native empty-body protocol");
// The empty commands carry no fields, so unmapped members are dropped exactly as they are for LogOut.
Check(Parse("""{"type":"TownRevive","data":{"Effect":7}}""").GetPacketBytes().ToArray().Length ==
    Parse("""{"type":"TownRevive","data":{}}""").GetPacketBytes().ToArray().Length,
    "Extra fields on an empty command never reach the server");
Reject("""{"type":"TownRevive","data":[]}""", "Non-object revive body rejected");
var creation = Parse("""{"type":"NewCharacter","data":{"Name":"webtest1","Gender":1,"Class":4}}""");
var decodedCreation = (ClientPackets.NewCharacter)Packet.ReceivePacket(creation.GetPacketBytes().ToArray(), out var creationExtra);
Check(decodedCreation.Name == "webtest1" && decodedCreation.Gender == MirGender.Female &&
    decodedCreation.Class == MirClass.Archer && creationExtra.Length == 0,
    "Character creation uses the native name, gender and class protocol");
Reject("""{"type":"NewCharacter","data":{"Name":"","Gender":0,"Class":0}}""", "Empty character name rejected");
Reject("""{"type":"NewCharacter","data":{"Name":null,"Gender":0,"Class":0}}""", "Null character name rejected");
Reject(JsonSerializer.Serialize(new { type = "NewCharacter", data = new { Name = new string('x', Globals.MinCharacterNameLength - 1), Gender = 0, Class = 0 } }),
    "Character name below the native minimum rejected");
Reject(JsonSerializer.Serialize(new { type = "NewCharacter", data = new { Name = new string('x', Globals.MaxCharacterNameLength + 1), Gender = 0, Class = 0 } }),
    "Character name beyond the native maximum rejected");
Reject("""{"type":"NewCharacter","data":{"Name":"web\ntest","Gender":0,"Class":0}}""", "Control characters in a character name rejected");
Reject("""{"type":"NewCharacter","data":{"Name":"webtest1","Gender":2,"Class":0}}""", "Unknown gender rejected");
Reject("""{"type":"NewCharacter","data":{"Name":"webtest1","Gender":0,"Class":5}}""", "Unknown class rejected");
var deletion = Parse("""{"type":"DeleteCharacter","data":{"CharacterIndex":7}}""");
Check(((ClientPackets.DeleteCharacter)Packet.ReceivePacket(deletion.GetPacketBytes().ToArray(), out _)).CharacterIndex == 7,
    "Character deletion uses the native binary protocol");
Reject("""{"type":"DeleteCharacter","data":{"CharacterIndex":0}}""", "Deletion without a character rejected");
Reject("""{"type":"DeleteCharacter","data":{"CharacterIndex":-1}}""", "Negative character index rejected");
var itemDrop = Parse("""{"type":"DropItem","data":{"UniqueID":"18446744073709551615","Count":65535,"HeroInventory":false}}""");
var decodedDrop = (ClientPackets.DropItem)Packet.ReceivePacket(itemDrop.GetPacketBytes().ToArray(), out var dropExtra);
Check(decodedDrop.UniqueID == ulong.MaxValue && decodedDrop.Count == ushort.MaxValue && !decodedDrop.HeroInventory && dropExtra.Length == 0,
    "Item drop preserves 64-bit IDs and the full stack range through the binary protocol");
Reject("""{"type":"DropItem","data":{"UniqueID":"0","Count":1,"HeroInventory":false}}""", "Drop without an item ID rejected");
Reject("""{"type":"DropItem","data":{"UniqueID":"1","Count":0,"HeroInventory":false}}""", "Drop of nothing rejected");
Reject("""{"type":"DropItem","data":{"UniqueID":"1","Count":1,"HeroInventory":true}}""", "Hero inventory drop rejected");
var goldDrop = Parse("""{"type":"DropGold","data":{"Amount":4294967295}}""");
Check(((ClientPackets.DropGold)Packet.ReceivePacket(goldDrop.GetPacketBytes().ToArray(), out var goldExtra)).Amount == uint.MaxValue && goldExtra.Length == 0,
    "Gold drop uses the native 32-bit amount protocol");
Reject("""{"type":"DropGold","data":{"Amount":0}}""", "Drop of no gold rejected");
var itemSplit = Parse("""{"type":"SplitItem","data":{"Grid":1,"UniqueID":"18446744073709551615","Count":7}}""");
var decodedSplit = (ClientPackets.SplitItem)Packet.ReceivePacket(itemSplit.GetPacketBytes().ToArray(), out var splitExtra);
Check(decodedSplit.Grid == MirGridType.Inventory && decodedSplit.UniqueID == ulong.MaxValue && decodedSplit.Count == 7 && splitExtra.Length == 0,
    "Item split carries the inventory grid, item ID and count to the server");
Reject("""{"type":"SplitItem","data":{"Grid":4,"UniqueID":"1","Count":1}}""", "Storage split rejected");
Reject("""{"type":"SplitItem","data":{"Grid":1,"UniqueID":"0","Count":1}}""", "Split without an item ID rejected");
Reject("""{"type":"SplitItem","data":{"Grid":1,"UniqueID":"1","Count":0}}""", "Split of nothing rejected");
var sale = Parse("""{"type":"SellItem","data":{"UniqueID":"18446744073709551615","Count":65535}}""");
var decodedSale = (ClientPackets.SellItem)Packet.ReceivePacket(sale.GetPacketBytes().ToArray(), out var saleExtra);
Check(decodedSale.UniqueID == ulong.MaxValue && decodedSale.Count == ushort.MaxValue && saleExtra.Length == 0,
    "Item sale carries the 64-bit item ID and the full stack count to the server");
Reject("""{"type":"SellItem","data":{"UniqueID":"0","Count":1}}""", "Sale without an item ID rejected");
Reject("""{"type":"SellItem","data":{"UniqueID":"1","Count":0}}""", "Sale of nothing rejected");
var repair = Parse("""{"type":"RepairItem","data":{"UniqueID":"18446744073709551615"}}""");
var decodedRepair = (ClientPackets.RepairItem)Packet.ReceivePacket(repair.GetPacketBytes().ToArray(), out var repairExtra);
Check(decodedRepair.UniqueID == ulong.MaxValue && repairExtra.Length == 0,
    "Item repair carries the 64-bit item ID to the server");
Reject("""{"type":"RepairItem","data":{"UniqueID":"0"}}""", "Repair without an item ID rejected");
Reject("""{"type":"SRepairItem","data":{"UniqueID":"1"}}""", "Special repair is not offered by this client");
// Character names must clear the same regex the server applies (Envir.CharacterReg), because
// char.IsControl does not reject format characters that make two names look identical.
Reject("""{"type":"NewCharacter","data":{"Name":"  ab  ","Gender":0,"Class":0}}""", "Padded character name rejected");
Reject("""{"type":"NewCharacter","data":{"Name":"a b;@[]","Gender":0,"Class":0}}""", "Punctuated character name rejected");
Reject("""{"type":"NewCharacter","data":{"Name":"ab\u200bcd","Gender":0,"Class":0}}""", "Zero-width character name rejected");
Reject("""{"type":"NewCharacter","data":{"Name":"ab\u202ecd","Gender":0,"Class":0}}""", "Bidi override character name rejected");
Check(((ClientPackets.NewCharacter)Parse("""{"type":"NewCharacter","data":{"Name":"webtest1","Gender":1,"Class":2}}""")).Name == "webtest1",
    "Plain character name accepted");
var deposit = Parse("""{"type":"StoreItem","data":{"From":45,"To":79}}""");
var decodedDeposit = (ClientPackets.StoreItem)Packet.ReceivePacket(deposit.GetPacketBytes().ToArray(), out var depositExtra);
Check(decodedDeposit.From == 45 && decodedDeposit.To == 79 && depositExtra.Length == 0,
    "Storage deposit carries the bag slot and the vault slot to the server");
var withdrawal = Parse("""{"type":"TakeBackItem","data":{"From":0,"To":6}}""");
var decodedWithdrawal = (ClientPackets.TakeBackItem)Packet.ReceivePacket(withdrawal.GetPacketBytes().ToArray(), out var withdrawalExtra);
Check(decodedWithdrawal.From == 0 && decodedWithdrawal.To == 6 && withdrawalExtra.Length == 0,
    "Storage withdrawal carries the vault slot and the bag slot to the server");
Reject("""{"type":"StoreItem","data":{"From":-1,"To":0}}""", "Negative bag slot in a deposit rejected");
Reject("""{"type":"StoreItem","data":{"From":0,"To":-1}}""", "Negative vault slot in a deposit rejected");
Reject("""{"type":"StoreItem","data":{"From":256,"To":0}}""", "Out-of-range bag slot in a deposit rejected");
// Globals.StorageGridSize is one vault page. AccountInfo.ExpandStorage doubles Storage to two
// pages for a rented vault, so the wire has to carry the second page: a rejected command closes
// the whole browser session, which would leave such an account unable to touch slots 80..159 at
// all. AccountInfo.IsValidStorageIndex still refuses the second page for accounts without it.
Check(((ClientPackets.StoreItem)Parse(JsonSerializer.Serialize(new
    { type = "StoreItem", data = new { From = 0, To = 2 * Globals.StorageGridSize - 1 } }))).To == 2 * Globals.StorageGridSize - 1,
    "Expanded vault slots are carried to the server instead of closing the session");
Check(((ClientPackets.TakeBackItem)Parse(JsonSerializer.Serialize(new
    { type = "TakeBackItem", data = new { From = Globals.StorageGridSize, To = 0 } }))).From == Globals.StorageGridSize,
    "The first slot of the rented vault page is carried to the server");
Reject(JsonSerializer.Serialize(new { type = "StoreItem", data = new { From = 0, To = 2 * Globals.StorageGridSize } }),
    "Vault slot beyond the largest account storage rejected");
Reject("""{"type":"TakeBackItem","data":{"From":-1,"To":0}}""", "Negative vault slot in a withdrawal rejected");
Reject("""{"type":"TakeBackItem","data":{"From":0,"To":-1}}""", "Negative bag slot in a withdrawal rejected");
Reject(JsonSerializer.Serialize(new { type = "TakeBackItem", data = new { From = 2 * Globals.StorageGridSize, To = 0 } }),
    "Vault slot beyond the largest account storage in a withdrawal rejected");
Reject("""{"type":"TakeBackItem","data":{"From":0,"To":256}}""", "Out-of-range bag slot in a withdrawal rejected");
// Storage passwords are not part of this client, so the two commands that manage them
// must not become a way to brute-force a vault through the browser gateway.
Reject("""{"type":"UnlockStorage","data":{"Password":"secret"}}""", "Storage unlock is not offered by this client");
Reject("""{"type":"SetStoragePassword","data":{"CurrentPassword":"a","NewPassword":"b"}}""", "Storage password changes are not offered by this client");
// A malformed unique id must not surface the attacker's text through a FormatException.
Reject("""{"type":"DropItem","data":{"UniqueID":"abc","Count":1,"HeroInventory":false}}""", "Non-numeric unique id rejected");
Reject("""{"type":"DropItem","data":{"UniqueID":"99999999999999999999999","Count":1,"HeroInventory":false}}""", "Overflowing unique id rejected");
Reject("""{"type":"SplitItem","data":{"Grid":1,"UniqueID":"","Count":1}}""", "Empty unique id rejected");

// The sell and repair panels quote prices the browser computes itself, from the same inputs
// UserItem.Price() and UserItem.RepairPrice() use. Two things have to hold for that to be safe.

// First, AddedStats has to survive the gateway. StatsConverter flattens Stats into one number
// per stat, absent ones as 0, and Stats.Count is a sum of magnitudes rather than a key count,
// so summing the flattened object reproduces it. Client.Web/src/item-price.js relies on this.
var added = new Stats();
added[Stat.MaxDC] = 3;
added[Stat.MaxAC] = -2;
using (var flattened = JsonDocument.Parse(JsonSerializer.Serialize(added, GameSession.Json)))
{
    int sum = 0;
    foreach (var stat in flattened.RootElement.EnumerateObject()) sum += Math.Abs(stat.Value.GetInt32());
    Check(sum == added.Count && added.Count == 5,
        "A browser can still recover AddedStats.Count from the flattened stats the gateway sends");
}

// Second, the ported formulas have to keep agreeing with the server's. These are the same items
// item-price.test.js pins, so a change to UserItem.Price() breaks here and names the JS copy.
var potion = new ItemInfo { Index = 1, Name = "potion", Price = 200, Durability = 0, StackSize = 50 };
var sword = new ItemInfo { Index = 2, Name = "sword", Price = 15000, Durability = 5000 };
var ring = new ItemInfo { Index = 3, Name = "ring", Price = 7, Durability = 3 };
var worn = new UserItem(sword) { Count = 1, MaxDura = 4500, CurrentDura = 1200 };
var upgraded = new UserItem(sword) { Count = 1, MaxDura = 4500, CurrentDura = 1200 };
upgraded.AddedStats[Stat.MaxDC] = 3;
upgraded.AddedStats[Stat.MaxAC] = -2;
var rented = new UserItem(sword) { Count = 1, MaxDura = 4500, CurrentDura = 1200, RentalInformation = new RentalInformation() };
Check(new UserItem(potion) { Count = 7 }.Price() == 1400 &&
    worn.Price() == 11775 && upgraded.Price() == 17662 &&
    new UserItem(sword) { Count = 1, MaxDura = 5000, CurrentDura = 5000 }.Price() == 15000 &&
    new UserItem(sword) { Count = 1, MaxDura = 0, CurrentDura = 0 }.Price() == 7500 &&
    new UserItem(ring) { Count = 1, MaxDura = 2, CurrentDura = 1 }.Price() == 5,
    "Item sale prices match the values the browser price module is pinned to");
Check(worn.RepairPrice() == 2475 && upgraded.RepairPrice() == 3713 && rented.RepairPrice() == 4950 &&
    new UserItem(sword) { Count = 1, MaxDura = 5000, CurrentDura = 5000 }.RepairPrice() == 0 &&
    (uint)(upgraded.RepairPrice() * 1.35F) == 5012,
    "Item repair prices, including the NPC rate, match the values the browser price module is pinned to");

Console.WriteLine($"{count}/{count} passed");

