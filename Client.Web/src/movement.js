export const MOVE_INTERVAL = 630;
export function resetMotion(object, location, direction) {
  object.Location = { ...location };
  object.Direction = direction;
  object.from = null;
  object.movedAt = 0;
  object.running = false;
  object.attackUntil = 0;
  object.castUntil = 0;
}
export function canPath(grid, from, to) {
  return !!grid && [from, to].every((point) => point && Number.isInteger(point.X) && Number.isInteger(point.Y) && grid.isInside(point.X, point.Y));
}
export function worldScale(width, height) {
  // Keep the viewport inside the server's 16-cell interest radius, with a loading margin.
  return Math.max(1, width / (26 * 48), height / (24 * 32));
}

export function motionPosition(object, now) {
  const t = object.from
    ? Math.max(0, Math.min(1, (now - object.movedAt) / (object.moveDuration || MOVE_INTERVAL)))
    : 1;
  return {
    X: (object.from?.X ?? object.Location.X) + (object.Location.X - (object.from?.X ?? object.Location.X)) * t,
    Y: (object.from?.Y ?? object.Location.Y) + (object.Location.Y - (object.from?.Y ?? object.Location.Y)) * t,
    moving: t < 1,
  };
}

export function beginMotion(object, location, now) {
  const distance = Math.max(Math.abs(location.X - object.Location.X), Math.abs(location.Y - object.Location.Y));
  if (!distance) return;
  // Continue from the displayed position, including when a packet arrives mid-step.
  object.from = distance <= 3 ? motionPosition(object, now) : location;
  object.running = distance > 1;
  object.Location = location;
  object.movedAt = now;
  object.moveDuration = MOVE_INTERVAL + 16;
}

export function movementLength(from, path, running, distance = 2) {
  if (!path.length) return 0;
  if (!running || path.length < distance) return 1;
  const dx = path[0].X - from.X;
  const dy = path[0].Y - from.Y;
  for (let i = 1; i < distance; i++) {
    if (path[i].X !== from.X + dx * (i + 1) ||
        path[i].Y !== from.Y + dy * (i + 1)) return 1;
  }
  return distance;
}
