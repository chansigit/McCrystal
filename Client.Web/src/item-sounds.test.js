import test from "node:test";
import assert from "node:assert/strict";
import { itemUseSound } from "./item-sounds.js";
test("Scroll use is not a potion or food sound", () => {
  const packet = { Success: true, Grid: 1 };
  assert.equal(itemUseSound(packet, { Type: 13 }), 10107);
  assert.equal(itemUseSound(packet, { Type: 27 }), 10107);
  assert.equal(itemUseSound(packet, { Type: 17 }), 10118);
  assert.equal(itemUseSound({ Success: false, Grid: 1 }, { Type: 17 }), null);
  assert.equal(itemUseSound({ Success: true, Grid: 4 }, { Type: 13 }), null);
  assert.equal(itemUseSound(packet, null), null);
});
