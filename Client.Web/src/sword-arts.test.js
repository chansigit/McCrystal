import test from "node:test";
import assert from "node:assert/strict";
import { attackSpell, pointMove, manaCost, SwordArts, SLAYING, THRUSTING, HALF_MOON,
  FLAMING_SWORD, TOGGLES, TOGGLE_ON, TOGGLE_OFF, TOGGLE_INTERVAL } from "./sword-arts.js";

const at = (X, Y) => ({ Location: { X, Y }, kind: "monster" });
const world = (...entities) => ({ entities: new Map(entities.map((e, i) => [i + 1, e])) });
const magic = (Spell, BaseCost = 0, LevelCost = 0, Level = 0) => ({ Spell, BaseCost, LevelCost, Level });
const hero = (Magics, MP = 100) => ({ Location: { X: 10, Y: 10 }, MP, Magics });
const off = { slaying: false, thrusting: false, halfMoon: false, flamingSword: false };

test("direction 2 is east, the way the shared table orders them", () => {
  assert.deepEqual(pointMove({ X: 10, Y: 10 }, 2, 1), { X: 11, Y: 10 });
  assert.deepEqual(pointMove({ X: 10, Y: 10 }, 2, 2), { X: 12, Y: 10 });
  assert.deepEqual(pointMove({ X: 10, Y: 10 }, 0, 1), { X: 10, Y: 9 }, "0 is north");
});

test("a plain swing carries no skill", () => {
  assert.equal(attackSpell(off, hero([]), world(at(11, 10)), 2), 0);
});

test("攻杀剑术 rides the next swing, but only into something", () => {
  const armed = { ...off, slaying: true };
  assert.equal(attackSpell(armed, hero([]), world(at(11, 10)), 2), SLAYING);
  assert.equal(attackSpell(armed, hero([]), world(at(15, 10)), 2), 0, "nothing in front, nothing spent");
});

test("刺杀剑术 needs the second cell occupied, not the first", () => {
  const on = { ...off, thrusting: true };
  const magics = [magic(THRUSTING)];
  assert.equal(attackSpell(on, hero(magics), world(at(12, 10)), 2), THRUSTING);
  assert.equal(attackSpell(on, hero(magics), world(at(11, 10)), 2), 0,
    "a monster only in the first cell is an ordinary swing");
  assert.equal(attackSpell(on, hero([]), world(at(12, 10)), 2), 0, "not learned, not sent");
});

test("半月弯刀 sweeps an arc and costs mana up front", () => {
  const on = { ...off, halfMoon: true };
  const magics = [magic(HALF_MOON, 3, 3, 2)]; // 3 + 2*3 = 9
  // MapControl.CanHalfMoon looks at the facing direction and its neighbours, so a monster
  // off to the side is still in the arc.
  assert.equal(attackSpell(on, hero(magics), world(at(11, 11)), 2), HALF_MOON);
  assert.equal(attackSpell(on, hero(magics, 8), world(at(11, 11)), 2), 0, "9 mana needed, 8 held");
  assert.equal(attackSpell(on, hero(magics), world(at(14, 14)), 2), 0, "nothing in the arc");
  assert.equal(manaCost(magics[0]), 9);
});

test("烈火剑法 wins over the others, the way the native order does", () => {
  // PlayerObject.cs runs four sequential ifs, so the last one that matches is the one sent.
  const all = { slaying: true, thrusting: true, halfMoon: true, flamingSword: true };
  const magics = [magic(THRUSTING), magic(HALF_MOON), magic(FLAMING_SWORD)];
  assert.equal(attackSpell(all, hero(magics), world(at(11, 10), at(12, 10)), 2), FLAMING_SWORD);
  const noFlame = { ...all, flamingSword: false };
  assert.equal(attackSpell(noFlame, hero(magics), world(at(11, 10), at(12, 10)), 2), HALF_MOON);
});

test("a corpse and an NPC are not something to swing a skill at", () => {
  const armed = { ...off, slaying: true };
  assert.equal(attackSpell(armed, hero([]), world({ ...at(11, 10), Dead: true }), 2), 0);
  assert.equal(attackSpell(armed, hero([]), world({ ...at(11, 10), kind: "npc" }), 2), 0);
  assert.equal(attackSpell(armed, hero([]), world({ ...at(11, 10), Hidden: true }), 2), 0);
});

test("the two switches are the client's own state; the server is told, not asked", () => {
  const sent = [];
  const user = hero([magic(THRUSTING), magic(HALF_MOON), magic(FLAMING_SWORD, 10)], 100);
  const arts = new SwordArts(() => user, (type, data) => { sent.push([type, data]); return true; }, world());
  assert.equal(arts.toggle(THRUSTING, 0), true);
  assert.deepEqual(sent[0], ["SpellToggle", { Spell: THRUSTING, canUse: TOGGLE_ON }]);
  assert.equal(arts.active(THRUSTING), true, "no echo comes back, so the client keeps the state");
  // GameScene.ToggleTime refuses a second flip inside a second.
  assert.equal(arts.toggle(THRUSTING, TOGGLE_INTERVAL - 1), false);
  assert.equal(arts.toggle(THRUSTING, TOGGLE_INTERVAL), true);
  assert.deepEqual(sent[1][1], { Spell: THRUSTING, canUse: TOGGLE_OFF });
  assert.equal(arts.active(THRUSTING), false);
  assert.equal(arts.toggle(99, 99999), false, "a spell nobody learned is not toggled");
});

test("烈火剑法 waits for the server, because the server pays the mana", () => {
  const sent = [];
  const user = hero([magic(FLAMING_SWORD, 12)], 100);
  const arts = new SwordArts(() => user, (type, data) => { sent.push([type, data]); return true; }, world());
  assert.equal(arts.toggle(FLAMING_SWORD, 0), true);
  assert.deepEqual(sent[0][1], { Spell: FLAMING_SWORD, canUse: TOGGLE_ON }, "never sent as an off switch");
  assert.equal(arts.state.flamingSword, false, "not armed until S.SpellToggle says so");
  arts.receive({ ObjectID: 7, Spell: FLAMING_SWORD, CanUse: true }, 7);
  assert.equal(arts.state.flamingSword, true);
  // Spent by the swing that carried it.
  arts.spent(FLAMING_SWORD);
  assert.equal(arts.state.flamingSword, false);
  user.MP = 5;
  assert.equal(arts.toggle(FLAMING_SWORD, 99999), false, "12 mana needed, 5 held");
});

test("攻杀剑术 is armed by the server and spent by one swing", () => {
  const arts = new SwordArts(() => hero([]), () => true, world());
  arts.receive({ ObjectID: 7, Spell: SLAYING, CanUse: true }, 7);
  assert.equal(arts.state.slaying, true);
  arts.receive({ ObjectID: 8, Spell: SLAYING, CanUse: false }, 7);
  assert.equal(arts.state.slaying, true, "another player's toggle is not ours");
  arts.spent(SLAYING);
  assert.equal(arts.state.slaying, false);
  assert.deepEqual(TOGGLES, [THRUSTING, HALF_MOON, FLAMING_SWORD], "攻杀剑术 is not a switch");
});
