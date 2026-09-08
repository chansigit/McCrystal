using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>Converts the 1.76 StdItems table into Crystal ItemInfo records.</summary>
public static class ItemStage
{
    private sealed record Rule(ItemType Type, RequiredClass Class = RequiredClass.None,
        RequiredGender Gender = RequiredGender.None, bool Restores = false, ushort Stack = 1);

    // Every mapping below that could be read off real data was: crystalm2-176 is an
    // unrelated Crystal server carrying these same Chinese item names, so joining on name
    // shows which Crystal ItemType each StdMode became. Twenty-four of the twenty-eight
    // modes agree unanimously across every item they share. The rest are marked Judged and
    // listed in the report by name rather than decided quietly here.
    //
    // Weapons and armour are WarWizTao rather than None because 1.76 has three classes:
    // its Magic table's Job column only ever holds 0, 1 or 2, and Assassin and Archer are
    // off in Configs/Setup.ini.
    private static readonly Dictionary<int, Rule> Modes = new()
    {
        [0]  = new(ItemType.Potion, Restores: true, Stack: 50),
        [1]  = new(ItemType.Potion, Restores: true, Stack: 50),   // Judged: 干肉, 面条
        [2]  = new(ItemType.Potion, Restores: true, Stack: 50),   // Judged: 包子
        [3]  = new(ItemType.Scroll, Stack: 50),
        [4]  = new(ItemType.Book),
        [5]  = new(ItemType.Weapon, RequiredClass.WarWizTao),
        [6]  = new(ItemType.Weapon, RequiredClass.WarWizTao),
        [10] = new(ItemType.Armour, RequiredClass.WarWizTao, RequiredGender.Male),
        [11] = new(ItemType.Armour, RequiredClass.WarWizTao, RequiredGender.Female),
        [15] = new(ItemType.Helmet),
        [19] = new(ItemType.Necklace),
        [20] = new(ItemType.Necklace),
        [21] = new(ItemType.Necklace),
        [22] = new(ItemType.Ring),
        [23] = new(ItemType.Ring),
        [24] = new(ItemType.Bracelet),
        [25] = new(ItemType.Amulet, Stack: 100),
        [26] = new(ItemType.Bracelet),
        // Not the torch item, the torch *slot*: 荣誉勋章 share this mode with 蜡烛 and 火把
        // because they are worn in the same place. The medals carry equipment stats of +1
        // to +3 and require level 28, the torches carry none, and Crystal's ItemType.Torch
        // is that slot -- so this is one type after all, and it does not stack.
        [30] = new(ItemType.Torch),
        [31] = new(ItemType.Potion, Restores: true, Stack: 50),
        [40] = new(ItemType.Meat, Stack: 50),
        [41] = new(ItemType.Nothing, Stack: 50),                  // Judged: 金币1, 血剑碎片
        [42] = new(ItemType.CraftingMaterial, Stack: 50),
        [43] = new(ItemType.Ore, Stack: 50),
        [44] = new(ItemType.CraftingMaterial, Stack: 50),
        [45] = new(ItemType.Nothing, Stack: 50),                  // Judged: 骰子, 木料, 佛牌
        [46] = new(ItemType.Quest, Stack: 50),                    // Judged: letters and permits
        [47] = new(ItemType.Nothing, Stack: 50),                  // Judged: event prizes
    };

    /// <summary>The Crystal ItemType a 1.76 StdMode became, for stages that need the
    /// same mapping -- an NPC's "+N" purchase category is a StdMode too.</summary>
    public static bool TypeOf(int stdMode, out ItemType type)
    {
        if (Modes.TryGetValue(stdMode, out var rule)) { type = rule.Type; return true; }
        type = default;
        return false;
    }

    // Modes whose ItemType no shared item in crystalm2-176 could confirm, so the choice is
    // this tool's rather than an observation. Named in the report for review.
    private static readonly HashSet<int> Judged = new() { 1, 2, 41, 45, 46, 47 };

    // 1.76's Need column selects what the requirement is measured in. Read off the same
    // join: 骷髅头盔 Need 1 became MaxDC, 白金项链 Need 2 became MaxMC, 白色虎齿项链
    // Need 3 became MaxSC, and everything at Need 0 became Level.
    private static readonly RequiredType[] Requirements =
        { RequiredType.Level, RequiredType.MaxDC, RequiredType.MaxMC, RequiredType.MaxSC };

    private const string Pickaxe = "鹤嘴锄";

    public sealed record Result(List<ItemInfo> Items, string Report, int Errors);

    public static Result Convert(List<Item> source, List<Magic> magics)
    {
        var report = new StringBuilder();
        var items = new List<ItemInfo>();
        var notes = new List<string>();
        var byMode = new SortedDictionary<int, List<string>>();
        int errors = 0, books = 0;
        var skillLevels = magics.ToDictionary(m => m.Name, m => m.NeedL1);

        foreach (var item in source)
        {
            byMode.TryAdd(item.StdMode, new List<string>());
            byMode[item.StdMode].Add(item.Name);

            if (!Modes.TryGetValue(item.StdMode, out var rule))
            {
                notes.Add($"ERROR  {item.Name}: StdMode {item.StdMode} has no mapping");
                errors++;
                continue;
            }

            var info = new ItemInfo
            {
                Index = item.Index,
                Name = item.Name,
                Type = rule.Type,
                Shape = (short)item.Shape,
                Weight = (byte)Math.Clamp(item.Weight, 0, 255),
                Image = (ushort)Math.Clamp(item.Looks, 0, ushort.MaxValue),
                Durability = (ushort)Math.Clamp(item.DuraMax, 0, ushort.MaxValue),
                Price = (uint)Math.Max(0, item.Price),
                RequiredClass = rule.Class,
                RequiredGender = rule.Gender,
                RequiredType = Requirements[Math.Clamp(item.Need, 0, Requirements.Length - 1)],
                RequiredAmount = (byte)Math.Clamp(item.NeedLevel, 0, 255),
                StackSize = rule.Stack,
                CanMine = item.Name == Pickaxe,
                Stats = new Stats(),
            };

            if (item.Need < 0 || item.Need >= Requirements.Length)
            {
                notes.Add($"ERROR  {item.Name}: Need {item.Need} is outside 0-3");
                errors++;
            }

            if (rule.Type == ItemType.Book)
            {
                books++;
                if (!MagicStage.Names.TryGetValue(item.Name, out var spell))
                {
                    notes.Add($"ERROR  {item.Name}: a skill book with no matching skill");
                    errors++;
                    continue;
                }
                // Crystal reads a book's Shape as the Spell it teaches, and 1.76 keeps the
                // class there instead, so the field is rebuilt rather than copied.
                info.Shape = (short)spell;
                info.RequiredClass = item.Shape switch
                {
                    0 => RequiredClass.Warrior,
                    1 => RequiredClass.Wizard,
                    2 => RequiredClass.Taoist,
                    _ => RequiredClass.None,
                };
                info.RequiredType = RequiredType.Level;
                info.RequiredAmount = (byte)Math.Clamp(item.DuraMax, 0, 255);
                info.Durability = 0;
                // The free check that reading falls out of: a book's DuraMax is the level
                // its skill needs, so it has to equal that skill's NeedL1.
                if (skillLevels.TryGetValue(item.Name, out int need) && need != item.DuraMax)
                {
                    notes.Add($"ERROR  {item.Name}: book needs level {item.DuraMax}, skill needs {need}");
                    errors++;
                }
            }
            else if (rule.Restores)
            {
                // A potion has no armour: 1.76 reuses Ac and Mac for what it restores.
                info.Stats[Stat.HP] = item.Ac;
                info.Stats[Stat.MP] = item.Mac;
            }
            else
            {
                // Equipment stores a pair per stat. It reads low-then-high on a range
                // (重盔甲 AC 4/7) and puts a fixed bonus in the first field with zero in the
                // second (白金项链 MC 2/0), so the high end is whichever is larger.
                Pair(info, Stat.MinAC, Stat.MaxAC, item.Ac, item.Ac2);
                Pair(info, Stat.MinMAC, Stat.MaxMAC, item.Mac, item.Mac2);
                Pair(info, Stat.MinDC, Stat.MaxDC, item.Dc, item.Dc2);
                Pair(info, Stat.MinMC, Stat.MaxMC, item.Mc, item.Mc2);
                Pair(info, Stat.MinSC, Stat.MaxSC, item.Sc, item.Sc2);
            }
            items.Add(info);
        }

        report.AppendLine("## 物品 StdItems -> ItemInfo");
        report.AppendLine();
        report.AppendLine($"读入 {source.Count} 条，写出 {items.Count} 条，错误 {errors} 条，其中技能书 {books} 本。");
        report.AppendLine();
        report.AppendLine("| StdMode | ItemType | 职业 | 性别 | 堆叠 | 件数 | 依据 | 物品 |");
        report.AppendLine("| ---: | --- | --- | --- | ---: | ---: | --- | --- |");
        foreach (var (mode, names) in byMode)
        {
            if (!Modes.TryGetValue(mode, out var rule)) continue;
            string sample = string.Join("、", names.Take(4)) + (names.Count > 4 ? " …" : "");
            report.AppendLine($"| {mode} | {rule.Type} | {rule.Class} | {rule.Gender} | {rule.Stack} | " +
                $"{names.Count} | {(Judged.Contains(mode) ? "**本工具判断**" : "同名比对")} | {sample} |");
        }
        report.AppendLine();
        report.AppendLine("待你确认的三件事：");
        report.AppendLine();
        report.AppendLine($"- 标为**本工具判断**的 {Judged.Count} 个 StdMode，没有同名物品可比对。上表列出了它们的全部内容。");
        report.AppendLine("- 堆叠数不是 1.76 的数据。它的 `Stock` 列是商店补货量而不是堆叠上限（木剑 100、技能书 50），所以上表的堆叠是本工具按类型给的默认值。");
        report.AppendLine("- `Grade` 一律 None，`StartItem` 一律 false：1.76 没有对应字段，没有编造。");
        if (notes.Count > 0)
        {
            report.AppendLine();
            report.AppendLine("### 需要注意的条目");
            report.AppendLine();
            foreach (var n in notes) report.AppendLine($"- {n}");
        }
        return new Result(items, report.ToString(), errors);
    }

    private static void Pair(ItemInfo info, Stat low, Stat high, int a, int b)
    {
        if (a == 0 && b == 0) return;
        info.Stats[low] = a;
        info.Stats[high] = Math.Max(a, b);
    }
}
