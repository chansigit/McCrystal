import test from "node:test";
import assert from "node:assert/strict";
import { mapAnimation, mapEffectFrame, mapPlacement } from "./map-effects.js";
test("Front glow flag is additive and not part of the animation count", () => {
  const cell = [0, 0, 0, 0, 14, 100, 0, 0x84, 1];
  const animation = mapAnimation(cell, 2);
  assert.deepEqual(animation, { count: 4, blend: true, tick: 1 });
  assert.equal(mapEffectFrame(100, animation, 0), 100);
  assert.equal(mapEffectFrame(100, animation, 200), 101);
  assert.equal(mapEffectFrame(100, animation, 800), 100);
});
test("Lamplight uses native three-cell anchor and embedded sprite offsets", () => {
  const cell = [0, 0, 0, 0, 14, 100, 0, 0x80, 0];
  assert.deepEqual(mapPlacement(cell, 2, 100, { width: 160, height: 160, x: -70, y: -30 }, 10, 20),
    { x: 410, y: 546, width: 160, height: 160 });
});
test("Ordinary scenery retains bottom anchoring without applying light offsets", () => {
  const cell = [0, 0, 0, 0, 14, 100, 0, 0, 0];
  assert.deepEqual(mapPlacement(cell, 2, 100, { width: 160, height: 160, x: -70, y: -30 }, 10, 20),
    { x: 480, y: 512, width: 160, height: 160 });
});
