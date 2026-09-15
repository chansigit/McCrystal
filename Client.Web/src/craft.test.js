import test from "node:test";
import assert from "node:assert/strict";
import { craftPlan, maxCraft, CRAFT_PANEL, TOOL_DURABILITY, MAX_CRAFT } from "./craft.js";

// 1.76's 灰色药粉(少量): three ingredients, no tools, no fee, and always succeeds.
const POWDER = {
  Gold: 0, Chance: 100,
  Item: { UniqueID: "5", ItemIndex: 900, Count: 1 },
  Tools: [],
  Ingredients: [
    { ItemIndex: 101, Count: 4, CurrentDura: 0, MaxDura: 0 },   // 食人树叶
    { ItemIndex: 102, Count: 2, CurrentDura: 0, MaxDura: 0 },   // 毒蜘蛛牙齿
    { ItemIndex: 103, Count: 1, CurrentDura: 0, MaxDura: 0 },   // 食人树的果实
  ],
};
const INFO = {
  101: { Name: "食人树叶", Image: 1, StackSize: 50 },
  102: { Name: "毒蜘蛛牙齿", Image: 2, StackSize: 50 },
  103: { Name: "食人树的果实", Image: 3, StackSize: 50 },
  900: { Name: "灰色药粉(少量)", Image: 4, StackSize: 20 },
  200: { Name: "铁锤", Image: 5, StackSize: 1 },
};
const info = (index) => INFO[index] || null;
const stack = (ItemIndex, Count) => ({ ItemIndex, Count, CurrentDura: 0, MaxDura: 0 });

test("one slot per ingredient, and the biggest stack of each", () => {
  // NPCScript.Craft insists usedSlots.Count == Tools.Count + Ingredients.Count, so a second
  // slot holding the same herb would be a count mismatch rather than a bigger pile.
  const bag = [stack(101, 4), null, stack(102, 9), stack(101, 40), stack(103, 2)];
  const plan = craftPlan(POWDER, bag, info);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.slots, [3, 2, 4], "the 40-leaf stack wins over the 4-leaf one");
  assert.equal(plan.rows[0].total, 44, "both stacks are still reported to the player");
});

test("a requirement spread across two stacks is not met", () => {
  // The server takes the whole amount out of one slot or refuses; two stacks of three
  // leaves are six leaves the player can see and cannot spend.
  const bag = [stack(101, 3), stack(101, 3), stack(102, 2), stack(103, 1)];
  const plan = craftPlan(POWDER, bag, info);
  assert.equal(plan.ready, false);
  assert.equal(plan.rows[0].slot, -1);
  assert.equal(plan.rows[0].total, 6, "the window can say why a bag that looks full enough is not");
  assert.equal(maxCraft(plan, POWDER, info(900), 0, info), 0);
});

test("the ceiling is the tightest of the server's own limits", () => {
  const bag = [stack(101, 40), stack(102, 9), stack(103, 7)];
  const plan = craftPlan(POWDER, bag, info);
  // leaves 40/4 = 10, teeth 9/2 = 4, fruit 7/1 = 7 -> 4.
  assert.equal(maxCraft(plan, POWDER, info(900), 0, info), 4);
  // The product's own stack size caps it too: a recipe yielding three per run into a
  // twenty-stack is six runs.
  const triple = { ...POWDER, Item: { ...POWDER.Item, Count: 3 } };
  assert.equal(maxCraft(plan, triple, info(900), 0, info), 4);
  assert.equal(maxCraft(craftPlan(triple, [stack(101, 50), stack(102, 50), stack(103, 50)], info),
    triple, info(900), 0, info), 6, "20 / 3 = 6 runs");
});

test("gold, when the recipe charges any, is a ceiling like the rest", () => {
  const paid = { ...POWDER, Gold: 100 };
  const bag = [stack(101, 40), stack(102, 40), stack(103, 40)];
  const plan = craftPlan(paid, bag, info);
  assert.equal(maxCraft(plan, paid, info(900), 250, info), 2);
  assert.equal(maxCraft(plan, paid, info(900), 0, info), 0);
  assert.equal(maxCraft(plan, POWDER, info(900), 0, info), 10, "a free recipe ignores gold");
});

test("a tool is worth as many crafts as it has thousands of durability", () => {
  const hammered = {
    ...POWDER,
    Tools: [{ ItemIndex: 200, Count: 1, CurrentDura: 0, MaxDura: 0 }],
  };
  const worn = { ItemIndex: 200, Count: 1, CurrentDura: 999, MaxDura: 10000 };
  const good = { ItemIndex: 200, Count: 1, CurrentDura: 3500, MaxDura: 10000 };
  const bag = [worn, stack(101, 40), stack(102, 40), stack(103, 40), good];
  const plan = craftPlan(hammered, bag, info);
  assert.equal(plan.rows[0].slot, 4, "the one under 1000 cannot pay for a single craft");
  assert.equal(maxCraft(plan, hammered, info(900), 0, info), 3);
  assert.equal(craftPlan(hammered, [worn, stack(101, 40), stack(102, 40), stack(103, 40)], info).ready, false);
  assert.equal(TOOL_DURABILITY, 1000);
});

test("an ingredient may demand a minimum condition", () => {
  // The third column of a recipe line is a durability floor; a zero there means MaxDura,
  // which is the ordinary "any condition" case and must not reject a fresh stack.
  const fussy = {
    ...POWDER,
    Ingredients: [{ ItemIndex: 200, Count: 1, CurrentDura: 5000, MaxDura: 10000 }],
  };
  const tired = { ItemIndex: 200, Count: 1, CurrentDura: 4000, MaxDura: 10000 };
  const fresh = { ItemIndex: 200, Count: 1, CurrentDura: 9000, MaxDura: 10000 };
  assert.equal(craftPlan(fussy, [tired], info).ready, false);
  assert.equal(craftPlan(fussy, [fresh], info).ready, true);
});

test("the constants are the server's and the native dialog's", () => {
  assert.equal(CRAFT_PANEL, 2);   // PanelType.Craft
  assert.equal(MAX_CRAFT, 99);    // the native MirAmountBox ceiling
  assert.equal(craftPlan(POWDER, null, info).ready, false, "no bag is not a crash");
  assert.equal(maxCraft(null, POWDER, info(900), 0, info), 0);
});
