import test from "node:test";
import assert from "node:assert/strict";
import { itemPrice, repairCost, repairPrice, sellPrice, statsCount } from "./item-price.js";

// The definitions and items below are the ones Tests/WebRegression pins against the real
// UserItem.Price() and UserItem.RepairPrice(), so the two suites fail together if either side
// drifts. Every expected number here was produced by the server code, not by hand.
const POTION = { Price: 200, Durability: 0, StackSize: 50 };
const SWORD = { Price: 15000, Durability: 5000 };
const RING = { Price: 7, Durability: 3 };

// GameSession.StatsConverter writes every stat, so a real AddedStats arrives mostly zeroed.
const stats = (values) => ({ MinAC: 0, MaxAC: 0, MinDC: 0, MaxDC: 0, Luck: 0, ...values });

test("AddedStats.Count survives the gateway as the sum of the magnitudes it flattens to", () => {
  assert.equal(statsCount(stats({ MaxDC: 3, MaxAC: -2 })), 5);
  assert.equal(statsCount(stats({})), 0);
  assert.equal(statsCount(undefined), 0);
  assert.equal(statsCount(null), 0);
});

test("an item is priced exactly as UserItem.Price() prices it, durability wear included", () => {
  assert.equal(itemPrice({ Count: 7 }, POTION), 1400);
  assert.equal(itemPrice({ Count: 1, MaxDura: 4500, CurrentDura: 1200 }, SWORD), 11775);
  assert.equal(itemPrice({ Count: 1, MaxDura: 5000, CurrentDura: 5000 }, SWORD), 15000);
  // A fully broken item still keeps half the base price, which is what the native formula does.
  assert.equal(itemPrice({ Count: 1, MaxDura: 0, CurrentDura: 0 }, SWORD), 7500);
  // The single-precision intermediates matter: this one is 5, not 5.8 rounded either way.
  assert.equal(itemPrice({ Count: 1, MaxDura: 2, CurrentDura: 1 }, RING), 5);
  assert.equal(
    itemPrice({ Count: 1, MaxDura: 4500, CurrentDura: 1200, AddedStats: stats({ MaxDC: 3, MaxAC: -2 }) }, SWORD),
    17662);
});

test("a missing definition yields no price at all rather than a wrong one", () => {
  assert.equal(itemPrice({ Count: 1 }, undefined), null);
  assert.equal(itemPrice(undefined, POTION), null);
  assert.equal(itemPrice({ Count: 1 }, { Price: "free", Durability: 0 }), null);
  assert.equal(repairPrice({ Count: 1 }, undefined), null);
  assert.equal(repairCost({ Count: 1 }, undefined, 1), null);
  assert.equal(sellPrice({ Count: 1 }, undefined), null);
});

test("a sale is quoted at half the item's value, and a partial stack at the fresh item's value", () => {
  assert.equal(sellPrice({ Count: 7 }, POTION), 700);
  // PlayerObject.SellItem prices part of a stack as a fresh item of that count.
  assert.equal(sellPrice({ Count: 7 }, POTION, 3), 300);
  // A count larger than the stack is clamped to the stack, as the server would clamp it.
  assert.equal(sellPrice({ Count: 7 }, POTION, 99), 700);
  assert.equal(
    sellPrice({ Count: 1, MaxDura: 4500, CurrentDura: 1200, AddedStats: stats({ MaxDC: 3, MaxAC: -2 }) }, SWORD),
    8831);
  // The NPC rate never touches a sale; only repairs are rated.
  assert.equal(sellPrice({ Count: 1, MaxDura: 4500, CurrentDura: 1200 }, SWORD), 5887);
});

test("a repair costs the difference to full durability, doubled for a rental and scaled by the NPC rate", () => {
  const worn = { Count: 1, MaxDura: 4500, CurrentDura: 1200 };
  assert.equal(repairPrice(worn, SWORD), 2475);
  assert.equal(repairPrice({ ...worn, RentalInformation: { BindingFlags: 0 } }, SWORD), 4950);
  assert.equal(repairPrice({ ...worn, AddedStats: stats({ MaxDC: 3, MaxAC: -2 }) }, SWORD), 3713);
  // Nothing is owed on an undamaged item, or on a type that never wears.
  assert.equal(repairPrice({ Count: 1, MaxDura: 5000, CurrentDura: 5000 }, SWORD), 0);
  assert.equal(repairPrice({ Count: 7 }, POTION), 0);
  // S.NPCRepair carries the rate PlayerObject.RepairItem multiplies by.
  assert.equal(repairCost({ ...worn, AddedStats: stats({ MaxDC: 3, MaxAC: -2 }) }, SWORD, 1.35), 5012);
  assert.equal(repairCost(worn, SWORD, 1), 2475);
  // An NPC that sent no usable rate is quoted at face value rather than at zero.
  assert.equal(repairCost(worn, SWORD, undefined), 2475);
  assert.equal(repairCost(worn, SWORD, -1), 2475);
});
