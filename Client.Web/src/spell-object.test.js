import test from "node:test";
import assert from "node:assert/strict";
import { spellObject, spellObjectFrame, spellObjectEffects, SPELL_OBJECTS } from "./spell-object.js";

test("the fire wall stands on its cell and loops", () => {
  const wall = spellObject(39);
  assert.deepEqual(
    { library: wall.library, start: wall.start, count: wall.count, interval: wall.interval },
    { library: "Magic", start: 1630, count: 6, interval: 120 }); // SpellObject.cs:46-53
  assert.equal(wall.blend, true);
  assert.equal(spellObjectFrame(wall, 0), 1630);
  assert.equal(spellObjectFrame(wall, 119), 1630);
  assert.equal(spellObjectFrame(wall, 120), 1631);
  assert.equal(spellObjectFrame(wall, 720), 1630); // six frames, then round again
  assert.equal(spellObjectFrame(wall, 7200), 1630); // and it never ends on its own
});

test("a one-shot ground spell stops drawing after its last frame", () => {
  const blizzard = spellObject(50); // Repeat = false
  assert.equal(blizzard.repeat, false);
  assert.deepEqual(blizzard.offset, { x: 0, y: -20 }); // AnimationOffset
  assert.equal(spellObjectFrame(blizzard, 2900), 1550 + 29); // last of 30
  assert.equal(spellObjectFrame(blizzard, 3000), null);
});

test("direction and the explosive trap flag pick the art", () => {
  // Rubble draws nothing facing 0 and frames 64..68 otherwise (SpellObject.cs:92-101).
  assert.equal(spellObject(201, 0), null);
  assert.equal(spellObject(201, 1).start, 64);
  assert.equal(spellObject(201, 7).start, 68); // clamped four past the base
  // DigOutZombie is one frame per direction (SpellObject.cs:63-68).
  assert.equal(spellObject(200, 3).start, 307);
  assert.equal(spellObject(200, 3).count, 1);
  // StoneGolemQuake strides eight frames per direction (SpellObject.cs:172-181).
  assert.equal(spellObject(208, 2).start, 368 + 16);
  // An armed trap loops; one going off plays once (SpellObject.cs:110-129).
  assert.equal(spellObject(124, 0, false).start, 1560);
  assert.equal(spellObject(124, 0, false).repeat, true);
  assert.equal(spellObject(124, 0, true).start, 1570);
  assert.equal(spellObject(124, 0, true).repeat, false);
});

test("the spells that are only an effect carry no standing object", () => {
  // MapLightning, MapLava and the two quakes add effects and nothing else.
  for (const spell of [202, 203, 204, 205, 207]) {
    assert.equal(SPELL_OBJECTS[spell], undefined);
    assert.equal(spellObject(spell), null);
    assert.ok(spellObjectEffects(spell).length > 0);
  }
  assert.deepEqual(spellObjectEffects(203), [["Dragon", 440, 20, 1600], ["Dragon", 470, 10, 800]]);
  assert.deepEqual(spellObjectEffects(39), []); // the fire wall has no companion effect
});

test("an unknown spell is ignored rather than drawn wrong", () => {
  assert.equal(spellObject(250), null);
  assert.equal(spellObjectFrame(null, 0), null);
});
