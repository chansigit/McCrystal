export function equippedWeapon(item, info) {
  if (!item || !info || (info.Durability > 0 && item.CurrentDura === 0)) return { Weapon: -1, WeaponEffect: 0 };
  return { Weapon: info.Shape, WeaponEffect: info.Effect || 0 };
}

// Data/CHair holds 00..08 and MLibrary.InitLibrary sizes the array from the highest
// numbered file, so PlayerObject.SetLibraries draws nothing for a larger Hair value.
export const HAIR_LIBRARIES = 9;

// PlayerObject.DrawHead draws HairLibrary at DrawFrame + HairOffSet, and HairOffSet is
// assigned the same value as ArmourOffSet in every class branch, so the head shares the
// body's displayed frame exactly and needs no re-derivation of the animation.
export function hairLayer(actor, bodyFrame) {
  if (!actor || bodyFrame < 0) return null;
  // A transformed player draws the transform sprite with HairLibrary cleared.
  if (Number.isInteger(actor.TransformType) && actor.TransformType > -1) return null;
  if (!Number.isInteger(actor.Hair) || actor.Hair < 0 || actor.Hair >= HAIR_LIBRARIES) return null;
  // Assassins and Archers only use AHair/ARHair with their alternate body sets, which the
  // web client does not draw yet; CHair is what matches the CArmour frames it does draw.
  return { library: `CHair/${String(actor.Hair).padStart(2, "0")}`, index: bodyFrame };
}

export function weaponLayer(actor, bodyFrame) {
  if (!Number.isInteger(actor.Weapon) || actor.Weapon < 0 || actor.RidingMount || bodyFrame < 0) return null;
  // Special class weapons require their matching alternate body animation set.
  if ((actor.Class === 3 && actor.Weapon >= 100 && actor.Weapon < 200) ||
      (actor.Class === 4 && actor.Weapon >= 200)) return null;
  return {
    library: `CWeapon/${String(actor.Weapon).padStart(2, "0")}`,
    index: bodyFrame - (actor.Gender === 1 ? 808 : 0) + (actor.Gender === 1 ? 416 : 0),
    behind: [0, 5, 6, 7].includes(actor.Direction || 0),
    effectLibrary: actor.WeaponEffect > 0 ? `CWeaponEffect/${String(actor.WeaponEffect).padStart(2, "0")}` : null,
  };
}

// PlayerObject.DrawWings: WingEffect 1..99 selects CHumEffect[WingEffect - 1] and the
// frame comes off the action's parallel effect strip -- EffectStart plus the direction
// times EffectCount + EffectSkip -- not off the body strip (PlayerObject.cs:757-763,
// 5074-5081). Assassins and Archers read AHumEffect and ARHumEffect with their own body
// sets, which this client does not draw yet.
// Data/CHumEffect holds 00..05, and InitLibrary sizes the array from the highest file,
// so a larger WingEffect draws nothing rather than reading past the end.
export const WING_LIBRARIES = 6;
const WARRIOR = 0, WIZARD = 1, TAOIST = 2;

// WingOffset: males draw from zero and females 840 frames on (PlayerObject.cs:587).
export function wingOffset(gender) {
  return gender === 1 ? 840 : 0;
}

export function wingLayer(actor, frames, direction, step) {
  if (!actor || !frames?.effect) return null;
  if (![WARRIOR, WIZARD, TAOIST].includes(actor.Class)) return null;
  if (Number.isInteger(actor.TransformType) && actor.TransformType > -1) return null;
  const wing = actor.WingEffect;
  if (!Number.isInteger(wing) || wing <= 0 || wing >= 100) return null;
  if (wing - 1 >= WING_LIBRARIES) return null;
  const e = frames.effect;
  const cursor = Math.min(Math.max(0, step), Math.max(0, e.count - 1));
  return {
    library: `CHumEffect/${String(wing - 1).padStart(2, "0")}`,
    index: e.start + direction * (e.count + e.skip) + cursor + wingOffset(actor.Gender),
  };
}

// A transformed player draws a whole different body: Data/Transform, or Data/TransformRide2
// when riding a mount above type 6, with the hair and both weapons cleared and every attack
// collapsed onto Attack1 (Client/MirObjects/PlayerObject.cs:310-358). TransformType 19 wears
// TransformEffect wings.
const TRANSFORM_ATTACKS = new Set([
  "Attack2", "Attack3", "Attack4", "AttackRange1", "AttackRange2", "AttackRange3",
]);

export function transformAction(action) {
  return TRANSFORM_ATTACKS.has(action) ? "Attack1" : action;
}

export function transformLayer(actor) {
  if (!actor || actor.kind !== "player") return null;
  const type = actor.TransformType;
  if (!Number.isInteger(type) || type < 0) return null;
  const ride = actor.RidingMount && actor.MountType > 6;
  return {
    library: `${ride ? "TransformRide2" : "Transform"}/${String(type).padStart(2, "0")}`,
    // ArmourOffSet is -416 on a transform mount and 0 otherwise, and there is no gender
    // offset either way.
    offset: ride ? -416 : 0,
    wing: type === 19 ? "TransformEffect/01" : null,
  };
}
