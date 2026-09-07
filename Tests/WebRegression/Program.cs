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
Console.WriteLine($"{count}/{count} passed");
