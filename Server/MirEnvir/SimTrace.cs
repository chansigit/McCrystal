using System.Drawing;
using System.Globalization;
using System.Text;
using Server.MirDatabase;
using Server.MirObjects;

namespace Server.MirEnvir
{
    /// <summary>A policy that can say what each agent is busy with, for the trace.</summary>
    public interface ISimPolicyTrace
    {
        IReadOnlyList<string> Activities { get; }
        int Activity(int agent);
    }

    /// <summary>
    /// Records what the agents of one run did, for looking at afterwards: where each one
    /// was and how it stood at regular intervals, and every kill, death, level and trade
    /// as it happened. Kept in memory and written as one JSON file when the run stops.
    /// It only reads the world, so a traced run stays identical to an untraced one.
    /// All members must be used on the engine thread.
    /// </summary>
    public sealed class SimTrace
    {
        private readonly Envir _envir;
        private readonly SimEnv _env;
        private readonly string _path;
        private readonly long _everyMs;
        private long _nextSample;
        private readonly Map _map;

        // Per agent, one value per sample.
        private readonly List<int>[] _x, _y, _level, _gold, _health, _doing, _kills, _deaths, _levelProgress;
        private readonly List<long>[] _experience, _earned, _spent;
        private readonly List<int> _times = new List<int>();

        private struct Last { public int Deaths, Level, Reliefs, ItemsSold, GearBought, Repairs, PotionsBought; public long Earned; }
        private readonly Last[] _last;

        // seconds, agent, kind, x, y, value, name index
        private readonly List<(int T, int Agent, char Kind, int X, int Y, long Value, int Name)> _events = new();
        private readonly List<string> _names = new List<string>();
        private readonly Dictionary<string, int> _nameIndex = new Dictionary<string, int>();
        private readonly Dictionary<PlayerObject, int> _agentOf = new Dictionary<PlayerObject, int>();

        public SimTrace(Envir envir, SimEnv env, string path, int everySeconds)
        {
            _envir = envir;
            _env = env;
            _path = path;
            _everyMs = Math.Max(1, everySeconds) * 1000L;

            var n = env.Agents.Count;
            List<T>[] Columns<T>() => Enumerable.Range(0, n).Select(_ => new List<T>()).ToArray();
            _x = Columns<int>(); _y = Columns<int>(); _level = Columns<int>(); _gold = Columns<int>();
            _health = Columns<int>(); _doing = Columns<int>(); _kills = Columns<int>(); _deaths = Columns<int>(); _levelProgress = Columns<int>();
            _experience = Columns<long>(); _earned = Columns<long>(); _spent = Columns<long>();
            _last = new Last[n];

            for (var i = 0; i < n; i++)
            {
                var player = env.Agents[i].Player;
                if (player == null) continue;
                _agentOf[player] = i;
                _last[i].Level = player.Level;
                _map ??= player.CurrentMap;
            }
        }

        private int Seconds => (int)(_envir.Time / 1000);

        private int Name(string name)
        {
            if (string.IsNullOrEmpty(name)) return -1;
            if (!_nameIndex.TryGetValue(name, out var index))
            {
                index = _names.Count;
                _names.Add(name);
                _nameIndex[name] = index;
            }
            return index;
        }

        private void Event(int agent, char kind, long value = 0, string name = null)
        {
            var player = _env.Agents[agent].Player;
            var at = player?.CurrentLocation ?? Point.Empty;
            _events.Add((Seconds, agent, kind, at.X, at.Y, value, Name(name)));
        }

        /// <summary>Called by a monster as it dies, with the player credited for it.</summary>
        public void Killed(MonsterObject monster, PlayerObject by)
        {
            if (!_agentOf.TryGetValue(by, out var agent)) return;
            _events.Add((Seconds, agent, 'K', monster.CurrentLocation.X, monster.CurrentLocation.Y, monster.Level, Name(monster.Name)));
        }

        /// <summary>Call after every decision step.</summary>
        public void Step()
        {
            var activity = _env.Policy as ISimPolicyTrace;

            for (var i = 0; i < _last.Length; i++)
            {
                var agent = _env.Agents[i];
                var player = agent.Player;
                if (player == null) continue;
                ref var last = ref _last[i];

                if (agent.Deaths != last.Deaths)
                {
                    // The character has already been sent back to town: use where it fell.
                    _events.Add((Seconds, i, 'D', agent.DeathLocation.X, agent.DeathLocation.Y, player.Level, Name(agent.DeathCause)));
                    last.Deaths = agent.Deaths;
                }
                if (player.Level != last.Level) { Event(i, 'L', player.Level); last.Level = player.Level; }
                if (agent.Reliefs != last.Reliefs) { Event(i, 'R'); last.Reliefs = agent.Reliefs; }
                if (agent.ItemsSold != last.ItemsSold)
                {
                    // Gold from selling arrives with the sale, so the rise since the last
                    // step is what this visit to the shop brought in.
                    Event(i, 'S', agent.GoldGained - last.Earned);
                    last.ItemsSold = agent.ItemsSold;
                }
                if (agent.GearBought != last.GearBought) { Event(i, 'G'); last.GearBought = agent.GearBought; }
                if (agent.Repairs != last.Repairs) { Event(i, 'F'); last.Repairs = agent.Repairs; }
                if (agent.PotionsBought != last.PotionsBought) { Event(i, 'P', agent.PotionsBought - last.PotionsBought); last.PotionsBought = agent.PotionsBought; }
                last.Earned = agent.GoldGained;
            }

            if (_envir.Time < _nextSample) return;
            _nextSample = _envir.Time + _everyMs;
            _times.Add(Seconds);

            for (var i = 0; i < _last.Length; i++)
            {
                var agent = _env.Agents[i];
                var player = agent.Player;
                var at = player?.CurrentLocation ?? Point.Empty;
                _x[i].Add(at.X); _y[i].Add(at.Y);
                _level[i].Add(player?.Level ?? 0);
                _levelProgress[i].Add(player == null ? 0 : (int)Math.Floor(SimEnv.FractionalLevel(player) * 100));
                _gold[i].Add((int)Math.Min(int.MaxValue, player?.Account.Gold ?? 0));
                _health[i].Add(player == null || player.Dead ? 0 : (int)Math.Round(100.0 * player.HP / Math.Max(1, player.Stats[Stat.HP])));
                _doing[i].Add(activity?.Activity(i) ?? 0);
                _kills[i].Add(agent.Kills); _deaths[i].Add(agent.Deaths);
                _experience[i].Add(agent.ExperienceGained); _earned[i].Add(agent.GoldGained); _spent[i].Add(agent.GoldSpent);
            }
        }

        private static string Quote(string text) =>
            "\"" + (text ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        private static void Column<T>(StringBuilder json, string name, List<T> values)
        {
            json.Append('"').Append(name).Append("\":[");
            for (var i = 0; i < values.Count; i++)
            {
                if (i > 0) json.Append(',');
                json.Append(Convert.ToString(values[i], CultureInfo.InvariantCulture));
            }
            json.Append(']');
        }

        /// <summary>Writes the whole trace. Call while the agents are still in the world.</summary>
        public void Write()
        {
            var json = new StringBuilder(1 << 22);
            var activity = _env.Policy as ISimPolicyTrace;

            json.Append("{\"meta\":{");
            json.Append($"\"seed\":{Settings.SimulationSeed},\"agents\":{_last.Length},\"seconds\":{Seconds},\"every\":{_everyMs / 1000},");
            json.Append($"\"policy\":{Quote(Settings.SimulationPolicy)},\"off\":{Quote(Settings.SimulationScriptOff)},");
            json.Append($"\"relief\":{(Settings.SimulationRelief ? "true" : "false")},\"view\":{_env.ViewRadius}}},\n");

            // The ground, one bit per cell, row by row.
            if (_map != null)
            {
                var bits = new byte[(_map.Width * _map.Height + 7) / 8];
                for (var y = 0; y < _map.Height; y++)
                    for (var x = 0; x < _map.Width; x++)
                        if (_map.Cells[x, y].Valid) { var b = y * _map.Width + x; bits[b >> 3] |= (byte)(1 << (b & 7)); }
                json.Append($"\"map\":{{\"title\":{Quote(_map.Info.Title)},\"w\":{_map.Width},\"h\":{_map.Height},\"walk\":\"{Convert.ToBase64String(bits)}\"}},\n");

                json.Append("\"safe\":[");
                json.Append(string.Join(",", _map.Info.SafeZones.Select(z => $"[{z.Location.X},{z.Location.Y},{z.Size},{(z.StartPoint ? 1 : 0)}]")));
                json.Append("],\n\"spawns\":[");
                json.Append(string.Join(",", _map.Respawns.Where(r => r.Monster != null).Select(r =>
                    $"[{r.Info.Location.X},{r.Info.Location.Y},{r.Info.Spread},{r.Info.Count},{r.Monster.Level},{Name(r.Monster.Name)},{r.Monster.Experience},{r.Monster.Stats[Stat.HP]}]")));
                json.Append("],\n\"shops\":[");
                json.Append(string.Join(",", _env.Shops.Where(s => s.Npc.CurrentMap == _map).Select(s =>
                    $"[{s.Npc.CurrentLocation.X},{s.Npc.CurrentLocation.Y},{(s.CheapestPotion != null ? 1 : 0)},{(s.SellsGear ? 1 : 0)},{(s.RepairKey != null ? 1 : 0)},{(s.SellKey != null ? 1 : 0)},{Name(s.Npc.Name)}]")));
                json.Append("],\n");
            }

            json.Append("\"activities\":[").Append(string.Join(",", (activity?.Activities ?? Array.Empty<string>()).Select(Quote))).Append("],\n");
            json.Append("\"t\":[").Append(string.Join(",", _times)).Append("],\n\"agents\":[\n");
            for (var i = 0; i < _last.Length; i++)
            {
                var agent = _env.Agents[i];
                if (i > 0) json.Append(",\n");
                json.Append($"{{\"name\":{Quote(agent.Name)},\"reliefs\":{agent.Reliefs},\"pk\":{agent.Player?.PKPoints ?? 0},\"sold\":{agent.ItemsSold},\"potions\":{agent.PotionsBought},\"gear\":{agent.GearBought},\"repairs\":{agent.Repairs},");
                Column(json, "x", _x[i]); json.Append(',');
                Column(json, "y", _y[i]); json.Append(',');
                Column(json, "lv", _level[i]); json.Append(',');
                Column(json, "lvp", _levelProgress[i]); json.Append(',');
                Column(json, "gold", _gold[i]); json.Append(',');
                Column(json, "hp", _health[i]); json.Append(',');
                Column(json, "do", _doing[i]); json.Append(',');
                Column(json, "kills", _kills[i]); json.Append(',');
                Column(json, "deaths", _deaths[i]); json.Append(',');
                Column(json, "exp", _experience[i]); json.Append(',');
                Column(json, "earned", _earned[i]); json.Append(',');
                Column(json, "spent", _spent[i]);
                json.Append('}');
            }
            json.Append("\n],\n\"events\":[");
            for (var i = 0; i < _events.Count; i++)
            {
                var e = _events[i];
                if (i > 0) json.Append(',');
                if (i % 200 == 0) json.Append('\n');
                json.Append($"[{e.T},{e.Agent},\"{e.Kind}\",{e.X},{e.Y},{e.Value},{e.Name}]");
            }
            json.Append("\n],\n\"names\":[").Append(string.Join(",", _names.Select(Quote))).Append("]}\n");

            var directory = Path.GetDirectoryName(Path.GetFullPath(_path));
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(_path, json.ToString(), new UTF8Encoding(false));
        }
    }
}
