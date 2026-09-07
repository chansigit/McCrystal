import test from "node:test";
import assert from "node:assert/strict";
import { sellCount, sellList, repairList, DONT_SELL, DONT_REPAIR } from "./npc-trade.js";
import { applyInventoryPacket } from "./inventory.js";

const item = (id, extra = {}) => ({ UniqueID: String(id), ItemIndex: 1, Count: 1, ...extra });

test("a sale never asks for more than the stack holds, and rejects anything that is not a count", () => {
  const stack = item(1, { Count: 12 });
  const info = { StackSize: 50 };
  assert.equal(sellCount("5", stack, info), 5);
  assert.equal(sellCount("12", stack, info), 12);
  assert.equal(sellCount("13", stack, info), 12);
  assert.equal(sellCount("4.8", stack, info), 4);
  for (const answer of ["0", "-3", "", "abc"]) assert.equal(sellCount(answer, stack, info), 0);
  // A stack size below the count the client believes it holds still bounds the request.
  assert.equal(sellCount("12", stack, { StackSize: 3 }), 3);
  // Missing item definitions fall back to the stack itself rather than to an unbounded count.
  assert.equal(sellCount("99", stack, undefined), 12);
  // The wire field is a ushort, so a desynced count can never overflow it.
  assert.equal(sellCount("70000", item(2, { Count: 70000 }), { StackSize: 70000 }), 65535);
  assert.equal(sellCount("1", item(3, { Count: 0 }), info), 0);
});

test("the repair list holds only damaged bag items, and marks the ones the server would refuse", () => {
  const definitions = {
    1: { Name: "剑", Durability: 5000, Bind: 0 },
    2: { Name: "药", Durability: 0, Bind: 0 },
    3: { Name: "祖玛剑", Durability: 5000, Bind: DONT_REPAIR },
  };
  const bag = [
    null,
    item(1, { ItemIndex: 1, MaxDura: 5000, CurrentDura: 5000 }),
    item(2, { ItemIndex: 1, MaxDura: 5000, CurrentDura: 1200 }),
    item(3, { ItemIndex: 2, MaxDura: 0, CurrentDura: 0, Count: 9 }),
    item(4, { ItemIndex: 3, MaxDura: 4000, CurrentDura: 10 }),
    // A stackable with a durability field the definition says never wears is not repairable.
    item(5, { ItemIndex: 2, MaxDura: 100, CurrentDura: 50 }),
  ];
  const rows = repairList(bag, (index) => definitions[index]);
  assert.deepEqual(rows.map((row) => row.item.UniqueID), ["2", "4"]);
  assert.deepEqual(rows.map((row) => row.index), [2, 4]);
  assert.deepEqual(rows.map((row) => row.blocked), [false, true]);
});

test("the sell list offers every bag item and flags the unsellable ones", () => {
  const definitions = { 1: { Name: "剑", Bind: 0 }, 2: { Name: "任务信", Bind: DONT_SELL } };
  const bag = [item(1, { ItemIndex: 1 }), null, item(2, { ItemIndex: 2 })];
  const rows = sellList(bag, (index) => definitions[index]);
  assert.deepEqual(rows.map((row) => row.item.UniqueID), ["1", "2"]);
  assert.deepEqual(rows.map((row) => row.blocked), [false, true]);
});

test("a successful sale takes the sold count off the stack and a refusal leaves it alone", () => {
  const user = { Inventory: [null, item(7, { Count: 5 })], Equipment: [] };
  assert.equal(applyInventoryPacket(user, "SellItem", { UniqueID: "7", Count: 2, Success: true }), true);
  assert.equal(user.Inventory[1].Count, 3);
  assert.equal(applyInventoryPacket(user, "SellItem", { UniqueID: "7", Count: 3, Success: false }), false);
  assert.equal(user.Inventory[1].Count, 3);
  assert.equal(applyInventoryPacket(user, "SellItem", { UniqueID: "7", Count: 3, Success: true }), true);
  assert.equal(user.Inventory[1], null);
});
