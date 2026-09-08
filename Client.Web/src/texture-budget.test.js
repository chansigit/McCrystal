import test from "node:test";
import assert from "node:assert/strict";
import { textureBytes, textureEvictions, TEXTURE_BUDGET } from "./texture-budget.js";

const entry = (key, bytes, lastUsed, pinned = false) => ({ key, bytes, lastUsed, pinned });

test("nothing is evicted while the set fits the budget", () => {
  assert.deepEqual(textureEvictions([entry("a", 10, 1), entry("b", 10, 2)], 100), []);
  assert.deepEqual(textureEvictions([], 100), []);
});

test("the least recently drawn go first, and only as many as it takes", () => {
  const entries = [entry("new", 40, 9), entry("old", 40, 1), entry("middle", 40, 5)];
  assert.deepEqual(textureEvictions(entries, 100), ["old"]); // 120 -> 80, one is enough
  assert.deepEqual(textureEvictions(entries, 50), ["old", "middle"]);
});

test("a texture a live sprite is still holding is never evicted", () => {
  // A sprite keeps drawing its last texture while the next one loads, so an in-use
  // texture can be older than the current tick.
  const entries = [entry("held", 40, 1, true), entry("free", 40, 8)];
  assert.deepEqual(textureEvictions(entries, 50), ["free"]);
  assert.deepEqual(textureEvictions(entries, 10), ["free"]); // never the pinned one
});

test("an HD frame is four times the bytes of the art it replaces", () => {
  assert.equal(textureBytes({ width: 92, height: 64 }), 92 * 64 * 4);
  assert.equal(textureBytes({ width: 184, height: 128 }), 4 * textureBytes({ width: 92, height: 64 }));
  assert.equal(textureBytes(null), 0);
  assert.ok(TEXTURE_BUDGET > 0);
});
