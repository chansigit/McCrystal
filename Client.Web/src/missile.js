// A projectile that flies from the object that fired it to the object it was aimed at.
// Native has exactly one: FireBounce (Client/MirScenes/GameScene.cs:4689-4717).

// GameScene.Direction16: the angle from source to destination, rotated half a step so a
// direction covers the 22.5 degrees around its own heading (GameScene.cs:12043-12064).
export function direction16(source, destination) {
  const dx = destination.X - source.X;
  const dy = destination.Y - source.Y;
  if (dx === 0 && dy === 0) return 0;
  // Native measures clockwise from due north, which is atan2(dx, -dy) here.
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  angle += 11.25;
  if (angle > 360) angle -= 360;
  return Math.floor(angle / 22.5) % 16;
}

// PlayerObject.CreateProjectile: the flight lasts 50 ms a cell, and the frame cursor runs
// at its own interval independent of that (Client/MirObjects/PlayerObject.cs:3539-3568).
export function missileDuration(source, destination) {
  return Math.max(1, Math.max(Math.abs(destination.X - source.X), Math.abs(destination.Y - source.Y))) * 50;
}

// FireBounce: Magic 410, six frames every 30 ms, four skipped between directions.
const PROJECTILES = {
  46: { library: "Magic", start: 410, count: 6, interval: 30, skip: 4, blend: true,
    sound: 20000 + 34 * 10 + 1, impact: { effect: ["Magic", 570, 10, 600], sound: 20000 + 34 * 10 + 2 } },
};

export function createMissile(spell, source, target) {
  const definition = PROJECTILES[spell];
  if (!definition || !source?.Location || !target?.Location) return null;
  const from = { X: source.Location.X, Y: source.Location.Y };
  const to = { X: target.Location.X, Y: target.Location.Y };
  return {
    ...definition,
    source: from,
    destination: to,
    targetID: target.ObjectID,
    direction: direction16(from, to),
    duration: missileDuration(from, to),
  };
}
