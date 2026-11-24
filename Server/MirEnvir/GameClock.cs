using System.Diagnostics;

namespace Server.MirEnvir
{
    /// <summary>
    /// Source of the engine's logical time (<see cref="Envir.Time"/>), in milliseconds.
    /// Game logic never reads the wall clock directly; it reads Envir.Time, which the
    /// main loop copies from the active clock once per iteration.
    /// </summary>
    public abstract class GameClock
    {
        public abstract long ElapsedMilliseconds { get; }

        /// <summary>True when time only moves through <see cref="Advance"/>.</summary>
        public virtual bool IsVirtual => false;

        /// <summary>Move a virtual clock forward. A real clock ignores this.</summary>
        public virtual void Advance(long milliseconds) { }
    }

    /// <summary>Wall-clock time since the process started. The normal mode.</summary>
    public sealed class RealClock : GameClock
    {
        private readonly Stopwatch _stopwatch;

        public RealClock(Stopwatch stopwatch)
        {
            _stopwatch = stopwatch;
        }

        public override long ElapsedMilliseconds => _stopwatch.ElapsedMilliseconds;
    }

    /// <summary>
    /// Simulation time. Starts at zero and moves only when the main loop advances it,
    /// so the world can run faster or slower than real time and a run can be repeated.
    /// </summary>
    public sealed class VirtualClock : GameClock
    {
        private long _milliseconds;

        public override long ElapsedMilliseconds => _milliseconds;

        public override bool IsVirtual => true;

        public override void Advance(long milliseconds)
        {
            if (milliseconds <= 0) throw new ArgumentOutOfRangeException(nameof(milliseconds));
            _milliseconds += milliseconds;
        }
    }
}
