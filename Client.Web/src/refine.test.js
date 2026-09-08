import test from "node:test";
import assert from "node:assert/strict";
import { applyRefineMove, refineList, refineCost, REFINE_SLOTS, DONT_UPGRADE, WEAPON } from "./refine.js";

const item = (id, extra = {}) => ({ UniqueID: String(id), ItemIndex: 1, Count: 1, ...extra });

test("materials move between the bag and the sixteen refine slots", () => {
  const bag = [item(1), null];
  const grid = new Array(REFINE_SLOTS).fill(null);
  assert.equal(applyRefineMove(bag, grid, "DepositRefineItem", { From: 0, To: 15, Success: true }), true);
  assert.equal(grid[15].UniqueID, "1");
  assert.equal(applyRefineMove(bag, grid, "RetrieveRefineItem", { From: 15, To: 1, Success: true }), true);
  assert.equal(bag[1].UniqueID, "1");
  // CharacterInfo.Refine is sixteen long and the server refuses anything past it.
  assert.throws(() => applyRefineMove(bag, grid, "DepositRefineItem", { From: 1, To: REFINE_SLOTS, Success: true }));
  assert.equal(applyRefineMove(bag, grid, "DepositRefineItem", { From: 1, To: 0, Success: false }), false);
});

test("the list is weapons from the bag, with the server's own three refusals named", () => {
  // PlayerObject.RefineItem: an item already carrying a refinement has to be appraised first,
  // a non-weapon is refused while OnlyRefineWeapon is on, and DontUpgrade blocks it outright.
  const bag = [
    item(1),
    item(2, { RefineAdded: 3 }),
    item(3, { ItemIndex: 2 }),
    item(4, { ItemIndex: 3 }),
    item(5, { ItemIndex: 1, RentalInformation: { BindingFlags: DONT_UPGRADE } }),
  ];
  const infos = new Map([
    [1, { Type: WEAPON, Bind: 0, RequiredAmount: 12 }],
    [2, { Type: WEAPON, Bind: DONT_UPGRADE, RequiredAmount: 12 }],
    [3, { Type: 2, Bind: 0, RequiredAmount: 12 }], // armour
  ]);
  const rows = refineList(bag, (index) => infos.get(index));
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2, 4], "the armour is not offered at all");
  assert.equal(rows[0].reason, null);
  assert.equal(rows[1].reason, "已修炼过，先去鉴定");
  assert.equal(rows[2].reason, "此物品不可修炼");
  assert.equal(rows[3].reason, "此物品不可修炼", "a rental's own flags count too");
  // The appraiser accepts anything, so its list is not restricted to weapons.
  assert.equal(refineList(bag, (index) => infos.get(index), false).length, 5);
});

test("the fee is the server's formula against the rate S.NPCRefine carried", () => {
  // (Info.RequiredAmount * 10) * Settings.RefineCost.
  assert.equal(refineCost({ RequiredAmount: 12 }, 1), 120);
  assert.equal(refineCost({ RequiredAmount: 12 }, 2.5), 300);
  assert.equal(refineCost({ RequiredAmount: 0 }, 3), 0);
  assert.equal(refineCost({ RequiredAmount: 12 }, undefined), 120, "no rate quotes at face value");
  assert.equal(refineCost(null, 1), null);
});
