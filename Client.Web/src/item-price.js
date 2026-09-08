// Prices for the player's own items, computed exactly the way the server computes them.
//
// UserItem.Price() and UserItem.RepairPrice() (Shared/Data/ItemData.cs) need only the item's
// count, durability and AddedStats plus ItemInfo.Price and ItemInfo.Durability, and the browser
// already holds all of those: S.UserInformation, S.GainedItem and S.AddItem carry the UserItem,
// and S.NewItemInfo carries the definition.
//
// AddedStats survives the gateway too. GameSession.StatsConverter writes every Stat as a number,
// absent ones as 0, and Stats.Count is defined as Values.Sum(pair => Math.Abs(pair.Value)) -- a
// sum of magnitudes, not a key count -- so summing the flattened object reproduces it exactly.
// Tests/WebRegression pins that invariant so a change to the converter cannot silently break it.
//
// Both routines are ported operation for operation because the native ones run on single
// precision floats and truncate to uint at several points; Math.fround reproduces each rounding.
const f = Math.fround;
const UINT_MAX = 4294967295;

const whole = (value, fallback = 0) => (Number.isInteger(value) && value >= 0 ? value : fallback);
const bounded = (value) => (Number.isFinite(value) && value >= 0 && value <= UINT_MAX ? value : null);

// Stats.Count in Shared/Data/Stat.cs.
export function statsCount(stats) {
  if (!stats || typeof stats !== "object") return 0;
  let total = 0;
  for (const value of Object.values(stats)) {
    if (!Number.isFinite(value)) continue;
    total += Math.abs(value);
  }
  return total;
}

// The AddedStats multiplier both prices share: (uint)(p * (AddedStats.Count * 0.1F + 1F)).
function withAddedStats(p, item) {
  return Math.trunc(f(p * f(f(statsCount(item.AddedStats) * f(0.1)) + 1)));
}

// UserItem.Price(). Returns null when a definition has not arrived yet, so callers can say
// "price not ready" rather than quoting a wrong number.
export function itemPrice(item, info) {
  if (!item || !info) return null;
  const price = info.Price, durability = info.Durability;
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(durability) || durability < 0) return null;
  const count = whole(item.Count, 1);
  if (count < 1) return null;
  let p = price;
  if (durability > 0) {
    const maxDura = whole(item.MaxDura), currentDura = whole(item.CurrentDura);
    p = Math.trunc(f(maxDura * f(f(price / 2) / durability)));
    const wear = maxDura > 0 ? f(currentDura / maxDura) : 0;
    const half = f(p / 2);
    p = Math.floor(f(f(half + f(half * wear)) + f(price / 2)));
  }
  return bounded(withAddedStats(p, item) * count);
}

// UserItem.RepairPrice(). A type that never wears costs nothing to repair, which is why
// repairList already hides those rows.
export function repairPrice(item, info) {
  if (!item || !info) return null;
  if (!Number.isInteger(info.Durability) || info.Durability <= 0) return 0;
  const base = itemPrice(item, info);
  if (base === null) return null;
  const price = info.Price, count = whole(item.Count, 1), maxDura = whole(item.MaxDura);
  const restored = Math.floor(f(f(maxDura * f(f(price / 2) / info.Durability)) + f(price / 2)));
  const cost = withAddedStats(restored, item) * count - base;
  // Rented items are charged double (RepairPrice doubles when RentalInformation is set).
  return bounded(cost < 0 ? 0 : item.RentalInformation ? cost * 2 : cost);
}

// PlayerObject.RepairItem charges (uint)(temp.RepairPrice() * script.PriceRate(this)), and
// S.NPCRepair carries that same rate. An NPC with no rate of its own quotes at face value.
export function repairCost(item, info, rate) {
  const base = repairPrice(item, info);
  if (base === null) return null;
  const applied = Number.isFinite(rate) && rate >= 0 ? rate : 1;
  return bounded(Math.trunc(f(base * f(applied))));
}

// Special repair charges three times as much and, unlike an ordinary repair, does not shave
// MaxDura by a thirtieth of the wear -- which is the whole reason to pay for it
// (PlayerObject.RepairItem: `temp.RepairPrice() * 3 * script.PriceRate(this)`, and the
// MaxDura line is guarded by `if (!special)`).
export function specialRepairCost(item, info, rate) {
  const base = repairPrice(item, info);
  if (base === null) return null;
  const applied = Number.isFinite(rate) && rate >= 0 ? rate : 1;
  return bounded(Math.trunc(f(base * 3 * f(applied))));
}

// PlayerObject.SellItem pays temp.Price() / 2 and never applies the NPC rate. Selling part of a
// stack prices a fresh item of that count instead (Envir.CreateFreshItem: full durability, no
// added stats), so quote the same thing the server will pay.
export function sellPrice(item, info, count) {
  if (!item || !info) return null;
  const held = whole(item.Count, 1);
  const selling = Number.isInteger(count) && count > 0 ? Math.min(count, held) : held;
  const priced = selling === held
    ? itemPrice(item, info)
    : itemPrice({ Count: selling, MaxDura: info.Durability, CurrentDura: info.Durability }, info);
  return priced === null ? null : Math.floor(priced / 2);
}
