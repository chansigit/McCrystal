using C = ClientPackets;
using S = ServerPackets;

namespace Crystal.Web;

public sealed class NpcInputRequest
{
    private readonly object sync = new();
    private S.NPCRequestInput? pending;

    public void Observe(Packet packet)
    {
        lock (sync)
        {
            if (packet is S.NPCRequestInput request) pending = request;
            else if (packet is S.MapChanged or S.MapInformation or S.LoginSuccess or S.LogOutSuccess)
                pending = null;
        }
    }

    public bool Accept(Packet packet)
    {
        lock (sync)
        {
            if (packet is C.NPCConfirmInput reply)
            {
                if (pending is null || reply.NPCID != pending.NPCID || reply.PageName != pending.PageName)
                    return false;
                pending = null;
            }
            else if (packet is C.CallNPC or C.LogOut) pending = null;
            return true;
        }
    }
}
