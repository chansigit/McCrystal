import test from "node:test";
import assert from "node:assert/strict";
import { itemUseSound, itemGainSound } from "./item-sounds.js";
test("Confirmed item gain selects native item-category samples, not consumption audio", () => {
  assert.equal(itemGainSound({Type:1}), 10111);
  assert.equal(itemGainSound({Type:2}), 10112);
  assert.equal(itemGainSound({Type:4}), 10116);
  assert.equal(itemGainSound({Type:10}), 10117);
  assert.equal(itemGainSound({Type:13}), 10108);
  assert.equal(itemGainSound({Type:15}), 10118);
  assert.equal(itemGainSound(undefined), 10118);
});
test("Scroll use is not a potion or food sound", () => {
  const packet = { Success: true, Grid: 1 };
  assert.equal(itemUseSound(packet, { Type: 13 }), 10107);
  assert.equal(itemUseSound(packet, { Type: 27 }), 10107);
  assert.equal(itemUseSound(packet, { Type: 17 }), 10118);
  assert.equal(itemUseSound({ Success: false, Grid: 1 }, { Type: 17 }), null);
  assert.equal(itemUseSound({ Success: true, Grid: 4 }, { Type: 13 }), null);
  assert.equal(itemUseSound(packet, null), null);
});
