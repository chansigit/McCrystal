// Textures are never released once loaded: a sprite node is reaped the tick it stops
// being drawn, but its texture stays in World.textures for the life of the session.
// That was tolerable at 1x and is not at 2x, where every frame costs four times the
// bytes and a walk across a map touches thousands of map-object frames.
//
// Eviction is least-recently-drawn, over a byte budget, and never touches a texture
// that is still assigned to a live node -- a sprite keeps drawing its last texture
// while the next one loads, so an in-use texture can be older than this tick.

export const TEXTURE_BUDGET = 384 * 1024 * 1024;

export function textureBytes(texture) {
  return texture ? texture.width * texture.height * 4 : 0;
}

export function textureEvictions(entries, budget = TEXTURE_BUDGET) {
  let total = 0;
  for (const entry of entries) total += entry.bytes;
  if (total <= budget) return [];
  const evictable = entries.filter((entry) => !entry.pinned)
    .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  const evicted = [];
  for (const entry of evictable) {
    if (total <= budget) break;
    total -= entry.bytes;
    evicted.push(entry.key);
  }
  return evicted;
}
