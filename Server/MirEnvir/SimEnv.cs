using Server.MirDatabase;
using Server.MirObjects;
using Server.MirObjects.Monsters;
using C = ClientPackets;

namespace Server.MirEnvir
{
    /// <summary>
    /// The observation and action interface for in-process agents. One instance serves
    /// every agent in the world: each decision step it fills one batch of observations,
    /// asks the policy for one action per agent, and applies them.
    ///
    /// Layout, per agent (all arrays are flat and row-major so they can be handed to a
    /// policy in another process without copying into a different shape):
    ///
    ///   Grid  [Channels, Side, Side]  the cells around the character, itself at the centre;
    ///                                 row = y, column = x, Side = 2 * ViewRadius + 1
    ///   Self  [SelfSize]              the character's own state
    ///   Mask  [ActionCount]           1 where the action can be taken right now
    ///
    /// An agent sees only what is within ViewRadius of it, which is never more than the
    /// range the server sends a real client. docs/sim-interface.md lists every field.
    /// </summary>
    public sealed class SimEnv
    {
        // Grid channels.
        public const int ChWalkable = 0;       // 1 if the cell can be stood on (terrain only)
        public const int ChBlocked = 1;        // 1 if something standing there blocks movement
        public const int ChMonster = 2;        // 1 if a living monster is there
        public const int ChMonsterHealth = 3;  // that monster's health, 0..1
        public const int ChMonsterLevel = 4;   // that monster's level / LevelScale, capped at 1
        public const int ChMonsterHunting = 5; // 1 if that monster's target is this character
        public const int ChPlayer = 6;         // 1 if another living player is there
        public const int ChItem = 7;           // 1 if an item lies on the ground there
        public const int ChNpc = 8;            // 1 if an NPC stands there
        public const int ChShopPotions = 9;    // 1 if that NPC sells health potions
        public const int ChShopBuysLoot = 10;  // 1 if that NPC would buy something in this character's bag
        public const int ChShopGear = 11;      // 1 if that NPC sells or repairs equipment
        public const int ChCorpse = 12;        // 1 if a dead monster lies there that this character can still cut up
        public const int ChGuard = 13;         // 1 if a town guard stands there: never to be attacked
        public const int Channels = 14;

        // Self vector.
        public const int SfHealth = 0;         // HP / max HP
        public const int SfMana = 1;           // MP / max MP
        public const int SfLevel = 2;          // level / LevelScale, capped at 1
        public const int SfExperience = 3;     // progress to the next level, 0..1
        public const int SfDead = 4;
        public const int SfSafeZone = 5;
        public const int SfCanWalk = 6;
        public const int SfCanRun = 7;
        public const int SfCanAttack = 8;
        public const int SfHealthPotions = 9;  // HP potions carried / PotionScale, capped at 1
        public const int SfManaPotions = 10;
        public const int SfFreeSlots = 11;     // empty bag slots / bag size
        public const int SfBagWeight = 12;     // carried weight / limit, capped at 1
        public const int SfGold = 13;          // log10(1 + gold) / 7, capped at 1
        public const int SfMapX = 14;          // x / map width
        public const int SfMapY = 15;          // y / map height
        public const int SfDirection = 16;     // 8 values, one-hot facing
        public const int SfLoot = 24;          // bag slots holding something to sell / bag size
        public const int SfWeapon = 25;        // equipped weapon's attack score / GearScale, capped at 1
        public const int SfArmour = 26;        // equipped armour's defence score / GearScale, capped at 1
        public const int SfWeaponDura = 27;    // weapon durability left, 0..1 (0 with no weapon)
        public const int SfArmourDura = 28;    // armour durability left, 0..1 (0 with no armour)
        public const int SfLootValue = 29;     // log10(1 + what the bag's loot would sell for) / 6, capped at 1
        public const int SelfSize = 30;

        // Actions.
        public const int ActNone = 0;
        public const int ActWalk = 1;          // 1..8: walk Up, UpRight, Right, ... UpLeft
        public const int ActRun = 9;           // 9..16: run, same order
        public const int ActAttack = 17;       // 17..24: melee attack towards, same order
        public const int ActPickUp = 25;
        public const int ActHealthPotion = 26;
        public const int ActManaPotion = 27;
        public const int ActSell = 28;         // sell everything a nearby NPC will buy, keeping health potions and gear upgrades
        public const int ActBuyPotion = 29;    // buy one of the cheapest health potion a nearby NPC stocks
        public const int ActBuyGear = 30;      // buy the best affordable weapon or armour upgrade nearby and put it on
        public const int ActEquipBest = 31;    // put on the best usable weapon or armour in the bag
        public const int ActHarvest = 32;      // 32..39: cut up the corpse in that direction (meat and the like are not dropped, they are cut)
        public const int ActRepair = 40;       // have a nearby NPC repair the most worn thing the character is wearing
        public const int ActionCount = 41;

        public const float LevelScale = 50f;
        public const float PotionScale = 20f;
        public const float GearScale = 50f;

        /// <summary>How close, in cells, a character must be to an NPC to trade with it.</summary>
        public const int ShopRange = 4;

        private readonly Envir _envir;
        private readonly List<SimAgent> _agents;

        public readonly int ViewRadius;
        public readonly int Side;
        public readonly int GridSize; // Channels * Side * Side

        public readonly float[] Grid;
        public readonly float[] Self;
        public readonly byte[] Mask;
        public readonly int[] Actions;

        /// <summary>The agents this environment serves, in batch order.</summary>
        public IReadOnlyList<SimAgent> Agents => _agents;

        /// <summary>Every NPC that buys or sells, with what it trades in.</summary>
        public readonly List<SimShop> Shops = new List<SimShop>();

        // What each agent could trade this step, worked out once while building its mask
        // and used again if it takes that action.
        private readonly Trade[] _trade;

        private struct Trade
        {
            public SimShop SellShop;
            public SimShop PotionShop;
            public UserItem PotionGoods;
            public SimShop GearShop;
            public UserItem GearGoods;
            public UserItem EquipItem;
            public SimShop RepairShop;
            public EquipmentSlot RepairSlot;
        }

        /// <summary>Decision steps taken, summed over agents.</summary>
        public long AgentSteps { get; private set; }

        /// <summary>Actions a policy chose although the mask ruled them out. They become no-ops.</summary>
        public long RejectedActions { get; private set; }

        public ISimPolicy Policy;

        public SimEnv(Envir envir, List<SimAgent> agents, int viewRadius)
        {
            if (viewRadius < 1 || viewRadius > Globals.DataRange)
                throw new ArgumentOutOfRangeException(nameof(viewRadius), $"View radius must be 1..{Globals.DataRange}.");

            _envir = envir;
            _agents = agents;
            ViewRadius = viewRadius;
            Side = 2 * viewRadius + 1;
            GridSize = Channels * Side * Side;

            Grid = new float[agents.Count * GridSize];
            Self = new float[agents.Count * SelfSize];
            Mask = new byte[agents.Count * ActionCount];
            Actions = new int[agents.Count];
            _trade = new Trade[agents.Count];

            foreach (var npc in envir.NPCs)
            {
                var shop = SimShop.From(npc);
                if (shop != null) Shops.Add(shop);
            }

            // A new character's starting kit arrives in its bag. Put it on, as a player
            // would before leaving town.
            foreach (var agent in agents)
            {
                for (var pieces = 0; pieces < 4 && agent.Player != null; pieces++)
                {
                    var item = BestUpgrade(agent.Player, agent, agent.Player.Info.Inventory, uint.MaxValue, 1f);
                    if (item == null) break;
                    Equip(agent, item);
                }
            }
        }

        /// <summary>The do-not-fight list: melee guards and archer guards of the towns.</summary>
        public static bool IsGuard(MapObject ob) =>
            ob is Server.MirObjects.Monsters.Guard || ob is Server.MirObjects.Monsters.TownArcher;

        /// <summary>Level with the progress towards the next one as its fraction: 9.40 is level 9 and 40% of the way to 10.</summary>
        public static double FractionalLevel(PlayerObject player) =>
            player.Level + (player.MaxExperience > 0 ? Math.Clamp(player.Experience / (double)player.MaxExperience, 0, 0.9999) : 0);

        // Bankruptcy relief, for training only. A character that dies can drop its weapon,
        // and a low-level warrior with no weapon does no damage at all: with no gold
        // either, it can never earn its way back and the rest of its run teaches nothing.
        // So a living character with no weapon on it or in its bag, and too little gold
        // to buy one, is handed the starting weapon again. This is a rule of the
        // simulation environment, not of the game: players on a normal server get nothing.
        private void Relieve(SimAgent agent)
        {
            var player = agent.Player;
            if (player == null || player.Dead) return;
            if (player.Info.Equipment[(int)EquipmentSlot.Weapon] != null) return;

            ItemInfo starter = null;
            foreach (var info in _envir.StartItems)
            {
                if (info.Type != ItemType.Weapon || !CanUse(player, agent, info)) continue;
                starter = info;
                break;
            }
            if (starter == null) return;

            // Enough gold for a couple of the cheapest weapons: it can buy its own.
            if (player.Account.Gold >= 2 * starter.Price) return;

            var bag = player.Info.Inventory;
            var free = false;
            for (var s = 0; s < bag.Length; s++)
            {
                if (bag[s] == null) { free = true; continue; }
                if (bag[s].Info.Type == ItemType.Weapon && CanUse(player, agent, bag[s].Info)) return; // it has one to put on
            }
            if (!free) return;

            var item = _envir.CreateFreshItem(starter);
            if (!player.CanGainItem(item)) return;
            player.GainItem(item);
            Equip(agent, item);
            agent.Reliefs++;
        }

        /// <summary>
        /// Totals and spread over all agents, for the end of a run. Call on the engine
        /// thread, or after the loop has stopped.
        /// </summary>
        public string Summary()
        {
            var levels = new List<int>();
            var fractional = new List<double>();
            long deaths = 0, kills = 0, experience = 0, goldGained = 0, goldSpent = 0, gold = 0;
            int potionsUsed = 0, potionsBought = 0, itemsSold = 0, gearBought = 0, armed = 0, armoured = 0, carried = 0, loot = 0;
            long weight = 0, weightLimit = 0;

            foreach (var agent in _agents)
            {
                deaths += agent.Deaths; kills += agent.Kills; experience += agent.ExperienceGained;
                goldGained += agent.GoldGained; goldSpent += agent.GoldSpent;
                potionsUsed += agent.PotionsUsed; potionsBought += agent.PotionsBought;
                itemsSold += agent.ItemsSold; gearBought += agent.GearBought;

                var player = agent.Player;
                if (player == null) continue;
                levels.Add(player.Level);
                fractional.Add(FractionalLevel(player));
                gold += player.Account.Gold;
                if (player.Info.Equipment[(int)EquipmentSlot.Weapon] != null) armed++;
                if (player.Info.Equipment[(int)EquipmentSlot.Armour] != null) armoured++;
                foreach (var item in player.Info.Inventory)
                {
                    if (item == null) continue;
                    carried++;
                    if (IsLoot(player, agent, item)) loot++;
                }
                weight += player.CurrentBagWeight; weightLimit += player.Stats[Stat.BagWeight];
            }

            levels.Sort();
            var n = Math.Max(1, levels.Count);
            var text = new System.Text.StringBuilder();
            text.AppendLine($"[summary] agents {_agents.Count}, in game {levels.Count}, decision steps {AgentSteps}, rejected actions {RejectedActions}");
            if (levels.Count > 0)
                text.AppendLine($"[summary] level min {levels[0]}, median {levels[levels.Count / 2]}, mean {levels.Average():F2}, max {levels[^1]}; with progress to the next level, mean {fractional.Average():F2}, min {fractional.Min():F2}, max {fractional.Max():F2}");
            text.AppendLine($"[summary] kills {kills} ({kills / (double)n:F1} each), experience {experience}, deaths {deaths} ({deaths / (double)n:F2} each)");
            text.AppendLine($"[summary] gold gained {goldGained}, spent {goldSpent}, held {gold}; items sold {itemsSold}");
            text.AppendLine($"[summary] potions bought {potionsBought}, used {potionsUsed}; gear bought {gearBought}, put on {_agents.Sum(a => a.GearEquipped)}, repairs {_agents.Sum(a => a.Repairs)}; wearing a weapon {armed}, armour {armoured}");
            text.AppendLine($"[summary] cuts at corpses {_agents.Sum(a => (long)a.Harvests)}; relief weapons handed out {_agents.Sum(a => a.Reliefs)} to {_agents.Count(a => a.Reliefs > 0)} characters");
            text.AppendLine($"[summary] bag slots in use {carried} ({loot} to sell), carried weight {weight} of {weightLimit}");
            if (Policy is ISimPolicyReport report) text.Append(report.Report());
            return text.ToString();
        }

        /// <summary>
        /// One decision step for every agent: revive the dead, observe all, decide, act all.
        /// Everyone observes the same moment before anyone moves. Call on the engine thread.
        /// </summary>
        public void Step()
        {
            if (Policy == null) return;

            for (var i = 0; i < _agents.Count; i++)
            {
                var agent = _agents[i];
                agent.TrackDeath();
                // Training is a continuing task: a dead character goes back to town and
                // carries on, with the death counted against it.
                if (agent.Player != null && agent.Player.Dead)
                    agent.Send(new C.TownRevive());

                if (Settings.SimulationRelief) Relieve(agent);
            }

            Array.Clear(Grid);
            Array.Clear(Self);
            Array.Clear(Mask);
            Array.Clear(_trade);

            for (var i = 0; i < _agents.Count; i++)
                Observe(i);

            Policy.Decide(this, Actions);

            for (var i = 0; i < _agents.Count; i++)
                Act(i, Actions[i]);

            AgentSteps += _agents.Count;
        }

        private void Observe(int index)
        {
            var player = _agents[index].Player;
            var mask = index * ActionCount;
            Mask[mask + ActNone] = 1;
            if (player == null || player.CurrentMap == null) return;

            var map = player.CurrentMap;
            var centre = player.CurrentLocation;
            var grid = index * GridSize;
            var plane = Side * Side;
            var onItem = false;

            for (var dy = -ViewRadius; dy <= ViewRadius; dy++)
            {
                for (var dx = -ViewRadius; dx <= ViewRadius; dx++)
                {
                    int x = centre.X + dx, y = centre.Y + dy;
                    if (!map.ValidPoint(x, y)) continue; // off the map or a wall: all zero

                    var at = grid + (dy + ViewRadius) * Side + (dx + ViewRadius);
                    Grid[at + ChWalkable * plane] = 1;

                    var objects = map.GetCell(x, y).Objects;
                    if (objects == null) continue;

                    for (var o = 0; o < objects.Count; o++)
                    {
                        var ob = objects[o];
                        if (ob == player) continue;

                        if (ob.Blocking) Grid[at + ChBlocked * plane] = 1;

                        switch (ob.Race)
                        {
                            case ObjectType.Monster:
                                if (ob.Dead)
                                {
                                    // Some monsters drop nothing: what they carry is cut from the body,
                                    // and only by whoever earned the kill.
                                    if (!ob.Harvested && ob is HarvestMonster && (ob.EXPOwner == null || ob.EXPOwner == player))
                                        Grid[at + ChCorpse * plane] = 1;
                                    break;
                                }
                                // Town guards are on the list of things not to fight: they are
                                // far too strong and are no prey. They get a channel of their
                                // own and never appear as monsters.
                                if (IsGuard(ob))
                                {
                                    Grid[at + ChGuard * plane] = 1;
                                    if (ob.Target == player) Grid[at + ChMonsterHunting * plane] = 1;
                                    break;
                                }
                                Grid[at + ChMonster * plane] = 1;
                                Grid[at + ChMonsterHealth * plane] = ob.MaxHealth > 0 ? Math.Clamp(ob.Health / (float)ob.MaxHealth, 0f, 1f) : 0f;
                                Grid[at + ChMonsterLevel * plane] = Math.Min(1f, ob.Level / LevelScale);
                                if (ob.Target == player) Grid[at + ChMonsterHunting * plane] = 1;
                                break;
                            case ObjectType.Player:
                                if (!ob.Dead) Grid[at + ChPlayer * plane] = 1;
                                break;
                            case ObjectType.Item:
                                Grid[at + ChItem * plane] = 1;
                                if (dx == 0 && dy == 0) onItem = true;
                                break;
                            case ObjectType.Merchant:
                                Grid[at + ChNpc * plane] = 1;
                                var seen = FindShop(ob);
                                if (seen == null) break;
                                if (seen.SellsPotions) Grid[at + ChShopPotions * plane] = 1;
                                if (seen.SellsGear || seen.RepairKey != null) Grid[at + ChShopGear * plane] = 1;
                                if (seen.SellKey != null && CountSellable(player, seen) > 0) Grid[at + ChShopBuysLoot * plane] = 1;
                                break;
                        }
                    }
                }
            }

            var self = index * SelfSize;
            int healthPotions = 0, manaPotions = 0, freeSlots = 0;
            var bag = player.Info.Inventory;
            for (var s = 0; s < bag.Length; s++)
            {
                var item = bag[s];
                if (item == null) { freeSlots++; continue; }
                if (item.Info.Type != ItemType.Potion) continue;
                if (item.Info.Stats[Stat.HP] > 0) healthPotions += item.Count;
                if (item.Info.Stats[Stat.MP] > 0) manaPotions += item.Count;
            }

            Self[self + SfHealth] = player.MaxHealth > 0 ? Math.Clamp(player.Health / (float)player.MaxHealth, 0f, 1f) : 0f;
            Self[self + SfMana] = player.Stats[Stat.MP] > 0 ? Math.Clamp(player.MP / (float)player.Stats[Stat.MP], 0f, 1f) : 0f;
            Self[self + SfLevel] = Math.Min(1f, player.Level / LevelScale);
            Self[self + SfExperience] = player.MaxExperience > 0 ? Math.Clamp(player.Experience / (float)player.MaxExperience, 0f, 1f) : 0f;
            Self[self + SfDead] = player.Dead ? 1 : 0;
            Self[self + SfSafeZone] = player.InSafeZone ? 1 : 0;
            Self[self + SfCanWalk] = player.CanWalk ? 1 : 0;
            Self[self + SfCanRun] = player.CanRun ? 1 : 0;
            Self[self + SfCanAttack] = player.CanAttack ? 1 : 0;
            Self[self + SfHealthPotions] = Math.Min(1f, healthPotions / PotionScale);
            Self[self + SfManaPotions] = Math.Min(1f, manaPotions / PotionScale);
            Self[self + SfFreeSlots] = freeSlots / (float)bag.Length;
            Self[self + SfBagWeight] = player.Stats[Stat.BagWeight] > 0 ? Math.Min(1f, player.CurrentBagWeight / (float)player.Stats[Stat.BagWeight]) : 1f;
            Self[self + SfGold] = Math.Min(1f, (float)Math.Log10(1.0 + player.Account.Gold) / 7f);
            Self[self + SfMapX] = centre.X / (float)map.Width;
            Self[self + SfMapY] = centre.Y / (float)map.Height;
            Self[self + SfDirection + (int)player.Direction] = 1;

            int loot = 0;
            double lootValue = 0;
            for (var s = 0; s < bag.Length; s++)
            {
                if (bag[s] == null || !IsLoot(player, _agents[index], bag[s])) continue;
                loot++;
                lootValue += bag[s].Price() / 2;
            }
            Self[self + SfLoot] = loot / (float)bag.Length;
            Self[self + SfLootValue] = Math.Min(1f, (float)Math.Log10(1.0 + lootValue) / 6f);
            Self[self + SfWeapon] = Math.Min(1f, Math.Max(0, EquippedScore(player, EquipmentSlot.Weapon)) / GearScale);
            Self[self + SfArmour] = Math.Min(1f, Math.Max(0, EquippedScore(player, EquipmentSlot.Armour)) / GearScale);
            Self[self + SfWeaponDura] = DuraLeft(player.Info.Equipment[(int)EquipmentSlot.Weapon]);
            Self[self + SfArmourDura] = DuraLeft(player.Info.Equipment[(int)EquipmentSlot.Armour]);

            if (player.Dead) return; // only the no-op is open to the dead

            for (var d = 0; d < 8; d++)
            {
                var direction = (MirDirection)d;
                var one = Functions.PointMove(centre, direction, 1);
                var oneOpen = Open(map, one);
                if (player.CanWalk && oneOpen) Mask[mask + ActWalk + d] = 1;
                if (player.CanRun && oneOpen && Open(map, Functions.PointMove(centre, direction, 2))) Mask[mask + ActRun + d] = 1;
                if (player.CanAttack) Mask[mask + ActAttack + d] = 1;
            }

            if (player.CanMove && freeSlots > 0)
            {
                var middle = grid + ChCorpse * plane + ViewRadius * Side + ViewRadius;
                // Standing on it: any direction reaches it, so offer the first.
                if (Grid[middle] != 0) Mask[mask + ActHarvest] = 1;
                for (var d = 0; d < 8; d++)
                {
                    var front = Functions.PointMove(centre, (MirDirection)d, 1);
                    if (Grid[middle + (front.Y - centre.Y) * Side + (front.X - centre.X)] != 0) Mask[mask + ActHarvest + d] = 1;
                }
            }

            if (onItem) Mask[mask + ActPickUp] = 1;
            if (healthPotions > 0) Mask[mask + ActHealthPotion] = 1;
            if (manaPotions > 0) Mask[mask + ActManaPotion] = 1;

            ref var trade = ref _trade[index];
            var agent = _agents[index];

            trade.EquipItem = BestUpgrade(player, agent, bag, uint.MaxValue, 1f);
            if (trade.EquipItem != null) Mask[mask + ActEquipBest] = 1;

            int bestSellCount = 0, potionDistance = int.MaxValue;
            uint potionCost = 0;
            int gearScore = -1;
            for (var i = 0; i < Shops.Count; i++)
            {
                var shop = Shops[i];
                if (shop.Npc.CurrentMap != map) continue;
                var distance = Functions.MaxDistance(shop.Npc.CurrentLocation, centre);
                if (distance > ShopRange) continue;

                if (shop.SellKey != null)
                {
                    var count = CountSellable(player, shop);
                    if (count > bestSellCount) { bestSellCount = count; trade.SellShop = shop; }
                }

                var rate = shop.Npc.Info.Rate / 100f;

                if (shop.RepairKey != null && freeSlots > 0 && trade.RepairShop == null)
                {
                    // The most worn thing it is wearing that this NPC will mend and it can pay for.
                    var worst = 1f;
                    var worn = player.Info.Equipment;
                    for (var e = 0; e < worn.Length; e++)
                    {
                        var item = worn[e];
                        if (item == null || item.MaxDura == 0 || item.CurrentDura >= item.MaxDura) continue;
                        if (item.Info.Bind.HasFlag(BindMode.DontRepair) || !shop.Accepts(item.Info.Type)) continue;
                        var cost = (uint)(item.RepairPrice() * rate);
                        if (cost == 0 || cost > player.Account.Gold) continue;
                        var left = item.CurrentDura / (float)item.MaxDura;
                        if (left < worst) { worst = left; trade.RepairShop = shop; trade.RepairSlot = (EquipmentSlot)e; }
                    }
                }

                if (shop.BuyKey == null) continue;

                if (shop.SellsPotions && (freeSlots > 0 || healthPotions > 0))
                {
                    var goods = shop.CheapestPotion;
                    var cost = (uint)(UnitPrice(goods) * rate);
                    var fits = player.CurrentBagWeight + goods.Info.Weight <= player.Stats[Stat.BagWeight];
                    if (fits && cost <= player.Account.Gold && (trade.PotionGoods == null || cost < potionCost || (cost == potionCost && distance < potionDistance)))
                    {
                        trade.PotionShop = shop; trade.PotionGoods = goods; potionCost = cost; potionDistance = distance;
                    }
                }

                if (shop.SellsGear && freeSlots > 0)
                {
                    var goods = BestUpgrade(player, agent, shop.Script.Goods, player.Account.Gold, rate);
                    if (goods != null && GearScore(player, goods.Info) > gearScore)
                    {
                        trade.GearShop = shop; trade.GearGoods = goods; gearScore = GearScore(player, goods.Info);
                    }
                }
            }

            if (trade.SellShop != null) Mask[mask + ActSell] = 1;
            if (trade.PotionGoods != null) Mask[mask + ActBuyPotion] = 1;
            if (trade.GearGoods != null) Mask[mask + ActBuyGear] = 1;
            if (trade.RepairShop != null) Mask[mask + ActRepair] = 1;
        }

        private static float DuraLeft(UserItem item) =>
            item == null ? 0f : item.MaxDura == 0 ? 1f : Math.Clamp(item.CurrentDura / (float)item.MaxDura, 0f, 1f);

        private SimShop FindShop(MapObject npc)
        {
            for (var i = 0; i < Shops.Count; i++)
                if (Shops[i].Npc == npc) return Shops[i];
            return null;
        }

        // What one of an item costs. Price() is for the whole stack, and a shop's goods
        // carry their stock level as the stack count.
        public static uint UnitPrice(UserItem item) =>
            item.Count > 1 ? item.Price() / item.Count : item.Price();

        public static bool IsHealthPotion(ItemInfo info) =>
            info.Type == ItemType.Potion && info.Stats[Stat.HP] > 0;

        // Where a kind of equipment is worn. Rings and bracelets have two places.
        // Returns how many (0 for anything this interface does not equip).
        private static int SlotsOf(ItemType type, out EquipmentSlot first, out EquipmentSlot second)
        {
            first = second = EquipmentSlot.Weapon;
            switch (type)
            {
                case ItemType.Weapon: first = EquipmentSlot.Weapon; return 1;
                case ItemType.Armour: first = EquipmentSlot.Armour; return 1;
                case ItemType.Helmet: first = EquipmentSlot.Helmet; return 1;
                case ItemType.Necklace: first = EquipmentSlot.Necklace; return 1;
                case ItemType.Belt: first = EquipmentSlot.Belt; return 1;
                case ItemType.Boots: first = EquipmentSlot.Boots; return 1;
                case ItemType.Bracelet: first = EquipmentSlot.BraceletL; second = EquipmentSlot.BraceletR; return 2;
                case ItemType.Ring: first = EquipmentSlot.RingL; second = EquipmentSlot.RingR; return 2;
                default: return 0;
            }
        }

        // How good a piece of equipment is for this character: the attack stat its class
        // fights with counts double, then defence, accuracy and agility.
        private static int GearScore(PlayerObject player, ItemInfo info)
        {
            var stats = info.Stats;
            var attack = player.Class switch
            {
                MirClass.Wizard => stats[Stat.MinMC] + stats[Stat.MaxMC],
                MirClass.Taoist => stats[Stat.MinSC] + stats[Stat.MaxSC],
                _ => stats[Stat.MinDC] + stats[Stat.MaxDC],
            };
            return 2 * attack + stats[Stat.MinAC] + stats[Stat.MaxAC] + stats[Stat.MinMAC] + stats[Stat.MaxMAC]
                   + stats[Stat.Accuracy] + stats[Stat.Agility];
        }

        private static int EquippedScore(PlayerObject player, EquipmentSlot slot)
        {
            var worn = player.Info.Equipment[(int)slot];
            return worn == null ? -1 : GearScore(player, worn.Info);
        }

        // The place this item would go -- the weaker of the two for rings and bracelets --
        // and how much better it is than what is there. False if it is not equipment.
        private static bool Upgrade(PlayerObject player, ItemInfo info, out EquipmentSlot slot, out int gain)
        {
            slot = EquipmentSlot.Weapon; gain = 0;
            var count = SlotsOf(info.Type, out var first, out var second);
            if (count == 0) return false;

            slot = first;
            if (count == 2 && EquippedScore(player, second) < EquippedScore(player, first)) slot = second;
            gain = GearScore(player, info) - EquippedScore(player, slot);
            return true;
        }

        // A first check that the character could wear this. The server has the last word;
        // an item it refuses is remembered on the agent and not offered again.
        private static bool CanUse(PlayerObject player, SimAgent agent, ItemInfo info)
        {
            if (agent.RefusedGear.Contains(info.Index)) return false;
            if (!info.RequiredClass.HasFlag((RequiredClass)(1 << (int)player.Class))) return false;
            if (!info.RequiredGender.HasFlag((RequiredGender)(1 << (int)player.Gender))) return false;

            var need = info.RequiredAmount;
            var met = info.RequiredType switch
            {
                RequiredType.Level => player.Level >= need,
                RequiredType.MaxLevel => player.Level <= need,
                RequiredType.MaxAC => player.Stats[Stat.MaxAC] >= need,
                RequiredType.MaxMAC => player.Stats[Stat.MaxMAC] >= need,
                RequiredType.MaxDC => player.Stats[Stat.MaxDC] >= need,
                RequiredType.MaxMC => player.Stats[Stat.MaxMC] >= need,
                RequiredType.MaxSC => player.Stats[Stat.MaxSC] >= need,
                RequiredType.MinAC => player.Stats[Stat.MinAC] >= need,
                RequiredType.MinMAC => player.Stats[Stat.MinMAC] >= need,
                RequiredType.MinDC => player.Stats[Stat.MinDC] >= need,
                RequiredType.MinMC => player.Stats[Stat.MinMC] >= need,
                RequiredType.MinSC => player.Stats[Stat.MinSC] >= need,
                _ => true,
            };
            if (!met) return false;

            return info.Type == ItemType.Weapon
                ? info.Weight <= player.Stats[Stat.HandWeight]
                : info.Weight <= player.Stats[Stat.WearWeight];
        }

        // The piece of equipment in a list that would improve the character most: one it
        // can use now, that beats what it is wearing, and that costs no more than the gold given.
        private static UserItem BestUpgrade(PlayerObject player, SimAgent agent, IList<UserItem> items, uint gold, float rate)
        {
            UserItem best = null;
            var bestGain = 0;
            for (var i = 0; i < items.Count; i++)
            {
                var item = items[i];
                if (item == null) continue;
                if (!Upgrade(player, item.Info, out _, out var gain) || gain <= bestGain) continue;
                if (!CanUse(player, agent, item.Info)) continue;
                if ((uint)(UnitPrice(item) * rate) > gold) continue;

                bestGain = gain; best = item;
            }
            return best;
        }

        // Something the character would sell: not a health potion, and not equipment that
        // is better than what it wears and that it can put on right now. Better gear it
        // cannot use yet is sold like anything else.
        private static bool IsLoot(PlayerObject player, SimAgent agent, UserItem item)
        {
            if (IsHealthPotion(item.Info)) return false;
            if (item.Info.Bind.HasFlag(BindMode.DontSell)) return false;
            if (Upgrade(player, item.Info, out _, out var gain) && gain > 0 && CanUse(player, agent, item.Info)) return false;
            return true;
        }

        private int CountSellable(PlayerObject player, SimShop shop)
        {
            var count = 0;
            var bag = player.Info.Inventory;
            for (var s = 0; s < bag.Length; s++)
                if (bag[s] != null && IsLoot(player, _agentOf(player), bag[s]) && shop.Accepts(bag[s].Info.Type)) count++;
            return count;
        }

        private static void Equip(SimAgent agent, UserItem item)
        {
            Upgrade(agent.Player, item.Info, out var slot, out _);
            agent.Send(new C.EquipItem { Grid = MirGridType.Inventory, UniqueID = item.UniqueID, To = (int)slot });
            if (agent.Player.Info.Equipment[(int)slot] == item) agent.GearEquipped++;
            else agent.RefusedGear.Add(item.Info.Index);
        }

        private SimAgent _agentOf(PlayerObject player)
        {
            for (var i = 0; i < _agents.Count; i++)
                if (_agents[i].Player == player) return _agents[i];
            return null;
        }

        // A cell that can be stepped onto: walkable terrain with nothing blocking on it.
        private static bool Open(Map map, System.Drawing.Point point)
        {
            if (!map.ValidPoint(point)) return false;

            var objects = map.GetCell(point).Objects;
            if (objects == null) return true;

            for (var i = 0; i < objects.Count; i++)
                if (objects[i].Blocking) return false;
            return true;
        }

        private void Act(int index, int action)
        {
            var agent = _agents[index];
            var player = agent.Player;
            if (player == null || action == ActNone) return;

            // The server queues a move or attack that arrives too early and runs it later.
            // Dropping what the mask ruled out keeps that queue from filling with stale orders.
            if (action < 0 || action >= ActionCount || Mask[index * ActionCount + action] == 0)
            {
                RejectedActions++;
                return;
            }

            if (action >= ActWalk && action < ActRun)
                agent.Send(new C.Walk { Direction = (MirDirection)(action - ActWalk) });
            else if (action >= ActRun && action < ActAttack)
                agent.Send(new C.Run { Direction = (MirDirection)(action - ActRun) });
            else if (action >= ActAttack && action < ActAttack + 8)
                agent.Send(new C.Attack { Direction = (MirDirection)(action - ActAttack), Spell = Spell.None });
            else if (action == ActPickUp)
                agent.Send(new C.PickUp());
            else if (action == ActRepair)
            {
                // The server mends only what is in the bag: take it off, mend it, put it back.
                var shop = _trade[index].RepairShop;
                var slot = (int)_trade[index].RepairSlot;
                var item = player.Info.Equipment[slot];
                var free = Array.IndexOf(player.Info.Inventory, null);
                if (item == null || free < 0) return;

                agent.Send(new C.RemoveItem { Grid = MirGridType.Inventory, UniqueID = item.UniqueID, To = free });
                if (player.Info.Equipment[slot] == item) return; // would not come off
                var before = item.CurrentDura;
                agent.Send(new C.CallNPC { ObjectID = shop.Npc.ObjectID, Key = NPCScript.MainKey });
                agent.Send(new C.CallNPC { ObjectID = shop.Npc.ObjectID, Key = shop.RepairKey });
                agent.Send(new C.RepairItem { UniqueID = item.UniqueID });
                if (item.CurrentDura > before) agent.Repairs++;
                agent.Send(new C.EquipItem { Grid = MirGridType.Inventory, UniqueID = item.UniqueID, To = slot });
            }
            else if (action >= ActHarvest && action < ActHarvest + 8)
            {
                agent.Harvests++;
                agent.Send(new C.Harvest { Direction = (MirDirection)(action - ActHarvest) });
            }
            else if (action == ActEquipBest)
                Equip(agent, _trade[index].EquipItem);
            else if (action == ActSell)
            {
                var shop = _trade[index].SellShop;
                agent.Send(new C.CallNPC { ObjectID = shop.Npc.ObjectID, Key = NPCScript.MainKey });
                agent.Send(new C.CallNPC { ObjectID = shop.Npc.ObjectID, Key = shop.SellKey });
                var bag = player.Info.Inventory;
                for (var s = 0; s < bag.Length; s++)
                {
                    var item = bag[s];
                    if (item == null || !IsLoot(player, agent, item) || !shop.Accepts(item.Info.Type)) continue;
                    agent.Send(new C.SellItem { UniqueID = item.UniqueID, Count = item.Count });
                    if (bag[s] != item) agent.ItemsSold++;
                }
            }
            else if (action == ActBuyPotion || action == ActBuyGear)
            {
                var gear = action == ActBuyGear;
                var shop = gear ? _trade[index].GearShop : _trade[index].PotionShop;
                var goods = gear ? _trade[index].GearGoods : _trade[index].PotionGoods;
                var before = player.Account.Gold;
                agent.Send(new C.CallNPC { ObjectID = shop.Npc.ObjectID, Key = NPCScript.MainKey });
                agent.Send(new C.CallNPC { ObjectID = shop.Npc.ObjectID, Key = shop.BuyKey });
                agent.Send(new C.BuyItem { ItemIndex = goods.UniqueID, Count = 1, Type = PanelType.Buy });
                if (player.Account.Gold >= before) return; // the server did not sell it

                if (!gear) { agent.PotionsBought++; return; }

                agent.GearBought++;
                var bag = player.Info.Inventory;
                for (var s = 0; s < bag.Length; s++)
                {
                    if (bag[s] == null || bag[s].Info != goods.Info) continue;
                    Equip(agent, bag[s]);
                    break;
                }
            }
            else
            {
                agent.PotionsUsed++;
                var stat = action == ActHealthPotion ? Stat.HP : Stat.MP;
                var bag = player.Info.Inventory;
                for (var s = 0; s < bag.Length; s++)
                {
                    var item = bag[s];
                    if (item == null || item.Info.Type != ItemType.Potion || item.Info.Stats[stat] <= 0) continue;
                    agent.Send(new C.UseItem { UniqueID = item.UniqueID, Grid = MirGridType.Inventory });
                    break;
                }
            }
        }
    }

    /// <summary>An NPC that trades, and what it trades in.</summary>
    public sealed class SimShop
    {
        public NPCObject Npc { get; private set; }
        public NPCScript Script { get; private set; }

        /// <summary>The page to call before buying from it, or null if it sells nothing.</summary>
        public string BuyKey { get; private set; }

        /// <summary>The page to call before selling to it, or null if it buys nothing.</summary>
        public string SellKey { get; private set; }

        /// <summary>The page to call before having it repair something, or null if it does not.</summary>
        public string RepairKey { get; private set; }

        public UserItem CheapestPotion { get; private set; }
        public bool SellsPotions => BuyKey != null && CheapestPotion != null;
        public bool SellsGear { get; private set; }

        /// <summary>Whether it buys items of this type. An NPC with no type list buys anything.</summary>
        public bool Accepts(ItemType type) => Script.Types.Count == 0 || Script.Types.Contains(type);

        public static SimShop From(NPCObject npc)
        {
            var script = NPCScript.Get(npc.ScriptID);
            if (script == null) return null;

            string Page(string key) =>
                script.NPCPages.Any(p => string.Equals(p.Key, key, StringComparison.OrdinalIgnoreCase)) ? key : null;

            var shop = new SimShop
            {
                Npc = npc,
                Script = script,
                BuyKey = Page(NPCScript.BuyKey) ?? Page(NPCScript.BuySellKey),
                SellKey = Page(NPCScript.SellKey) ?? Page(NPCScript.BuySellKey),
                RepairKey = Page(NPCScript.RepairKey),
            };
            if (shop.BuyKey == null && shop.SellKey == null && shop.RepairKey == null) return null;

            if (shop.BuyKey != null)
            {
                foreach (var goods in script.Goods)
                {
                    if (SimEnv.IsHealthPotion(goods.Info) && (shop.CheapestPotion == null || SimEnv.UnitPrice(goods) < SimEnv.UnitPrice(shop.CheapestPotion)))
                        shop.CheapestPotion = goods;
                    if (goods.Info.Type is ItemType.Weapon or ItemType.Armour or ItemType.Helmet or ItemType.Necklace
                        or ItemType.Bracelet or ItemType.Ring or ItemType.Belt or ItemType.Boots)
                        shop.SellsGear = true;
                }
            }
            return shop;
        }
    }

    /// <summary>A policy that has something to add to the end-of-run summary.</summary>
    public interface ISimPolicyReport
    {
        string Report();
    }

    /// <summary>Chooses one action per agent from the batch the environment has just filled.</summary>
    public interface ISimPolicy
    {
        void Decide(SimEnv env, int[] actions);
    }

    /// <summary>
    /// Picks uniformly among the actions the mask allows. It draws from its own generator,
    /// so the policy's choices and the world's dice do not disturb each other.
    /// </summary>
    public sealed class RandomSimPolicy : ISimPolicy
    {
        private readonly Random _random;

        public RandomSimPolicy(int seed)
        {
            _random = new Random(seed);
        }

        public void Decide(SimEnv env, int[] actions)
        {
            for (var i = 0; i < actions.Length; i++)
            {
                var mask = i * SimEnv.ActionCount;
                var open = 0;
                for (var a = 0; a < SimEnv.ActionCount; a++)
                    if (env.Mask[mask + a] != 0) open++;

                var pick = _random.Next(open);
                for (var a = 0; a < SimEnv.ActionCount; a++)
                {
                    if (env.Mask[mask + a] == 0) continue;
                    if (pick-- == 0) { actions[i] = a; break; }
                }
            }
        }
    }
}
