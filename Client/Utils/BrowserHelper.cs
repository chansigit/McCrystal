using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Client.Utils
{
    public class BrowserHelper
    {
        public static void OpenDefaultBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch
            {
                // Fallback for different platforms
                try
                {
                    if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
                        Process.Start("open", url);
                    else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                        Process.Start("xdg-open", url);
                    else
                        Process.Start("explorer.exe", url);
                }
                catch { }
            }
        }
    }
}
