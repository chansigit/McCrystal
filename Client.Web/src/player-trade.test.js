import test from "node:test";
import assert from "node:assert/strict";
import { applyTradeMove, blockedFromTrade, tradeGoldAmount, TRADE_SLOTS, DONT_TRADE } from "./player-trade.js";

const item = (id) => ({ UniqueID: String(id), ItemIndex: 1, Count: 1 });

test("a deposit moves one item into the trade grid and a retrieval moves it back", () => {
  // PlayerObject.DepositTradeItem fills Info.Trade[to] only if it finds it empty, clears
  // Info.Inventory[from], and echoes both indexes with Success.
  const bag = [item(1), null, item(3)];
  const trade = new Array(TRADE_SLOTS).fill(null);
  assert.equal(applyTradeMove(bag, trade, "DepositTradeItem", { From: 0, To: 4, Success: true }), true);
  assert.equal(bag[0], null);
  assert.equal(trade[4].UniqueID, "1");
  assert.equal(applyTradeMove(bag, trade, "RetrieveTradeItem", { From: 4, To: 1, Success: true }), true);
  assert.equal(trade[4], null);
  assert.equal(bag[1].UniqueID, "1");
});

test("a refusal changes nothing, and an unapplicable answer is a desync rather than a shrug", () => {
  const bag = [item(1)];
  const trade = new Array(TRADE_SLOTS).fill(null);
  assert.equal(applyTradeMove(bag, trade, "DepositTradeItem", { From: 0, To: 0, Success: false }), false);
  assert.equal(bag[0].UniqueID, "1", "a refusal leaves the bag alone");
  // Outside the ten slots the server holds.
  assert.throws(() => applyTradeMove(bag, trade, "DepositTradeItem", { From: 0, To: TRADE_SLOTS, Success: true }));
  // An accepted move out of a slot the browser thinks is empty means the two have diverged.
  assert.throws(() => applyTradeMove(bag, trade, "RetrieveTradeItem", { From: 3, To: 0, Success: true }));
  // And into one it thinks is full.
  trade[2] = item(9);
  assert.throws(() => applyTradeMove(bag, trade, "DepositTradeItem", { From: 0, To: 2, Success: true }));
});

test("DontTrade is refused on the definition and on a rental's own flags", () => {
  assert.equal(blockedFromTrade(item(1), { Bind: DONT_TRADE }), true);
  assert.equal(blockedFromTrade({ ...item(1), RentalInformation: { BindingFlags: DONT_TRADE } }, { Bind: 0 }), true);
  assert.equal(blockedFromTrade(item(1), { Bind: 0 }), false);
  assert.equal(blockedFromTrade(item(1), null), false, "an unknown definition is not a refusal");
});

test("a gold offer is clamped to the wallet, and anything under one coin is refused", () => {
  // PlayerObject.TradeGold: `if (amount < 1 || Account.Gold < amount || ...) return;` with no
  // message, so both bounds are worth applying before the round trip.
  assert.equal(tradeGoldAmount(500, 1000), 500);
  assert.equal(tradeGoldAmount(5000, 1000), 1000, "never more than the player holds");
  assert.equal(tradeGoldAmount(0, 1000), null);
  assert.equal(tradeGoldAmount(-5, 1000), null);
  assert.equal(tradeGoldAmount("abc", 1000), null);
  assert.equal(tradeGoldAmount(1000, 0), null, "an empty wallet has nothing to offer");
  assert.equal(tradeGoldAmount("250.9", 1000), 250, "a fractional amount truncates like the uint it becomes");
});
