import test from "node:test";
import assert from "node:assert/strict";
import { castError, manaCost, skillModes } from "./skills.js";

const fireball = { Spell: 31, BaseCost: 5, LevelCost: 2, Level: 3, Range: 8 };
const user = () => ({ ObjectID: 1, MP: 100, Location: { X: 10, Y: 10 }, Magics: [fireball] });
const monster = () => ({ ObjectID: 2, kind: "monster", Location: { X: 12, Y: 12 } });
test("spell cost includes learned level and target range includes diagonals", () => {
  assert.equal(manaCost(fireball), 11);
  const target = monster();
  assert.equal(castError(user(), fireball, target, target.Location, 1000), "");
  target.Location = { X: 18, Y: 18 };
  assert.equal(castError(user(), fireball, target, target.Location, 1000), "");
  target.Location.X = 19;
  assert.match(castError(user(), fireball, target, target.Location, 1000), /距离/);
});
test("unlearned, passive, insufficient mana and cooldown casts are rejected", () => {
  const u = user(), target = monster();
  assert.match(castError(u, { ...fireball, Spell: 36 }, target, target.Location, 1000), /学会/);
  u.MP = 10; assert.match(castError(u, fireball, target, target.Location, 1000), /魔法不足/);
  u.MP = 100; assert.match(castError(u, fireball, target, target.Location, 1000, 1100), /冷却/);
  u.Magics = [{ ...fireball, Spell: 1 }];
  assert.match(castError(u, u.Magics[0], target, target.Location, 1000), /未接入/);
  assert.equal(skillModes.has(1), false);
});
test("hostile spells reject dead, removed and hidden targets", () => {
  const target = monster(); target.Dead = true;
  assert.match(castError(user(), fireball, target, target.Location, 1000), /存活/);
  assert.match(castError(user(), fireball, null, null, 1000), /存活/);
  target.Dead = false; target.Hidden = true;
  assert.match(castError(user(), fireball, target, target.Location, 1000), /存活/);
});
test("healing targets self and ground spells accept empty cells", () => {
  const u = user(); const healing = { ...fireball, Spell: 61 }, wall = { ...fireball, Spell: 39 };
  u.Magics.push(healing, wall);
  assert.equal(castError(u, healing, u, u.Location, 1000), "");
  assert.equal(castError(u, wall, null, { X: 11, Y: 12 }, 1000), "");
  assert.match(castError(u, wall, null, null, 1000), /位置/);
});
