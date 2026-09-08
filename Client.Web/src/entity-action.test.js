import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_FALLBACKS, actionChain, resolveFrames, hasDeclaredAction, animationStep,
  actionLength, advanceAction, liveAction, attackAction, rangeAttackAction,
  manualDrawOffset, MONSTER_DEFAULTS, PLAYER_DEFAULTS, NPC_DEFAULTS,
  REMOVED_ON_HIDE, STONED_ON_HIDE, stonedAtSpawn, playerAttackAction,
} from "./entity-action.js";
import { frameIndex } from "./entity-presentation.js";

// Read from Data/Monster/371.Lib, whose overlay the audit verified frame by frame.
const hydra = {
  Hide: { start: 7, count: 8, skip: 0, interval: 100, reverse: true },
  Standing: { start: 64, count: 6, skip: 0, interval: 200, reverse: false },
  AttackRange1: { start: 112, count: 8, skip: 0, interval: 100, reverse: false },
  Attack1: { start: 176, count: 10, skip: 0, interval: 100, reverse: false },
  Struck: { start: 256, count: 3, skip: 0, interval: 200, reverse: false },
  Die: { start: 280, count: 15, skip: 0, interval: 100, reverse: false },
  Dead: { start: 294, count: 1, skip: 14, interval: 1000, reverse: false },
  Show: { start: 0, count: 8, skip: 0, interval: 100, reverse: false },
};
// Data/Monster/001.Lib: a table with nothing but Standing and Attack1.
const sparse = {
  Standing: { start: 0, count: 4, skip: 0, interval: 500 },
  Attack1: { start: 32, count: 6, skip: 0, interval: 100 },
};

const lookup = (animations, library) => ({
  length: (action) => actionLength(resolveFrames(animations, library, action)),
  declares: (action) => hasDeclaredAction(animations, library, action),
});

test("ranged, pushed, special and skeleton actions fall back the way native does", () => {
  // MonsterObject.SetAction, Client/MirObjects/MonsterObject.cs:564-595.
  assert.deepEqual(ACTION_FALLBACKS.AttackRange1, ["Attack1"]);
  assert.deepEqual(ACTION_FALLBACKS.Pushed, ["Walking"]);
  assert.deepEqual(ACTION_FALLBACKS.Special, ["Attack1"]);
  assert.deepEqual(ACTION_FALLBACKS.Skeleton, ["Dead"]);
  assert.deepEqual(actionChain("AttackRange3"), ["AttackRange3", "Attack3", "Attack1"]);
  const table = { Standing: sparse.Standing, Attack1: sparse.Attack1, Dead: hydra.Dead };
  assert.equal(resolveFrames(table, "Monster/001", "AttackRange2"), sparse.Attack1);
  assert.equal(resolveFrames(table, "Monster/001", "Special"), sparse.Attack1);
  assert.equal(resolveFrames(table, "Monster/001", "Skeleton"), hydra.Dead);
  // The hydra owns AttackRange1 outright, so no fallback is taken.
  assert.equal(resolveFrames(hydra, "Monster/371", "AttackRange1"), hydra.AttackRange1);
});

test("Running falls back to Walking instead of freezing in the idle pose", () => {
  // Only HardenRhino declares Running across all 510 monster libraries.
  const table = { Standing: sparse.Standing, Walking: MONSTER_DEFAULTS.Walking };
  assert.equal(resolveFrames(table, "Monster/002", "Running"), MONSTER_DEFAULTS.Walking);
  assert.notEqual(resolveFrames(table, "Monster/002", "Running"), sparse.Standing);
  // A player library carries no table at all, so its own Running default still wins.
  assert.equal(resolveFrames({}, "CArmour/00", "Running"), PLAYER_DEFAULTS.Running);
});

test("the default frame set is only reachable for libraries with no table", () => {
  // Native reads BodyLibrary.Frames ?? FrameSet.DefaultMonster (MonsterObject.cs:504).
  assert.equal(hasDeclaredAction(hydra, "Monster/371", "Struck"), true);
  assert.equal(hasDeclaredAction(hydra, "Monster/371", "Revive"), false);
  assert.equal(hasDeclaredAction(sparse, "Monster/001", "Struck"), false);
  assert.equal(hasDeclaredAction({}, "Monster/002", "Struck"), true);
  assert.equal(hasDeclaredAction({}, "Monster/002", "Revive"), true);
  // A player or an NPC must never inherit the monster Struck or Revive layout.
  assert.equal(hasDeclaredAction({}, "CArmour/00", "Struck"), false);
  assert.equal(hasDeclaredAction({}, "NPC/00", "Struck"), false);
  assert.equal(NPC_DEFAULTS.Standing.interval, 450);
});

test("one-shot actions hold their last frame while Standing cycles", () => {
  assert.equal(animationStep(hydra.Attack1, "Attack1", 0), 0);
  assert.equal(animationStep(hydra.Attack1, "Attack1", 450), 4);
  assert.equal(animationStep(hydra.Attack1, "Attack1", 990), 9);
  assert.equal(animationStep(hydra.Attack1, "Attack1", 5000), 9);
  assert.equal(animationStep(hydra.Standing, "Standing", 200), 1);
  assert.equal(animationStep(hydra.Standing, "Standing", 1200), 0);
  // A step spreads the whole walk cycle over the move, not over the frame interval.
  assert.equal(animationStep(MONSTER_DEFAULTS.Walking, "Walking", 0, 646), 0);
  assert.equal(animationStep(MONSTER_DEFAULTS.Walking, "Walking", 323, 646), 3);
  assert.equal(animationStep(MONSTER_DEFAULTS.Walking, "Walking", 645, 646), 5);
});

test("two monsters of the same image on the same clock animate independently", () => {
  // The bug this replaces: the frame came from performance.now() modulo, so every
  // monster of an image sat on the same frame at the same instant.
  const first = { kind: "monster" }, second = { kind: "monster" };
  const early = advanceAction(first, { action: "Attack1", startedAt: 1000 }, 1000);
  const late = advanceAction(second, { action: "Attack1", startedAt: 1450 }, 1500);
  assert.equal(early, 0);
  assert.equal(late, 50);
  assert.equal(animationStep(hydra.Attack1, "Attack1", early), 0);
  assert.equal(animationStep(hydra.Attack1, "Attack1", late), 0);
  assert.equal(advanceAction(first, { action: "Attack1", startedAt: 1000 }, 1650), 650);
  assert.equal(animationStep(hydra.Attack1, "Attack1", 650), 6);
});

test("a repeated action restarts its phase instead of continuing the old one", () => {
  const monster = { kind: "monster" };
  advanceAction(monster, { action: "Attack1", startedAt: 1000 }, 1000);
  assert.equal(advanceAction(monster, { action: "Attack1", startedAt: 1000 }, 1300), 300);
  // A second swing 300 ms in starts its animation from frame zero, not mid-swing.
  assert.equal(advanceAction(monster, { action: "Attack1", startedAt: 1300 }, 1300), 0);
  assert.equal(monster.actionStartedAt, 1300);
  // Standing has no timestamp of its own, so it anchors where the swing ended.
  assert.equal(advanceAction(monster, { action: "Standing" }, 2300), 0);
  assert.equal(advanceAction(monster, { action: "Standing" }, 2800), 500);
});

test("a monster swing lasts as long as its own frame table, not a fixed 600 ms", () => {
  const still = { moving: false };
  const hydraLookup = lookup(hydra, "Monster/371");
  const monster = { kind: "monster", attackStartedAt: 0, attackAction: "Attack1" };
  // Monster/371 Attack1 is 10 frames at 100 ms; the old 600 ms window cut it at six.
  assert.equal(hydraLookup.length("Attack1"), 1000);
  assert.equal(liveAction(monster, still, 900, hydraLookup).action, "Attack1");
  assert.equal(liveAction(monster, still, 1000, hydraLookup).action, "Standing");
  // A player keeps the native 600 ms regardless of what its library would say.
  const player = { kind: "player", attackStartedAt: 0, attackAction: "Attack1" };
  assert.equal(liveAction(player, still, 599, hydraLookup).action, "Attack1");
  assert.equal(liveAction(player, still, 600, hydraLookup).action, "Standing");
});

test("Struck plays its own animation, behind an attack and never mid-step", () => {
  const still = { moving: false }, walking = { moving: true };
  const hydraLookup = lookup(hydra, "Monster/371");
  const monster = { kind: "monster", struckStartedAt: 0 };
  assert.equal(hydraLookup.length("Struck"), 600);
  assert.deepEqual(liveAction(monster, still, 100, hydraLookup),
    { action: "Struck", startedAt: 0 });
  assert.equal(liveAction(monster, still, 600, hydraLookup).action, "Standing");
  assert.equal(liveAction(monster, walking, 100, hydraLookup).action, "Walking");
  assert.equal(liveAction({ ...monster, attackStartedAt: 0, attackAction: "Attack1" },
    still, 100, hydraLookup).action, "Attack1");
  // Monster/001 declares no Struck, so nothing is invented for it.
  assert.equal(liveAction(monster, still, 100, lookup(sparse, "Monster/001")).action, "Standing");
});

test("Revive plays for libraries that declare it and outranks everything else", () => {
  const still = { moving: false };
  const withRevive = { ...hydra, Revive: { start: 280, count: 15, skip: 0, interval: 100, reverse: true } };
  const reviveLookup = lookup(withRevive, "Monster/010");
  const monster = { kind: "monster", reviveStartedAt: 0, attackStartedAt: 1400, attackAction: "Attack1" };
  assert.equal(reviveLookup.length("Revive"), 1500);
  assert.equal(liveAction(monster, still, 100, reviveLookup).action, "Revive");
  assert.equal(liveAction(monster, still, 1499, reviveLookup).action, "Revive");
  assert.equal(liveAction(monster, still, 1500, reviveLookup).action, "Attack1");
  // 345 of 421 tabled monster libraries carry Revive; the rest must not fake one.
  assert.equal(liveAction({ kind: "monster", reviveStartedAt: 0 }, still, 100,
    lookup(hydra, "Monster/371")).action, "Standing");
});

test("a stoned statue idles in its Stoned pose", () => {
  const table = { ...hydra, Stoned: { start: 300, count: 1, skip: 0, interval: 1000 } };
  const stoned = { kind: "monster", stoned: true };
  assert.equal(liveAction(stoned, { moving: false }, 0, lookup(table, "Monster/065")).action, "Stoned");
  assert.equal(resolveFrames(table, "Monster/065", "Stoned"), table.Stoned);
  // Without a Stoned block the statue simply stands, rather than vanishing.
  assert.equal(resolveFrames(hydra, "Monster/371", "Stoned"), hydra.Standing);
});

test("attack variants follow the packet Type, and players always swing Attack1", () => {
  const monster = { kind: "monster" }, player = { kind: "player" };
  assert.equal(attackAction(monster, 0), "Attack1");
  assert.equal(attackAction(monster, 1), "Attack2");
  assert.equal(attackAction(monster, 4), "Attack5");
  assert.equal(attackAction(monster, 9), "Attack1");
  assert.equal(attackAction(player, 3), "Attack1");
  assert.equal(rangeAttackAction(monster, 0), "AttackRange1");
  assert.equal(rangeAttackAction(monster, 1), "AttackRange2");
  assert.equal(rangeAttackAction(monster, 2), "AttackRange3");
  assert.equal(rangeAttackAction(player, 2), "AttackRange1");
  // Selecting a variant must not blank monsters that only own Attack1.
  assert.equal(resolveFrames(sparse, "Monster/001", "Attack2"), sparse.Attack1);
});

test("EvilMir and the siege gates carry their native draw offsets", () => {
  // MonsterObject.ManualLocationOffset, Client/MirObjects/MonsterObject.cs:19-42.
  assert.deepEqual(manualDrawOffset({ kind: "monster", Image: 900 }), { x: -21, y: -15 });
  assert.deepEqual(manualDrawOffset({ kind: "monster", Image: 955 }), { x: -45, y: 7 });
  assert.deepEqual(manualDrawOffset({ kind: "monster", Image: 953 }), { x: -10, y: 0 });
  assert.deepEqual(manualDrawOffset({ kind: "monster", Image: 371 }), { x: 0, y: 0 });
  assert.deepEqual(manualDrawOffset({ kind: "player", Image: 900 }), { x: 0, y: 0 });
});

test("the Hydra keeps its exact emergence and submersion frames", () => {
  // Show 0..7 forward, Hide 7..0 reversed, matching Data/Monster/371.Lib.
  assert.deepEqual([0, 1, 7].map((step) => frameIndex(hydra.Show, 0, step)), [0, 1, 7]);
  assert.deepEqual([0, 1, 7].map((step) => frameIndex(hydra.Hide, 0, step)), [7, 6, 0]);
  assert.equal(REMOVED_ON_HIDE.has(371), true);
  assert.equal(STONED_ON_HIDE.has(371), false);
  // The statue family freezes instead of leaving the map.
  assert.equal(STONED_ON_HIDE.has(65), true);
  assert.equal(REMOVED_ON_HIDE.has(65), false);
  assert.equal(REMOVED_ON_HIDE.has(10), true);
});

test("a statue that arrives already stoned says so in its spawn packet", () => {
  // Client/MirObjects/MonsterObject.cs:239-253 reads Extra into Stoned before the
  // first action is chosen, so the statue never stands up and animates.
  assert.equal(stonedAtSpawn({ Image: 65, Extra: true }), true); // ZumaStatue
  assert.equal(stonedAtSpawn({ Image: 65, Extra: false }), false);
  assert.equal(stonedAtSpawn({ Image: 65 }), false); // absent reads as awake
  assert.equal(stonedAtSpawn({ Image: 4, Extra: true }), false); // a deer is never stoned
  // Native's spawn switch is shorter than its end-of-Hide list: neither red zuma is in it.
  assert.equal(stonedAtSpawn({ Image: 67, Extra: true }), false); // RedThunderZuma
  assert.equal(stonedAtSpawn({ Image: 211, Extra: true }), false); // FrozenRedZuma
  assert.equal(STONED_ON_HIDE.has(67) && STONED_ON_HIDE.has(211), true);
});

test("a player only rolls for a second swing at empty air with shift held", () => {
  // PlayerObject.cs:1069-1072: shift and no target, one in five is Attack3.
  assert.equal(playerAttackAction(false, false, () => 0), "Attack1"); // no shift, no roll
  assert.equal(playerAttackAction(true, true, () => 0), "Attack1"); // a target, no roll
  assert.equal(playerAttackAction(true, false, () => 0.0), "Attack3"); // roll 0 of 100
  assert.equal(playerAttackAction(true, false, () => 0.19), "Attack3"); // 19, still under
  assert.equal(playerAttackAction(true, false, () => 0.20), "Attack1"); // 20, the cutoff
  assert.equal(playerAttackAction(true, false, () => 0.99), "Attack1");
});
