using System.Text;
using Server.MirDatabase;

namespace Mir176Import;

/// <summary>
/// Converts Envir/merchant.txt, Envir/Npcs.txt and the Envir/market_def scripts into
/// Crystal NPCInfo records plus a script per NPC under the pack's Envir/NPCs.
///
/// The two dialects are close relatives -- Crystal's own NPC scripts still carry M2
/// filenames like WasteLand/Grocery-HELL00.txt -- so most of a script passes through
/// untouched. What differs is catalogued below and every line the tool cannot translate
/// is kept in place as a comment and counted in the report, so a missing feature shows up
/// as a quiet NPC rather than as silently vanished content.
/// </summary>
public static class NpcStage
{
    public sealed record Script(string Path, string Text);
    public sealed record Result(List<NPCInfo> Npcs, List<Script> Scripts, string Report, int Errors);

    // Commands the two dialects spell differently but mean the same by. Renames only:
    // anything whose arguments also have to change is handled in Translate.
    private static readonly Dictionary<string, string> Renames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["TAKE"] = "TAKEITEM",
        ["GIVE"] = "GIVEITEM",
        ["CHECKJOB"] = "CHECKCLASS",
        // M2's MAP moves the player to a map without naming a point; Crystal's MOVE reads
        // a missing x/y as 0 and picks a random walkable cell, which is the same thing.
        ["MAP"] = "MOVE",
        ["MAPMOVE"] = "MOVE",
    };

    // Commands Crystal has under the same name. Listed rather than assumed so that a
    // command missing from both tables is reported instead of passed through untested.
    private static readonly HashSet<string> Shared = new(StringComparer.OrdinalIgnoreCase)
    {
        "GOTO", "BREAK", "SET", "MOV", "CHECK", "RANDOM", "CHECKITEM", "MONGEN", "MONCLEAR",
        "PARAM1", "PARAM2", "PARAM3", "TIMERECALL", "CLOSE", "GIVEGOLD", "TAKEGOLD",
        "CHANGELEVEL", "CALC",
    };

    // Commands with no Crystal counterpart. Each is kept as a comment and counted; the
    // note says what the NPC loses so the gap is a decision on the report, not a silence.
    private static readonly Dictionary<string, string> Unsupported = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ADDBATCH"] = "批量随机传送：把一批地图加入候选池",
        ["BATCHMOVE"] = "批量随机传送：从候选池里随机送一张",
        ["BATCHDELAY"] = "批量随机传送的间隔",
        ["CHECKLUCKYPOINT"] = "幸运值判定，Crystal 没有幸运值",
        ["RESET"] = "成批清空标志位，Crystal 只能逐个 SET",
        // Crystal's CHECKCALC parses both sides as integers without expanding %D0 first,
        // so it cannot stand in for a variable comparison. Verified in NPCSegment.Check.
        ["EQUAL"] = "变量比较，Crystal 的 CHECKCALC 不展开变量",
        ["CHECKITEMW"] = "检查身上穿戴的物品，Crystal 的 CHECKITEM 只看背包",
        ["TAKEW"] = "收走身上穿戴的物品，Crystal 的 TAKEITEM 只动背包",
    };

    // Page keys M2 gives a built-in meaning that Crystal spells differently.
    private static readonly Dictionary<string, string> PageRenames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["@S_REPAIR"] = "@srepair",
        // Crystal's storage window deposits and withdraws in one dialog, so the separate
        // withdrawal page has nowhere to go. Its links are redirected and the page dropped.
        ["@GETBACK"] = "@storage",
    };

    private static readonly Dictionary<string, string> Classes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["战士"] = "Warrior", ["法师"] = "Wizard", ["道士"] = "Taoist",
        ["warrior"] = "Warrior", ["wizard"] = "Wizard", ["taoist"] = "Taoist",
    };

    // Say-text variables. Everything absent from here is reported rather than emitted.
    private static readonly Dictionary<string, string> Variables = new(StringComparer.OrdinalIgnoreCase)
    {
        ["USERNAME"] = "USERNAME",
        ["USERWEAPON"] = "WEAPON",
    };

    // Emitted with a translation whose numbers this tool could not confirm, so the report
    // can name them instead of letting them pass as verified.
    private static readonly Dictionary<string, string> Unverified = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CHECKDURAEVA"] = "矿石纯度门槛：译成 CHECKITEM 的耐久参数，但 M2 的纯度单位与 "
            + "Crystal 的 `耐久 < 阈值 × 1000` 是否同一刻度未经验证",
    };

    private const string GoldName = "金币";

    public static Result Convert(List<Merchant> merchants, List<SpecialNpc> specials,
        string scriptDirectory, List<MapInfo> maps, List<ItemInfo> items)
    {
        var report = new StringBuilder();
        var npcs = new List<NPCInfo>();
        var scripts = new List<Script>();
        var unknownCommands = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var unsupportedHits = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var unknownVariables = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var unverifiedHits = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var typeNames = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var gluedGold = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var dangling = new SortedDictionary<string, int>(StringComparer.Ordinal);
        int emptyShops = 0, lostShops = 0;
        var missingItems = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var missingScripts = new List<string>();
        var missingMaps = new List<string>();
        int goods = 0, types = 0, getbackPages = 0, errors = 0;

        var mapIndex = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var map in maps) mapIndex[map.FileName] = map.Index;
        var itemNames = new HashSet<string>(items.Select(i => i.Name), StringComparer.OrdinalIgnoreCase);

        // market_def is matched case-insensitively: eight merchant rows spell their script
        // id in a different case from the file on disk, which only mattered once the pack
        // moved off Windows.
        var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (Directory.Exists(scriptDirectory))
            foreach (var file in Directory.GetFiles(scriptDirectory, "*.txt"))
                files[Path.GetFileName(file)] = file;

        foreach (var merchant in merchants)
        {
            string name = $"{merchant.ScriptId}-{merchant.MapFile}.txt";
            if (!files.TryGetValue(name, out string path))
            {
                missingScripts.Add($"{name}（{merchant.Name}）");
                continue;
            }
            if (!mapIndex.TryGetValue(merchant.MapFile, out int map))
            {
                missingMaps.Add($"{merchant.MapFile}（{merchant.Name}）");
                continue;
            }

            var translated = Translate(GeeM2Source.ReadGbk(path).ToList(), itemNames);
            foreach (var (command, count) in translated.Unknown)
                unknownCommands[command] = unknownCommands.GetValueOrDefault(command) + count;
            foreach (var (command, count) in translated.Unsupported)
                unsupportedHits[command] = unsupportedHits.GetValueOrDefault(command) + count;
            foreach (var (variable, count) in translated.UnknownVariables)
                unknownVariables[variable] = unknownVariables.GetValueOrDefault(variable) + count;
            foreach (var (item, count) in translated.MissingItems)
                missingItems[item] = missingItems.GetValueOrDefault(item) + count;
            foreach (var (command, count) in translated.Unverified)
                unverifiedHits[command] = unverifiedHits.GetValueOrDefault(command) + count;
            foreach (var (token, count) in translated.GluedGold)
                gluedGold[token] = gluedGold.GetValueOrDefault(token) + count;
            foreach (var (type, count) in translated.TypeNames)
                typeNames[type] = typeNames.GetValueOrDefault(type) + count;
            // A shop can end up with nothing to sell either because the source block was
            // already empty -- plenty of 1.76 shops only buy -- or because every name in it
            // was unresolvable. Only the second is a loss.
            if (translated.Text.Contains("[TRADE]") && translated.Goods == 0)
            {
                if (translated.MissingItems.Count > 0) lostShops++; else emptyShops++;
            }
            goods += translated.Goods;
            types += translated.Types;
            getbackPages += translated.GetBackPages;

            foreach (var target in DanglingLinks(translated.Text))
                dangling[$"{name} → {target}"] = 1;

            string fileName = Path.GetFileNameWithoutExtension(name);
            scripts.Add(new Script(fileName + ".txt", translated.Text));
            npcs.Add(new NPCInfo
            {
                Index = npcs.Count + 1,
                FileName = fileName,
                Name = merchant.Name,
                MapIndex = map,
                Location = new System.Drawing.Point(merchant.X, merchant.Y),
                Image = (ushort)merchant.Body,
                Rate = translated.Rate,
            });
        }

        // Npcs.txt places three NPCs the engine drives itself. Crystal has no equivalent
        // hook, so each becomes an ordinary NPC pointing at the matching market_def script
        // when one exists and at an empty page when it does not.
        foreach (var special in specials)
        {
            if (!mapIndex.TryGetValue(special.MapFile, out int map))
            {
                missingMaps.Add($"{special.MapFile}（{special.Name}）");
                continue;
            }
            if (npcs.Any(n => n.MapIndex == map && n.Location.X == special.X && n.Location.Y == special.Y))
                continue;

            string fileName = $"Special-{special.Race}-{special.MapFile}";
            scripts.Add(new Script(fileName + ".txt",
                $"[@MAIN]\n{special.Name}\n \n<关闭/@exit>\n"));
            npcs.Add(new NPCInfo
            {
                Index = npcs.Count + 1,
                FileName = fileName,
                Name = special.Name,
                MapIndex = map,
                Location = new System.Drawing.Point(special.X, special.Y),
                Image = (ushort)special.Body,
            });
        }

        int orphans = files.Count - merchants.Count + missingScripts.Count;

        report.AppendLine("## NPC");
        report.AppendLine();
        report.AppendLine($"- merchant.txt {merchants.Count} 行，Npcs.txt {specials.Count} 行，"
            + $"写出 {npcs.Count} 个 NPC、{scripts.Count} 个脚本");
        report.AppendLine($"- market_def 共 {files.Count} 个脚本文件，被引用 {merchants.Count - missingScripts.Count} 个，"
            + $"其余 {orphans} 个未引用，不进包");
        report.AppendLine($"- 商店存货 {goods} 条，收购类别 {types} 条（"
            + string.Join("、", typeNames.Select(t => $"{t.Key} {t.Value}")) + "）");
        if (emptyShops > 0)
            report.AppendLine($"- {emptyShops} 个商店没有存货，因为源脚本的 `[goods]` 段本来就是空的"
                + "——这些 NPC 只收购不出售，靠 `[TYPES]` 工作");
        if (lostShops > 0)
            report.AppendLine($"- **{lostShops} 个商店的存货全丢了**：源脚本写的商品名在 176 物品表里"
                + "查不到，见下面的缺物品清单");
        if (getbackPages > 0)
            report.AppendLine($"- {getbackPages} 个 `[@getback]` 取物页并入 `[@STORAGE]`："
                + "Crystal 的仓库窗口存取合一，指向它的链接已改写，原页文字丢弃");
        if (missingScripts.Count > 0)
        {
            report.AppendLine($"- **{missingScripts.Count} 行找不到脚本文件**，未生成 NPC：");
            foreach (var line in missingScripts) report.AppendLine($"  - {line}");
        }
        if (missingMaps.Count > 0)
        {
            report.AppendLine($"- **{missingMaps.Count} 行落在不存在的地图上**，未生成 NPC：");
            foreach (var line in missingMaps) report.AppendLine($"  - {line}");
        }
        if (missingItems.Count > 0)
        {
            report.AppendLine($"- **{missingItems.Count} 个物品名在 176 物品表里查不到**"
                + "（引用它们的行保留为注释）。这些名字在 1.76 的 StdItems 里本来就不存在，"
                + "不是导入丢的——例如脚本写 `金币100` 而物品表只有 `金币1`：");
            foreach (var (item, count) in missingItems) report.AppendLine($"  - `{item}` × {count}");
        }
        if (unsupportedHits.Count > 0)
        {
            report.AppendLine($"- Crystal 没有对应实现、保留为注释的指令：");
            foreach (var (command, count) in unsupportedHits)
                report.AppendLine($"  - `{command}` × {count} —— {Unsupported[command]}");
        }
        if (dangling.Count > 0)
        {
            report.AppendLine($"- **{dangling.Count} 个跳转指向了本脚本里不存在的页**。"
                + "这些链接在 1.76 源脚本里本来就是断的，或者指向 M2 的武器升级子系统"
                + "（`[~@upgradenow_*]` 这类由引擎回调的页），Crystal 没有对应实现："
                );
            foreach (var line in dangling.Keys) report.AppendLine($"  - `{line}`");
        }
        if (gluedGold.Count > 0)
        {
            report.AppendLine("- **本工具替源脚本改了错**：");
            foreach (var (token, count) in gluedGold)
                report.AppendLine($"  - `take {token}` × {count} 当成 `take 金币 {token[2..]}` 处理。"
                    + "同一页里其它扣费行都写成两段，上面的 `#IF` 也照同一个数额查钱，"
                    + "照原样保留会让这些 NPC 白送东西");
        }
        if (unverifiedHits.Count > 0)
        {
            report.AppendLine("- **译出来了但数值语义没验证**的指令：");
            foreach (var (command, count) in unverifiedHits)
                report.AppendLine($"  - `{command}` × {count} —— {Unverified[command]}");
        }
        if (unknownVariables.Count > 0)
        {
            report.AppendLine("- 对话文本里 Crystal 不认识的变量（原样保留，运行时会照字面显示）：");
            foreach (var (variable, count) in unknownVariables)
                report.AppendLine($"  - `<${variable}>` × {count}");
        }
        if (unknownCommands.Count > 0)
        {
            report.AppendLine("- **两张表都没有的指令**，保留为注释待定：");
            foreach (var (command, count) in unknownCommands)
                report.AppendLine($"  - `{command}` × {count}");
        }
        report.AppendLine();

        return new Result(npcs, scripts, report.ToString(), errors);
    }

    private sealed class Translated
    {
        public string Text;
        public ushort Rate = 100;
        public int Goods, Types, GetBackPages;
        public readonly SortedDictionary<string, int> Unknown = new(StringComparer.OrdinalIgnoreCase);
        public readonly SortedDictionary<string, int> Unsupported = new(StringComparer.OrdinalIgnoreCase);
        public readonly SortedDictionary<string, int> UnknownVariables = new(StringComparer.OrdinalIgnoreCase);
        public readonly SortedDictionary<string, int> MissingItems = new(StringComparer.Ordinal);
        public readonly SortedDictionary<string, int> Unverified = new(StringComparer.OrdinalIgnoreCase);
        public readonly SortedDictionary<string, int> TypeNames = new(StringComparer.Ordinal);
        public readonly SortedDictionary<string, int> GluedGold = new(StringComparer.Ordinal);
    }

    private enum Mode { Header, Say, Command, Goods }

    private static Translated Translate(List<string> lines, HashSet<string> items)
    {
        var result = new Translated();
        var body = new StringBuilder();
        var typeList = new List<int>();
        var mode = Mode.Header;
        bool skipPage = false;
        // Say lines are buffered so the blank lines a trailing backslash leaves behind can
        // be dropped where they would otherwise pad the bottom of a dialogue.
        var pending = new List<string>();

        void FlushSay()
        {
            int last = pending.Count - 1;
            while (last >= 0 && pending[last] == " ") last--;
            for (int i = 0; i <= last; i++) body.AppendLine(pending[i]);
            pending.Clear();
        }

        foreach (var raw in lines)
        {
            // Tabs separate columns in some [goods] blocks and Crystal only splits on
            // spaces, so every line is normalised before anything else looks at it.
            string line = raw.Replace('\t', ' ').TrimEnd();
            string trimmed = line.Trim();

            if (mode == Mode.Header)
            {
                if (trimmed.StartsWith(";") || trimmed.Length == 0)
                {
                    if (!trimmed.StartsWith("[")) continue;
                }
                if (trimmed.StartsWith("%") && ushort.TryParse(trimmed[1..], out ushort rate))
                {
                    result.Rate = rate;
                    continue;
                }
                if (trimmed.StartsWith("+") && int.TryParse(trimmed[1..], out int mode176))
                {
                    typeList.Add(mode176);
                    continue;
                }
                if (!trimmed.StartsWith("[")) continue;
            }

            if (trimmed.StartsWith("["))
            {
                string key = trimmed;
                skipPage = false;
                FlushSay();
                if (key.Equals("[goods]", StringComparison.OrdinalIgnoreCase))
                {
                    mode = Mode.Goods;
                    body.AppendLine();
                    body.AppendLine("[TRADE]");
                    continue;
                }
                string inner = key.Trim('[', ']');
                if (PageRenames.TryGetValue(inner, out string renamed))
                {
                    if (renamed.Equals("@storage", StringComparison.OrdinalIgnoreCase))
                    {
                        // The withdrawal page's links already point at the storage window
                        // after redirection, so keeping the page would duplicate the key.
                        result.GetBackPages++;
                        skipPage = true;
                        mode = Mode.Say;
                        continue;
                    }
                    key = "[" + renamed + "]";
                }
                mode = Mode.Say;
                body.AppendLine();
                body.AppendLine(key);
                continue;
            }

            if (skipPage) continue;

            if (mode == Mode.Goods)
            {
                if (trimmed.StartsWith(";") || trimmed.Length == 0) continue;
                var f = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                // 商品名 数量 补货间隔. Crystal reads a count only when the line has
                // exactly two fields, so the restock hours have to come off. Three of the
                // blocks head their columns without a leading ';', and a header has no
                // number where the count belongs.
                if (f.Length < 2 || !int.TryParse(f[1], out _)) continue;
                if (!items.Contains(f[0]))
                {
                    Miss(result.MissingItems, f[0]);
                    body.AppendLine("; [缺物品] " + trimmed);
                    continue;
                }
                body.AppendLine($"{f[0]} {f[1]}");
                result.Goods++;
                continue;
            }

            if (trimmed.StartsWith("#"))
            {
                FlushSay();
                string directive = trimmed.ToUpperInvariant();
                // Nine lines across the pack spell #ELSEACT as #ELESACT.
                if (directive == "#ELESACT") directive = "#ELSEACT";
                mode = directive is "#SAY" or "#ELSESAY" ? Mode.Say : Mode.Command;
                body.AppendLine(directive);
                continue;
            }

            if (mode == Mode.Command)
            {
                if (trimmed.Length == 0 || trimmed.StartsWith(";")) continue;
                body.AppendLine(TranslateCommand(trimmed, result, items));
                continue;
            }

            foreach (var say in SayLines(line, result))
                pending.Add(say);
        }

        FlushSay();

        // Crystal's own scripts close with [TYPES]/[TRADE], and ParseTypes reads until the
        // first line that is not a number, so the block has to end the file rather than
        // open it.
        var text = new StringBuilder(body.ToString().TrimStart('\n'));
        if (typeList.Count > 0)
        {
            var buffer = new StringBuilder();
            foreach (var mode176 in typeList.Distinct())
            {
                if (!ItemStage.TypeOf(mode176, out var itemType)) continue;
                buffer.AppendLine(((int)itemType).ToString());
                Miss(result.TypeNames, itemType.ToString());
                result.Types++;
            }
            if (buffer.Length > 0)
            {
                text.AppendLine();
                text.AppendLine("[TYPES]");
                text.Append(buffer);
            }
        }
        result.Text = text.ToString();
        return result;
    }

    // M2 marks a line break inside dialogue with a backslash and treats the file's own
    // newlines as incidental, so one source line can be several displayed lines.
    private static IEnumerable<string> SayLines(string line, Translated result)
    {
        string text = RedirectLinks(ReplaceVariables(line, result));
        var parts = text.Split('\\');
        int last = parts.Length - 1;
        while (last > 0 && parts[last].Trim().Length == 0) last--;
        for (int i = 0; i <= last; i++)
        {
            string part = parts[i].TrimEnd();
            // Crystal reads an empty line as the end of a page, so a blank display line
            // has to carry a space -- the same trick Crystal's own scripts use.
            yield return part.Trim().Length == 0 ? " " : part;
        }
    }

    // A page that was renamed or folded into another has to be renamed everywhere it is
    // jumped to as well, or the link lands on a page that is no longer there.
    private static string RedirectLinks(string line)
    {
        return System.Text.RegularExpressions.Regex.Replace(line, @"@[A-Za-z_][A-Za-z0-9_]*", m =>
            PageRenames.TryGetValue(m.Value, out string renamed) ? renamed : m.Value);
    }

    private static string ReplaceVariables(string line, Translated result)
    {
        return System.Text.RegularExpressions.Regex.Replace(line, @"<\$([A-Za-z_]+)>", m =>
        {
            string name = m.Groups[1].Value;
            if (Variables.TryGetValue(name, out string mapped)) return "<$" + mapped + ">";
            Miss(result.UnknownVariables, name);
            return m.Value;
        });
    }

    private static string TranslateCommand(string line, Translated result, HashSet<string> items)
    {
        var f = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string command = f[0].ToUpperInvariant();

        if (Unsupported.ContainsKey(command))
        {
            Miss(result.Unsupported, command);
            return "; [未支持] " + line;
        }

        switch (command)
        {
            // Gold is an item in M2 and a separate balance in Crystal.
            case "TAKE" when f.Length >= 3 && f[1] == GoldName:
                return $"TAKEGOLD {f[2]}";
            case "GIVE" when f.Length >= 3 && f[1] == GoldName:
                return $"GIVEGOLD {f[2]}";
            // M2 states a threshold and means "at least"; Crystal wants the operator.
            case "CHECKGOLD" when f.Length == 2:
                return $"CHECKGOLD >= {f[1]}";
            case "CHECKPKPOINT" when f.Length == 2:
                return $"CHECKPKPOINT >= {f[1]}";
            case "CHECKLEVEL" when f.Length == 2:
                return $"LEVEL >= {f[1]}";
            case "CHECKHUM" when f.Length == 3:
                return $"CHECKHUM {f[1]} >= {f[2]}";
            // Bare CHECKBAGGAGE asks whether there is any room at all.
            case "CHECKBAGGAGE" when f.Length == 1:
                return "HASBAGSPACE > 0";
            case "CHECKBAGGAGE" when f.Length == 2:
                return $"HASBAGSPACE >= {f[1]}";
            case "GOTO" when f.Length >= 2:
                return $"GOTO {RedirectLinks(f[1])}";
            // Fourteen lines write the fee as one token, 金币100, where every sibling line
            // in the same page writes 金币 100 and the #IF above them checks CHECKGOLD 100.
            // 金币1 is a real item so only a token that is not itself an item is split.
            case "TAKE" when f.Length == 2 && f[1].StartsWith(GoldName) && !items.Contains(f[1])
                    && int.TryParse(f[1][GoldName.Length..], out int glued):
                Miss(result.GluedGold, f[1]);
                return $"TAKEGOLD {glued}";
            case "CHECKJOB" when f.Length >= 2 && Classes.TryGetValue(f[1], out string cls):
                return $"CHECKCLASS {cls}";
            case "GENDER" when f.Length >= 2:
                return $"CHECKGENDER {(f[1].Equals("man", StringComparison.OrdinalIgnoreCase) || f[1] == "男" ? "Male" : "Female")}";
            // Crystal takes the operator first and the map last.
            case "CHECKMONMAP" when f.Length == 3:
                return $"CHECKMON >= {f[2]} {f[1]}";
            // M2 increments a variable in place; Crystal spells the same thing as a CALC.
            case "INC" when f.Length == 3:
                return $"CALC {f[1]} + {f[2]}";
            // CHECKITEM's fourth argument is a durability floor, which is the closest thing
            // Crystal has to M2's ore-purity test.
            case "CHECKDURAEVA" when f.Length == 3:
                Miss(result.Unverified, command);
                return $"CHECKITEM {f[1]} 1 {f[2]}";
        }

        if ((command is "TAKE" or "GIVE" or "CHECKITEM") && f.Length >= 2 && !items.Contains(f[1]))
        {
            Miss(result.MissingItems, f[1]);
            return "; [缺物品] " + line;
        }

        if (Renames.TryGetValue(command, out string renamed))
            return string.Join(' ', new[] { renamed }.Concat(f.Skip(1)));
        if (Shared.Contains(command))
            return string.Join(' ', new[] { command }.Concat(f.Skip(1)));

        Miss(result.Unknown, command);
        return "; [未识别] " + line;
    }

    // Pages Crystal answers itself, so a link to one is not dangling even though no
    // section in the file declares it.
    private static readonly HashSet<string> EnginePages = new(StringComparer.OrdinalIgnoreCase)
    {
        "@exit", "@main", "@buy", "@sell", "@repair", "@srepair", "@storage", "@buyback",
        "@buysell", "@back", "@close", "@craft", "@refine", "@market", "@consign",
    };

    /// <summary>Link targets no page in the same script declares. Every one found is either
    /// broken in the 1.76 source itself or points at an M2 subsystem Crystal has no page
    /// for, so they are reported rather than invented.</summary>
    private static IEnumerable<string> DanglingLinks(string text)
    {
        var declared = new HashSet<string>(
            System.Text.RegularExpressions.Regex.Matches(text, @"(?m)^\[(@[^\]]+)\]")
                .Select(m => m.Groups[1].Value), StringComparer.OrdinalIgnoreCase);
        return System.Text.RegularExpressions.Regex.Matches(text, @"@[A-Za-z_~][A-Za-z0-9_]*")
            .Select(m => m.Value)
            .Where(t => !declared.Contains(t) && !EnginePages.Contains(t))
            .Select(t => t.ToLowerInvariant())
            .Distinct();
    }

    private static void Miss(IDictionary<string, int> counts, string key)
        => counts[key] = counts.TryGetValue(key, out int n) ? n + 1 : 1;
}
