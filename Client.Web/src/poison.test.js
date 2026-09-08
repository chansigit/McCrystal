import test from "node:test";
import assert from "node:assert/strict";
import { poisonTint, poisonDots, POISON } from "./poison.js";

test("the tint follows native's priority, not the flag order", () => {
  assert.equal(poisonTint(0), 0xffffff);
  assert.equal(poisonTint(POISON.Green), 0x008000);
  assert.equal(poisonTint(POISON.Red), 0xff0000);
  // Frozen outranks green even though its flag is higher, because the switch tests it
  // first (PlayerObject.cs:865-876).
  assert.equal(poisonTint(POISON.Green | POISON.Frozen), 0x0000ff);
  // DelayedExplosion outranks everything.
  assert.equal(poisonTint(POISON.Frozen | POISON.DelayedExplosion), 0xffa500);
  // Either paralysis reads the same, and so do stun and dazed.
  assert.equal(poisonTint(POISON.LRParalysis), poisonTint(POISON.Paralysis));
  assert.equal(poisonTint(POISON.Dazed), poisonTint(POISON.Stun));
});

test("the dots are every poison at once, in DrawPoison's own order", () => {
  assert.deepEqual(poisonDots(0), []);
  assert.deepEqual(poisonDots(POISON.Green), [0x008000]);
  // Green first, then red, then bleeding: not the order the tint switch uses.
  assert.deepEqual(poisonDots(POISON.Bleeding | POISON.Green | POISON.Red),
    [0x008000, 0xff0000, 0x8b0000]);
  // Stun and dazed share one dot rather than showing two.
  assert.equal(poisonDots(POISON.Stun | POISON.Dazed).length, 1);
  assert.equal(poisonDots(POISON.Paralysis | POISON.LRParalysis).length, 1);
  // Nine flags, nine dots at most.
  assert.equal(poisonDots(0xffff).length, 9);
});
