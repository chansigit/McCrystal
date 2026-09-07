import test from "node:test";
import assert from "node:assert/strict";
import { addInventoryItem, applyInventoryPacket, equipSlot, emptyBagSlot, canEquipAt } from "./inventory.js";

const item = (id, index = 1, count = 1) => ({ UniqueID: String(id), ItemIndex: index, Count: count });
const user = () => ({ Inventory: Array(46).fill(null), Equipment: Array(14).fill(null) });
test("new items follow the native potion, amulet and regular bag rules", () => {
  const u = user();
  addInventoryItem(u.Inventory, item(1), { Type: 13, StackSize: 10 });
  addInventoryItem(u.Inventory, item(2, 2), { Type: 8, StackSize: 1 });
  addInventoryItem(u.Inventory, item(3, 3), { Type: 1, StackSize: 1 });
  assert.equal(u.Inventory[0].UniqueID, "1");
  assert.equal(u.Inventory[4].UniqueID, "2");
  assert.equal(u.Inventory[6].UniqueID, "3");
});
test("stack merging uses existing capacity before placing the remainder", () => {
  const u = user(); u.Inventory[0] = item(1, 1, 8); u.Inventory[7] = item(2, 1, 9);
  addInventoryItem(u.Inventory, item(3, 1, 5), { Type: 13, StackSize: 10 });
  assert.equal(u.Inventory[0].Count, 10); assert.equal(u.Inventory[7].Count, 10);
  assert.equal(u.Inventory[1].Count, 2); assert.equal(u.Inventory[1].UniqueID, "3");
});
test("equip exchanges items only after a successful server response", () => {
  const u = user(); u.Inventory[6] = item("18446744073709551615"); u.Equipment[0] = item(2);
  const p = { Grid: 1, UniqueID: "18446744073709551615", To: 0, Success: false };
  assert.equal(applyInventoryPacket(u, "EquipItem", p), false);
  assert.equal(u.Equipment[0].UniqueID, "2");
  applyInventoryPacket(u, "EquipItem", { ...p, Success: true });
  assert.equal(u.Equipment[0].UniqueID, p.UniqueID); assert.equal(u.Inventory[6].UniqueID, "2");
});
test("failed use preserves a stack; successful use consumes exactly one", () => {
  const u = user(); u.Inventory[0] = item(1, 1, 2);
  const p = { Grid: 1, UniqueID: "1", Success: false };
  applyInventoryPacket(u, "UseItem", p); assert.equal(u.Inventory[0].Count, 2);
  applyInventoryPacket(u, "UseItem", { ...p, Success: true }); assert.equal(u.Inventory[0].Count, 1);
  applyInventoryPacket(u, "UseItem", { ...p, Success: true }); assert.equal(u.Inventory[0], null);
});
test("move swaps belt and bag slots without merging or changing IDs", () => {
  const u = user(); u.Inventory[0] = item(1); u.Inventory[8] = item(2);
  applyInventoryPacket(u, "MoveItem", { Grid: 1, From: 0, To: 8, Success: true });
  assert.equal(u.Inventory[0].UniqueID, "2"); assert.equal(u.Inventory[8].UniqueID, "1");
});
test("unequip moves into an empty slot and rejects inconsistent occupied destinations", () => {
  const u = user(); u.Equipment[0] = item(1); u.Inventory[6] = item(2);
  assert.throws(() => applyInventoryPacket(u, "RemoveItem", { Grid: 1, UniqueID: "1", To: 6, Success: true }));
  assert.equal(u.Equipment[0].UniqueID, "1");
  applyInventoryPacket(u, "RemoveItem", { Grid: 1, UniqueID: "1", To: 7, Success: true });
  assert.equal(u.Equipment[0], null); assert.equal(u.Inventory[7].UniqueID, "1");
});
test("refresh, durability, repair and delete locate equipped items by ID", () => {
  const u = user(); u.Equipment[0] = item(1);
  applyInventoryPacket(u, "RefreshItem", { Item: { ...item(1), CurrentDura: 1000 } });
  applyInventoryPacket(u, "DuraChanged", { UniqueID: "1", CurrentDura: 900 });
  assert.equal(u.Equipment[0].CurrentDura, 900);
  applyInventoryPacket(u, "ItemRepaired", { UniqueID: "1", CurrentDura: 2000, MaxDura: 2000 });
  assert.equal(u.Equipment[0].MaxDura, 2000);
  applyInventoryPacket(u, "DeleteItem", { UniqueID: "1", Count: 1 });
  assert.equal(u.Equipment[0], null);
});
test("equipment selection respects paired slots and prefers empty regular bag slots", () => {
  const u = user(); assert.equal(equipSlot({ Type: 7 }, u.Equipment), 8);
  u.Equipment[8] = item(1); assert.equal(equipSlot({ Type: 7 }, u.Equipment), 7);
  assert.equal(canEquipAt({ Type: 1 }, 1), false);
  assert.equal(emptyBagSlot(u.Inventory), 6);
});
test("unsupported grids and rejected packets do not touch inventory", () => {
  const u = user(); u.Inventory[0] = item(1);
  assert.equal(applyInventoryPacket(u, "MoveItem", { Grid: 4, From: 0, To: 6, Success: true }), false);
  assert.equal(u.Inventory[0].UniqueID, "1");
  assert.throws(() => applyInventoryPacket(u, "MoveItem", { Grid: 1, From: -1, To: 6, Success: true }));
});
