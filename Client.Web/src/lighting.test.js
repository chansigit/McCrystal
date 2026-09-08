import test from "node:test";
import assert from "node:assert/strict";
import {
  LIGHT_SETTING, LIGHT_SIZES, effectiveSetting, needsDarkness, darknessColour,
  lightSize, lightColour, lightsFor,
} from "./lighting.js";

test("a map set to Normal follows the server clock and anything else overrides it", () => {
  // GameScene.cs:10589 -- Lights == Normal ? Scene.Lights : Lights.
  assert.equal(effectiveSetting(LIGHT_SETTING.Normal, LIGHT_SETTING.Night), LIGHT_SETTING.Night);
  assert.equal(effectiveSetting(LIGHT_SETTING.Normal, LIGHT_SETTING.Day), LIGHT_SETTING.Day);
  // A DARK map stays dark at noon, which is what the 165 dark maps in this pack rely on.
  assert.equal(effectiveSetting(LIGHT_SETTING.Night, LIGHT_SETTING.Day), LIGHT_SETTING.Night);
  // Before the first TimeOfDay arrives there is no clock, and the safe reading is daylight
  // rather than a black screen.
  assert.equal(effectiveSetting(LIGHT_SETTING.Normal, undefined), LIGHT_SETTING.Day);
});

test("only daylight skips the overlay entirely", () => {
  assert.equal(needsDarkness(LIGHT_SETTING.Day), false);
  assert.equal(needsDarkness(LIGHT_SETTING.Night), true);
  assert.equal(needsDarkness(LIGHT_SETTING.Dawn), true);
  assert.equal(needsDarkness(LIGHT_SETTING.Evening), true);
});

test("the ambient colour is native's switch, MapDarkLight included", () => {
  assert.equal(darknessColour(LIGHT_SETTING.Night, 0), 0x000000);
  assert.equal(darknessColour(LIGHT_SETTING.Night, 1), 0x141414);
  assert.equal(darknessColour(LIGHT_SETTING.Night, 2), 0x778899); // LightSlateGray
  assert.equal(darknessColour(LIGHT_SETTING.Night, 4), 0xdaa520); // Goldenrod
  // An unnamed variant falls through to plain black, not to a missing value.
  assert.equal(darknessColour(LIGHT_SETTING.Night, 9), 0x000000);
  assert.equal(darknessColour(LIGHT_SETTING.Evening), 0x323232);
  assert.equal(darknessColour(LIGHT_SETTING.Dawn), 0x323232);
  assert.equal(darknessColour(LIGHT_SETTING.Day), 0xffffff);
});

test("a light byte splits into a reach and a brightness", () => {
  // light % 15 picks the ellipse, and CreateLights builds from LightSizes[1..10], so the
  // smallest light a lit actor can have is the second row of the table.
  assert.deepEqual(lightSize(0), LIGHT_SIZES[1]);
  assert.deepEqual(lightSize(2), LIGHT_SIZES[3]);
  assert.deepEqual(lightSize(47), LIGHT_SIZES[3]); // 47 % 15 === 2
  // Beyond the table native clamps rather than reaching past the end.
  assert.deepEqual(lightSize(14), LIGHT_SIZES[10]);
  assert.deepEqual(lightSize(9), LIGHT_SIZES[10]);
});

test("a player's brightness is what they are carrying", () => {
  // light / 15: nothing, a lamp, a candle, a torch, then a peddler's torch.
  assert.equal(lightColour(3, "player"), 0x3c3c3c);
  assert.equal(lightColour(15 + 3, "player"), 0x787878);
  assert.equal(lightColour(30 + 3, "player"), 0xb4b4b4);
  assert.equal(lightColour(45 + 3, "player"), 0xf0f0f0);
  assert.equal(lightColour(60 + 3, "player"), 0xffffff);
  // A merchant is a fixed dim glow, and everything else burns white.
  assert.equal(lightColour(10, "npc"), 0x787878);
  assert.equal(lightColour(3, "monster"), 0xffffff);
});

test("a torch reaches the local player's own light, which the server never sends", async () => {
  const { refreshStats, USER_MIN_LIGHT } = await import("./stats.js");
  const torch = { ItemIndex: 1, Type: 12, Light: 4, Stats: {}, Durability: 100, Shape: 0 };
  const infos = new Map([[1, torch]]);
  const bare = { Class: 0, Level: 10, Inventory: [], Equipment: [] };
  assert.equal(refreshStats(bare, infos, null).light, USER_MIN_LIGHT,
    "carrying nothing still sees a little way");
  const lit = { ...bare, Equipment: [{ ItemIndex: 1, CurrentDura: 100, AddedStats: {} }] };
  assert.equal(refreshStats(lit, infos, null).light, 4);
});

test("an unlit actor lights nothing, and only the player lights the ground once dead", () => {
  const user = { kind: "player", Light: 48, Dead: true };
  const monster = { kind: "monster", Light: 3, Dead: true };
  const alive = { kind: "monster", Light: 3 };
  const dark = { kind: "monster", Light: 0 };
  const npc = { kind: "npc", Light: 10 };
  const lights = lightsFor([user, monster, alive, dark, npc], user);
  assert.deepEqual(lights.map((l) => l.entity), [user, alive, npc],
    "the dead monster and the unlit one drop out, the dead player does not");
  assert.equal(lights[0].colour, 0xf0f0f0);
  assert.deepEqual(lights[1].size, LIGHT_SIZES[4]);
});
