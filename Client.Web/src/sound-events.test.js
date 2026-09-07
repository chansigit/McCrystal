import test from "node:test";
import assert from "node:assert/strict";
import { actorSound, audible } from "./sound-events.js";
test("Monster attack, flinch and death use native image sound families", () => {
  for (const image of [0, 7, 25, 57]) {
    const actor = { kind: "monster", Image: image };
    assert.equal(actorSound(actor, "show"), image * 10);
    assert.equal(actorSound(actor, "attack"), image * 10 + 1);
    assert.equal(actorSound(actor, "struck"), image * 10 + 2);
    assert.equal(actorSound(actor, "die"), image * 10 + 3);
  }
});
test("Water Dragon emergence uses its native popup sound", () => {
  assert.equal(actorSound({ kind: "monster", Image: 371 }, "show"), 3710);
});
test("Player flinch and death retain gender-specific voices, not generic weapon hits", () => {
  assert.equal(actorSound({ kind: "player", Gender: 0 }, "struck"), 10138);
  assert.equal(actorSound({ kind: "player", Gender: 1 }, "struck"), 10139);
  assert.equal(actorSound({ kind: "player", Gender: 0 }, "die"), 10144);
  assert.equal(actorSound({ kind: "player", Gender: 1 }, "die"), 10145);
  assert.equal(actorSound({ kind: "npc" }, "die"), null);
});
test("Unrelated distant actors do not flood the sound mixer", () => {
  const user = { Location: { X: 100, Y: 100 } };
  assert.equal(audible({ Location: { X: 112, Y: 100 } }, user), true);
  assert.equal(audible({ Location: { X: 113, Y: 100 } }, user), false);
  assert.equal(audible(null, user), false);
});
