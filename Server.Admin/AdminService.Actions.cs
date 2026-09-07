using System.Drawing;
using Server.MirDatabase;
using Server.MirEnvir;
using Server.MirObjects;
using S = ServerPackets;

namespace Server.Admin
{
    public sealed partial class AdminService
    {
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
                if (level < 1 || level > ushort.MaxValue) throw new AdminException("Level must be between 1 and 65535.");
                var player = OnlinePlayer(playerName);
                var old = player.Level;
                player.Level = (ushort)level;
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
                return Log($"{(admin ? "granted" : "revoked")} admin on {account.AccountID}");
            });
        }

        public AdminActionResult SaveNow()
        {
            return runner.Run(() =>
            {
                envir.SaveDB();
                envir.SaveAccounts();
                return Log("saved database and accounts");
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
    }
}
