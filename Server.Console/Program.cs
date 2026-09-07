using log4net;
using Server;
using Server.Admin;
using Server.ContentPacks;
using Server.MirEnvir;
using System.Reflection;

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
                System.Console.WriteLine($"Settings loaded from {contentPack.Describe()}.");

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

                var messageQueue = MessageQueue.Instance;

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

                    if (!hadMessage)
                        Thread.Sleep(100);
                }

                System.Console.WriteLine("Stopping server...");
                if (admin != null) admin.Stop();
                Envir.Main.Stop();
                System.Console.WriteLine("Server stopped.");

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
