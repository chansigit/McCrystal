using System.Diagnostics;
using Client.Resolution;

namespace Client
{
    internal static class Program
    {
        public static CMain Form;

        public static bool Restart;
        public static bool Launch;

        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length > 0)
            {
                foreach (var arg in args)
                {
                    if (arg.ToLower() == "-tc") Settings.UseTestConfig = true;
                }
            }

            #if DEBUG
                Settings.UseTestConfig = true;
            #endif

            try
            {
                Packet.IsServer = false;
                Settings.Load();

                CheckResolutionSetting();

                Launch = true;

                if (Launch)
                {
                    using (Form = new CMain())
                    {
                        Form.Run();
                    }
                }

                Settings.Save();
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.ToString());
                CMain.SaveError(ex.ToString());
            }
        }

        public static void CheckResolutionSetting()
        {
            var parsedOK = DisplayResolutions.GetDisplayResolutions();
            if (!parsedOK)
            {
                Console.WriteLine("Could not get display resolutions.");
            }

            if (!DisplayResolutions.IsSupported(Settings.Resolution))
            {
                Console.WriteLine($"Resolution {Settings.Resolution} is not supported, defaulting to 1024x768.");
                Settings.Resolution = (int)eSupportedResolution.w1024h768;
                Settings.Save();
            }
        }

    }
}
