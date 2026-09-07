import test from "node:test";
import assert from "node:assert/strict";
import { TEXT_SIZE, PLAYER_NAME_SIZE, showName, nameTop, frameIndex, transitionFrame, hydraOverlay, goldImage, npcIdleAction, beginAttackAnimation, entityDepth } from "./entity-presentation.js";

test("names clear tall sprites and keep a screen-space gap", () => {
  assert.ok(PLAYER_NAME_SIZE > TEXT_SIZE);
  assert.equal(nameTop(100, -120, 11, 1), -35);
  assert.equal(nameTop(100, -60, 5.5, 2), 32.5);
  assert.ok(nameTop(100, undefined, 11, 1) < 60);
  assert.equal(nameTop(100, -60, 12, 1, -2), 30);
});

test("native name defaults exclude corpses; hover works with names disabled", () => {
  assert.ok(TEXT_SIZE < 11);
  assert.equal(showName({kind: "monster"}, true, false), true);
  assert.equal(showName({kind: "monster", Dead: true}, true, false), false);
  assert.equal(showName({kind: "monster"}, false, false), false);
  assert.equal(showName({kind: "monster"}, false, true), true);
  assert.equal(showName({kind: "monster", Hidden: true}, true, true), false);
  assert.equal(showName({kind: "item"}, false, false), false);
  assert.equal(showName({kind: "item"}, false, true), false);
});

test("Guard attack animation includes the native standing recovery", () => {
  const guard = {kind: "monster", Image: 1};
  assert.equal(beginAttackAnimation(guard, 1000), true);
  assert.equal(guard.attackUntil, 1600);
  assert.equal(beginAttackAnimation(guard, 2000), false);
  assert.equal(beginAttackAnimation(guard, 3600), true);
  assert.equal(beginAttackAnimation({kind: "monster", Image: 20}, 2000), true);
});

test("native cell depth draws loot, then corpses, then living actors", () => {
  const item = entityDepth(320, {kind: "item", ObjectID: 3});
  const corpse = entityDepth(320, {kind: "monster", Dead: true, ObjectID: 2});
  const actor = entityDepth(320, {kind: "player", Dead: false, ObjectID: 1});
  assert.ok(item < corpse);
  assert.ok(corpse < actor);
  assert.ok(actor < entityDepth(352, {kind: "item", ObjectID: 1}));
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
test("Gold drops use the same five floor sprites as the native client", () => {
  assert.deepEqual([1, 99, 100, 199, 200, 499, 500, 999, 1000].map(goldImage),
    [112, 112, 113, 113, 114, 114, 115, 115, 116]);
});
test("NPCs alternate complete standing and harvest idle cycles", () => {
  const npc = {};
  const animations = { Standing: { count: 4, interval: 450 }, Harvest: { count: 10, interval: 200 } };
  assert.equal(npcIdleAction(npc, animations, 1000, () => 0.9), "Harvest");
  assert.equal(npcIdleAction(npc, animations, 2999, () => 0), "Harvest");
  assert.equal(npcIdleAction(npc, animations, 3000, () => 0), "Standing");
  assert.equal(npcIdleAction({}, { Standing: animations.Standing }, 0, () => 0.9), "Standing");
});
