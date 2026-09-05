import test from "node:test";
import assert from "node:assert/strict";
import { equippedWeapon, weaponLayer } from "./appearance.js";

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
