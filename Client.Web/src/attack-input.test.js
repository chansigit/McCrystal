import test from "node:test";
import assert from "node:assert/strict";
import { AttackInput } from "./attack-input.js";
test("Shift and left button are both required for held force attack", () => {
  const input = new AttackInput();
  input.update({ buttons: 1, shiftKey: true, clientX: 42, clientY: 70 });
  assert.deepEqual(input.target, { clientX: 42, clientY: 70 });
  input.shift = false; assert.equal(input.target, null);
  input.shift = true; input.reset(); assert.equal(input.target, null);
  for (const buttons of [0, 2, 3]) {
    input.update({ buttons, shiftKey: true, clientX: 42, clientY: 70 });
    assert.equal(input.target, null);
  }
});
test("Holding left then pressing Shift and aiming updates the force-attack target", () => {
  const input = new AttackInput();
  input.update({ buttons: 1, shiftKey: false, clientX: 1, clientY: 2 });
  assert.equal(input.target, null);
  input.shift = true; assert.equal(input.target.clientX, 1);
  input.update({ buttons: 1, shiftKey: true, clientX: 9, clientY: 10 });
  assert.equal(input.target.clientX, 9);
});
test("Alt-left harvests instead of force-attacking and stops on release or reset", () => {
  const input = new AttackInput();
  input.update({ buttons: 1, altKey: true, shiftKey: true, clientX: 42, clientY: 70 });
  assert.deepEqual(input.harvestTarget, { clientX: 42, clientY: 70 });
  assert.equal(input.target, null);
  input.alt = false;
  assert.equal(input.harvestTarget, null);
  assert.ok(input.target);
  for (const buttons of [0, 2, 3]) {
    input.update({ buttons, altKey: true, clientX: 42, clientY: 70 });
    assert.equal(input.harvestTarget, null);
  }
  input.update({ buttons: 1, altKey: true, clientX: 42, clientY: 70 });
  input.reset();
  assert.equal(input.harvestTarget, null);
});
