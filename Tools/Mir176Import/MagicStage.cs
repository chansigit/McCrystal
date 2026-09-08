using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts the 1.76 Magic table into Crystal MagicInfo records.</summary>
public static class MagicStage
{
    // Crystal has no class field on MagicInfo: the class is the band the Spell value
    // falls in -- 1-17 warrior, 31-55 wizard, 61-86 taoist. That makes the 1.76 Job
    // column redundant as data and useful as a check, so it is not stored and is
    // asserted against instead.
    private static readonly (int Low, int High)[] JobBands = { (1, 17), (31, 55), (61, 86) };

    // Independently corroborated: crystalm2-176, an unrelated Crystal server carrying
    // these same Chinese names, maps 基本剑术/攻杀剑术/刺杀剑术 to 1/2/3 exactly as here,
    // and agrees on all 31 names it shares.
    public static readonly Dictionary<string, Spell> Names = new()
    {
        ["基本剑术"] = Spell.Fencing,        ["攻杀剑术"] = Spell.Slaying,
        ["刺杀剑术"] = Spell.Thrusting,      ["半月弯刀"] = Spell.HalfMoon,
        ["野蛮冲撞"] = Spell.ShoulderDash,   ["烈火剑法"] = Spell.FlamingSword,

        ["火球术"] = Spell.FireBall,         ["抗拒火环"] = Spell.Repulsion,
        ["诱惑之光"] = Spell.ElectricShock,  ["大火球"] = Spell.GreatFireBall,
        ["地狱火"] = Spell.HellFire,         ["雷电术"] = Spell.ThunderBolt,
        ["瞬息移动"] = Spell.Teleport,       ["爆裂火焰"] = Spell.FireBang,
        ["火墙"] = Spell.FireWall,           ["疾光电影"] = Spell.Lightning,
        ["地狱雷光"] = Spell.ThunderStorm,   ["魔法盾"] = Spell.MagicShield,
        ["圣言术"] = Spell.TurnUndead,       ["冰咆哮"] = Spell.IceStorm,

        ["治愈术"] = Spell.Healing,          ["精神力战法"] = Spell.SpiritSword,
        ["施毒术"] = Spell.Poisoning,        ["灵魂火符"] = Spell.SoulFireBall,
        ["召唤骷髅"] = Spell.SummonSkeleton, ["隐身术"] = Spell.Hiding,
        ["集体隐身术"] = Spell.MassHiding,   ["幽灵盾"] = Spell.SoulShield,
        ["神圣战甲术"] = Spell.BlessedArmour,["心灵启示"] = Spell.Revelation,
        ["困魔咒"] = Spell.TrapHexagon,      ["群体治愈术"] = Spell.MassHealing,
        ["召唤神兽"] = Spell.SummonShinsu,
    };

    public sealed record Result(List<MagicInfo> Magics, string Report, int Errors);

    public static Result Convert(List<Magic> source)
    {
        var report = new StringBuilder();
        var magics = new List<MagicInfo>();
        int exact = 0, clamped = 0, flat = 0, errors = 0;
        var notes = new List<string>();

        foreach (var m in source)
        {
            if (!Names.TryGetValue(m.Name, out var spell))
            {
                notes.Add($"ERROR  {m.Name}: no Spell mapping");
                errors++;
                continue;
            }

            var band = JobBands[Math.Clamp(m.Job, 0, 2)];
            if ((int)spell < band.Low || (int)spell > band.High)
            {
                notes.Add($"ERROR  {m.Name}: Job {m.Job} wants {band.Low}-{band.High}, {spell} is {(int)spell}");
                errors++;
            }

            // Both damage curves are linear in level, so they reconcile algebraically
            // rather than approximately:
            //   1.76      power(L) = base + L * per
            //   Crystal   power(L) = MPower/4 * (L + 1) + Power
            //                      = (MPower/4 + Power) + L * (MPower/4)
            // Matching slope and intercept gives MPower = 4 * per and Power = base - per.
            int slopeLow = m.DefPower, slopeSpan = m.DefMaxPower - m.DefPower;
            int mPowerBase = 4 * slopeLow, mPowerBonus = 4 * slopeSpan;
            int powerBase = m.Power - slopeLow, powerBonus = (m.MaxPower - m.Power) - slopeSpan;

            string note = null;
            if (m.Power == 0 && m.MaxPower == 0 && m.DefPower == 0 && m.DefMaxPower == 0)
                flat++;                                  // damage comes from the character's stats
            else if (powerBase >= 0 && powerBonus >= 0 && mPowerBonus >= 0)
                exact++;
            else
            {
                // Crystal's shape forces the level-0 value to be at least a quarter of the
                // slope, so a spell that starts very low and scales hard cannot be
                // expressed exactly. The slope is kept and the intercept clamped, which
                // leaves a constant offset -- reported per skill rather than hidden.
                clamped++;
                int offset = Math.Max(0, -powerBase);
                note = $"CLAMP  {m.Name}: PowerBase {powerBase} -> 0, every level reads +{offset}";
                powerBase = Math.Max(0, powerBase);
                powerBonus = Math.Max(0, powerBonus);
            }
            if (note != null) notes.Add(note);

            magics.Add(new MagicInfo
            {
                Name = m.Name,
                Spell = spell,
                // The client's MagIcon.Lib is ordered by the classic skill order: every one
                // of the 31 icons crystalm2-176 assigns is exactly MagID - 1.
                Icon = (byte)Math.Clamp(m.Id - 1, 0, 255),
                BaseCost = (byte)Math.Clamp(m.Spell, 0, 255),
                LevelCost = (byte)Math.Clamp(m.DefSpell, 0, 255),
                Level1 = (byte)Math.Clamp(m.NeedL1, 0, 255),
                Level2 = (byte)Math.Clamp(m.NeedL2, 0, 255),
                Level3 = (byte)Math.Clamp(m.NeedL3, 0, 255),
                Need1 = (ushort)Math.Clamp(m.L1Train, 0, ushort.MaxValue),
                Need2 = (ushort)Math.Clamp(m.L2Train, 0, ushort.MaxValue),
                Need3 = (ushort)Math.Clamp(m.L3Train, 0, ushort.MaxValue),
                DelayBase = (uint)(m.Delay * 10),        // hundredths of a second, see GeeM2Source
                DelayReduction = 0,
                PowerBase = (ushort)Math.Clamp(powerBase, 0, ushort.MaxValue),
                PowerBonus = (ushort)Math.Clamp(powerBonus, 0, ushort.MaxValue),
                MPowerBase = (ushort)Math.Clamp(mPowerBase, 0, ushort.MaxValue),
                MPowerBonus = (ushort)Math.Clamp(mPowerBonus, 0, ushort.MaxValue),
            });
        }

        foreach (var name in Names.Keys.Where(n => source.All(m => m.Name != n)))
        {
            notes.Add($"ERROR  {name}: mapped but absent from the source table");
            errors++;
        }

        report.AppendLine("## 技能 Magic -> MagicInfo");
        report.AppendLine();
        report.AppendLine($"读入 {source.Count} 条，写出 {magics.Count} 条，错误 {errors} 条。");
        report.AppendLine($"威力字段：{exact} 条逐级精确对齐，{clamped} 条钳位，{flat} 条无威力字段（伤害来自人物属性）。");
        report.AppendLine();
        report.AppendLine("| 技能 | Spell | 图标 | 耗魔 | 等级 | 熟练度 | 冷却 | 威力 0 级 | 3 级 | 1.76 3 级 |");
        report.AppendLine("| --- | --- | ---: | --- | --- | --- | ---: | --- | --- | --- |");
        foreach (var (m, info) in source.Where(m => Names.ContainsKey(m.Name)).Zip(magics))
        {
            report.AppendLine($"| {m.Name} | {info.Spell} ({(int)info.Spell}) | {info.Icon} | " +
                $"{info.BaseCost}+{info.LevelCost}/级 | {info.Level1}/{info.Level2}/{info.Level3} | " +
                $"{info.Need1}/{info.Need2}/{info.Need3} | {info.DelayBase}ms | " +
                $"{Crystal(info, 0)} | {Crystal(info, 3)} | {Original(m, 3)} |");
        }
        if (notes.Count > 0)
        {
            report.AppendLine();
            report.AppendLine("### 需要注意的条目");
            report.AppendLine();
            foreach (var n in notes) report.AppendLine($"- {n}");
        }
        return new Result(magics, report.ToString(), errors);
    }

    // The damage a level-L cast can roll, as a range rather than its floor: both engines
    // draw the level term and the flat term independently, so a single number would hide
    // exactly the half of the conversion that is easiest to get wrong.
    private static string Crystal(MagicInfo info, int level)
    {
        int low = (int)Math.Round(info.MPowerBase / 4F * (level + 1) + info.PowerBase);
        int high = (int)Math.Round((info.MPowerBase + info.MPowerBonus) / 4F * (level + 1)
            + info.PowerBase + info.PowerBonus);
        return low == high ? $"{low}" : $"{low}-{high}";
    }

    private static string Original(Magic m, int level)
    {
        int low = m.Power + level * m.DefPower, high = m.MaxPower + level * m.DefMaxPower;
        return low == high ? $"{low}" : $"{low}-{high}";
    }
}
