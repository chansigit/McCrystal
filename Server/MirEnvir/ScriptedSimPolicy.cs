using System.Drawing;
using System.Text;

namespace Server.MirEnvir
{
    /// <summary>
    /// A hand-written policy: the baseline a learned one is measured against.
    ///
    /// It decides from the same observation a learned policy gets -- the local grid, the
    /// self vector and the action mask -- plus two things a human player also has: its own
    /// memory of where it has been and what it has met, and the map itself (terrain, where
    /// the towns and shops are), which a player reads off the minimap. It never looks at
    /// monsters, items or other characters outside its view.
    ///
    /// Behaviour, highest priority first:
    ///   survive   drink when hurt, break away when losing with nothing to drink
    ///   recover   stand still out of combat until health is back
    ///   fight     attack the chosen monster once beside it
    ///   loot      pick up what dropped
    ///   resupply  walk to town when the bag fills or potions run out: sell, buy gear, buy potions
    ///   hunt      choose a monster worth fighting and close in
    ///   explore   find monsters, preferring ground not yet covered
    ///
    /// Which monsters are worth fighting is learned per character: it starts with the
    /// weakest kind it has seen, moves up after a run of easy wins, and steps back after
    /// a death or a retreat.
    ///
    /// Each part can be switched off by name to measure what it contributes.
    /// </summary>
    public sealed class ScriptedSimPolicy : ISimPolicy, ISimPolicyReport
    {
        private static readonly int[] Dx = { 0, 1, 1, 1, 0, -1, -1, -1 };
        private static readonly int[] Dy = { -1, -1, 0, 1, 1, 1, 0, -1 };

        private enum Doing { Wait, Flee, Drink, Rest, Fight, Loot, Approach, Explore, Resupply, Count }

        private sealed class Mind
        {
            public Random Random;
            public Point Position, LastPosition;
            public bool TriedToMove;
            public int Stuck;

            // What it will fight.
            public readonly SortedSet<int> SeenLevels = new SortedSet<int>();
            public int AllowedLevel = -1;
            public int EasyWins, LastKills, LastDeaths;

            public int RestSteps, PotionCooldown;
            public bool Fleeing;
            public readonly long[] Doing = new long[(int)ScriptedSimPolicy.Doing.Count];
            public long Moved, PlanFailures, NoStep;
            public int Blocked;
            public long NextStepBack;

            // Travel.
            public List<Point> Path;
            public int PathIndex;
            public Point PathGoal;

            // Hunting and exploring.
            public Point? HuntSpot;
            public Point? ExploreGoal;
            public int[] Visited;

            // Picking up.
            public Point IgnoreItem;
            public long IgnoreItemUntil;
            public int PickUpTries;
            public Point IgnoreCorpse, CorpseAt;
            public long IgnoreCorpseUntil;
            public int CorpseTries;

            // Resupply trip.
            public bool Resupplying;
            public int Town, Stop, StopSteps, RepairsThisStop;
            public long NextTripStep;
        }

        private sealed class Town
        {
            public Point Centre;
            public readonly List<SimShop> Stops = new List<SimShop>();
        }

        private readonly bool _flee, _potion, _rest, _select, _memory, _resupply;
        private readonly int _seed;

        private Mind[] _minds;
        private SimEnv _env;
        private int _radius, _side, _plane;
        private long _step;

        // The map, as common knowledge.
        private int _width, _height;
        private bool[] _terrain;
        private readonly List<Town> _towns = new List<Town>();
        private const int Block = 16;
        private int _blocksWide, _blocksHigh;

        // Shared scratch space for path searches.
        private int[] _cost, _stamp, _parent;
        private int _search;
        private readonly int[] _localParent = new int[33 * 33];
        private readonly int[] _localQueue = new int[33 * 33];

        private readonly long[] _doing = new long[(int)Doing.Count];
        private long _trips, _promotions, _demotions, _sawItem, _noRoom;

        /// <param name="off">Comma-separated parts to disable: flee, potion, rest, select, memory, resupply.</param>
        public ScriptedSimPolicy(int seed, string off)
        {
            _seed = seed;
            var disabled = new HashSet<string>(
                (off ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                StringComparer.OrdinalIgnoreCase);
            _flee = !disabled.Contains("flee");
            _potion = !disabled.Contains("potion");
            _rest = !disabled.Contains("rest");
            _select = !disabled.Contains("select");
            _memory = !disabled.Contains("memory");
            _resupply = !disabled.Contains("resupply");
        }

        public string Report()
        {
            var total = Math.Max(1, _doing.Sum());
            var text = new StringBuilder("[script] time spent:");
            for (var d = 0; d < (int)Doing.Count; d++)
                text.Append($" {((Doing)d).ToString().ToLowerInvariant()} {100.0 * _doing[d] / total:F1}%");
            text.AppendLine();
            text.AppendLine($"[script] resupply trips {_trips}, moved up a monster tier {_promotions} times, stepped back {_demotions} times");
            text.AppendLine($"[script] steps with an item in reach {_sawItem}, of which the bag had no room {_noRoom}");

            // The characters that got least done, with what the script was doing with them.
            // Reads the characters directly: this is a report, not a decision.
            if (_minds != null)
            {
                foreach (var i in Enumerable.Range(0, _minds.Length).OrderBy(i => _env.Agents[i].Kills).Take(6))
                {
                    var mind = _minds[i];
                    var agent = _env.Agents[i];
                    var player = agent.Player;
                    if (player == null) continue;
                    var weapon = player.Info.Equipment[(int)EquipmentSlot.Weapon];
                    text.AppendLine(
                        $"[script] {agent.Name}: level {player.Level}, kills {agent.Kills}, deaths {agent.Deaths}, at {player.CurrentLocation.X},{player.CurrentLocation.Y}, " +
                        $"hp {player.Health}/{player.MaxHealth}, weapon {(weapon == null ? "none" : $"{weapon.Info.Name} {weapon.CurrentDura}/{weapon.MaxDura}")}, " +
                        $"weight {player.CurrentBagWeight}/{player.Stats[Stat.BagWeight]}, gold {player.Account.Gold}, " +
                        $"fights up to level {mind.AllowedLevel} (seen {string.Join("/", mind.SeenLevels)}), " +
                        $"{(mind.Resupplying ? $"resupplying: town {mind.Town} stop {mind.Stop} for {mind.StopSteps} steps" : "hunting")}, " +
                        $"stuck {mind.Stuck}, route {(mind.Path == null ? "none" : $"{mind.PathIndex}/{mind.Path.Count} to {mind.PathGoal.X},{mind.PathGoal.Y}")}, " +
                        $"explore goal {(mind.ExploreGoal.HasValue ? $"{mind.ExploreGoal.Value.X},{mind.ExploreGoal.Value.Y}" : "none")}");
                    text.AppendLine(
                        $"[script]   moved {mind.Moved} cells, route plans failed {mind.PlanFailures}, no step found {mind.NoStep}, steps: " +
                        string.Join(" ", Enumerable.Range(0, (int)Doing.Count).Where(d => mind.Doing[d] > 0).Select(d => $"{((Doing)d).ToString().ToLowerInvariant()} {mind.Doing[d]}")));
                }
            }
            return text.ToString();
        }

        private void Learn(SimEnv env)
        {
            _env = env;
            _radius = env.ViewRadius;
            _side = env.Side;
            _plane = _side * _side;

            var map = env.Agents.Select(a => a.Player?.CurrentMap).FirstOrDefault(m => m != null);
            _width = map.Width;
            _height = map.Height;
            _terrain = new bool[_width * _height];
            for (var y = 0; y < _height; y++)
                for (var x = 0; x < _width; x++)
                    _terrain[y * _width + x] = map.ValidPoint(x, y);

            _blocksWide = (_width + Block - 1) / Block;
            _blocksHigh = (_height + Block - 1) / Block;
            _cost = new int[_width * _height];
            _stamp = new int[_width * _height];
            _parent = new int[_width * _height];

            // A town is a safe zone and the shops around it. Stops are ordered the way a
            // trip should go: sell first, then spend on gear, then on potions.
            foreach (var zone in map.Info.SafeZones)
            {
                var town = new Town { Centre = zone.Location };
                var near = env.Shops.Where(s => s.Npc.CurrentMap == map && Functions.MaxDistance(s.Npc.CurrentLocation, zone.Location) <= 60).ToList();
                town.Stops.AddRange(near.Where(s => s.SellKey != null && !s.SellsGear && !s.SellsPotions));
                town.Stops.AddRange(near.Where(s => s.SellsGear || (s.RepairKey != null && !s.SellsPotions)));
                town.Stops.AddRange(near.Where(s => s.SellsPotions));
                if (town.Stops.Count > 0) _towns.Add(town);
            }

            _minds = new Mind[env.Agents.Count];
            for (var i = 0; i < _minds.Length; i++)
                _minds[i] = new Mind { Random = new Random(_seed * 7919 + i), Visited = new int[_blocksWide * _blocksHigh] };
        }

        public void Decide(SimEnv env, int[] actions)
        {
            if (_minds == null) Learn(env);
            _step++;

            for (var i = 0; i < actions.Length; i++)
            {
                var doing = Doing.Wait;
                actions[i] = Choose(i, ref doing);
                _doing[(int)doing]++;
                _minds[i].Doing[(int)doing]++;
            }
        }

        // ---- reading the observation ----

        private float G(int i, int channel, int dx, int dy) =>
            _env.Grid[i * _env.GridSize + channel * _plane + (dy + _radius) * _side + (dx + _radius)];

        private float S(int i, int field) => _env.Self[i * SimEnv.SelfSize + field];

        private bool Can(int i, int action) => _env.Mask[i * SimEnv.ActionCount + action] != 0;

        private bool Passable(int i, int dx, int dy) =>
            Math.Abs(dx) <= _radius && Math.Abs(dy) <= _radius &&
            G(i, SimEnv.ChWalkable, dx, dy) != 0 && G(i, SimEnv.ChBlocked, dx, dy) == 0;

        private static int Direction(int dx, int dy)
        {
            int sx = Math.Sign(dx), sy = Math.Sign(dy);
            for (var d = 0; d < 8; d++)
                if (Dx[d] == sx && Dy[d] == sy) return d;
            return -1;
        }

        // ---- the decision ----

        private int Choose(int i, ref Doing doing)
        {
            var mind = _minds[i];
            var agent = _env.Agents[i];

            mind.Position = new Point((int)Math.Round(S(i, SimEnv.SfMapX) * _width), (int)Math.Round(S(i, SimEnv.SfMapY) * _height));
            if (mind.PotionCooldown > 0) mind.PotionCooldown--;

            // A move that left it where it was means something is in the way.
            if (mind.TriedToMove && mind.Position == mind.LastPosition) mind.Stuck++;
            else mind.Stuck = 0;
            mind.Moved += Functions.MaxDistance(mind.Position, mind.LastPosition);
            mind.TriedToMove = false;
            mind.LastPosition = mind.Position;

            var block = (mind.Position.Y / Block) * _blocksWide + mind.Position.X / Block;
            mind.Visited[block] = (int)Math.Min(int.MaxValue, _step);

            // Dying says the last fights were too much.
            if (agent.Deaths != mind.LastDeaths)
            {
                mind.LastDeaths = agent.Deaths;
                StepBack(mind, 1);
                mind.NextStepBack = _step + 300;
                mind.Path = null; mind.ExploreGoal = null; mind.HuntSpot = null;
                mind.Resupplying = false;
            }

            if (S(i, SimEnv.SfDead) != 0) return SimEnv.ActNone;

            var health = S(i, SimEnv.SfHealth);

            // Look around once.
            int hunters = 0, nearestHunter = int.MaxValue, monstersClose = 0;
            int targetDx = 0, targetDy = 0; var targetScore = float.MaxValue; var haveTarget = false;
            int itemDx = 0, itemDy = 0, itemDistance = int.MaxValue;
            int corpseDx = 0, corpseDy = 0, corpseDistance = int.MaxValue;

            for (var dy = -_radius; dy <= _radius; dy++)
            {
                for (var dx = -_radius; dx <= _radius; dx++)
                {
                    var distance = Math.Max(Math.Abs(dx), Math.Abs(dy));

                    if (G(i, SimEnv.ChItem, dx, dy) != 0 && distance < itemDistance)
                    {
                        var where = new Point(mind.Position.X + dx, mind.Position.Y + dy);
                        if (!(where == mind.IgnoreItem && _step < mind.IgnoreItemUntil))
                        {
                            itemDistance = distance; itemDx = dx; itemDy = dy;
                        }
                    }

                    if (G(i, SimEnv.ChCorpse, dx, dy) != 0 && distance < corpseDistance)
                    {
                        var where = new Point(mind.Position.X + dx, mind.Position.Y + dy);
                        if (!(where == mind.IgnoreCorpse && _step < mind.IgnoreCorpseUntil))
                        {
                            corpseDistance = distance; corpseDx = dx; corpseDy = dy;
                        }
                    }

                    if (G(i, SimEnv.ChMonster, dx, dy) == 0) continue;

                    var level = (int)Math.Round(G(i, SimEnv.ChMonsterLevel, dx, dy) * SimEnv.LevelScale);
                    var hunting = G(i, SimEnv.ChMonsterHunting, dx, dy) != 0;
                    mind.SeenLevels.Add(level);
                    if (distance <= 3) monstersClose++;
                    if (hunting)
                    {
                        hunters++;
                        nearestHunter = Math.Min(nearestHunter, distance);
                    }

                    if (mind.AllowedLevel < 0) mind.AllowedLevel = mind.SeenLevels.Min;
                    var acceptable = !_select || hunting || level <= mind.AllowedLevel || level == mind.SeenLevels.Min;
                    if (!acceptable) continue;

                    float score = distance;
                    if (_select)
                    {
                        if (hunting) score -= 3;                                       // it is coming anyway
                        score -= 2 * (1 - G(i, SimEnv.ChMonsterHealth, dx, dy));       // finish what is nearly dead
                        for (var d = 0; d < 8; d++)                                    // someone else is on it
                        {
                            int px = dx + Dx[d], py = dy + Dy[d];
                            if (Math.Abs(px) <= _radius && Math.Abs(py) <= _radius && G(i, SimEnv.ChPlayer, px, py) != 0) { score += 6; break; }
                        }
                    }
                    if (score < targetScore) { targetScore = score; targetDx = dx; targetDy = dy; haveTarget = true; }
                }
            }

            if (haveTarget && _memory) mind.HuntSpot = mind.Position;

            // A kill is news about how hard that fight was.
            if (agent.Kills != mind.LastKills)
            {
                mind.LastKills = agent.Kills;
                if (health >= 0.5f)
                {
                    if (++mind.EasyWins >= 4) StepUp(mind);
                }
                else mind.EasyWins = 0;
            }

            // Survive.
            if (_potion && health < 0.5f && mind.PotionCooldown == 0 && Can(i, SimEnv.ActHealthPotion))
            {
                mind.PotionCooldown = 15;
                doing = Doing.Drink;
                return SimEnv.ActHealthPotion;
            }

            var losing = hunters > 0 && health < 0.3f && !Can(i, SimEnv.ActHealthPotion);
            if (!losing) mind.Fleeing = false;

            if (_flee && losing)
            {
                var away = FleeDirection(i);
                if (away >= 0)
                {
                    // One retreat is one lesson, however many steps it takes and however
                    // often the chase is briefly lost and picked up again.
                    if (!mind.Fleeing && _step >= mind.NextStepBack)
                    {
                        StepBack(mind, 1);
                        mind.NextStepBack = _step + 300;
                    }
                    mind.Fleeing = true;
                    mind.EasyWins = 0;
                    mind.Path = null;
                    doing = Doing.Flee;
                    mind.TriedToMove = true;
                    return away;
                }
            }

            if (Can(i, SimEnv.ActEquipBest)) return SimEnv.ActEquipBest;

            // Recover, when nothing is on it and nothing is about to be.
            if (_rest && hunters == 0 && monstersClose == 0 && !mind.Resupplying)
            {
                if (health < 0.5f || (mind.RestSteps > 0 && health < 0.8f))
                {
                    if (++mind.RestSteps < 300)
                    {
                        doing = Doing.Rest;
                        return SimEnv.ActNone;
                    }
                }
                else mind.RestSteps = 0;
            }
            else mind.RestSteps = 0;

            // Fight what is in reach.
            if (haveTarget && Math.Max(Math.Abs(targetDx), Math.Abs(targetDy)) == 1)
            {
                doing = Doing.Fight;
                var attack = SimEnv.ActAttack + Direction(targetDx, targetDy);
                return Can(i, attack) ? attack : SimEnv.ActNone;
            }

            // Near the weight limit it stops collecting and keeps hunting; weight alone is
            // no reason to walk to town.
            var room = S(i, SimEnv.SfFreeSlots) > 0 && S(i, SimEnv.SfBagWeight) < 0.9f;

            // Cut up what it killed: hens, deer and the like carry their goods in the body.
            if (room && nearestHunter > 2 && corpseDistance <= 5)
            {
                var corpse = new Point(mind.Position.X + corpseDx, mind.Position.Y + corpseDy);
                if (corpse != mind.CorpseAt) { mind.CorpseAt = corpse; mind.CorpseTries = 0; }

                if (++mind.CorpseTries > 40)
                {
                    mind.IgnoreCorpse = corpse;
                    mind.IgnoreCorpseUntil = _step + 300;
                }
                else if (corpseDistance <= 1)
                {
                    doing = Doing.Loot;
                    var cut = SimEnv.ActHarvest + (corpseDistance == 0 ? 0 : Direction(corpseDx, corpseDy));
                    return Can(i, cut) ? cut : SimEnv.ActNone;
                }
                else
                {
                    var step = LocalStep(i, corpseDx, corpseDy, true);
                    if (step != SimEnv.ActNone) { doing = Doing.Loot; mind.TriedToMove = true; return step; }
                }
            }

            // Pick up, unless something is already on it.
            if (itemDistance <= 5) { _sawItem++; if (!room) _noRoom++; }
            if (room && nearestHunter > 2 && itemDistance <= 5)
            {
                doing = Doing.Loot;
                if (itemDistance == 0)
                {
                    if (++mind.PickUpTries > 3)
                    {
                        // Somebody else's drop, or something it cannot carry.
                        mind.IgnoreItem = mind.Position;
                        mind.IgnoreItemUntil = _step + 300;
                        mind.PickUpTries = 0;
                    }
                    else if (Can(i, SimEnv.ActPickUp)) return SimEnv.ActPickUp;
                }
                else
                {
                    mind.PickUpTries = 0;
                    var step = LocalStep(i, itemDx, itemDy, false);
                    if (step != SimEnv.ActNone) { mind.TriedToMove = true; return step; }
                }
            }

            // Resupply.
            if (_resupply && _towns.Count > 0)
            {
                if (!mind.Resupplying && hunters == 0 && _step >= mind.NextTripStep && WantsTown(i))
                {
                    mind.Resupplying = true;
                    mind.Town = NearestTown(mind.Position);
                    mind.Stop = 0;
                    mind.StopSteps = 0;
                    mind.Path = null;
                }

                if (mind.Resupplying)
                {
                    doing = Doing.Resupply;
                    return Resupply(i, mind);
                }
            }

            // Hunt.
            if (haveTarget)
            {
                doing = Doing.Approach;
                mind.ExploreGoal = null;
                mind.Path = null;
                var step = LocalStep(i, targetDx, targetDy, true);
                if (step != SimEnv.ActNone) mind.TriedToMove = true;
                return Unstick(i, mind, step);
            }

            // Explore.
            doing = Doing.Explore;
            return Unstick(i, mind, Explore(i, mind));
        }

        private void StepUp(Mind mind)
        {
            mind.EasyWins = 0;
            var higher = mind.SeenLevels.FirstOrDefault(l => l > mind.AllowedLevel);
            mind.AllowedLevel = higher > mind.AllowedLevel ? higher : mind.AllowedLevel + 2;
            _promotions++;
        }

        private void StepBack(Mind mind, int tiers)
        {
            if (mind.AllowedLevel < 0 || mind.SeenLevels.Count == 0) return;
            var before = mind.AllowedLevel;
            for (var t = 0; t < tiers; t++)
            {
                var lower = mind.SeenLevels.LastOrDefault(l => l < mind.AllowedLevel);
                if (lower <= 0 || lower >= mind.AllowedLevel) break;
                mind.AllowedLevel = lower;
            }
            mind.EasyWins = 0;
            if (mind.AllowedLevel != before) _demotions++;
        }

        // If a planned move keeps failing, take any open step to get clear and plan again.
        private int Unstick(int i, Mind mind, int action)
        {
            if (mind.Stuck < 6) return action;

            mind.Stuck = 0;
            mind.Path = null;
            mind.ExploreGoal = null;
            var start = mind.Random.Next(8);
            for (var k = 0; k < 8; k++)
            {
                var d = (start + k) % 8;
                if (Can(i, SimEnv.ActWalk + d)) { mind.TriedToMove = true; return SimEnv.ActWalk + d; }
            }
            return action;
        }

        // The open direction that ends furthest from everything hunting this character.
        private int FleeDirection(int i)
        {
            var best = -1;
            var bestGap = -1;
            for (var kind = 0; kind < 2; kind++) // run first, then walk
            {
                var reach = kind == 0 ? 2 : 1;
                var baseAction = kind == 0 ? SimEnv.ActRun : SimEnv.ActWalk;
                for (var d = 0; d < 8; d++)
                {
                    if (!Can(i, baseAction + d)) continue;
                    int x = Dx[d] * reach, y = Dy[d] * reach;
                    var gap = int.MaxValue;
                    for (var dy = -_radius; dy <= _radius; dy++)
                        for (var dx = -_radius; dx <= _radius; dx++)
                            if (G(i, SimEnv.ChMonsterHunting, dx, dy) != 0)
                                gap = Math.Min(gap, Math.Max(Math.Abs(dx - x), Math.Abs(dy - y)));
                    if (gap > bestGap) { bestGap = gap; best = baseAction + d; }
                }
            }
            return best;
        }

        // ---- moving ----

        // One step towards a cell inside the view, around whatever is in the way.
        // With stopBeside, arriving next to the cell is enough (it holds a monster or an NPC).
        private int LocalStep(int i, int goalDx, int goalDy, bool stopBeside)
        {
            if (goalDx == 0 && goalDy == 0) return SimEnv.ActNone;

            var side = _side;
            var centre = _radius * side + _radius;
            var goal = (goalDy + _radius) * side + (goalDx + _radius);

            Array.Fill(_localParent, -1, 0, side * side);
            _localParent[centre] = centre;
            int head = 0, tail = 0;
            _localQueue[tail++] = centre;
            var found = -1;

            while (head < tail && found < 0)
            {
                var at = _localQueue[head++];
                int ax = at % side - _radius, ay = at / side - _radius;
                for (var d = 0; d < 8; d++)
                {
                    int nx = ax + Dx[d], ny = ay + Dy[d];
                    if (Math.Abs(nx) > _radius || Math.Abs(ny) > _radius) continue;
                    var next = (ny + _radius) * side + (nx + _radius);
                    if (_localParent[next] >= 0) continue;

                    if (next == goal)
                    {
                        if (stopBeside) { found = at; break; }
                        if (!Passable(i, nx, ny)) continue;
                        _localParent[next] = at;
                        found = next;
                        break;
                    }

                    if (!Passable(i, nx, ny)) continue;
                    _localParent[next] = at;
                    _localQueue[tail++] = next;
                }
            }

            if (found < 0 || found == centre) return SimEnv.ActNone;

            // Walk the route back to its first step, and the one after it.
            int first = found, second = -1;
            while (_localParent[first] != centre)
            {
                second = first;
                first = _localParent[first];
            }
            if (first == found) second = -1;
            else if (_localParent[second] != first) second = -1;

            int fx = first % side - _radius, fy = first / side - _radius;
            var direction = Direction(fx, fy);

            if (second >= 0)
            {
                int sx = second % side - _radius, sy = second / side - _radius;
                if (sx == 2 * fx && sy == 2 * fy && Can(i, SimEnv.ActRun + direction)) return SimEnv.ActRun + direction;
            }

            return Can(i, SimEnv.ActWalk + direction) ? SimEnv.ActWalk + direction : SimEnv.ActNone;
        }

        // One step towards a cell anywhere on the map, along a route planned over the
        // terrain and followed with the local search.
        private int Travel(int i, Mind mind, Point goal, bool stopBeside)
        {
            int gdx = goal.X - mind.Position.X, gdy = goal.Y - mind.Position.Y;
            if (Math.Abs(gdx) <= _radius - 1 && Math.Abs(gdy) <= _radius - 1)
            {
                var direct = LocalStep(i, gdx, gdy, stopBeside);
                if (direct != SimEnv.ActNone) { mind.TriedToMove = true; return direct; }
            }

            if (mind.Path == null || mind.PathGoal != goal)
            {
                mind.Path = PlanRoute(mind.Position, goal);
                mind.PathGoal = goal;
                mind.PathIndex = 0;
                if (mind.Path == null) { mind.PlanFailures++; return SimEnv.ActNone; }
            }

            // Skip what is already behind, then aim for the furthest point still in view.
            var path = mind.Path;
            while (mind.PathIndex < path.Count - 1 && Functions.MaxDistance(path[mind.PathIndex], mind.Position) <= 1) mind.PathIndex++;
            // Pushed further from the route than a local step can bridge (a fight or a
            // detour does this): plan again from here. Anything short of "out of reach"
            // would leave it standing between a route it cannot rejoin and no new one.
            var reach = _radius - 1;
            if (Functions.MaxDistance(path[mind.PathIndex], mind.Position) > reach)
            {
                mind.Path = PlanRoute(mind.Position, goal);
                mind.PathIndex = 0;
                if (mind.Path == null) { mind.PlanFailures++; return SimEnv.ActNone; }
                path = mind.Path;
            }

            var aim = mind.PathIndex;
            while (aim < path.Count - 1 && Functions.MaxDistance(path[aim + 1], mind.Position) <= reach) aim++;

            for (; aim >= mind.PathIndex; aim--)
            {
                int dx = path[aim].X - mind.Position.X, dy = path[aim].Y - mind.Position.Y;
                if (Math.Abs(dx) > reach || Math.Abs(dy) > reach) continue;
                var step = LocalStep(i, dx, dy, false);
                if (step == SimEnv.ActNone) continue;
                mind.TriedToMove = true;
                mind.Blocked = 0;
                return step;
            }

            mind.NoStep++;
            // Free to walk and still no way onto the route: something is standing on it.
            // Give it a moment, then drop the route and the goal and choose again.
            if (S(i, SimEnv.SfCanWalk) != 0 && ++mind.Blocked >= 10)
            {
                mind.Blocked = 0;
                mind.Path = null;
                mind.ExploreGoal = null;
                mind.Stuck = 6; // let Unstick take one step to get clear
            }
            return SimEnv.ActNone;
        }

        // A* over the terrain. Ignores monsters and players: they move, and the local
        // search deals with them on the way.
        private List<Point> PlanRoute(Point from, Point to)
        {
            if (from.X < 0 || from.Y < 0 || from.X >= _width || from.Y >= _height) return null;
            to = new Point(Math.Clamp(to.X, 0, _width - 1), Math.Clamp(to.Y, 0, _height - 1));

            _search++;
            var start = from.Y * _width + from.X;
            var goal = to.Y * _width + to.X;
            var open = new PriorityQueue<int, int>();
            _cost[start] = 0; _stamp[start] = _search; _parent[start] = start;
            open.Enqueue(start, 0);
            var expanded = 0;
            var reached = -1;

            while (open.Count > 0 && expanded++ < 400000)
            {
                var at = open.Dequeue();
                int ax = at % _width, ay = at / _width;
                if (Math.Max(Math.Abs(ax - to.X), Math.Abs(ay - to.Y)) <= 1) { reached = at; break; }

                for (var d = 0; d < 8; d++)
                {
                    int nx = ax + Dx[d], ny = ay + Dy[d];
                    if (nx < 0 || ny < 0 || nx >= _width || ny >= _height) continue;
                    var next = ny * _width + nx;
                    if (!_terrain[next] && next != goal) continue;
                    var cost = _cost[at] + 1;
                    if (_stamp[next] == _search && _cost[next] <= cost) continue;
                    _stamp[next] = _search; _cost[next] = cost; _parent[next] = at;
                    open.Enqueue(next, cost + Math.Max(Math.Abs(nx - to.X), Math.Abs(ny - to.Y)));
                }
            }

            if (reached < 0) return null;

            var route = new List<Point>();
            for (var at = reached; at != start; at = _parent[at]) route.Add(new Point(at % _width, at / _width));
            route.Reverse();
            return route.Count == 0 ? null : route;
        }

        // ---- exploring ----

        private int Explore(int i, Mind mind)
        {
            // Back to where the hunting was, if that is not here.
            if (_memory && mind.HuntSpot.HasValue)
            {
                if (Functions.MaxDistance(mind.HuntSpot.Value, mind.Position) > 4)
                    return Travel(i, mind, mind.HuntSpot.Value, false);
                mind.HuntSpot = null; // here, and nothing to hunt
            }

            if (mind.ExploreGoal.HasValue && Functions.MaxDistance(mind.ExploreGoal.Value, mind.Position) <= 3)
                mind.ExploreGoal = null;

            if (!mind.ExploreGoal.HasValue)
            {
                mind.ExploreGoal = _memory ? Frontier(mind) : RandomCell(mind);
                mind.Path = null;
            }

            var action = Travel(i, mind, mind.ExploreGoal.Value, false);
            if (action == SimEnv.ActNone && mind.Path == null) mind.ExploreGoal = null; // unreachable: choose again
            return action;
        }

        // The nearest block of the map it has not stood in for a long while.
        private Point Frontier(Mind mind)
        {
            int bx = mind.Position.X / Block, by = mind.Position.Y / Block;
            for (var ring = 1; ring < Math.Max(_blocksWide, _blocksHigh); ring++)
            {
                var candidates = new List<Point>();
                for (var y = by - ring; y <= by + ring; y++)
                {
                    for (var x = bx - ring; x <= bx + ring; x++)
                    {
                        if (Math.Max(Math.Abs(x - bx), Math.Abs(y - by)) != ring) continue;
                        if (x < 0 || y < 0 || x >= _blocksWide || y >= _blocksHigh) continue;
                        var seen = mind.Visited[y * _blocksWide + x];
                        if (seen != 0 && _step - seen < 20000) continue;
                        var cell = OpenCellIn(x, y);
                        if (cell.HasValue) candidates.Add(cell.Value);
                    }
                }
                if (candidates.Count > 0) return candidates[mind.Random.Next(candidates.Count)];
            }
            return RandomCell(mind);
        }

        private Point? OpenCellIn(int blockX, int blockY)
        {
            int cx = Math.Min(_width - 1, blockX * Block + Block / 2), cy = Math.Min(_height - 1, blockY * Block + Block / 2);
            for (var r = 0; r < Block / 2; r++)
                for (var y = cy - r; y <= cy + r; y++)
                    for (var x = cx - r; x <= cx + r; x++)
                        if (x >= 0 && y >= 0 && x < _width && y < _height && _terrain[y * _width + x]) return new Point(x, y);
            return null;
        }

        private Point RandomCell(Mind mind)
        {
            for (var tries = 0; tries < 200; tries++)
            {
                int x = Math.Clamp(mind.Position.X + mind.Random.Next(-80, 81), 0, _width - 1);
                int y = Math.Clamp(mind.Position.Y + mind.Random.Next(-80, 81), 0, _height - 1);
                if (_terrain[y * _width + x]) return new Point(x, y);
            }
            return mind.Position;
        }

        // ---- resupplying ----

        private float Gold(int i) => (float)Math.Pow(10, S(i, SimEnv.SfGold) * 7) - 1;

        // What the loot in the bag would sell for.
        private float LootValue(int i) => (float)Math.Pow(10, S(i, SimEnv.SfLootValue) * 6) - 1;

        // A trip to town costs a long walk, so it needs a reason that pays for it: something
        // it must buy and the means to buy it, or a bag with no slot left. A heavy bag is
        // not a reason; it just stops collecting.
        private bool WantsTown(int i)
        {
            var funds = Gold(i) + LootValue(i);
            if (S(i, SimEnv.SfFreeSlots) <= 0.1f) return S(i, SimEnv.SfLoot) > 0;
            if (S(i, SimEnv.SfWeapon) == 0) return funds >= 100;                      // lost its weapon
            if (S(i, SimEnv.SfHealthPotions) == 0) return funds >= 400;               // out of potions
            if (S(i, SimEnv.SfWeaponDura) < 0.2f) return funds >= 200;                // weapon about to break
            return LootValue(i) >= 5000;                                              // enough to shop for upgrades
        }

        private int NearestTown(Point position)
        {
            var best = 0;
            for (var t = 1; t < _towns.Count; t++)
                if (Functions.MaxDistance(_towns[t].Centre, position) < Functions.MaxDistance(_towns[best].Centre, position)) best = t;
            return best;
        }

        private int Resupply(int i, Mind mind)
        {
            var town = _towns[mind.Town];

            while (mind.Stop < town.Stops.Count)
            {
                var shop = town.Stops[mind.Stop];
                var where = shop.Npc.CurrentLocation;

                if (Functions.MaxDistance(where, mind.Position) <= SimEnv.ShopRange - 1)
                {
                    if (Can(i, SimEnv.ActSell)) return SimEnv.ActSell;
                    if (Can(i, SimEnv.ActRepair) && (S(i, SimEnv.SfWeaponDura) < 0.6f || S(i, SimEnv.SfArmourDura) < 0.6f) && mind.RepairsThisStop++ < 4)
                        return SimEnv.ActRepair;
                    if (Can(i, SimEnv.ActBuyGear)) return SimEnv.ActBuyGear;
                    // Keep a little gold back only when there is gear still worth saving for.
                    if (shop.SellsPotions && S(i, SimEnv.SfHealthPotions) < 1f && Can(i, SimEnv.ActBuyPotion)) return SimEnv.ActBuyPotion;
                }
                else if (++mind.StopSteps < 1500)
                {
                    return Unstick(i, mind, Travel(i, mind, where, true));
                }

                mind.Stop++;
                mind.StopSteps = 0;
                mind.RepairsThisStop = 0;
                mind.Path = null;
            }

            mind.Resupplying = false;
            mind.NextTripStep = _step + 1500;
            mind.Path = null;
            _trips++;
            return SimEnv.ActNone;
        }
    }
}
