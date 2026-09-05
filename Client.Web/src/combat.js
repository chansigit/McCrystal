export function tileDistance(a, b) {
  return Math.max(Math.abs(a.X - b.X), Math.abs(a.Y - b.Y));
}
export function deathFrame(elapsed, count, interval) {
  return Math.min(Math.max(1, count) - 1, Math.floor(Math.max(0, elapsed) / Math.max(50, interval)));
}

export function meleeTarget(user, target) {
  if (!user || user.Dead || !target || target.Dead || target.Hidden || target.kind !== "monster") return "cancel";
  return tileDistance(user.Location, target.Location) === 1 ? "attack" : "approach";
}

export function hitSprite(point, candidates) {
  return candidates.filter(({ bounds }) => point.X >= bounds.x && point.X < bounds.x + bounds.width &&
    point.Y >= bounds.y && point.Y < bounds.y + bounds.height)
    .sort((a, b) => b.z - a.z)[0]?.entity;
}
