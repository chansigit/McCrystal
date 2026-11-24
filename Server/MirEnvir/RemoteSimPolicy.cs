using System.IO.MemoryMappedFiles;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Server.MirEnvir
{
    /// <summary>
    /// Hands every decision to another process, such as a Python training loop. The batch
    /// the environment fills (grid, self, mask) is copied into a memory-mapped file the
    /// other side maps too; a loopback connection carries only one byte each way per
    /// step, to say whose turn it is. The world waits for the answer, which is what
    /// training wants: this is for policies that answer in microseconds, not for LLMs.
    ///
    /// Layout of the shared file, all little-endian, described in bridge.json next to it:
    ///   header   int64 step, int64 game time in ms
    ///   grid     float32[agents * channels * side * side]
    ///   self     float32[agents * selfSize]
    ///   mask     uint8[agents * actions]
    ///   stats    float64[agents * StatCount]
    ///   actions  int32[agents]            (written by the other side)
    /// </summary>
    public sealed class RemoteSimPolicy : ISimPolicy, IDisposable
    {
        public const int StatCount = 9;
        // Per-agent running totals a reward can be built from.
        public const int StLevel = 0, StExperience = 1, StDeaths = 2, StKills = 3, StGold = 4, StHealth = 5, StGoldGained = 6, StReliefs = 7, StHits = 8;

        private readonly string _directory;
        private MemoryMappedFile _file;
        private MemoryMappedViewAccessor _view;
        private TcpListener _listener;
        private Socket _peer;
        private long _gridAt, _selfAt, _maskAt, _statsAt, _actionsAt;
        private double[] _stats;
        private long _step;
        private readonly byte[] _signal = new byte[1];

        /// <summary>Set when the other side has gone or asked to stop. The run should end.</summary>
        public bool Closed { get; private set; }

        public RemoteSimPolicy(string directory)
        {
            _directory = directory;
        }

        private void Open(SimEnv env)
        {
            var agents = env.Agents.Count;
            const long header = 16;
            _gridAt = header;
            _selfAt = _gridAt + 4L * agents * env.GridSize;
            _maskAt = _selfAt + 4L * agents * SimEnv.SelfSize;
            _statsAt = (_maskAt + (long)agents * SimEnv.ActionCount + 7) / 8 * 8;
            _actionsAt = _statsAt + 8L * agents * StatCount;
            var size = _actionsAt + 4L * agents;
            _stats = new double[agents * StatCount];

            Directory.CreateDirectory(_directory);
            var shared = Path.Combine(_directory, "shared.bin");
            _file = MemoryMappedFile.CreateFromFile(shared, FileMode.Create, null, size);
            _view = _file.CreateViewAccessor(0, size);

            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start(1);
            var port = ((IPEndPoint)_listener.LocalEndpoint).Port;

            var json = new StringBuilder();
            json.Append("{");
            json.Append($"\"port\":{port},\"shared\":\"shared.bin\",\"size\":{size},");
            json.Append($"\"agents\":{agents},\"channels\":{SimEnv.Channels},\"side\":{env.Side},\"view_radius\":{env.ViewRadius},");
            json.Append($"\"self_size\":{SimEnv.SelfSize},\"actions\":{SimEnv.ActionCount},\"stat_count\":{StatCount},");
            json.Append($"\"tick_ms\":{Settings.SimulationTickMs},\"decision_ticks\":{Settings.SimulationDecisionTicks},\"seed\":{Settings.SimulationSeed},");
            json.Append($"\"offsets\":{{\"header\":0,\"grid\":{_gridAt},\"self\":{_selfAt},\"mask\":{_maskAt},\"stats\":{_statsAt},\"actions\":{_actionsAt}}}");
            json.Append("}");
            // Written last and moved into place, so a reader never sees half a file.
            var temporary = Path.Combine(_directory, "bridge.json.tmp");
            File.WriteAllText(temporary, json.ToString());
            File.Move(temporary, Path.Combine(_directory, "bridge.json"), true);

            // The trainer starts this process and is waiting for that file.
            var accept = _listener.AcceptSocketAsync();
            if (!accept.Wait(TimeSpan.FromSeconds(120)))
                throw new TimeoutException($"No trainer connected to port {port} within 120 seconds.");
            _peer = accept.Result;
            _peer.NoDelay = true;
            _listener.Stop();
        }

        public void Decide(SimEnv env, int[] actions)
        {
            if (Closed) { Array.Clear(actions); return; }
            if (_view == null) Open(env);

            var agents = env.Agents.Count;
            for (var i = 0; i < agents; i++)
            {
                var agent = env.Agents[i];
                var player = agent.Player;
                var at = i * StatCount;
                _stats[at + StLevel] = player == null ? 0 : SimEnv.FractionalLevel(player);
                _stats[at + StExperience] = agent.ExperienceGained;
                _stats[at + StDeaths] = agent.Deaths;
                _stats[at + StKills] = agent.Kills;
                _stats[at + StGold] = player?.Account.Gold ?? 0;
                _stats[at + StHealth] = env.Self[i * SimEnv.SelfSize + SimEnv.SfHealth];
                _stats[at + StGoldGained] = agent.GoldGained;
                _stats[at + StReliefs] = agent.Reliefs;
                _stats[at + StHits] = player?.HitsLanded ?? 0;
            }

            _view.Write(0, ++_step);
            _view.Write(8, Envir.Main.Time);
            _view.WriteArray(_gridAt, env.Grid, 0, env.Grid.Length);
            _view.WriteArray(_selfAt, env.Self, 0, env.Self.Length);
            _view.WriteArray(_maskAt, env.Mask, 0, env.Mask.Length);
            _view.WriteArray(_statsAt, _stats, 0, _stats.Length);

            try
            {
                _signal[0] = (byte)'S';
                _peer.Send(_signal);
                if (_peer.Receive(_signal) != 1 || _signal[0] != (byte)'A') Closed = true;
            }
            catch (SocketException) { Closed = true; }
            catch (ObjectDisposedException) { Closed = true; }

            if (Closed) { Array.Clear(actions); return; }
            _view.ReadArray(_actionsAt, actions, 0, agents);
        }

        public void Dispose()
        {
            try { if (_peer != null && !Closed) { _signal[0] = (byte)'E'; _peer.Send(_signal); } } catch { }
            _peer?.Dispose();
            _listener?.Stop();
            _view?.Dispose();
            _file?.Dispose();
        }
    }
}
