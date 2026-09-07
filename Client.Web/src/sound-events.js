export function actorSound(actor, event) {
  if (!actor) return null;
  if (actor.kind === "monster" && Number.isInteger(actor.Image) && actor.Image >= 0) {
    const offsets = { show: 0, attack: 1, struck: 2, die: 3 };
    return Object.hasOwn(offsets, event) ? actor.Image * 10 + offsets[event] : null;
  }
  if (actor.kind === "player") {
    if (event === "die") return actor.Gender === 1 ? 10145 : 10144;
    if (event === "struck") return actor.Gender === 1 ? 10139 : 10138;
  }
  return null;
}

export function audible(actor, user) {
  return !!actor?.Location && !!user?.Location &&
    Math.max(Math.abs(actor.Location.X - user.Location.X), Math.abs(actor.Location.Y - user.Location.Y)) <= 12;
}
