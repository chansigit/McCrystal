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
            // Intentionally not disposed: a late Set() firing after a timeout must not throw.
            var done = new ManualResetEventSlim(false);
            string message = null;
            Exception error = null;
            bool abandoned = false;

            envir.AdminActions.Enqueue(() =>
            {
                if (Volatile.Read(ref abandoned)) return;

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
            {
                Volatile.Write(ref abandoned, true);
                return new AdminActionResult { Ok = false, Message = "Timed out waiting for the game loop. Is the server running?" };
            }

            if (error != null)
            {
                if (error is AdminException)
                    return new AdminActionResult { Ok = false, Message = error.Message };

                MessageQueue.Instance.Enqueue(error);
                return new AdminActionResult { Ok = false, Message = "Internal error; see server log." };
            }

            return new AdminActionResult { Ok = true, Message = message ?? "OK" };
        }
    }
}
