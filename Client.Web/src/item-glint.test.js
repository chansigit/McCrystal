import test from "node:test";
import assert from "node:assert/strict";
import { glintStyle, glintColour, glintPhase, GLINT_PERIOD } from "./item-glint.js";

test("the grade colours are native's own", () => {
  // GameScene.cs:6797 -- Common yellow, Rare deep sky blue, Legendary dark orange,
  // Mythical plum, Heroic red. Grade 0 (None) is the warm default the glint has always used.
  assert.equal(glintColour(1), 0xffe000);
  assert.equal(glintColour(2), 0x00bfff);
  assert.equal(glintColour(3), 0xff8c00);
  assert.equal(glintColour(4), 0xdda0dd);
  assert.equal(glintColour(5), 0xff2d2d);
  assert.equal(glintColour(0), 0xffe9a8);
  // An absent or nonsense grade is the default rather than a crash or a black star.
  assert.equal(glintColour(undefined), 0xffe9a8);
  assert.equal(glintColour(99), 0xffe9a8);
});

test("a rarer item is a bigger, brighter star", () => {
  const common = glintStyle(0, 0.3), heroic = glintStyle(5, 0.3);
  assert.ok(heroic.arm > common.arm);
  assert.ok(heroic.core > common.core);
  assert.ok(heroic.alpha > common.alpha);
  // Only from Rare up does it get a halo; a plain drop stays a small star.
  assert.equal(glintStyle(1, 0.3).halo, 0);
  assert.ok(glintStyle(2, 0.3).halo > 0);
});

test("it is lit for more of the cycle than it is dark", () => {
  // The first version was lit for 28% of 1800ms, so an item spent nearly a second and a
  // half invisible -- long enough to walk past it.
  let lit = 0;
  for (let i = 0; i < 100; i++) if (glintStyle(0, i / 100).alpha > 0) lit++;
  assert.ok(lit > 50, `lit for ${lit}% of the cycle`);
  // Brightest in the middle of the lit part, and fully out at the ends.
  assert.equal(glintStyle(0, 0).alpha, 0);
  assert.equal(glintStyle(0, 0.99).alpha, 0);
  assert.ok(glintStyle(0, 0.3).alpha > glintStyle(0, 0.05).alpha);
});

test("two items never flash in lockstep", () => {
  assert.notEqual(glintPhase(0, 1), glintPhase(0, 2));
  const p = glintPhase(0, 7);
  assert.ok(p >= 0 && p < 1);
  assert.equal(glintPhase(GLINT_PERIOD, 7), p, "the cycle repeats on its period");
  assert.ok(glintPhase(0, undefined) >= 0, "an item with no id still blinks");
});
