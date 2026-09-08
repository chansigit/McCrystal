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
