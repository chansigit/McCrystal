import test from "node:test";
import assert from "node:assert/strict";
import { World } from "./world.js";
import { hydraOverlay } from "./entity-presentation.js";

// Animation tables copied from the real libraries the gateway serves. 371 is the Hydra,
// whose overlay the audit verified frame by frame; 065 is ZumaStatue; 001 is a library
// whose table holds nothing but Standing and Attack1.
const LIBRARIES = {
  "Monster/371": {
    Hide: { start: 7, count: 8, skip: 0, interval: 100, reverse: true },
    Standing: { start: 64, count: 6, skip: 0, interval: 200, reverse: false },
    AttackRange1: { start: 112, count: 8, skip: 0, interval: 100, reverse: false },
    Attack1: { start: 176, count: 10, skip: 0, interval: 100, reverse: false },
    Struck: { start: 256, count: 3, skip: 0, interval: 200, reverse: false },
    Die: { start: 280, count: 15, skip: 0, interval: 100, reverse: false },
    Dead: { start: 294, count: 1, skip: 14, interval: 1000, reverse: false },
    Show: { start: 0, count: 8, skip: 0, interval: 100, reverse: false },
  },
  "Monster/065": {
    Stoned: { start: 0, count: 1, skip: 5, interval: 100 },
    Show: { start: 0, count: 6, skip: 0, interval: 100 },
    Hide: { start: 5, count: 6, skip: 0, interval: 100, reverse: true },
    Standing: { start: 48, count: 4, skip: 0, interval: 1000 },
    Walking: { start: 80, count: 6, skip: 0, interval: 100 },
    Attack1: { start: 128, count: 6, skip: 0, interval: 100 },
    Struck: { start: 176, count: 2, skip: 0, interval: 200 },
    Die: { start: 192, count: 10, skip: 0, interval: 100 },
    Dead: { start: 201, count: 1, skip: 9, interval: 1000 },
    Revive: { start: 192, count: 10, skip: 0, interval: 100, reverse: true },
  },
  "Monster/001": {
    Standing: { start: 0, count: 4, skip: 0, interval: 500 },
    Attack1: { start: 32, count: 6, skip: 0, interval: 100 },
  },
  "Monster/002": {}, // no animation table at all, so the default frame set applies
  "NPC/00": {
    Standing: { start: 0, count: 4, skip: 0, interval: 450 },
    Harvest: { start: 12, count: 10, skip: 0, interval: 200 },
  },
  "CArmour/00": {},
};

function world() {
  const w = Object.create(World.prototype);
  w.entities = new Map();
  w.failedTextures = new Set();
  w.manifests = new Map(Object.entries(LIBRARIES).map(([name, animations]) =>
    [name, { animations, frames: Array.from({ length: 1024 }, (_, i) => ({ index: i })) }]));
  w.manifest = function (library) { return this.manifests.get(library) ?? null; };
  w.texture = () => ({});
  return w;
}

test("a monster's attack runs for its own frame table, and each swing restarts", () => {
  const w = world();
  const still = { moving: false };
  const hydra = { kind: "monster", Image: 371, ObjectID: 1, attackStartedAt: 1000, attackAction: "Attack1" };
  // Attack1 is 10 frames at 100 ms. The hardcoded 600 ms window used to cut it at six.
  assert.equal(w.actionLength("Monster/371", "Attack1"), 1000);
  assert.equal(w.resolveAction(hydra, "Monster/371", still, 1900).action, "Attack1");
  assert.equal(w.resolveAction(hydra, "Monster/371", still, 2000).action, "Standing");
  assert.equal(w.frameAt("Monster/371", "Attack1", 0, 0), 176);
  assert.equal(w.frameAt("Monster/371", "Attack1", 0, 9), 185);
  assert.equal(w.frameAt("Monster/371", "Attack1", 3, 0), 206);
});

test("attack variants and ranged attacks resolve to real frames", () => {
  const w = world();
  // AttackRange1 exists on the Hydra outright, and drops to Attack1 where it does not.
  assert.equal(w.frameAt("Monster/371", "AttackRange1", 0, 0), 112);
  assert.equal(w.frameAt("Monster/001", "AttackRange1", 0, 0), 32);
  assert.equal(w.frameAt("Monster/001", "Attack3", 0, 0), 32);
  // Running has no frames anywhere but HardenRhino, so it walks instead of idling.
  assert.equal(w.frameAt("Monster/002", "Running", 0, 0), 32);
  assert.equal(w.frameAt("Monster/002", "Walking", 0, 0), 32);
  // A player library carries no table, so its own defaults still decide.
  assert.equal(w.frameAt("CArmour/00", "Running", 0, 0), 80);
  assert.equal(w.frameAt("CArmour/00", "Attack1", 0, 0), 136);
  assert.equal(w.frameAt("CArmour/00", "Attack1", 0, 0, 808), 944);
});

test("Struck and Revive only play where the library declares them", () => {
  const w = world();
  const still = { moving: false };
  assert.equal(w.declaresAction("Monster/371", "Struck"), true);
  assert.equal(w.declaresAction("Monster/001", "Struck"), false);
  assert.equal(w.declaresAction("Monster/002", "Struck"), true);
  assert.equal(w.declaresAction("CArmour/00", "Struck"), false);
  const struck = { kind: "monster", Image: 371, struckStartedAt: 500 };
  assert.equal(w.resolveAction(struck, "Monster/371", still, 800).action, "Struck");
  assert.equal(w.resolveAction({ ...struck, Image: 1 }, "Monster/001", still, 800).action, "Standing");
  const revived = { kind: "monster", Image: 2, reviveStartedAt: 0 };
  assert.equal(w.resolveAction(revived, "Monster/002", still, 500).action, "Revive");
  // The default Revive is Die played backwards, so it must count down from the corpse.
  assert.equal(w.frameAt("Monster/002", "Revive", 0, 0), 144);
  assert.equal(w.frameAt("Monster/002", "Revive", 0, 9), 135);
});

test("NPC idle cycling still drives its own action and start time", () => {
  const w = world();
  const npc = { kind: "npc", Image: 0 };
  const resolved = w.resolveAction(npc, "NPC/00", { moving: false }, 4000);
  assert.ok(["Standing", "Harvest"].includes(resolved.action));
  assert.equal(resolved.startedAt, 4000);
  assert.equal(npc.npcIdleStartedAt, 4000);
});

test("the Hydra emerges, submerges in reverse and leaves the map, overlay intact", () => {
  const w = world();
  const hydra = { kind: "monster", Image: 371, ObjectID: 9, Direction: 0, visibilityAction: "Show" };
  w.entities.set(9, hydra);
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 1000), 0);
  assert.equal(hydraOverlay(0), 400);
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 1300), 3);
  assert.equal(hydraOverlay(3), 403);
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 1700), 7);
  assert.equal(hydra.visibilityAction, "Show");
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 1800), 7);
  assert.equal(hydra.visibilityAction, null);
  assert.equal(w.entities.has(9), true);
  // Hide is the same eight frames reversed, and the Hydra leaves the map at the end.
  hydra.visibilityAction = "Hide";
  hydra.visibilityStartedAt = null;
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 2000), 7);
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 2300), 4);
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 2700), 0);
  assert.equal(w.entities.has(9), true);
  assert.equal(w.visibilityFrame(hydra, "Monster/371", 2800), 0);
  assert.equal(w.entities.has(9), false);
  assert.equal(hydra.stoned, undefined);
});

test("a statue freezes into its Stoned pose instead of leaving the map", () => {
  const w = world();
  const statue = { kind: "monster", Image: 65, ObjectID: 4, Direction: 5, visibilityAction: "Hide" };
  w.entities.set(4, statue);
  // Hide is six frames counting back from 5 + direction * 6, and Stoned is the one
  // frame that strip ends on.
  assert.equal(w.visibilityFrame(statue, "Monster/065", 0), 35);
  assert.equal(w.visibilityFrame(statue, "Monster/065", 300), 32);
  assert.equal(w.visibilityFrame(statue, "Monster/065", 600), 30);
  assert.equal(w.entities.has(4), true);
  assert.equal(statue.stoned, true);
  assert.equal(w.resolveAction(statue, "Monster/065", { moving: false }, 800).action, "Stoned");
  assert.equal(w.frameAt("Monster/065", "Stoned", 5, 0), 30);
  statue.visibilityAction = "Show";
  statue.visibilityStartedAt = null;
  assert.equal(w.visibilityFrame(statue, "Monster/065", 800), 30);
  assert.equal(w.visibilityFrame(statue, "Monster/065", 1400), 35);
  assert.equal(statue.stoned, false);
});

test("a monster with no Show or Hide frames drops the action and stays put", () => {
  const w = world();
  const monster = { kind: "monster", Image: 1, ObjectID: 6, visibilityAction: "Hide" };
  w.entities.set(6, monster);
  assert.equal(w.visibilityFrame(monster, "Monster/001", 0), -1);
  assert.equal(monster.visibilityAction, null);
  assert.equal(w.entities.has(6), true);
});

test("a death overlay stops when the death animation does", () => {
  // The Scarecrow's fire is drawn on MirAction.Die. Native leaves Die for Dead once the
  // animation ends, so the fire goes out; reporting only the frame and not the action
  // left it burning on the corpse forever.
  const w = world();
  const scarecrow = { kind: "monster", Image: 65, ObjectID: 1, Direction: 0, Dead: true };
  // Monster/065's Die is ten frames at 100 ms.
  w.dyingFrame(scarecrow, "Monster/065", 0, 1000);
  assert.equal(scarecrow.dyingAction, "Die");
  assert.equal(scarecrow.frameStep, 0);
  w.dyingFrame(scarecrow, "Monster/065", 0, 1400);
  assert.equal(scarecrow.dyingAction, "Die");
  assert.equal(scarecrow.frameStep, 4); // and the step advances, rather than sticking
  w.dyingFrame(scarecrow, "Monster/065", 0, 2500);
  assert.equal(scarecrow.dyingAction, "Dead");
  assert.equal(scarecrow.frameStep, 0);
  w.dyingFrame(scarecrow, "Monster/065", 0, 60000);
  assert.equal(scarecrow.dyingAction, "Dead"); // and stays there
});
