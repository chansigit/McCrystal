using Microsoft.Data.Sqlite;

namespace Mir176Import;

/// <summary>The 1.76 Magic table, as the Delphi engine stored it.</summary>
/// <remarks>
/// Two of these columns are read through an inference rather than a specification,
/// because no M2Server source survives in ThirdParty/legend-176 -- ten archives, zero
/// .pas files. Both inferences are recorded in the conversion report rather than
/// buried here.
///
/// Power/MaxPower is read as the level-0 damage range and DefPower/DefMaxPower as the
/// range added per level. Supporting it: on that reading GreatFireBall only overtakes
/// FireBall at high level, which is how the game actually plays, and every solved
/// conversion lands on sane non-negative numbers.
///
/// Delay is read as hundredths of a second. On that reading FireBall is 600ms and
/// FireWall 1200ms, and every passive skill is 0.
/// </remarks>
public sealed record Magic(
    int Id, string Name, int Spell, int Power, int MaxPower,
    int DefSpell, int DefPower, int DefMaxPower, int Job,
    int NeedL1, int NeedL2, int NeedL3,
    int L1Train, int L2Train, int L3Train, int Delay);

/// <summary>A row of the 1.76 StdItems table.</summary>
/// <remarks>
/// Three fields change meaning with StdMode, which is the whole difficulty of this table:
///
/// Ac/Mac are armour on equipment and the amount restored on a potion -- 金创药(小量)
/// carries Ac 20 and 魔法药(小量) Mac 30, which are their classic heal and mana values.
///
/// Shape is the item's appearance except on a skill book, where it is the class that can
/// read it; Crystal reads a book's Shape as the Spell it teaches (HumanObject.cs:1238),
/// so the field has to be rebuilt rather than copied.
///
/// DuraMax is durability except on a skill book, where it is the level needed to read it.
/// That is checkable: it equals the skill's own NeedL1 in the Magic table.
/// </remarks>
public sealed record Item(
    int Index, string Name, int StdMode, int Shape, int Weight, int Looks, int DuraMax,
    int Ac, int Ac2, int Mac, int Mac2, int Dc, int Dc2, int Mc, int Mc2, int Sc, int Sc2,
    int Need, int NeedLevel, int Price, int Stock);

public sealed class GeeM2Source
{
    private readonly string root;

    public GeeM2Source(string root) => this.root = root;

    public string DatabasePath => Path.Combine(root, "GEEM2.db");

    public List<Magic> Magics()
    {
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Mode=ReadOnly");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "select MagID, MagName, Spell, Power, MaxPower, DefSpell, DefPower, DefMaxPower, " +
            "Job, NeedL1, NeedL2, NeedL3, L1Train, L2Train, L3Train, Delay from Magic order by MagID";
        using var reader = command.ExecuteReader();
        var magics = new List<Magic>();
        while (reader.Read())
            magics.Add(new Magic(
                reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7),
                reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11),
                reader.GetInt32(12), reader.GetInt32(13), reader.GetInt32(14), reader.GetInt32(15)));
        return magics;
    }

    public List<Item> Items()
    {
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Mode=ReadOnly");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "select Idx, Name, Stdmode, Shape, Weight, Looks, DuraMax, Ac, Ac2, Mac, Mac2, " +
            "Dc, Dc2, Mc, Mc2, Sc, Sc2, Need, NeedLevel, Price, Stock from StdItems order by Idx";
        using var reader = command.ExecuteReader();
        var items = new List<Item>();
        while (reader.Read())
            items.Add(new Item(
                reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7),
                reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11),
                reader.GetInt32(12), reader.GetInt32(13), reader.GetInt32(14), reader.GetInt32(15),
                reader.GetInt32(16), reader.GetInt32(17), reader.GetInt32(18), reader.GetInt32(19),
                reader.GetInt32(20)));
        return items;
    }
}
