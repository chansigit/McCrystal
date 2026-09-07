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
}
