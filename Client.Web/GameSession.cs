using System.Net.Sockets;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using C = ClientPackets;
using S = ServerPackets;

namespace Crystal.Web;

public static class GameSession
{
    public static readonly JsonSerializerOptions Json = CreateJson();

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
            await tcp.ConnectAsync("127.0.0.1", 7000, stop.Token);
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
            catch (Exception e) when (e is OperationCanceledException or IOException or WebSocketException or SocketException) { }
        }
        catch (Exception e) when (e is SocketException or IOException or JsonException or InvalidOperationException or WebSocketException or OperationCanceledException)
        {
            // Credentials and gameplay command bodies must never reach application logs.
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
            "Magic" => typeof(C.Magic),
            "CallNPC" => typeof(C.CallNPC),
            "NPCConfirmInput" => typeof(C.NPCConfirmInput),
            "BuyItem" => typeof(C.BuyItem), "ChangeAMode" => typeof(C.ChangeAMode),
            "RequestMapInfo" => typeof(C.RequestMapInfo),
            "Chat" => typeof(C.Chat), "KeepAlive" => typeof(C.KeepAlive),
            "LogOut" => typeof(C.LogOut), "NewCharacter" => typeof(C.NewCharacter),
            "TownRevive" => typeof(C.TownRevive),
            _ => throw new InvalidDataException("Unsupported command")
        };
        var packet = (Packet?)JsonSerializer.Deserialize(data, type, Json) ?? throw new JsonException();
        if (packet is C.RequestMapInfo map && map.MapIndex < 0) throw new InvalidDataException("Invalid map index");
        if (packet is C.BuyItem buy && (buy.ItemIndex == 0 || buy.Count == 0 || buy.Type != PanelType.Buy))
            throw new InvalidDataException("Invalid purchase");
        if (packet is C.ChangeAMode mode && !Enum.IsDefined(mode.Mode)) throw new InvalidDataException("Invalid attack mode");
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
        if (packet is C.Chat chat && (string.IsNullOrEmpty(chat.Message) || chat.Message.Length > Globals.MaxChatLength || chat.LinkedItems is null))
            throw new InvalidDataException("Invalid chat");
        if (packet is C.Walk walk && (byte)walk.Direction > 7) throw new InvalidDataException("Invalid direction");
        if (packet is C.Harvest harvest && (byte)harvest.Direction > 7) throw new InvalidDataException("Invalid harvest direction");
        if (packet is C.Run run && (byte)run.Direction > 7) throw new InvalidDataException("Invalid direction");
        if (packet is C.Turn turn && (byte)turn.Direction > 7) throw new InvalidDataException("Invalid direction");
        if (packet is C.Attack attack && ((byte)attack.Direction > 7 || attack.Spell != Spell.None))
            throw new InvalidDataException("Only basic attacks are supported");
        if (packet is C.UseItem use && (use.Grid != MirGridType.Inventory || use.UniqueID == 0))
            throw new InvalidDataException("Invalid inventory use");
        if (packet is C.EquipItem equip && (equip.Grid != MirGridType.Inventory || equip.UniqueID == 0 || equip.To is < 0 or > 13))
            throw new InvalidDataException("Invalid equipment slot");
        if (packet is C.RemoveItem remove && (remove.Grid != MirGridType.Inventory || remove.UniqueID == 0 || remove.To is < 0 or > 255))
            throw new InvalidDataException("Invalid inventory slot");
        if (packet is C.MoveItem move && (move.Grid != MirGridType.Inventory || move.From is < 0 or > 255 || move.To is < 0 or > 255 || move.From == move.To))
            throw new InvalidDataException("Invalid inventory move");
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
    private sealed class UInt64Converter : JsonConverter<ulong>
    {
        public override ulong Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            reader.TokenType == JsonTokenType.String ? ulong.Parse(reader.GetString()!) : reader.GetUInt64();
        public override void Write(Utf8JsonWriter writer, ulong value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString());
    }
}
