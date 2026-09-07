import test from "node:test";
import assert from "node:assert/strict";
import { clampCount, placeItem, applyInventoryPacket } from "./inventory.js";
import { InventoryUI } from "./inventory-ui.js";

const item = (id, index = 1, count = 1) => ({ UniqueID: String(id), ItemIndex: index, Count: count });
const player = () => ({ Inventory: Array(46).fill(null), Equipment: Array(14).fill(null), Gold: 500 });

function withUI(user, run) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const nodes = new Map(), prompts = [], sent = [];
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "" });
      return nodes.get(id);
    },
  };
  const answers = [];
  globalThis.window = {
    prompt(message) { prompts.push(message); return answers.length ? answers.shift() : null; },
    confirm(message) { prompts.push(message); return answers.length ? answers.shift() : false; },
  };
  const ui = new InventoryUI(() => user, (index) => ({ Name: `物品${index}`, Type: 0, StackSize: 50 }),
    (type, data) => { sent.push({ type, data }); return true; });
  // The grid rendering needs a real DOM; these tests are about the command and lock logic.
  ui.render = () => {}; ui.renderDetails = () => {};
  try { return run(ui, { nodes, prompts, sent, answers }); }
  finally { clearTimeout(ui.timer); globalThis.document = previousDocument; globalThis.window = previousWindow; }
}

test("amount prompts clamp to the stack and reject anything that is not a whole count", () => {
  assert.equal(clampCount("3", 10), 3);
  assert.equal(clampCount("99", 10), 10);
  assert.equal(clampCount("0", 10), 0);
  assert.equal(clampCount("-4", 10), 0);
  assert.equal(clampCount("", 10), 0);
  assert.equal(clampCount("abc", 10), 0);
  assert.equal(clampCount("2.9", 10), 2);
  assert.equal(clampCount("1", 0), 0);
});

test("dropping a stack sends the clamped count and never more than the player holds", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 5);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ctx.answers.push("500");
    ui.dropItem();
    assert.deepEqual(ctx.sent, [{ type: "DropItem", data: { UniqueID: "1", Count: 5, HeroInventory: false } }]);
    assert.equal(user.Inventory[6].Count, 5, "the stack only changes when the server confirms");
  });
});

test("a rejected drop releases the lock and explains why the item stayed", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 5);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ctx.answers.push("2");
    ui.dropItem();
    assert.equal(ui.available(), false, "the bag is locked while the server decides");
    ui.receive("DropItem", { UniqueID: "1", Count: 2, HeroItem: false, Success: false });
    assert.equal(ui.available(), true);
    assert.equal(user.Inventory[6].Count, 5);
    assert.match(ctx.nodes.get("inventory-status").textContent, /无法丢弃/);
  });
});

test("a confirmed partial drop releases the lock and decrements only the dropped count", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 5);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ctx.answers.push("2");
    ui.dropItem();
    ui.receive("DropItem", { UniqueID: "1", Count: 2, HeroItem: false, Success: true });
    assert.equal(ui.available(), true);
    assert.equal(user.Inventory[6].Count, 3);
    assert.equal(ctx.nodes.get("inventory-status").textContent, "");
  });
});

test("a full-stack drop empties the slot", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 3);
  applyInventoryPacket(user, "DropItem", { UniqueID: "1", Count: 3, HeroItem: false, Success: true });
  assert.equal(user.Inventory[6], null);
});

test("a single item is dropped through a confirmation instead of an amount prompt", () => {
  const user = player(); user.Inventory[6] = item(1);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ui.dropItem();
    assert.deepEqual(ctx.sent, [], "declining the confirmation sends nothing");
    ctx.answers.push(true);
    ui.dropItem();
    assert.deepEqual(ctx.sent, [{ type: "DropItem", data: { UniqueID: "1", Count: 1, HeroInventory: false } }]);
  });
});

test("splitting offers at most one less than the stack and settles on SplitItem1", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 4);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ctx.answers.push("4");
    ui.splitItem();
    assert.deepEqual(ctx.sent, [{ type: "SplitItem", data: { Grid: 1, UniqueID: "1", Count: 3 } }]);
    assert.equal(ui.available(), false);
    ui.receive("SplitItem1", { Grid: 1, UniqueID: "1", Count: 3, Success: true });
    assert.equal(ui.available(), true);
    assert.equal(user.Inventory[6].Count, 1);
    ui.receive("SplitItem", { Grid: 1, Item: item(2, 1, 3) });
    assert.equal(user.Inventory[7].UniqueID, "2");
    assert.equal(user.Inventory[7].Count, 3);
  });
});

test("a rejected split releases the lock and leaves the source stack whole", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 4);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ctx.answers.push("2");
    ui.splitItem();
    ui.receive("SplitItem1", { Grid: 1, UniqueID: "1", Count: 2, Success: false });
    assert.equal(ui.available(), true);
    assert.equal(user.Inventory[6].Count, 4);
    assert.match(ctx.nodes.get("inventory-status").textContent, /无法拆分/);
  });
});

test("an unanswered command releases the lock instead of stranding the bag until re-login", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const user = player(); user.Inventory[6] = item(1, 1, 5);
  withUI(user, (ui, ctx) => {
    ui.selected = { grid: "bag", index: 6 };
    ctx.answers.push("1");
    ui.dropItem();
    assert.equal(ui.available(), false);
    t.mock.timers.tick(8000);
    assert.equal(ui.available(), true);
    assert.equal(ui.uncertain, false);
    assert.match(ctx.nodes.get("inventory-status").textContent, /未回应/);
  });
});

test("dropping gold clamps to the purse and never takes the inventory lock", () => {
  const user = player();
  withUI(user, (ui, ctx) => {
    ctx.answers.push("100000");
    ui.dropGold();
    assert.deepEqual(ctx.sent, [{ type: "DropGold", data: { Amount: 500 } }]);
    assert.equal(ui.available(), true, "gold is never acknowledged, so it must not lock the bag");
    user.Gold = 0;
    ui.dropGold();
    assert.equal(ctx.sent.length, 1);
    assert.match(ctx.nodes.get("inventory-status").textContent, /没有可丢弃的金币/);
  });
});

test("a split stack is placed without merging back into the stack it came from", () => {
  const user = player(); user.Inventory[6] = item(1, 1, 1);
  placeItem(user.Inventory, item(2, 1, 3), { Type: 0, StackSize: 50 });
  assert.equal(user.Inventory[6].Count, 1);
  assert.equal(user.Inventory[7].UniqueID, "2");
});
