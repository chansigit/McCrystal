export function equippedWeapon(item, info) {
  if (!item || !info || (info.Durability > 0 && item.CurrentDura === 0)) return { Weapon: -1, WeaponEffect: 0 };
  return { Weapon: info.Shape, WeaponEffect: info.Effect || 0 };
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
