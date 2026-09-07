export const TEXT_SIZE = 8 * 96 / 72;

export function nameTop(y, standingOffset, height, scale) {
  return Math.min(y - 40, y + (standingOffset ?? -40)) - height - 4 / scale;
}

export function showName(entity, nameView, hovered) {
  if (entity.Hidden) return false;
  if (hovered) return true;
  return entity.kind === "item" || (nameView && !entity.Dead);
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
