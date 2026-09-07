import test from "node:test";
import assert from "node:assert/strict";
import { TEXT_SIZE, showName, nameTop, frameIndex, transitionFrame, hydraOverlay } from "./entity-presentation.js";

test("names clear tall sprites and keep a screen-space gap", () => {
  assert.equal(nameTop(100, -120, 11, 1), -35);
  assert.equal(nameTop(100, -60, 5.5, 2), 32.5);
  assert.ok(nameTop(100, undefined, 11, 1) < 60);
});

test("native name defaults exclude corpses; hover works with names disabled", () => {
  assert.ok(TEXT_SIZE < 11);
  assert.equal(showName({kind: "monster"}, true, false), true);
  assert.equal(showName({kind: "monster", Dead: true}, true, false), false);
  assert.equal(showName({kind: "monster"}, false, false), false);
  assert.equal(showName({kind: "monster"}, false, true), true);
  assert.equal(showName({kind: "monster", Hidden: true}, true, true), false);
  assert.equal(showName({kind: "item"}, false, false), true);
});

test("Hydra emergence waits for textures, plays eight frames once, and hides in reverse", () => {
  const entity = {}, frame = {start: 0, count: 8, skip: 0, interval: 100};
  assert.deepEqual(transitionFrame(entity, frame, 1000, false), {step: 0, done: false});
  assert.deepEqual(transitionFrame(entity, frame, 5000, true), {step: 0, done: false});
  assert.equal(transitionFrame(entity, frame, 5700, true).step, 7);
  assert.equal(transitionFrame(entity, frame, 5800, true).done, true);
  assert.equal(frameIndex(frame, 3, 7), 31);
  assert.equal(frameIndex({...frame, start: 7, reverse: true}, 3, 7), 24);
  assert.equal(hydraOverlay(31), 431);
  assert.equal(hydraOverlay(294), 694);
});
