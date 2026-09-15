using System.Net.Sockets;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;
using C = ClientPackets;
using S = ServerPackets;

namespace Crystal.Web;

public static class GameSession
{
    // The gateway used to dial 127.0.0.1:7000 as a literal, which meant it could only ever
    // reach one content pack. Packs run on their own ports -- classic on 7000, mir-176 on
    // 7100 -- so the upstream is chosen at startup instead.
    public static (string Host, int Port) GameServer { get; set; } = ("127.0.0.1", 7000);

    public static readonly JsonSerializerOptions Json = CreateJson();

    // Mirrors Envir.CharacterReg. char.IsControl misses format characters such as
    // U+200B and U+202E, which allow visually identical character names.
    // CharacterInfo.Trade and CharacterInfo.Refine, whose lengths the server checks directly.
    private const int TradeSlots = 10, RefineSlots = 16, InventorySlots = 46;

    private static readonly Regex CharacterName = new(
        $"^[\\u4e00-\\u9fa5_A-Za-z0-9]{{{Globals.MinCharacterNameLength},{Globals.MaxCharacterNameLength}}}$",
        RegexOptions.Compiled);

    private static JsonSerializerOptions CreateJson()
    {
        var resolver = new DefaultJsonTypeInfoResolver();
        resolver.Modifiers.Add(info =>
        {
            for (int i = info.Properties.Count - 1; i >= 0; i--)
                if (info.Properties[i].AttributeProvider is PropertyInfo property && !property.CanWrite)
                    info.Properties.RemoveAt(i);
        });
        var options = new JsonSerializerOptions
        {
            IncludeFields = true, TypeInfoResolver = resolver,
            ReferenceHandler = ReferenceHandler.IgnoreCycles, MaxDepth = 32
        };
        options.Converters.Add(new StatsConverter());
        options.Converters.Add(new UInt64Converter());
        options.Converters.Add(new ColourConverter());
        return options;
    }

    public static async Task Run(WebSocket socket, string clientAssembly, CancellationToken cancellation)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        using var tcp = new TcpClient { NoDelay = true };
        using var writeLock = new SemaphoreSlim(1);
        var knownMaps = new ConcurrentDictionary<int, byte>();
        var npcInput = new NpcInputRequest();
        var itemDefinitions = new Dictionary<int, ItemInfo>();
        try
        {
            await tcp.ConnectAsync(GameServer.Host, GameServer.Port, stop.Token);
            var stream = tcp.GetStream();
            async Task Send(Packet packet)
            {
                byte[] data = packet.GetPacketBytes().ToArray();
                await writeLock.WaitAsync(stop.Token);
                try { await stream.WriteAsync(data, stop.Token); }
                finally { writeLock.Release(); }
            }
            async Task ReadServer()
            {
                byte[] header = new byte[4];
                while (!stop.IsCancellationRequested)
                {
                    await stream.ReadExactlyAsync(header, stop.Token);
                    int length = BitConverter.ToUInt16(header);
                    if (length < 4) throw new InvalidDataException("Invalid frame size");
                    byte[] data = new byte[length];
                    header.CopyTo(data, 0);
                    await stream.ReadExactlyAsync(data.AsMemory(4), stop.Token);
                    var packet = Packet.ReceivePacket(data, out _);
                    if (packet is null) continue;
                    npcInput.Observe(packet);
                    if (packet is S.NewItemInfo definition) itemDefinitions[definition.Info.Index] = definition.Info;
                    if (packet is S.MapInformation currentMap) knownMaps.TryAdd(currentMap.MapIndex, 0);
                    if (packet is S.MapChanged changedMap) knownMaps.TryAdd(changedMap.MapIndex, 0);
                    if (packet is S.WorldMapSetupInfo worldMap)
                        foreach (var icon in worldMap.Setup.Icons) knownMaps.TryAdd(icon.MapIndex, 0);
                    if (packet is S.NewMapInfo mapInfo)
                    {
                        knownMaps.TryAdd(mapInfo.MapIndex, 0);
                        foreach (var movement in mapInfo.Info.Movements) knownMaps.TryAdd(movement.Destination, 0);
                    }
                    if (packet is S.Connected)
                    {
                        byte[] hash = MD5.HashData(await File.ReadAllBytesAsync(clientAssembly, stop.Token));
                        await Send(new C.ClientVersion { VersionHash = hash });
                    }
                    byte[] json;
                    try
                    {
                        json = JsonSerializer.SerializeToUtf8Bytes(new
                        {
                            type = packet.GetType().Name,
                            data = packet is S.NPCGoods goods
                                ? JsonSerializer.SerializeToElement(ShopPrices.Project(goods, itemDefinitions), Json)
                                : JsonSerializer.SerializeToElement(packet, packet.GetType(), Json)
                        });
                    }
                    catch (Exception error)
                    {
                        // Optional native dialogs must not terminate the entire browser session.
                        Console.Error.WriteLine($"Skipped {packet.GetType().Name}: {error.GetType().Name}");
                        continue;
                    }
                    await socket.SendAsync(json, WebSocketMessageType.Text, true, stop.Token);
                }
            }
            async Task ReadBrowser()
            {
                byte[] buffer = new byte[8192];
                var window = DateTime.UtcNow;
                int messages = 0;
                while (!stop.IsCancellationRequested)
                {
                    int length = 0;
                    ValueWebSocketReceiveResult received;
                    do
                    {
                        if (length == buffer.Length) throw new InvalidDataException("Command too large");
                        received = await socket.ReceiveAsync(buffer.AsMemory(length), stop.Token);
                        if (received.MessageType == WebSocketMessageType.Close) return;
                        if (received.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Text required");
                        length += received.Count;
                    } while (!received.EndOfMessage);
                    if (DateTime.UtcNow - window > TimeSpan.FromSeconds(1)) { window = DateTime.UtcNow; messages = 0; }
                    if (++messages > 40) throw new InvalidDataException("Too many commands");
                    var command = ParseCommand(buffer.AsSpan(0, length));
                    // The native server assumes requested maps exist; only forward advertised IDs.
                    if (command is C.RequestMapInfo request && !knownMaps.ContainsKey(request.MapIndex)) continue;
                    if (!npcInput.Accept(command)) continue;
                    await Send(command);
                }
            }
            var tasks = new[] { ReadServer(), ReadBrowser() };
            await Task.WhenAny(tasks);
            stop.Cancel();
            tcp.Close();
            try { await Task.WhenAll(tasks); }
            catch (Exception e) when (e is OperationCanceledException or IOException or InvalidDataException or WebSocketException or SocketException) { }
        }
        catch (Exception e) when (e is SocketException or IOException or InvalidDataException or JsonException or InvalidOperationException or WebSocketException or OperationCanceledException)
        {
            // Credentials and gameplay command bodies must never reach application logs, but
            // which rule rejected a command must: without it a refused command is
            // indistinguishable from a network drop, and the only symptom is a browser that
            // waits forever. Every InvalidDataException message here is a fixed literal.
            Console.Error.WriteLine(e is InvalidDataException
                ? $"Session ended: {e.Message}" : $"Session ended: {e.GetType().Name}");
        }
        finally
        {
            stop.Cancel();
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                using var close = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Connection ended", close.Token); }
                catch (Exception e) when (e is WebSocketException or OperationCanceledException) { }
            }
        }
    }

    public static Packet ParseCommand(ReadOnlySpan<byte> bytes)
    {
        using var document = JsonDocument.Parse(bytes.ToArray());
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var command) ||
            command.ValueKind != JsonValueKind.String) throw new InvalidDataException("Invalid command envelope");
        Type type = command.GetString() switch
        {
            "Login" => typeof(C.Login), "NewAccount" => typeof(C.NewAccount), "StartGame" => typeof(C.StartGame),
            "Walk" => typeof(C.Walk), "Run" => typeof(C.Run), "Turn" => typeof(C.Turn),
            "Attack" => typeof(C.Attack), "PickUp" => typeof(C.PickUp),
            "Harvest" => typeof(C.Harvest),
            "UseItem" => typeof(C.UseItem), "EquipItem" => typeof(C.EquipItem),
            "RemoveItem" => typeof(C.RemoveItem), "MoveItem" => typeof(C.MoveItem),
            "DropItem" => typeof(C.DropItem), "DropGold" => typeof(C.DropGold),
            "SplitItem" => typeof(C.SplitItem),
            "Magic" => typeof(C.Magic),
            "CallNPC" => typeof(C.CallNPC),
            "NPCConfirmInput" => typeof(C.NPCConfirmInput),
            "BuyItem" => typeof(C.BuyItem), "ChangeAMode" => typeof(C.ChangeAMode),
            "SellItem" => typeof(C.SellItem), "RepairItem" => typeof(C.RepairItem),
            "SRepairItem" => typeof(C.SRepairItem),
            "RequestMapInfo" => typeof(C.RequestMapInfo),
            "Chat" => typeof(C.Chat), "KeepAlive" => typeof(C.KeepAlive),
            "LogOut" => typeof(C.LogOut), "NewCharacter" => typeof(C.NewCharacter),
            "DeleteCharacter" => typeof(C.DeleteCharacter),
            "TownRevive" => typeof(C.TownRevive),
            "StoreItem" => typeof(C.StoreItem), "TakeBackItem" => typeof(C.TakeBackItem),
            "MagicKey" => typeof(C.MagicKey),
            // Player-to-player trading.
            "TradeRequest" => typeof(C.TradeRequest), "TradeReply" => typeof(C.TradeReply),
            "TradeGold" => typeof(C.TradeGold), "TradeConfirm" => typeof(C.TradeConfirm),
            "TradeCancel" => typeof(C.TradeCancel),
            "DepositTradeItem" => typeof(C.DepositTradeItem),
            "RetrieveTradeItem" => typeof(C.RetrieveTradeItem),
            // Parties.
            "AddMember" => typeof(C.AddMember), "DelMember" => typeof(C.DelMember),
            "GroupInvite" => typeof(C.GroupInvite), "SwitchGroup" => typeof(C.SwitchGroup),
            // Refining, and the appraisal that follows it.
            "RefineItem" => typeof(C.RefineItem), "CheckRefine" => typeof(C.CheckRefine),
            "DepositRefineItem" => typeof(C.DepositRefineItem),
            "RetrieveRefineItem" => typeof(C.RetrieveRefineItem),
            // Doors. Map.AddDoor masks the map byte with 0x7F, so 1..127 is the whole range.
            "Opendoor" => typeof(C.Opendoor),
            // Crafting. One packet names the recipe and the bag slots its materials sit in.
            "CraftItem" => typeof(C.CraftItem),
            // 刺杀剑术 and 半月弯刀 are switches the player throws, and 烈火剑法 is armed the
            // same way; none of the three travels as a C.Magic.
            "SpellToggle" => typeof(C.SpellToggle),
            // 查看装备: the one thing 1.76 lets a player look at on someone else.
            "Inspect" => typeof(C.Inspect),
            _ => throw new InvalidDataException("Unsupported command")
        };
        var packet = (Packet?)JsonSerializer.Deserialize(data, type, Json) ?? throw new JsonException();
        if (packet is C.RequestMapInfo map && map.MapIndex < 0) throw new InvalidDataException("Invalid map index");
        if (packet is C.BuyItem buy && (buy.ItemIndex == 0 || buy.Count == 0 || buy.Type != PanelType.Buy))
            throw new InvalidDataException("Invalid purchase");
        // The server sells whole or partial stacks out of the bag; a count of zero is answered
        // with a bare failure, so refuse it here rather than spending a round trip on it.
        if (packet is C.SellItem sale && (sale.UniqueID == 0 || sale.Count == 0))
            throw new InvalidDataException("Invalid sale");
        if (packet is C.RepairItem repair && repair.UniqueID == 0)
            throw new InvalidDataException("Invalid repair");
        // Special repair costs three times as much and spares the item's maximum durability;
        // the server runs it through the same PlayerObject.RepairItem with special = true.
        if (packet is C.SRepairItem specialRepair && specialRepair.UniqueID == 0)
            throw new InvalidDataException("Invalid special repair");
        // NPCScript.Craft reads player.Info.Inventory[slot] for every slot in the packet and
        // dereferences the recipe it matched, so a null array or an out-of-range slot is the
        // server's problem to survive, not the browser's to send. One slot per material is
        // the most the server can use: it counts them against the recipe's own requirement
        // count and refuses a mismatch.
        if (packet is C.CraftItem craft && (craft.UniqueID == 0 || craft.Count == 0 || craft.Slots is null ||
            craft.Slots.Length > InventorySlots || craft.Slots.Any(slot => slot is < 0 or >= InventorySlots) ||
            craft.Slots.Distinct().Count() != craft.Slots.Length))
            throw new InvalidDataException("Invalid craft");
        if (packet is C.ChangeAMode mode && !Enum.IsDefined(mode.Mode)) throw new InvalidDataException("Invalid attack mode");
        // Map.OpenDoor walks its door list looking for the index and returns false when it is
        // not there, silently. Index 0 is "no door" in the map data and can never match.
        if (packet is C.Opendoor door && (door.DoorIndex == 0 || door.DoorIndex > 0x7F))
            throw new InvalidDataException("Invalid door");
        // Both trade grids and the refine grid are fixed-size arrays on CharacterInfo, and the
        // server answers an index outside them with a bare failure. Refusing here costs the
        // player a round trip rather than a silent nothing.
        if (packet is C.DepositTradeItem tradeIn && (tradeIn.From is < 0 or > 255 ||
            tradeIn.To < 0 || tradeIn.To >= TradeSlots)) throw new InvalidDataException("Invalid trade slot");
        if (packet is C.RetrieveTradeItem tradeOut && (tradeOut.From < 0 || tradeOut.From >= TradeSlots ||
            tradeOut.To is < 0 or > 255)) throw new InvalidDataException("Invalid trade slot");
        if (packet is C.DepositRefineItem refineIn && (refineIn.From is < 0 or > 255 ||
            refineIn.To < 0 || refineIn.To >= RefineSlots)) throw new InvalidDataException("Invalid refine slot");
        if (packet is C.RetrieveRefineItem refineOut && (refineOut.From < 0 || refineOut.From >= RefineSlots ||
            refineOut.To is < 0 or > 255)) throw new InvalidDataException("Invalid refine slot");
        // PlayerObject.TradeGold adds to the offer and refuses anything under 1 without a word.
        if (packet is C.TradeGold tradeGold && tradeGold.Amount < 1)
            throw new InvalidDataException("Invalid trade gold");
        if (packet is C.RefineItem refine && refine.UniqueID == 0)
            throw new InvalidDataException("Invalid refine");
        if (packet is C.CheckRefine check && check.UniqueID == 0)
            throw new InvalidDataException("Invalid refine check");
        // A character name is the only thing either party command carries.
        if (packet is C.AddMember invite && !CharacterName.IsMatch(invite.Name ?? string.Empty))
            throw new InvalidDataException("Invalid group invite");
        if (packet is C.DelMember kick && !CharacterName.IsMatch(kick.Name ?? string.Empty))
            throw new InvalidDataException("Invalid group removal");
        // A player's own keys are 1..16, F1..F8 then Ctrl+F1..F8; 0 clears the binding.
        // MirConnection.MagicKey routes anything above 16 to a hero this client never
        // spawns (Server/MirNetwork/MirConnection.cs:1543-1553).
        if (packet is C.MagicKey magicKey && (magicKey.Key > 16 || magicKey.OldKey > 16 ||
            !Enum.IsDefined(magicKey.Spell) || magicKey.Spell == Spell.None))
            throw new InvalidDataException("Invalid skill key");
        if (packet is C.NPCConfirmInput input && (input.NPCID == 0 || string.IsNullOrEmpty(input.PageName) ||
            input.PageName.Length > 200 || input.PageName.Any(char.IsControl) || input.Value is null ||
            input.Value.Length > 200 || input.Value.Any(char.IsControl)))
            throw new InvalidDataException("Invalid NPC input");
        if (packet is C.CallNPC npc && (npc.ObjectID == 0 || string.IsNullOrEmpty(npc.Key) || npc.Key.Length > 200 ||
            !npc.Key.StartsWith("[@") || !npc.Key.EndsWith("]") || npc.Key.Any(char.IsControl)))
            throw new InvalidDataException("Invalid NPC interaction");
        if (packet is C.Login login && (string.IsNullOrEmpty(login.AccountID) || string.IsNullOrEmpty(login.Password) ||
            login.AccountID.Length > Globals.MaxAccountIDLength || login.Password.Length > Globals.MaxPasswordLength))
            throw new InvalidDataException("Invalid login length");
        if (packet is C.NewAccount account && (string.IsNullOrWhiteSpace(account.AccountID) || string.IsNullOrEmpty(account.Password) ||
            account.AccountID.Length is < Globals.MinAccountIDLength or > Globals.MaxAccountIDLength ||
            account.Password.Length is < Globals.MinPasswordLength or > Globals.MaxPasswordLength ||
            account.EMailAddress is null || account.EMailAddress.Length > 50 ||
            account.UserName is null || account.UserName.Length > 20 ||
            account.SecretQuestion is null || account.SecretQuestion.Length > 30 ||
            account.SecretAnswer is null || account.SecretAnswer.Length > 30 ||
            account.BirthDate == DateTime.MinValue)) throw new InvalidDataException("Invalid registration");
        if (packet is C.NewCharacter creation && (creation.Name is null || !CharacterName.IsMatch(creation.Name) ||
            !Enum.IsDefined(creation.Gender) || !Enum.IsDefined(creation.Class)))
            throw new InvalidDataException("Invalid character creation");
        // Character indexes are assigned from 1 upwards; 0 means "no character".
        if (packet is C.DeleteCharacter deletion && deletion.CharacterIndex <= 0)
            throw new InvalidDataException("Invalid character index");
        if (packet is C.Chat chat && (string.IsNullOrEmpty(chat.Message) || chat.Message.Length > Globals.MaxChatLength || chat.LinkedItems is null))
            throw new InvalidDataException("Invalid chat");
        if (packet is C.Walk walk && (byte)walk.Direction > 7) throw new InvalidDataException("Invalid direction");
        if (packet is C.Harvest harvest && (byte)harvest.Direction > 7) throw new InvalidDataException("Invalid harvest direction");
        if (packet is C.Run run && (byte)run.Direction > 7) throw new InvalidDataException("Invalid direction");
        if (packet is C.Turn turn && (byte)turn.Direction > 7) throw new InvalidDataException("Invalid direction");
        // A swing may carry one of 1.76's four melee skills. HumanObject.Attack re-checks
        // each of them -- learned, affordable, and in the case of 烈火剑法 actually armed --
        // and degrades the swing to a plain one rather than refusing it, so the only thing
        // worth refusing here is a spell from outside that set.
        if (packet is C.Attack attack && ((byte)attack.Direction > 7 ||
            attack.Spell is not (Spell.None or Spell.Slaying or Spell.Thrusting or Spell.HalfMoon or Spell.FlamingSword)))
            throw new InvalidDataException("Unsupported attack skill");
        // Envir.Inspect looks the id up among the online players and answers nothing when it
        // finds none. Ranking reads a saved character by index instead and Hero inspects a
        // hero; neither exists in this client.
        if (packet is C.Inspect look && (look.ObjectID == 0 || look.Ranking || look.Hero))
            throw new InvalidDataException("Invalid inspect");
        // SpellToggleState.None means "flip whatever it is now", which needs the server to
        // hold the state; this client keeps its own and always says which way.
        if (packet is C.SpellToggle toggle && (!Enum.IsDefined(toggle.Spell) || toggle.Spell == Spell.None ||
            toggle.canUse is not (SpellToggleState.True or SpellToggleState.False)))
            throw new InvalidDataException("Invalid spell toggle");
        if (packet is C.UseItem use && (use.Grid != MirGridType.Inventory || use.UniqueID == 0))
            throw new InvalidDataException("Invalid inventory use");
        if (packet is C.EquipItem equip && (equip.Grid != MirGridType.Inventory || equip.UniqueID == 0 || equip.To is < 0 or > 13))
            throw new InvalidDataException("Invalid equipment slot");
        if (packet is C.RemoveItem remove && (remove.Grid != MirGridType.Inventory || remove.UniqueID == 0 || remove.To is < 0 or > 255))
            throw new InvalidDataException("Invalid inventory slot");
        if (packet is C.MoveItem move && (move.Grid != MirGridType.Inventory || move.From is < 0 or > 255 || move.To is < 0 or > 255 || move.From == move.To))
            throw new InvalidDataException("Invalid inventory move");
        // The hero inventory is not part of this client, so a hero drop could only come from a forged command.
        if (packet is C.DropItem drop && (drop.UniqueID == 0 || drop.Count == 0 || drop.HeroInventory))
            throw new InvalidDataException("Invalid item drop");
        if (packet is C.DropGold gold && gold.Amount == 0) throw new InvalidDataException("Invalid gold drop");
        if (packet is C.SplitItem split && (split.Grid != MirGridType.Inventory || split.UniqueID == 0 || split.Count == 0))
            throw new InvalidDataException("Invalid item split");
        // Globals.StorageGridSize is one vault PAGE, not the size of AccountInfo.Storage:
        // AccountInfo.ExpandStorage doubles the array to two pages and persists that, so a rented
        // vault addresses indexes up to 2 * Globals.StorageGridSize - 1. Bound the wire here at
        // the server's own maximum and leave the per-account limit to AccountInfo.IsValidStorageIndex,
        // because rejecting a command tears the whole browser session down: a player with expanded
        // storage would be disconnected by every click on the second page. Both halves of a
        // transfer address a bag slot on one side and a vault slot on the other, and
        // PlayerObject.StoreItem / TakeBackItem answer an out-of-range index with a bare failure.
        const int storageSlots = 2 * Globals.StorageGridSize;
        if (packet is C.StoreItem store && (store.From is < 0 or > 255 || store.To < 0 || store.To >= storageSlots))
            throw new InvalidDataException("Invalid storage deposit");
        if (packet is C.TakeBackItem takeBack && (takeBack.From < 0 || takeBack.From >= storageSlots || takeBack.To is < 0 or > 255))
            throw new InvalidDataException("Invalid storage withdrawal");
        if (packet is C.Magic magic && (magic.ObjectID == 0 || magic.Spell == Spell.None || !Enum.IsDefined(magic.Spell) ||
            (byte)magic.Direction > 7 || magic.Location.X is < 0 or > 32767 || magic.Location.Y is < 0 or > 32767))
            throw new InvalidDataException("Invalid spell command");
        return packet;
    }

    private sealed class StatsConverter : JsonConverter<Stats>
    {
        public override Stats Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => throw new NotSupportedException();
        public override void Write(Utf8JsonWriter writer, Stats value, JsonSerializerOptions options)
        {
            writer.WriteStartObject();
            foreach (Stat stat in Enum.GetValues<Stat>().Distinct()) writer.WriteNumber(stat.ToString(), value[stat]);
            writer.WriteEndObject();
        }
    }
    // System.Drawing.Color exposes R, G and B as get-only properties, and the resolver above
    // removes get-only properties -- so without this every colour the server sends reached the
    // browser as an empty object. That is not a cosmetic loss: a player's name colour is how
    // 1.76 says 红名 (PKPoints >= 200), 灰名 (BrownTime) and which side of a guild war someone
    // is on (PlayerObject.GetNameColour). Written as "#rrggbb"; a fully transparent colour,
    // which is what an unset Color is, becomes null so the browser can fall back to its own
    // default rather than painting the name black.
    private sealed class ColourConverter : JsonConverter<System.Drawing.Color>
    {
        public override System.Drawing.Color Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Null) return System.Drawing.Color.Empty;
            var text = reader.GetString();
            return text is { Length: 7 } && text[0] == '#' && int.TryParse(text[1..], System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out int rgb)
                ? System.Drawing.Color.FromArgb(unchecked((int)0xFF000000) | rgb)
                : throw new JsonException();
        }
        public override void Write(Utf8JsonWriter writer, System.Drawing.Color value, JsonSerializerOptions options)
        {
            if (value.A == 0) writer.WriteNullValue();
            else writer.WriteStringValue($"#{value.R:x2}{value.G:x2}{value.B:x2}");
        }
    }

    private sealed class UInt64Converter : JsonConverter<ulong>
    {
        public override ulong Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            reader.TokenType == JsonTokenType.String
                ? (ulong.TryParse(reader.GetString(), out var parsed) ? parsed : throw new JsonException())
                : reader.GetUInt64();
        public override void Write(Utf8JsonWriter writer, ulong value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString());
    }
}
