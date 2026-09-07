import test from "node:test";
import assert from "node:assert/strict";
import { shopCost, purchaseCommand } from "./shop.js";

test("Shop prices apply native float rates after multiplying quantity", () => {
  assert.equal(shopCost(100, 1.2, 3), 360);
  assert.equal(shopCost(99, 1.1, 7), 762);
  assert.equal(shopCost(0, 1, 1), 0);
});
test("Invalid quantities, missing quotes and overflow never become a zero-cost purchase", () => {
  for (const count of [0, -1, 1.5, 65536, NaN]) assert.equal(shopCost(10, 1, count), null);
  assert.equal(shopCost(undefined, 1, 1), null);
  assert.equal(shopCost(10, NaN, 1), null);
  assert.equal(shopCost(4294967295, 1, 2), null);
});
test("Purchases use the advertised 64-bit goods ID, not the item definition index", () => {
  const item = { UniqueID: "18446744073709551615", ItemIndex: 15, Count: 1 };
  const info = { StackSize: 10 };
  assert.deepEqual(purchaseCommand(item, info, 3), { ItemIndex: item.UniqueID, Count: 3, Type: 0 });
  assert.equal(purchaseCommand(item, info, 11), null);
  assert.equal(purchaseCommand(item, info, 0), null);
  assert.equal(purchaseCommand(item, null, 1), null);
  assert.equal(item.Count, 1);
});
