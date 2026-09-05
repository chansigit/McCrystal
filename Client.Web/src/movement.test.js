import test from "node:test";
import assert from "node:assert/strict";
import { movementLength, motionPosition, beginMotion, resetMotion, canPath, MOVE_INTERVAL, worldScale } from "./movement.js";
import PF from "pathfinding";

const from = { X: 10, Y: 10 };
const straight = [{ X: 11, Y: 10 }, { X: 12, Y: 10 }, { X: 13, Y: 10 }];
test("Running covers twice the walking distance over the same interpolation interval", () => {
  const walk = { Location: { X: 0, Y: 0 } }, run = { Location: { X: 0, Y: 0 } };
  beginMotion(walk, { X: 1, Y: 0 }, 100);
  beginMotion(run, { X: 2, Y: 0 }, 100);
  for (const time of [200, 400, 600, 746])
    assert.equal(motionPosition(run, time).X, 2 * motionPosition(walk, time).X);
});
test("Map changes snap to the new location and clear old movement/action animation", () => {
  const actor = { Location: { X: 328, Y: 328 }, from: { X: 327, Y: 328 }, movedAt: 10, running: true, attackUntil: 1000, castUntil: 1000 };
  resetMotion(actor, { X: 51, Y: 64 }, 3);
  assert.deepEqual(motionPosition(actor, 200), { X: 51, Y: 64, moving: false });
  assert.equal(actor.running, false);
  assert.equal(actor.Direction, 3);
  assert.equal(actor.attackUntil, 0);
});
test("Pathfinding rejects old-map coordinates and unavailable grids during transfer", () => {
  const grid = new PF.Grid(100, 100);
  assert.equal(canPath(grid, { X: 328, Y: 328 }, { X: 51, Y: 64 }), false);
  assert.equal(canPath(null, { X: 51, Y: 64 }, { X: 52, Y: 64 }), false);
  assert.equal(canPath(grid, { X: 51, Y: 64 }, { X: 52, Y: 64 }), true);
});
test("walking consumes one tile and running consumes two", () => {
  assert.equal(movementLength(from, straight, false), 1);
  assert.equal(movementLength(from, straight, true), 2);
});
test("running never skips a turn or a missing intermediate tile", () => {
  assert.equal(movementLength(from, [straight[0], { X: 11, Y: 11 }], true), 1);
  assert.equal(movementLength(from, [straight[0], straight[2]], true), 1);
});
test("short paths walk and empty paths stop", () => {
  assert.equal(movementLength(from, [straight[0]], true), 1);
  assert.equal(movementLength(from, [], true), 0);
});
test("diagonal and three-tile runs preserve their full path", () => {
  assert.equal(movementLength(from, [{ X: 11, Y: 11 }, { X: 12, Y: 12 }], true), 2);
  assert.equal(movementLength(from, straight, true, 3), 3);
  assert.equal(movementLength(from, straight.slice(0, 2), true, 3), 1);
});
test("motion continues beyond 300ms and across the packet cadence", () => {
  const actor = { Location: { X: 0, Y: 0 } };
  beginMotion(actor, { X: 1, Y: 0 }, 100);
  assert.equal(motionPosition(actor, 700).moving, true);
  const before = motionPosition(actor, 100 + MOVE_INTERVAL);
  beginMotion(actor, { X: 2, Y: 0 }, 100 + MOVE_INTERVAL);
  assert.equal(motionPosition(actor, 100 + MOVE_INTERVAL).X, before.X);
  assert.ok(motionPosition(actor, 100 + MOVE_INTERVAL + 100).X > before.X);
});
test("stationary acknowledgements do not restart motion and teleports snap", () => {
  const actor = { Location: { X: 0, Y: 0 } };
  beginMotion(actor, { X: 1, Y: 0 }, 100);
  beginMotion(actor, { X: 1, Y: 0 }, 200);
  assert.equal(actor.movedAt, 100);
  beginMotion(actor, { X: 100, Y: 100 }, 300);
  assert.equal(motionPosition(actor, 300).X, 100);
});
test("wide and tall viewports stay within server interest range", () => {
  for (const [width, height] of [[390, 700], [1440, 900], [3440, 1440], [1024, 2400]]) {
    const scale = worldScale(width, height);
    assert.ok(width / scale / 48 / 2 <= 13);
    assert.ok(height / scale / 32 / 2 <= 12);
  }
});
