import test from "node:test";
import assert from "node:assert/strict";
import { equippedWeapon, weaponLayer, hairLayer, HAIR_LIBRARIES, wingLayer, wingOffset, WING_LIBRARIES } from "./appearance.js";

test("equipped weapon shape zero is valid while missing and broken weapons are hidden", () => {
  assert.deepEqual(equippedWeapon({ CurrentDura: 1000 }, { Shape: 0, Effect: 3, Durability: 10 }), { Weapon: 0, WeaponEffect: 3 });
  assert.equal(equippedWeapon(null, null).Weapon, -1);
  assert.equal(equippedWeapon({ CurrentDura: 0 }, { Shape: 10, Durability: 10 }).Weapon, -1);
  assert.equal(equippedWeapon({ CurrentDura: 0 }, { Shape: 10, Durability: 0 }).Weapon, 10);
});
test("weapon follows the exact displayed body frame with female weapon offsets", () => {
  const male = weaponLayer({ Weapon: 5, Gender: 0, Direction: 2 }, 148);
  const female = weaponLayer({ Weapon: 5, Gender: 1, Direction: 2 }, 148 + 808);
  assert.equal(male.library, "CWeapon/05");
  assert.equal(male.index, 148); assert.equal(female.index, 148 + 416);
});
test("weapon draw order follows native eight-direction layering", () => {
  for (let direction = 0; direction < 8; direction++)
    assert.equal(weaponLayer({ Weapon: 1, Direction: direction }, 0).behind, [0, 5, 6, 7].includes(direction));
});
test("unequipping removes weapon and effect layers; unsupported alternate bodies do not use wrong frames", () => {
  assert.equal(weaponLayer({ Weapon: -1 }, 0), null);
  assert.equal(weaponLayer({ Weapon: 200, Class: 4 }, 0), null);
  assert.equal(weaponLayer({ Weapon: 100, Class: 3 }, 0), null);
  assert.equal(weaponLayer({ Weapon: 1, RidingMount: true }, 0), null);
  assert.equal(weaponLayer({ Weapon: 1, WeaponEffect: 12 }, 0).effectLibrary, "CWeaponEffect/12");
});
test("hair uses the body's own displayed frame because HairOffSet equals ArmourOffSet", () => {
  // A female body frame already carries the 808 armour offset; the head shares it.
  assert.deepEqual(hairLayer({ Hair: 3, Gender: 1 }, 148 + 808), { library: "CHair/03", index: 148 + 808 });
  assert.deepEqual(hairLayer({ Hair: 0, Gender: 0 }, 0), { library: "CHair/00", index: 0 });
  // Every animation the body plays is followed for free, including death frames.
  for (const frame of [0, 32, 136, 296, 344, 384, 387, 1615])
    assert.equal(hairLayer({ Hair: 8 }, frame).index, frame);
});
test("hair layer is drawn in all eight directions", () => {
  for (let direction = 0; direction < 8; direction++)
    assert.equal(hairLayer({ Hair: 1, Direction: direction }, direction * 4).library, "CHair/01");
});
test("hair is absent for out of range styles, transforms and unresolved body frames", () => {
  assert.equal(hairLayer({ Hair: HAIR_LIBRARIES }, 0), null);
  assert.equal(hairLayer({ Hair: -1 }, 0), null);
  assert.equal(hairLayer({}, 0), null);
  assert.equal(hairLayer({ Hair: 2 }, -1), null);
  assert.equal(hairLayer({ Hair: 2, TransformType: 4 }, 0), null);
  assert.equal(hairLayer({ Hair: 2, TransformType: -1 }, 0).library, "CHair/02");
  // Riding a mount still shows the head in the native client, unlike the weapon.
  assert.equal(hairLayer({ Hair: 2, RidingMount: true }, 0).library, "CHair/02");
});

test("wings ride the action's own effect strip, not the body's", () => {
  // Walking's effect strip is 64, six frames per direction (Frames.cs:158), and a female
  // draws 840 frames on (PlayerObject.cs:587).
  const walking = { start: 32, count: 6, skip: 0, interval: 100,
    effect: { start: 64, count: 6, skip: 0, interval: 100 } };
  const player = { Class: 0, Gender: 0, WingEffect: 1, TransformType: -1 };
  assert.deepEqual(wingLayer(player, walking, 0, 0),
    { library: "CHumEffect/00", index: 64 });
  assert.deepEqual(wingLayer(player, walking, 3, 2),
    { library: "CHumEffect/00", index: 64 + 18 + 2 });
  assert.equal(wingLayer({ ...player, Gender: 1 }, walking, 0, 0).index, 64 + 840);
  assert.equal(wingOffset(0), 0);
  assert.equal(wingOffset(1), 840);
});

test("wings are declined where native declines them", () => {
  const walking = { start: 32, count: 6, skip: 0, interval: 100,
    effect: { start: 64, count: 6, skip: 0, interval: 100 } };
  const player = { Class: 0, Gender: 0, WingEffect: 1, TransformType: -1 };
  assert.equal(wingLayer(player, { start: 0, count: 1, skip: 0, interval: 100 }, 0, 0), null);
  assert.equal(wingLayer({ ...player, WingEffect: 0 }, walking, 0, 0), null);
  assert.equal(wingLayer({ ...player, WingEffect: 100 }, walking, 0, 0), null); // native's own bound
  assert.equal(wingLayer({ ...player, WingEffect: WING_LIBRARIES + 1 }, walking, 0, 0), null);
  assert.equal(wingLayer({ ...player, Class: 3 }, walking, 0, 0), null); // Assassin reads AHumEffect
  assert.equal(wingLayer({ ...player, Class: 4 }, walking, 0, 0), null); // Archer reads ARHumEffect
  assert.equal(wingLayer({ ...player, TransformType: 2 }, walking, 0, 0), null);
  assert.equal(wingLayer(null, walking, 0, 0), null);
});
