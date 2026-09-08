export const TEXT_SIZE = 8 * 96 / 72;
export const PLAYER_NAME_SIZE = 12;

export function nameTop(y, standingOffset, height, scale, gap = 4) {
  return Math.min(y - 40, y + (standingOffset ?? -40)) - height - gap / scale;
}

export function showName(entity, nameView, hovered) {
  if (entity.Hidden) return false;
  if (entity.kind === "item") return false;
  if (hovered) return true;
  return nameView && !entity.Dead;
}

// A 2600 ms lockout used to sit here for monster images 0 and 1. It was a workaround
// for frames being driven off a shared wall clock, where a fresh swing could start
// mid-animation; every action now carries its own start timestamp, so the swing plays
// from frame zero each time and the lockout is gone. The action's own length, taken
// from the library's frame table, ends it instead of a hardcoded 600 ms.
export function beginAttackAnimation(entity, now, action = "Attack1") {
  entity.attackStartedAt = now;
  entity.attackAction = action;
  return true;
}

export function entityDepth(y, entity) {
  const layer = entity.kind === "item" ? 0 : entity.Dead ? 0.1 : 0.2;
  return y + 32 + layer + Math.abs(Number(entity.ObjectID) || 0) % 1000 / 1000000;
}

export function frameIndex(frame, direction, step) {
  return frame.start + direction * (frame.count + frame.skip) + (frame.reverse ? -step : step);
}

export function transitionFrame(entity, frame, now, ready) {
  if (ready) entity.visibilityStartedAt ??= now;
  const elapsed = entity.visibilityStartedAt == null ? 0 : now - entity.visibilityStartedAt;
  return { step: Math.min(frame.count - 1, Math.floor(elapsed / Math.max(50, frame.interval))),
    done: elapsed >= frame.count * Math.max(50, frame.interval) };
}

// WaterDragon's native DrawBlend overlay uses the same directional layout as its body.
export function hydraOverlay(index) {
  return index >= 0 && index < 400 ? index + 400 : null;
}

export function goldImage(amount) {
  if (amount < 100) return 112;
  if (amount < 200) return 113;
  if (amount < 500) return 114;
  if (amount < 1000) return 115;
  return 116;
}

export function npcIdleAction(entity, animations, now, random = Math.random) {
  const choices = animations?.Harvest ? ["Standing", "Harvest"] : ["Standing"];
  if (!entity.npcIdleAction || now >= (entity.npcIdleUntil || 0)) {
    entity.npcIdleAction = choices[Math.floor(random() * choices.length)];
    const frame = animations?.[entity.npcIdleAction] || animations?.Standing;
    entity.npcIdleStartedAt = now;
    entity.npcIdleUntil = now + Math.max(1, frame?.count || 1) * Math.max(50, frame?.interval || 500);
  }
  return entity.npcIdleAction;
}

// An HD override frame (Data/HD, built by Tools/SpriteHD) is exactly twice the
// size the manifest declares, and is the only thing that ever is -- so the texture's
// own dimensions say whether to halve the sprite's scale. Drawn at 0.5 the art keeps
// its cell and its anchor and gains one texture pixel per physical pixel on a Retina
// canvas, instead of one source pixel stretched over a 2x2 block.
export function assetScale(texture, frame) {
  if (!texture || !frame) return 1;
  return texture.width === frame.width * 2 && texture.height === frame.height * 2 ? 0.5 : 1;
}
