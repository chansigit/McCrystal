using log4net;
using Server;
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

                if (args.Contains("--validate-pack", StringComparer.Ordinal))
                {
                    System.Console.WriteLine($"Content pack is valid: {contentPack.Describe()}.");
                    return 0;
                }

                Settings.Load();
                System.Console.WriteLine($"Settings loaded from {contentPack.Describe()}.");

                System.Console.WriteLine("Starting server...");
                Envir.Main.Start();
                System.Console.WriteLine("Server started. Press Ctrl+C to stop.");

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
                        hadMessage = true;
                    }

                    while (messageQueue.DebugLog.TryDequeue(out string debug))
                    {
                        System.Console.Write($"[Debug] {debug}");
                        hadMessage = true;
                    }

                    if (!hadMessage)
                        Thread.Sleep(100);
                }

                System.Console.WriteLine("Stopping server...");
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
    }
}
