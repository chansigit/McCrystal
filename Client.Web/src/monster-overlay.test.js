import test from "node:test";
import assert from "node:assert/strict";
import { MONSTER_OVERLAYS, monsterOverlays } from "./monster-overlay.js";
import { hydraOverlay } from "./entity-presentation.js";
import { frameIndex } from "./entity-presentation.js";

test("the scarecrow burns as it dies", () => {
  // MonsterObject.cs:4341-4346, the overlay this whole table started from.
  const [fire] = monsterOverlays({ Image: 5 }, "Die", 3, 2);
  assert.deepEqual(fire, { image: 5, index: 227, blend: true, gray: false });
  assert.deepEqual(monsterOverlays({ Image: 5 }, "Standing", 0, 0), []); // only on death
});

test("the Hydra overlay still lands exactly where it did", () => {
  // The audit's one verified entry, and the only one implemented before this table. Its
  // Hide runs backwards from 7 + direction * 8, and the overlay sits 400 frames on.
  const hide = { start: 7, count: 8, skip: 0, reverse: true };
  for (const direction of [0, 3, 7])
    for (const step of [0, 2, 7]) {
      const body = frameIndex(hide, direction, step);
      const [overlay] = monsterOverlays({ Image: 371 }, "Hide", step, direction, hide.start);
      assert.equal(overlay.index, hydraOverlay(body));
      assert.equal(overlay.blend, true);
    }
});

test("a Behemoth wears its aura in every action but Dead", () => {
  // The aura sits after the action switch, guarded on CurrentAction != Dead
  // (MonsterObject.cs:4832-4833), so it stacks with the per-action layer.
  const swing = monsterOverlays({ Image: 158 }, "Attack1", 5, 1);
  assert.deepEqual(swing.map((o) => o.index), [670, 604, 653]); // 667+5+2-4, 592+5+7, 648+5
  assert.deepEqual(monsterOverlays({ Image: 158 }, "Standing", 2, 0).map((o) => o.index),
    [514, 650]); // the standing layer and the aura
  assert.deepEqual(monsterOverlays({ Image: 158 }, "Dead", 0, 0), []); // the one exception
});

test("a frame guard keeps the overlay off the frames native skips", () => {
  // CaveMaggot's spit only appears from frame 1 (MonsterObject.cs:4348-4356).
  assert.deepEqual(monsterOverlays({ Image: 20 }, "Attack1", 0, 0), []);
  assert.equal(monsterOverlays({ Image: 20 }, "Attack1", 1, 0)[0].index, 176);
  // HellSlasher's window closes again at 6 (MonsterObject.cs, FrameIndex >= 2 && < 6).
  const slasher = MONSTER_OVERLAYS[215];
  if (slasher) {
    const windowed = Object.values(slasher).flat().find((row) => row.below != null);
    assert.equal(windowed.min, 2);
    assert.equal(windowed.below, 6);
  }
});

test("the FrostTiger overlay waits for its spawn Effect byte", () => {
  // Gated on Effect == 1, and native reads the ManTree library for it -- kept as native
  // has it rather than corrected (MonsterObject.cs:5537-5543).
  assert.deepEqual(monsterOverlays({ Image: 102, Effect: 0 }, "Standing", 1, 0), []);
  const [tint] = monsterOverlays({ Image: 102, Effect: 1 }, "Standing", 1, 0);
  assert.equal(tint.image, 353); // ManTree
  assert.equal(tint.gray, true); // Color.Gray, the only tinted overlays in the switch
});

test("a shared block narrows to one of its two monsters", () => {
  // FlameScythe and FlameAssassin share a case; the extra layer is FlameScythe's only
  // when facing off zero, and FlameAssassin's unconditionally (MonsterObject.cs:4952-4959).
  const facing = (image, direction) => monsterOverlays({ Image: image }, "AttackRange1", 1, direction);
  assert.equal(facing(240, 0).length, 1); // FlameScythe facing 0 gets only the shared layer
  assert.equal(facing(240, 3).length, 2); // and the extra one once it turns
  assert.equal(facing(240, 3)[1].index, 544 + 1 + 3 * 6 - 6);
  assert.equal(facing(241, 0).length, 2); // FlameAssassin gets it in every direction
  assert.equal(facing(241, 0)[1].index, 544 + 1);
});

test("the table covers the monsters the switch names", () => {
  assert.equal(Object.keys(MONSTER_OVERLAYS).length, 85);
  const rows = Object.values(MONSTER_OVERLAYS)
    .flatMap((actions) => Object.values(actions).flat());
  assert.equal(rows.length, 348); // 347 generated plus the Behemoth aura
  assert.ok(rows.every((row) => Number.isInteger(row.base)));
});

test("an unknown monster or action produces nothing", () => {
  assert.deepEqual(monsterOverlays({ Image: 4 }, "Attack1", 0, 0), []); // a deer has none
  assert.deepEqual(monsterOverlays({ Image: 5 }, "Harvest", 0, 0), []);
  assert.deepEqual(monsterOverlays(null, "Die", 0, 0), []);
});
