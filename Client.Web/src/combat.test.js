import test from "node:test";
import assert from "node:assert/strict";
import { meleeTarget, hitSprite, deathFrame } from "./combat.js";

test("melee approaches distant targets and attacks adjacent targets including diagonals", () => {
  const user = { Location: { X: 10, Y: 10 } };
  const target = { kind: "monster", Location: { X: 15, Y: 10 } };
  assert.equal(meleeTarget(user, target), "approach");
  target.Location = { X: 11, Y: 11 };
  assert.equal(meleeTarget(user, target), "attack");
  target.Location = user.Location;
  assert.equal(meleeTarget(user, target), "approach");
});
test("dead, hidden and removed targets cancel combat", () => {
  const user = { Location: { X: 10, Y: 10 } };
  for (const target of [null, { Dead: true }, { Hidden: true }, { kind: "npc" }])
    assert.equal(meleeTarget(user, target), "cancel");
});
test("clicking a monster body hits its rendered bounds, not only its foot cell", () => {
  const back = { entity: { ObjectID: 1 }, z: 10, bounds: { x: 100, y: 40, width: 80, height: 100 } };
  const front = { ...back, entity: { ObjectID: 2 }, z: 20 };
  assert.equal(hitSprite({ X: 130, Y: 50 }, [back, front]).ObjectID, 2);
  assert.equal(hitSprite({ X: 90, Y: 50 }, [back, front]), undefined);
});
test("death animation starts at frame zero, uses resource timing and does not loop", () => {
  assert.equal(deathFrame(0, 10, 100), 0);
  assert.equal(deathFrame(499, 10, 100), 4);
  assert.equal(deathFrame(999, 10, 100), 9);
  assert.equal(deathFrame(2000, 10, 100), 9);
  assert.equal(deathFrame(300, 8, 150), 2);
});
