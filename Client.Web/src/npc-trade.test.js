import test from "node:test";
import assert from "node:assert/strict";
import { NPCTrade, sellCount, sellList, repairList, DONT_SELL, DONT_REPAIR, NO_SREPAIR } from "./npc-trade.js";
import { repairCost, specialRepairCost } from "./item-price.js";
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

// The panel needs enough of a DOM to render into; these tests are about the numbers it shows.
function withTrade(user, definitions, run) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const nodes = new Map(), sent = [], asked = [];
  const element = () => ({
    hidden: true, disabled: false, textContent: "", children: [],
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = kids; },
    setAttribute() {}, getAttribute: () => "",
  });
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createDocumentFragment: element,
  };
  globalThis.window = {
    confirm: (text) => { asked.push(text); return true; },
    prompt: (text) => { asked.push(text); return null; },
  };
  const ui = new NPCTrade(() => user, (index) => definitions[index],
    (type, data) => { sent.push({ type, data }); return true; });
  const detail = (row) => nodes.get("trade-list").children[0].children[row].children[2].textContent;
  try { return run(ui, { nodes, sent, asked, detail }); }
  finally { clearTimeout(ui.timer); globalThis.document = previousDocument; globalThis.window = previousWindow; }
}

const SWORD = { Name: "剑", Price: 15000, Durability: 5000, Image: 1, Bind: 0 };
const POTION = { Name: "药", Price: 200, Durability: 0, StackSize: 50, Image: 2, Bind: 0 };

test("the sell panel quotes what the server will pay and warns that nothing can be bought back", () => {
  const user = {
    Inventory: [item(1, { ItemIndex: 1, MaxDura: 4500, CurrentDura: 1200 }), item(2, { ItemIndex: 2, Count: 7 })],
    Equipment: [], Gold: 500,
  };
  withTrade(user, { 1: SWORD, 2: POTION }, (ui, { nodes, detail }) => {
    // S.NPCSell carries no fields at all, so a sale must not keep a rate it never received.
    ui.open("sell", undefined);
    assert.equal(ui.rate, null);
    assert.match(detail(0), /售价 5,887 金币/);
    assert.match(detail(1), /售价 700 金币/);
    assert.match(nodes.get("trade-hint").textContent, /无法买回/);
  });
});

test("the repair panel quotes the rated cost and refuses a request the server would answer with silence", () => {
  const user = { Inventory: [item(1, { ItemIndex: 1, MaxDura: 4500, CurrentDura: 1200 })], Equipment: [], Gold: 500 };
  withTrade(user, { 1: SWORD }, (ui, { nodes, sent, detail }) => {
    // S.NPCRepair carries the rate PlayerObject.RepairItem multiplies RepairPrice() by.
    ui.open("repair", 2);
    assert.equal(ui.rate, 2);
    assert.match(detail(0), /修理费 4,950 金币（金币不足）/);
    // PlayerObject.RepairItem returns without a message when the gold is short.
    ui.choose("1");
    assert.equal(sent.length, 0);
    assert.match(nodes.get("trade-status").textContent, /金币不足/);
    user.Gold = 10000;
    ui.choose("1");
    assert.deepEqual(sent.at(-1), { type: "RepairItem", data: { UniqueID: "1" } });
    // S.RepairItem is enqueued before any of those checks run, so it must not claim acceptance.
    ui.receive("RepairItem", { UniqueID: "1" });
    assert.match(nodes.get("trade-status").textContent, /尚未确认/);
    ui.receive("ItemRepaired", { UniqueID: "1", MaxDura: 4500, CurrentDura: 4500 });
    assert.equal(nodes.get("trade-status").textContent, "修理完成");
  });
});

test("an item whose definition has not arrived is listed without inventing a price for it", () => {
  const user = { Inventory: [item(1, { ItemIndex: 9 })], Equipment: [], Gold: 0 };
  withTrade(user, {}, (ui, { detail }) => {
    ui.open("sell");
    assert.match(detail(0), /价格未就绪/);
  });
});

test("special repair costs triple and refuses the items marked against it", () => {
  // PlayerObject.RepairItem: `temp.RepairPrice() * 3 * script.PriceRate(this)`, and the
  // MaxDura line above it is guarded by `if (!special)` -- the triple fee buys the item's
  // maximum durability rather than a bigger restore.
  const info = { Price: 1000, Durability: 10000, Bind: 0, StackSize: 1 };
  const worn = { Count: 1, MaxDura: 10000, CurrentDura: 4000, AddedStats: {} };
  const ordinary = repairCost(worn, info, 1);
  assert.equal(specialRepairCost(worn, info, 1), ordinary * 3);
  // The NPC's own rate still applies on top.
  assert.equal(specialRepairCost(worn, info, 2), ordinary * 6);

  const bag = [{ ...worn, ItemIndex: 1 }, { ...worn, ItemIndex: 2 }];
  const infos = new Map([[1, { ...info, Bind: NO_SREPAIR }], [2, { ...info, Bind: DONT_REPAIR }]]);
  const get = (index) => infos.get(index);
  // NoSRepair blocks only the special service; DontRepair blocks both.
  assert.deepEqual(repairList(bag, get, false).map((r) => r.blocked), [false, true]);
  assert.deepEqual(repairList(bag, get, true).map((r) => r.blocked), [true, true]);
});
