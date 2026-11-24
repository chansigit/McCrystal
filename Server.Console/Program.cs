using log4net;
using Server;
using Server.Admin;
using Server.ContentPacks;
using Server.MirEnvir;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Server.Console
{
    static class Program
    {
        static int Main(string[] args)
        {
            Packet.IsServer = true;

            var logRepository = LogManager.GetRepository(Assembly.GetEntryAssembly());
            log4net.Config.XmlConfigurator.Configure(logRepository, new FileInfo("log4net.config"));

            try
            {
                var contentPack = ContentPack.Configure(args);
                contentPack.ValidateOrThrow(Envir.MinVersion, Envir.Version);

                var reportPath = ContentPack.GetOption(args, "--report");
                if (args.Contains("--validate-pack", StringComparer.Ordinal) || reportPath != null)
                {
                    var report = ContentPackInspector.Inspect(contentPack);
                    PrintReport(contentPack, report);
                    if (reportPath != null)
                    {
                        report.WriteJson(reportPath);
                        System.Console.WriteLine($"Full report written to {Path.GetFullPath(reportPath)}");
                    }
                    return report.ErrorCount == 0 ? 0 : 1;
                }

                Settings.Load();

                // --sim turns the virtual clock on for this run only; --sim-speed and
                // --sim-tick override its pace. The values in Setup.ini are put back
                // before settings are saved on shutdown.
                var simulationConfigured = (Settings.SimulationEnabled, Settings.SimulationSpeed, Settings.SimulationTickMs,
                    Settings.SimulationSeed, Settings.SimulationHashSeconds);
                if (args.Contains("--sim", StringComparer.Ordinal))
                    Settings.SimulationEnabled = true;
                if (double.TryParse(ContentPack.GetOption(args, "--sim-speed"), System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out var simSpeed) && simSpeed >= 0)
                    Settings.SimulationSpeed = simSpeed;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-tick"), out var simTick) && simTick > 0)
                    Settings.SimulationTickMs = simTick;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-seed"), out var simSeed))
                    Settings.SimulationSeed = simSeed;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-hash"), out var simHash) && simHash >= 0)
                    Settings.SimulationHashSeconds = simHash;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-agents"), out var simAgents) && simAgents > 0)
                    Settings.SimulationAgents = simAgents;
                var simPolicy = ContentPack.GetOption(args, "--sim-policy");
                if (simPolicy != null) Settings.SimulationPolicy = simPolicy;
                Settings.SimulationScriptOff = ContentPack.GetOption(args, "--sim-script-off") ?? Settings.SimulationScriptOff;
                if (args.Contains("--sim-listen", StringComparer.Ordinal)) Settings.SimulationListen = true;
                if (args.Contains("--sim-no-relief", StringComparer.Ordinal)) Settings.SimulationRelief = false;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-view"), out var simView) && simView > 0)
                    Settings.SimulationViewRadius = simView;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-decision-ticks"), out var simDecision) && simDecision > 0)
                    Settings.SimulationDecisionTicks = simDecision;
                // Never written to Setup.ini: a stop time is a property of one run.
                if (int.TryParse(ContentPack.GetOption(args, "--sim-until"), out var simUntil) && simUntil > 0)
                    Settings.SimulationStopSeconds = simUntil;
                System.Console.WriteLine($"Settings loaded from {contentPack.Describe()}.");
                if (Settings.SimulationEnabled)
                    System.Console.WriteLine($"Simulation mode: virtual clock, {Settings.SimulationTickMs}ms per tick, " +
                        (Settings.SimulationSpeed > 0 ? $"held to {Settings.SimulationSpeed}x" : "no speed limit") +
                        $", seed {Settings.SimulationSeed}.");

                System.Console.WriteLine("Starting server...");
                Envir.Main.Start();
                System.Console.WriteLine("Server started. Press Ctrl+C to stop.");

                AdminConsole admin = null;
                // The admin console needs a port of its own; a simulation that is not
                // listening for clients leaves that alone too, so worlds can run in parallel.
                if (Settings.AdminEnabled && !(Settings.SimulationEnabled && !Settings.SimulationListen))
                {
                    if (string.IsNullOrWhiteSpace(Settings.AdminPassword))
                    {
                        System.Console.WriteLine("Admin console disabled: set [Admin] Password in Configs/Setup.ini.");
                    }
                    else
                    {
                        try
                        {
                            admin = new AdminConsole(Envir.Main, Settings.AdminPassword, Settings.AdminPort);
                            admin.Start();
                            System.Console.WriteLine($"Admin console at {admin.BaseUrl}");
                        }
                        catch (Exception adminEx)
                        {
                            admin = null;
                            System.Console.WriteLine($"Admin console failed to start: {adminEx.Message}");
                            Logger.GetLogger(LogType.Server).Error(adminEx);
                        }
                    }
                }

                // Drain message queue to console
                var cts = new CancellationTokenSource();
                System.Console.CancelKeyPress += (s, e) =>
                {
                    e.Cancel = true;
                    cts.Cancel();
                };

                // Ctrl+C never reaches a process started in the background or by a
                // service manager; those send SIGTERM. Without this the server could
                // only be killed, which skips the shutdown save.
                using var sigterm = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context =>
                {
                    context.Cancel = true;
                    cts.Cancel();
                });

                var messageQueue = MessageQueue.Instance;
                var exitCode = 0;

                // In simulation mode, report how fast virtual time is moving.
                var simReportClock = System.Diagnostics.Stopwatch.StartNew();
                long simLastReal = 0, simLastVirtual = 0, simLastTicks = 0, simLastSteps = 0;

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

                    while (Envir.Main.StateHashes.TryDequeue(out var stateHash))
                        System.Console.WriteLine($"[hash] tick {stateHash.Tick} {stateHash.Hash:x16}");

                    // The loop thread is gone: it reached --sim-until, or it failed. Either
                    // way there is no world left to serve, so exit instead of idling.
                    if (!Envir.Main.LoopAlive)
                    {
                        if (!Envir.Main.SimulationCompleted)
                        {
                            exitCode = 1;
                            System.Console.WriteLine("The engine loop ended unexpectedly.");
                            if (Envir.Main.LoopError != null) System.Console.WriteLine(Envir.Main.LoopError);
                        }
                        cts.Cancel();
                    }

                    if (Settings.SimulationEnabled && simReportClock.ElapsedMilliseconds - simLastReal >= 5000)
                    {
                        var real = simReportClock.ElapsedMilliseconds;
                        var virt = Envir.Main.Time;
                        var ticks = Envir.Main.SimulationTicks;
                        var speed = (virt - simLastVirtual) / (double)(real - simLastReal);
                        var ticksPerSecond = (ticks - simLastTicks) * 1000.0 / (real - simLastReal);
                        System.Console.WriteLine(
                            $"[sim] virtual {virt / 1000}s, {speed:F1}x real time, {ticksPerSecond:F0} ticks/s, " +
                            $"monsters {Envir.Main.MonsterCount}, objects {Envir.Main.Objects.Count}, players {Envir.Main.Players.Count}");
                        var env = Envir.Main.SimEnv;
                        if (env != null)
                        {
                            // Read off the engine thread: a snapshot for the eye, not for analysis.
                            var agents = Envir.Main.SimAgents;
                            var steps = env.AgentSteps;
                            double levels = 0; int alive = 0, deaths = 0;
                            for (var i = 0; i < agents.Count; i++)
                            {
                                var player = agents[i].Player;
                                deaths += agents[i].Deaths;
                                if (player == null) continue;
                                levels += player.Level;
                                if (!player.Dead) alive++;
                            }
                            System.Console.WriteLine(
                                $"[agents] {(steps - simLastSteps) * 1000.0 / (real - simLastReal):F0} steps/s, alive {alive}/{agents.Count}, " +
                                $"mean level {levels / Math.Max(1, agents.Count):F2}, deaths {deaths}, rejected {env.RejectedActions}");
                            simLastSteps = steps;
                        }

                        simLastReal = real;
                        simLastVirtual = virt;
                        simLastTicks = ticks;
                    }

                    if (!hadMessage)
                        Thread.Sleep(100);
                }

                while (Envir.Main.StateHashes.TryDequeue(out var lastHash))
                    System.Console.WriteLine($"[hash] tick {lastHash.Tick} {lastHash.Hash:x16}");
                if (Envir.Main.SimSummary != null)
                    System.Console.Write(Envir.Main.SimSummary);

                System.Console.WriteLine("Stopping server...");
                if (admin != null) admin.Stop();
                Envir.Main.Stop();
                System.Console.WriteLine("Server stopped.");

                (Settings.SimulationEnabled, Settings.SimulationSpeed, Settings.SimulationTickMs,
                    Settings.SimulationSeed, Settings.SimulationHashSeconds) = simulationConfigured;
                Settings.Save();
                return exitCode;
            }
            catch (Exception ex)
            {
                System.Console.WriteLine($"Error: {ex}");
                Logger.GetLogger(LogType.Server).Error(ex);
                return 1;
            }
        }

        private static void PrintReport(ContentPack contentPack, ContentPackReport report)
        {
            System.Console.WriteLine($"Content pack: {contentPack.Describe()}");
            foreach (var entry in report.Inventory.OrderBy(entry => entry.Key))
                System.Console.WriteLine($"  {entry.Key}: {entry.Value}");
            System.Console.WriteLine($"Validation: {report.ErrorCount} errors, {report.WarningCount} warnings");

            foreach (var issue in report.Issues.Take(50))
                System.Console.WriteLine($"{issue.Severity.ToString().ToUpperInvariant(),-7} {issue.Code}: {issue.Message}{(issue.Path == null ? string.Empty : $" [{issue.Path}]")}");
            if (report.Issues.Count > 50)
                System.Console.WriteLine($"... {report.Issues.Count - 50} more issues; use --report to save all details.");
        }
    }
}
