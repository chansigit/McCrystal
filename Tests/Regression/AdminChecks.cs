using Server.MirEnvir;

static class AdminChecks
{
    static void Check(bool condition, string message = "Assertion failed")
    {
        if (!condition) throw new Exception(message);
    }

    public static void ActionQueueDrainsInOrder()
    {
        var envir = new Envir();
        var order = new List<int>();
        envir.AdminActions.Enqueue(() => order.Add(1));
        envir.AdminActions.Enqueue(() => throw new InvalidOperationException("boom"));
        envir.AdminActions.Enqueue(() => order.Add(3));

        envir.ProcessAdminActions();

        Check(order.SequenceEqual(new[] { 1, 3 }), "actions ran out of order or a failure stopped the queue");
        Check(envir.AdminActions.IsEmpty, "queue not drained");
    }

    public static void ActionRunnerReturnsResult()
    {
        var envir = new Envir();
        var runner = new Server.Admin.AdminActionRunner(envir, TimeSpan.FromSeconds(2));

        var drain = new Thread(() =>
        {
            Thread.Sleep(50);
            envir.ProcessAdminActions();
        });
        drain.Start();
        var ok = runner.Run(() => "done");
        drain.Join();
        Check(ok.Ok && ok.Message == "done", "successful action not reported");

        drain = new Thread(() =>
        {
            Thread.Sleep(50);
            envir.ProcessAdminActions();
        });
        drain.Start();
        var failed = runner.Run(() => throw new Server.Admin.AdminException("no such player"));
        drain.Join();
        Check(!failed.Ok && failed.Message == "no such player", "failure message not reported");
    }

    public static void ActionRunnerTimesOut()
    {
        var envir = new Envir();
        var runner = new Server.Admin.AdminActionRunner(envir, TimeSpan.FromMilliseconds(100));
        var result = runner.Run(() => "never");
        Check(!result.Ok, "timeout reported as success");
        Check(result.Message.Contains("game loop"), "timeout message missing");
        envir.ProcessAdminActions(); // late execution must not throw
    }

    public static void LogBufferKeepsLastLines()
    {
        var buffer = new Server.Admin.LogBuffer(3);
        buffer.Append("server", "a");
        buffer.Append("server", "b");
        buffer.Append("chat", "c");
        buffer.Append("debug", "d");

        var all = buffer.After(0);
        Check(all.Count == 3, "capacity not enforced");
        Check(all[0].Text == "b" && all[2].Text == "d", "oldest line not evicted");
        Check(all[0].Sequence == 2 && all[2].Sequence == 4, "sequence numbers wrong");

        var tail = buffer.After(3);
        Check(tail.Count == 1 && tail[0].Kind == "debug", "After(sequence) wrong");
        Check(buffer.LastSequence == 4, "LastSequence wrong");
    }
}
