using Microsoft.Xna.Framework.Graphics;

namespace Client.Resolution
{
    internal static class DisplayResolutions
    {
        internal static List<eSupportedResolution> DisplaySupportedResolutions = new List<eSupportedResolution>();

        internal static bool GetDisplayResolutions()
        {
            bool parsedOK = false;

            var supportedResolutions = Enum.GetNames(typeof(eSupportedResolution));
            try
            {
                List<string> list = new();

                // Use MonoGame GraphicsAdapter to enumerate display modes
                foreach (var displayMode in GraphicsAdapter.DefaultAdapter.SupportedDisplayModes)
                {
                    string displayResolution = $"w{displayMode.Width}h{displayMode.Height}";

                    if (supportedResolutions.Contains(displayResolution))
                    {
                        if (!list.Contains(displayResolution))
                        {
                            list.Add(displayResolution);
                        }
                    }
                }

                // If no modes found via adapter, add common resolutions as fallback
                if (list.Count == 0)
                {
                    // Fallback: assume common resolutions are supported
                    foreach (var resName in supportedResolutions)
                    {
                        list.Add(resName);
                    }
                }

                if (list.Count > 0)
                {
                    foreach (string displayResolution in list)
                    {
                        eSupportedResolution resolution;
                        if (Enum.TryParse(displayResolution, true, out resolution))
                        {
                            if (!DisplaySupportedResolutions.Contains(resolution))
                                DisplaySupportedResolutions.Add(resolution);
                        }
                    }
                }

                if (DisplaySupportedResolutions.Count > 0)
                {
                    parsedOK = true;
                }

            }
            catch
            {
                parsedOK = false;
            }

            return parsedOK;
        }

        internal static bool IsSupported(int resolution)
        {
            return IsSupported(resolution.ToString());
        }

        internal static bool IsSupported(string resolution)
        {
            eSupportedResolution res;
            if (!Enum.TryParse(resolution, true, out res))
            {
                return false;
            }

            if (!Enum.IsDefined(typeof(eSupportedResolution), res))
            {
                return false;
            }
            return true;
        }
    }
}
