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
}
