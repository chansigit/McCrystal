import test from "node:test";
import assert from "node:assert/strict";
import { radarRect, fitMap } from "./native-map.js";
test("Native radar crops around the player, not a whole-map collision mask", () => {
  assert.deepEqual(radarRect({ width: 700, height: 700 }, { width: 700, height: 700 }, { X: 350, Y: 350 }),
    { x: 290, y: 296, width: 120, height: 108 });
});
test("Radar clamps to map edges and handles resources smaller than its viewport", () => {
  assert.deepEqual(radarRect({ width: 700, height: 700 }, { width: 700, height: 700 }, { X: 699, Y: 699 }),
    { x: 580, y: 592, width: 120, height: 108 });
  assert.deepEqual(radarRect({ width: 60, height: 54 }, { width: 700, height: 700 }, { X: 0, Y: 0 }),
    { x: 0, y: 0, width: 60, height: 54 });
});
test("Global map retains resource proportions and centers in the canvas", () => {
  assert.deepEqual(fitMap({ width: 200, height: 100 }, 400, 400), { x: 0, y: 100, width: 400, height: 200, scale: 2 });
});
