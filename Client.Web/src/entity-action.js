import { locomotionFrame } from "./footsteps.js";

// FrameSet.DefaultMonster / DefaultNPC (Client/MirObjects/Frames.cs:23-32,17-21).
// Native only reaches for these when a library carries no animation table at all
// (MonsterObject.SetAction: `BodyLibrary.Frames ?? FrameSet.DefaultMonster`), so
// hasDeclaredAction below refuses to invent an action a tabled library omits.
export const MONSTER_DEFAULTS = {
  Standing: { start: 0, count: 4, skip: 0, interval: 500 },
  Walking: { start: 32, count: 6, skip: 0, interval: 100 },
  Attack1: { start: 80, count: 6, skip: 0, interval: 100 },
  Struck: { start: 128, count: 2, skip: 0, interval: 200 },
  Die: { start: 144, count: 10, skip: 0, interval: 100 },
  Dead: { start: 153, count: 1, skip: 9, interval: 1000 },
  Revive: { start: 144, count: 10, skip: 0, interval: 100, reverse: true },
};
export const NPC_DEFAULTS = {
  Standing: { start: 0, count: 4, skip: 0, interval: 450 },
  Harvest: { start: 12, count: 10, skip: 0, interval: 200 },
};
// FrameSet.Player in full (Client/MirObjects/Frames.cs:155-198). A player library carries
// no table of its own, so this is the only source of a player's frames. The Archer's
// bow actions and the Assassin's Sneek and DashAttack read a different body set and are
// left out until that set is served.
export const PLAYER_DEFAULTS = {
  Standing: { start: 0, count: 4, skip: 0, interval: 500, effect: { start: 0, count: 8, skip: 0, interval: 250 } },
  Walking: { start: 32, count: 6, skip: 0, interval: 100, effect: { start: 64, count: 6, skip: 0, interval: 100 } },
  Running: { start: 80, count: 6, skip: 0, interval: 100, effect: { start: 112, count: 6, skip: 0, interval: 100 } },
  Stance: { start: 128, count: 1, skip: 0, interval: 1000, effect: { start: 160, count: 1, skip: 0, interval: 1000 } },
  Stance2: { start: 300, count: 1, skip: 5, interval: 1000, effect: { start: 332, count: 1, skip: 5, interval: 1000 } },
  Attack1: { start: 136, count: 6, skip: 0, interval: 100, effect: { start: 168, count: 6, skip: 0, interval: 100 } },
  Attack2: { start: 184, count: 6, skip: 0, interval: 100, effect: { start: 216, count: 6, skip: 0, interval: 100 } },
  Attack3: { start: 232, count: 8, skip: 0, interval: 100, effect: { start: 264, count: 8, skip: 0, interval: 100 } },
  Attack4: { start: 416, count: 6, skip: 0, interval: 100, effect: { start: 448, count: 6, skip: 0, interval: 100 } },
  Spell: { start: 296, count: 6, skip: 0, interval: 100, effect: { start: 328, count: 6, skip: 0, interval: 100 } },
  Harvest: { start: 344, count: 2, skip: 0, interval: 300, effect: { start: 376, count: 2, skip: 0, interval: 300 } },
  Struck: { start: 360, count: 3, skip: 0, interval: 100, effect: { start: 392, count: 3, skip: 0, interval: 100 } },
  Die: { start: 384, count: 4, skip: 0, interval: 100, effect: { start: 416, count: 4, skip: 0, interval: 100 } },
  Dead: { start: 387, count: 1, skip: 3, interval: 1000, effect: { start: 419, count: 1, skip: 3, interval: 1000 } },
  Revive: { start: 384, count: 4, skip: 0, interval: 100, reverse: true, effect: { start: 416, count: 4, skip: 0, interval: 100 } },
  Mine: { start: 184, count: 6, skip: 0, interval: 100, effect: { start: 216, count: 6, skip: 0, interval: 100 } },
  Lunge: { start: 139, count: 1, skip: 5, interval: 1000, effect: { start: 300, count: 1, skip: 5, interval: 1000 } },
  MountStanding: { start: 416, count: 4, skip: 0, interval: 500, effect: { start: 448, count: 4, skip: 0, interval: 500 } },
  MountWalking: { start: 448, count: 8, skip: 0, interval: 100, effect: { start: 480, count: 8, skip: 0, interval: 500 } },
  MountRunning: { start: 512, count: 6, skip: 0, interval: 100, effect: { start: 544, count: 6, skip: 0, interval: 100 } },
  MountStruck: { start: 560, count: 3, skip: 0, interval: 100, effect: { start: 592, count: 3, skip: 0, interval: 100 } },
  MountAttack: { start: 584, count: 6, skip: 0, interval: 100, effect: { start: 616, count: 6, skip: 0, interval: 100 } },
};

export function defaultFrames(library) {
  if (library.startsWith("CArmour/")) return PLAYER_DEFAULTS;
  if (library.startsWith("NPC/")) return NPC_DEFAULTS;
  return MONSTER_DEFAULTS;
}

// MonsterObject.SetAction's own fallbacks (Client/MirObjects/MonsterObject.cs:564-595):
// ranged attacks drop to their melee twin, Pushed borrows Walking, Special borrows
// Attack1 and Skeleton borrows Dead. Two entries go beyond native on purpose:
//   * Attack2..Attack5 drop to Attack1. Native leaves Frame null there and the monster
//     stops being drawn at all, which is not worth copying, and without it selecting an
//     attack variant by packet Type would regress monsters that lack the variant.
//   * Running drops to Walking. Only HardenRhino declares Running in the whole game,
//     so every other running monster otherwise slides along in its idle pose.
export const ACTION_FALLBACKS = {
  AttackRange1: ["Attack1"],
  AttackRange2: ["Attack2", "Attack1"],
  AttackRange3: ["Attack3", "Attack1"],
  Attack2: ["Attack1"],
  Attack3: ["Attack1"],
  Attack4: ["Attack1"],
  Attack5: ["Attack1"],
  Special: ["Attack1"],
  Skeleton: ["Dead"],
  Pushed: ["Walking"],
  Running: ["Walking"],
  Stoned: ["Standing"],
};

export function actionChain(action) {
  return [action, ...(ACTION_FALLBACKS[action] || [])];
}

// Resolve an action against a library's own table first, then the family defaults,
// walking the native fallback chain through each in turn.
export function resolveFrames(animations, library, action) {
  const defaults = defaultFrames(library);
  const chain = actionChain(action);
  for (const name of chain) if (animations?.[name]) return animations[name];
  for (const name of chain) if (defaults[name]) return defaults[name];
  return animations?.Standing || defaults.Standing || MONSTER_DEFAULTS.Standing;
}

// True only when this library really owns the action: either its own table declares
// it, or the library has no table and native would have used the default frame set.
export function hasDeclaredAction(animations, library, action) {
  if (animations && Object.keys(animations).length) return !!animations[action];
  return !!defaultFrames(library)[action];
}

// PlayerObject.StanceDelay, and MirClass.Archer (Shared/Enums.cs).
// A mounted player swaps five of its actions for the mount's own
// (Client/MirObjects/PlayerObject.cs:914-933). Everything else keeps its usual frames.
export const MOUNT_ACTIONS = {
  Standing: "MountStanding", Walking: "MountWalking", Running: "MountRunning",
  Struck: "MountStruck", Attack1: "MountAttack",
};
export const STANCE_DELAY = 2500;
const ARCHER = 4;

// Standing and the terminal poses cycle; everything else is a one-shot that holds
// its last frame, the way native stops advancing FrameIndex at Frame.Count.
export const LOOPING_ACTIONS = new Set(["Standing", "Stoned", "Dead", "Skeleton"]);
export const MOVING_ACTIONS = new Set(["Walking", "Running", "Pushed"]);

export function animationStep(frame, action, elapsed, duration) {
  const count = Math.max(1, frame.count || 1);
  if (MOVING_ACTIONS.has(action))
    return locomotionFrame(elapsed / Math.max(1, duration || 1), count);
  const step = Math.floor(Math.max(0, elapsed) / Math.max(50, frame.interval));
  return LOOPING_ACTIONS.has(action) ? step % count : Math.min(count - 1, step);
}

export function actionLength(frame) {
  return Math.max(1, frame.count || 1) * Math.max(50, frame.interval);
}

// Native pops one queued action at a time and zeroes FrameIndex as it does
// (MonsterObject.cs:471-641). The browser keeps the same information as a start
// timestamp, so every actor's phase is measured from when its own action began
// instead of from a shared wall clock.
export function advanceAction(entity, resolved, now) {
  // An action with no timestamp of its own, Standing above all, anchors where the
  // previous one ended and then keeps running; one that carries a timestamp restarts
  // whenever that timestamp moves, so a second swing plays from frame zero.
  if (entity.currentAction !== resolved.action ||
      (resolved.startedAt != null && resolved.startedAt !== entity.actionStartedAt)) {
    entity.currentAction = resolved.action;
    entity.actionStartedAt = resolved.startedAt ?? now;
  }
  return Math.max(0, now - entity.actionStartedAt);
}

// Which action an actor is in right now, and when that action started, given a
// library's own frame lengths. `length(action)` is the action's run time in ms and
// `declares(action)` says whether this library really owns it. Native reads the same
// thing off ActionFeed and CurrentAction (MonsterObject.cs:471-641); NPC idle cycling
// is picked by the caller, since it has its own random choice.
export function liveAction(entity, position, now, { length, declares }) {
  if (entity.reviveStartedAt != null && declares("Revive") &&
      now - entity.reviveStartedAt < length("Revive"))
    return { action: "Revive", startedAt: entity.reviveStartedAt };
  if (now < (entity.harvestUntil || 0))
    return { action: "Harvest", startedAt: entity.harvestStartedAt, duration: 600 };
  if (now < (entity.castUntil || 0))
    return { action: "Spell", startedAt: entity.castStartedAt, duration: 600 };
  const attack = entity.attackAction || "Attack1";
  // A player's swing resolves to the native 600 ms. A monster's lasts exactly as long
  // as its own frame table says instead of being cut off at a hardcoded 600 ms, which
  // was clipping 124 of the 376 monsters that carry an Attack1 mid-swing.
  const attackDuration = entity.kind === "monster" ? length(attack) : 600;
  if (entity.attackStartedAt != null && now - entity.attackStartedAt < attackDuration)
    return { action: attack, startedAt: entity.attackStartedAt, duration: attackDuration };
  // Struck waits for a swing to finish and never interrupts a step, the closest a
  // window model gets to native queueing it behind whatever is already playing.
  if (entity.kind !== "npc" && entity.struckStartedAt != null && !position.moving &&
      declares("Struck") && now - entity.struckStartedAt < length("Struck"))
    return { action: "Struck", startedAt: entity.struckStartedAt };
  if (position.moving)
    return { action: entity.running ? "Running" : "Walking",
      startedAt: entity.movedAt, duration: entity.moveDuration };
  // For 2.5 seconds after a swing or a cast a player stands ready rather than idle
  // (PlayerObject.cs:79, 941, 2505). An Archer holding a bow never does.
  if (entity.kind === "player" && !entity.RidingMount && entity.Class !== ARCHER && declares("Stance")) {
    const ready = Math.max(
      entity.attackStartedAt != null ? entity.attackStartedAt + attackDuration : 0,
      entity.castUntil || 0);
    if (ready > 0 && now < ready + STANCE_DELAY)
      return { action: "Stance", startedAt: ready };
  }
  return { action: entity.stoned ? "Stoned" : "Standing" };
}

// A player swinging at empty air with shift held rolls for a second swing: one in five
// is Attack3, the rest Attack1 (Client/MirObjects/PlayerObject.cs:1069-1072). With a
// target under the cursor, or without shift, native never rolls. The Assassin has its own
// weights and its own body set, neither of which this client has yet.
export function playerAttackAction(shift, hasTarget, roll = Math.random) {
  if (!shift || hasTarget) return "Attack1";
  return roll() * 100 >= 20 ? "Attack1" : "Attack3";
}

// S.ObjectAttack.Type picks Attack1..Attack5, and players always swing Attack1
// (Client/MirScenes/GameScene.cs:3341-3376).
export function attackAction(entity, type) {
  if (entity?.kind !== "monster") return "Attack1";
  return ["Attack1", "Attack2", "Attack3", "Attack4", "Attack5"][type] || "Attack1";
}

// S.ObjectRangeAttack.Type picks AttackRange1..3 (GameScene.cs:5143-5165).
export function rangeAttackAction(entity, type) {
  if (entity?.kind !== "monster") return "AttackRange1";
  return ["AttackRange1", "AttackRange2", "AttackRange3"][type] || "AttackRange1";
}

// MonsterObject.ManualLocationOffset (Client/MirObjects/MonsterObject.cs:19-42),
// applied to the draw position only; native leaves depth sorting on Movement.Y.
const MANUAL_OFFSETS = new Map([
  [900, { x: -21, y: -15 }], // EvilMir
  [951, { x: -10, y: 0 }], // PalaceWallLeft
  [952, { x: -10, y: 0 }], // PalaceWall1
  [953, { x: -10, y: 0 }], // PalaceWall2
  [954, { x: -10, y: 0 }], // GiGateSouth
  [955, { x: -45, y: 7 }], // GiGateEast
  [956, { x: -10, y: 0 }], // GiGateWest
  [957, { x: -10, y: 0 }], // SSabukWall1
  [958, { x: -10, y: 0 }], // SSabukWall2
  [959, { x: -10, y: 0 }], // SSabukWall3
]);
const NO_OFFSET = { x: 0, y: 0 };
export function manualDrawOffset(entity) {
  if (entity?.kind !== "monster") return NO_OFFSET;
  return MANUAL_OFFSETS.get(entity.Image) || NO_OFFSET;
}

// The two lists MonsterObject takes at the end of MirAction.Hide
// (Client/MirObjects/MonsterObject.cs:1423-1461): a few burrowers leave the map,
// the statues freeze into their Stoned pose, and everything else stands back up.
export const REMOVED_ON_HIDE = new Set([
  10, // CannibalPlant
  41, // EvilCentipede
  69, // DigOutZombie
  290, // Armadillo
  291, // ArmadilloElder
  324, // CreeperPlant
  371, // WaterDragon
]);
export const STONED_ON_HIDE = new Set([
  65, 66, 67, 68, // ZumaStatue, ZumaGuardian, RedThunderZuma, ZumaTaurus
  209, 210, 211, // FrozenZumaStatue, FrozenZumaGuardian, FrozenRedZuma
  251, // DemonGuard
  305, // EarthGolem
  352, // Turtlegrass
  353, // ManTree
  403, // PurpleFaeFlower
  414, 415, 416, 417, // WarriorScroll, TaoistScroll, WizardScroll, AssassinScroll
]);

// A statue that is already stoned when it comes into view says so in the spawn
// packet: native reads S.ObjectMonster.Extra into Stoned before it picks the
// first action (Client/MirObjects/MonsterObject.cs:239-253). This is a shorter
// list than STONED_ON_HIDE -- native never reads Extra for RedThunderZuma or
// FrozenRedZuma, even though both freeze at the end of a Hide.
export const STONED_AT_SPAWN = new Set([
  65, 66, // ZumaStatue, ZumaGuardian
  68, // ZumaTaurus
  209, 210, // FrozenZumaStatue, FrozenZumaGuardian
  251, // DemonGuard
  305, // EarthGolem
  352, // Turtlegrass
  353, // ManTree
  403, // PurpleFaeFlower
  414, 415, 416, 417, // WarriorScroll, TaoistScroll, WizardScroll, AssassinScroll
]);

// Native reads Extra in the MonsterObject constructor, before the first action is
// chosen, so a statue that was already stoned when it entered view renders in its
// Stoned pose rather than standing up and animating.
export function stonedAtSpawn(packet) {
  return packet.Extra === true && STONED_AT_SPAWN.has(packet.Image);
}
