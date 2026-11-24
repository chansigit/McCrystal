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
                var simulationConfigured = (Settings.SimulationEnabled, Settings.SimulationSpeed, Settings.SimulationTickMs);
                if (args.Contains("--sim", StringComparer.Ordinal))
                    Settings.SimulationEnabled = true;
                if (double.TryParse(ContentPack.GetOption(args, "--sim-speed"), System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out var simSpeed) && simSpeed >= 0)
                    Settings.SimulationSpeed = simSpeed;
                if (int.TryParse(ContentPack.GetOption(args, "--sim-tick"), out var simTick) && simTick > 0)
                    Settings.SimulationTickMs = simTick;
                System.Console.WriteLine($"Settings loaded from {contentPack.Describe()}.");
                if (Settings.SimulationEnabled)
                    System.Console.WriteLine($"Simulation mode: virtual clock, {Settings.SimulationTickMs}ms per tick, " +
                        (Settings.SimulationSpeed > 0 ? $"held to {Settings.SimulationSpeed}x." : "no speed limit."));

                System.Console.WriteLine("Starting server...");
                Envir.Main.Start();
                System.Console.WriteLine("Server started. Press Ctrl+C to stop.");

                AdminConsole admin = null;
                if (Settings.AdminEnabled)
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

                // In simulation mode, report how fast virtual time is moving.
                var simReportClock = System.Diagnostics.Stopwatch.StartNew();
                long simLastReal = 0, simLastVirtual = 0, simLastTicks = 0;

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
                        simLastReal = real;
                        simLastVirtual = virt;
                        simLastTicks = ticks;
                    }

                    if (!hadMessage)
                        Thread.Sleep(100);
                }

                System.Console.WriteLine("Stopping server...");
                if (admin != null) admin.Stop();
                Envir.Main.Stop();
                System.Console.WriteLine("Server stopped.");

                (Settings.SimulationEnabled, Settings.SimulationSpeed, Settings.SimulationTickMs) = simulationConfigured;
                Settings.Save();
                return 0;
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
