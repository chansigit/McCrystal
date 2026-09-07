import test from "node:test";
import assert from "node:assert/strict";
import { applyStorageMove, blockedFromStorage, firstEmptySlot, slotLabel, DONT_STORE, STORAGE_PAGE, StorageUI } from "./storage.js";

const item = (id, extra = {}) => ({ UniqueID: String(id), ItemIndex: 1, Count: 1, ...extra });
const player = () => ({ Inventory: Array(46).fill(null), Equipment: Array(14).fill(null), Gold: 0 });

function withUI(user, run) {
  const previousDocument = globalThis.document;
  const nodes = new Map(), sent = [];
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "" });
      return nodes.get(id);
    },
  };
  const ui = new StorageUI(() => user, (index) => ({ Name: `物品${index}`, Image: index, Bind: 0 }),
    (type, data) => { sent.push({ type, data }); return true; });
  // Drawing the two grids needs a real DOM; these tests are about the transfer and lock logic.
  ui.render = () => {};
  try { return run(ui, { nodes, sent }); }
  finally { clearTimeout(ui.timer); globalThis.document = previousDocument; }
}

test("a stored item leaves the bag slot the server names and lands in the vault slot it names", () => {
  const bag = [null, item(7, { Count: 3 })], vault = [null, null, null];
  assert.equal(applyStorageMove(bag, vault, "StoreItem", { From: 1, To: 2, Success: true }), true);
  assert.equal(bag[1], null);
  assert.equal(vault[2].UniqueID, "7");
  assert.equal(vault[2].Count, 3);
});

test("a withdrawal moves the vault item into the bag slot the server names", () => {
  const bag = [null, null], vault = [item(9), null];
  assert.equal(applyStorageMove(bag, vault, "TakeBackItem", { From: 0, To: 1, Success: true }), true);
  assert.equal(vault[0], null);
  assert.equal(bag[1].UniqueID, "9");
});

// PlayerObject.StoreItem and TakeBackItem answer every refusal with a bare Success = false,
// and the client applies nothing before that answer, so a refusal must leave both grids alone.
test("a refused transfer leaves the bag and the vault exactly as the server holds them", () => {
  const stored = item(7);
  const bag = [stored, null], vault = [null, item(8)];
  assert.equal(applyStorageMove(bag, vault, "StoreItem", { From: 0, To: 1, Success: false }), false);
  assert.deepEqual(bag, [stored, null]);
  assert.equal(vault[0], null);
  assert.equal(vault[1].UniqueID, "8");
  assert.equal(applyStorageMove(bag, vault, "TakeBackItem", { From: 1, To: 1, Success: false }), false);
  assert.equal(vault[1].UniqueID, "8");
  assert.equal(bag[1], null);
  // A packet for another system never touches either grid.
  assert.equal(applyStorageMove(bag, vault, "MoveItem", { From: 0, To: 1, Success: true }), false);
  assert.deepEqual(bag, [stored, null]);
});

test("a success the local grids cannot explain is reported as a desync instead of corrupting them", () => {
  const bag = [item(1), null], vault = [item(2), null];
  // The source slot the server emptied is already empty here.
  assert.throws(() => applyStorageMove(bag, vault, "StoreItem", { From: 1, To: 1, Success: true }), /同步异常/);
  // The destination slot the server filled is already taken here.
  assert.throws(() => applyStorageMove(bag, vault, "StoreItem", { From: 0, To: 0, Success: true }), /同步异常/);
  // Indexes outside either grid can only mean the copy no longer matches the server.
  assert.throws(() => applyStorageMove(bag, vault, "TakeBackItem", { From: 5, To: 0, Success: true }), /同步异常/);
  assert.throws(() => applyStorageMove(bag, vault, "TakeBackItem", { From: 0, To: -1, Success: true }), /同步异常/);
  assert.equal(bag[0].UniqueID, "1");
  assert.equal(vault[0].UniqueID, "2");
});

test("the first free slot and the bind flag decide what can be stored at all", () => {
  assert.equal(firstEmptySlot([item(1), null, null]), 1);
  assert.equal(firstEmptySlot([item(1), item(2)]), -1);
  assert.equal(firstEmptySlot(null), -1);
  // A locked second vault page is not a free slot, however empty it looks.
  assert.equal(firstEmptySlot([item(1), null, null], 1), -1);
  assert.equal(firstEmptySlot([item(1), null, null], 2), 1);
  assert.equal(blockedFromStorage(item(1), { Bind: DONT_STORE }), true);
  assert.equal(blockedFromStorage(item(1), { Bind: 4 }), false);
  assert.equal(blockedFromStorage(item(1, { RentalInformation: { BindingFlags: DONT_STORE } }), { Bind: 0 }), true);
  assert.equal(blockedFromStorage(item(1), undefined), false);
  assert.equal(slotLabel("storage", 0), "仓库 1");
  assert.equal(slotLabel("bag", 0), "快捷栏 1");
  assert.equal(slotLabel("bag", 6), "背包 1");
});

test("a click stores into the first free vault slot and takes back into the first free bag slot", () => {
  const user = player();
  user.Inventory[6] = item(7);
  withUI(user, (ui, { sent }) => {
    ui.receive("UserStorage", { Storage: [item(3), null, null] });
    ui.open();
    ui.transfer({ grid: "bag", index: 6 });
    assert.deepEqual(sent.at(-1), { type: "StoreItem", data: { From: 6, To: 1 } });
    ui.receive("StoreItem", { From: 6, To: 1, Success: true });
    assert.equal(user.Inventory[6], null);
    assert.equal(ui.items[1].UniqueID, "7");
    // The bag prefers a regular slot over the belt, exactly as a pickup does.
    ui.transfer({ grid: "storage", index: 1 });
    assert.deepEqual(sent.at(-1), { type: "TakeBackItem", data: { From: 1, To: 6 } });
    ui.receive("TakeBackItem", { From: 1, To: 6, Success: true });
    assert.equal(ui.items[1], null);
    assert.equal(user.Inventory[6].UniqueID, "7");
  });
});

test("only one transfer is in flight at a time and a refusal releases the lock", () => {
  const user = player();
  user.Inventory[6] = item(7);
  user.Inventory[7] = item(8);
  withUI(user, (ui, { sent, nodes }) => {
    ui.receive("UserStorage", { Storage: [null, null] });
    ui.open();
    ui.transfer({ grid: "bag", index: 6 });
    ui.transfer({ grid: "bag", index: 7 });
    assert.equal(sent.length, 1, "a second transfer must wait for the first to be answered");
    // A refusal releases the lock and names the causes the server actually checks.
    ui.receive("StoreItem", { From: 6, To: 0, Success: false });
    assert.match(nodes.get("storage-status").textContent, /拒绝/);
    assert.equal(ui.pending, null);
    assert.equal(user.Inventory[6].UniqueID, "7");
    ui.transfer({ grid: "bag", index: 7 });
    assert.equal(sent.length, 2);
  });
});

test("an unanswered transfer releases the lock instead of stranding the vault until re-login", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const user = player();
  user.Inventory[6] = item(7);
  withUI(user, (ui, { nodes }) => {
    ui.receive("UserStorage", { Storage: [null, null] });
    ui.open();
    ui.transfer({ grid: "bag", index: 6 });
    assert.equal(ui.available(), false);
    t.mock.timers.tick(8000);
    assert.equal(ui.available(), true);
    assert.equal(ui.uncertain, false);
    assert.match(nodes.get("storage-status").textContent, /未回应/);
  });
});

test("a full vault or a full bag is reported instead of sending a transfer the server would refuse", () => {
  const user = player();
  user.Inventory[6] = item(7);
  withUI(user, (ui, { sent, nodes }) => {
    ui.receive("UserStorage", { Storage: [item(3)] });
    ui.open();
    ui.transfer({ grid: "bag", index: 6 });
    assert.equal(sent.length, 0);
    assert.equal(nodes.get("storage-status").textContent, "仓库已满");
    user.Inventory.fill(item(1));
    ui.transfer({ grid: "storage", index: 0 });
    assert.equal(sent.length, 0);
    assert.equal(nodes.get("storage-status").textContent, "背包已满");
  });
});

test("an item the server would refuse to store is refused here instead of costing a round trip", () => {
  const user = player();
  user.Inventory[6] = item(7);
  const previousDocument = globalThis.document;
  const nodes = new Map(), sent = [];
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "" });
      return nodes.get(id);
    },
  };
  const ui = new StorageUI(() => user, () => ({ Name: "婚戒", Bind: DONT_STORE }), (type, data) => { sent.push({ type, data }); return true; });
  ui.render = () => {};
  try {
    ui.receive("UserStorage", { Storage: [null] });
    ui.open();
    ui.transfer({ grid: "bag", index: 6 });
    assert.equal(sent.length, 0);
    assert.equal(nodes.get("storage-status").textContent, "此物品无法存入仓库");
  } finally { clearTimeout(ui.timer); globalThis.document = previousDocument; }
});

test("a drag only crosses the two grids, and only onto an empty slot", () => {
  const user = player();
  user.Inventory[6] = item(7);
  user.Inventory[7] = item(8);
  withUI(user, (ui, { sent }) => {
    ui.receive("UserStorage", { Storage: [item(3), null] });
    ui.open();
    // Moving inside one grid has no packet: C.StoreItem and C.TakeBackItem always cross.
    ui.move({ grid: "bag", index: 6 }, { grid: "bag", index: 8 });
    assert.equal(sent.length, 0);
    ui.move({ grid: "storage", index: 0 }, { grid: "storage", index: 1 });
    assert.equal(sent.length, 0);
    // The server only ever fills a slot it finds empty.
    ui.move({ grid: "bag", index: 6 }, { grid: "storage", index: 0 });
    assert.equal(sent.length, 0);
    ui.move({ grid: "bag", index: 6 }, { grid: "storage", index: 1 });
    assert.deepEqual(sent.at(-1), { type: "StoreItem", data: { From: 6, To: 1 } });
  });
});

test("the vault survives a logout and stays blocked once the copy is known to be wrong", () => {
  const user = player();
  user.Inventory[6] = item(7);
  withUI(user, (ui) => {
    ui.receive("UserStorage", { Storage: [null, null] });
    ui.open();
    // The account vault is sent once per connection, so closing the window keeps the copy.
    ui.close();
    assert.equal(ui.items.length, 2);
    ui.open();
    assert.equal(ui.available(), true);
    // A success the copy cannot explain stops further transfers rather than guessing.
    ui.receive("StoreItem", { From: 20, To: 0, Success: true });
    assert.equal(ui.uncertain, true);
    assert.equal(ui.available(), false);
    // Only a fresh connection, which resends the vault, clears that.
    ui.reset();
    assert.equal(ui.items, null);
    assert.equal(ui.uncertain, false);
  });
});

test("a vault the server never sent says why instead of showing an empty grid", () => {
  const previousDocument = globalThis.document;
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "" });
      return nodes.get(id);
    },
  };
  const locked = { ...player(), RequireStoragePassword: true, HasStoragePassword: true };
  const ui = new StorageUI(() => locked, () => undefined, () => true);
  try {
    ui.open();
    assert.match(nodes.get("storage-hint").textContent, /仓库密码/);
    assert.equal(nodes.get("storage-grids").hidden, true);
    assert.equal(ui.available(), false);
    // Without a password on the account the same silence is a delivery problem, not a lock.
    locked.HasStoragePassword = false;
    ui.render();
    assert.match(nodes.get("storage-hint").textContent, /尚未送达/);
  } finally { clearTimeout(ui.timer); globalThis.document = previousDocument; }
});

// HumanObject.ProcessItems empties an expired vault slot and announces it with S.DeleteItem
// alone; nothing else tells the browser the item is gone.
test("an item that expires in the vault leaves the copy instead of staying clickable", () => {
  const user = player();
  withUI(user, (ui, { sent }) => {
    ui.receive("UserStorage", { Storage: [item(3), item(4), null] });
    ui.open();
    ui.receive("DeleteItem", { UniqueID: "3", Count: 1 });
    assert.equal(ui.items[0], null);
    assert.equal(ui.items[1].UniqueID, "4");
    // A deletion for a bag item the vault does not hold must leave the vault alone.
    ui.receive("DeleteItem", { UniqueID: "99", Count: 1 });
    assert.equal(ui.items[1].UniqueID, "4");
    // The freed slot is now a real destination rather than one the server would refuse.
    user.Inventory[6] = item(7);
    ui.transfer({ grid: "bag", index: 6 });
    assert.deepEqual(sent.at(-1), { type: "StoreItem", data: { From: 6, To: 0 } });
  });
});

// AccountInfo.ExpandStorage doubles Storage to two pages and the server announces the new
// length with S.ResizeStorage; the grid has to follow without waiting for a page reload.
test("buying a vault expansion grows the grid, and letting it lapse locks the page again", () => {
  const user = player();
  withUI(user, (ui) => {
    ui.receive("UserStorage", { Storage: Array(STORAGE_PAGE).fill(null) });
    ui.open();
    assert.equal(ui.slots(), STORAGE_PAGE);
    ui.resize({ Size: 2 * STORAGE_PAGE, HasExpandedStorage: true });
    assert.equal(ui.items.length, 2 * STORAGE_PAGE);
    assert.equal(ui.slots(), 2 * STORAGE_PAGE);
    assert.equal(user.HasExpandedStorage, true);
    // A rented slot is a legal destination, which is exactly what the gateway now forwards.
    user.Inventory[6] = item(7);
    ui.items.fill(item(1), 0, STORAGE_PAGE);
    ui.transfer({ grid: "bag", index: 6 });
    assert.deepEqual(ui.pending, { type: "StoreItem", From: 6, To: STORAGE_PAGE });
    ui.receive("StoreItem", { From: 6, To: STORAGE_PAGE, Success: true });
    assert.equal(ui.items[STORAGE_PAGE].UniqueID, "7");
    // The rental lapsing keeps the array but locks the page, as IsValidStorageIndex does.
    ui.resize({ Size: 2 * STORAGE_PAGE, HasExpandedStorage: false });
    assert.equal(ui.items.length, 2 * STORAGE_PAGE, "the stranded items are still there");
    assert.equal(ui.slots(), STORAGE_PAGE);
    ui.move({ grid: "bag", index: 7 }, { grid: "storage", index: STORAGE_PAGE });
    assert.equal(ui.pending, null);
    // A size that could not have come from the server is ignored rather than trusted.
    ui.resize({ Size: "160", HasExpandedStorage: true });
    assert.equal(ui.items.length, 2 * STORAGE_PAGE);
  });
});

test("a transfer the server carried out but the copy cannot absorb fails instead of being dropped", () => {
  const user = player();
  withUI(user, (ui, { nodes }) => {
    // The vault window can be opened before S.UserStorage arrives, so the ack has no copy.
    ui.open();
    ui.receive("StoreItem", { From: 6, To: 0, Success: true });
    assert.equal(ui.uncertain, true);
    assert.equal(ui.available(), false);
    assert.match(nodes.get("storage-status").textContent, /刷新页面/);
  });
});
