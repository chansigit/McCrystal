using log4net;
using Server.ContentPacks;
using Server.MirEnvir;
using System.Reflection;

namespace Server.MirForms
{
    static class Program
    {
        /// <summary>
        /// The main entry point for the application.
        /// </summary>
        [STAThread]
        static void Main(string[] args)
        {
            Packet.IsServer = true;

            var logRepository = LogManager.GetRepository(Assembly.GetEntryAssembly());
            log4net.Config.XmlConfigurator.Configure(logRepository, new FileInfo("log4net.config"));

            try
            {
                var contentPack = ContentPack.Configure(args);
                contentPack.ValidateOrThrow(Envir.MinVersion, Envir.Version);
                Settings.Load();

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SMain());

                Settings.Save();
            }
            catch(Exception ex)
            {
                Logger.GetLogger().Error(ex);
            }
        }
    }
}
