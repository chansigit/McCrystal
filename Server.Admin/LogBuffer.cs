namespace Server.Admin
{
    public sealed class LogEntry
    {
        public long Sequence { get; set; }
        public string Kind { get; set; }
        public string Text { get; set; }
        public DateTime Time { get; set; }
    }

    /// <summary>Fixed-capacity ring of recent log lines shared by the terminal and the admin page.</summary>
    public sealed class LogBuffer
    {
        private readonly object gate = new object();
        private readonly LinkedList<LogEntry> entries = new LinkedList<LogEntry>();
        private readonly int capacity;
        private long lastSequence;

        public LogBuffer(int capacity = 2000)
        {
            this.capacity = capacity;
        }

        public long LastSequence
        {
            get { lock (gate) return lastSequence; }
        }

        public LogEntry Append(string kind, string text)
        {
            lock (gate)
            {
                var entry = new LogEntry
                {
                    Sequence = ++lastSequence,
                    Kind = kind,
                    Text = text.TrimEnd('\r', '\n'),
                    Time = DateTime.Now
                };
                entries.AddLast(entry);
                while (entries.Count > capacity) entries.RemoveFirst();
                return entry;
            }
        }

        /// <summary>Entries with a sequence greater than <paramref name="sequence"/>, oldest first.</summary>
        public List<LogEntry> After(long sequence)
        {
            lock (gate)
            {
                return entries.Where(e => e.Sequence > sequence).ToList();
            }
        }
    }
}
