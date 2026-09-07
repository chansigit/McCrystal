using Server.MirEnvir;

namespace Server.Admin
{
    /// <summary>Thrown by admin actions for user-facing failures (unknown player, bad item name).</summary>
    public sealed class AdminException : Exception
    {
        public AdminException(string message) : base(message) { }
    }

    public sealed class AdminActionResult
    {
        public bool Ok { get; set; }
        public string Message { get; set; }
    }

    /// <summary>Posts work to the engine thread and waits for it to finish.</summary>
    public sealed class AdminActionRunner
    {
        private readonly Envir envir;
        private readonly TimeSpan timeout;

        public AdminActionRunner(Envir envir, TimeSpan? timeout = null)
        {
            this.envir = envir;
            this.timeout = timeout ?? TimeSpan.FromSeconds(5);
        }

        public AdminActionResult Run(Func<string> action)
        {
            var done = new ManualResetEventSlim(false);
            string message = null;
            Exception error = null;

            envir.AdminActions.Enqueue(() =>
            {
                try
                {
                    message = action();
                }
                catch (Exception ex)
                {
                    error = ex;
                }
                finally
                {
                    done.Set();
                }
            });

            if (!done.Wait(timeout))
                return new AdminActionResult { Ok = false, Message = "Timed out waiting for the game loop. Is the server running?" };

            if (error != null)
                return new AdminActionResult { Ok = false, Message = error.Message };

            return new AdminActionResult { Ok = true, Message = message ?? "OK" };
        }
    }
}
