export function mapAnimation(cell, layer) {
  const raw = cell[layer === 2 ? 7 : 9] || 0;
  if (layer === 2) return { count: raw & 0x7f, blend: (raw & 0x80) !== 0, tick: cell[8] || 0 };
  const count = raw > 0 && raw < 255 ? ((raw & 15) || raw) : 0;
  return { count, blend: (raw & 15) !== 0 && (count === 8 || count === 10), tick: cell[10] || 0 };
}
export function mapEffectFrame(index, animation, now) {
  return index + (animation.count ? Math.floor(Math.floor(now / 100) / (animation.tick + 1)) % animation.count : 0);
}
export function mapPlacement(cell, layer, index, frame, x, y) {
  const animation = mapAnimation(cell, layer), file = cell[layer * 2];
  let left = x * 48, top = y * 32 + 32 - frame.height;
  if (layer === 2 && animation.blend) {
    if (file === 14 || file === 27 || (file > 99 && file < 199)) {
      left += frame.x; top = y * 32 + 32 - 96 + frame.y;
    } else if (index >= 2723 && index <= 2732) { left += frame.x; top += frame.y; }
  } else if (layer === 2 && file === 28 && (frame.x || frame.y)) {
    left += frame.x; top = y * 32 + frame.y;
  }
  return { x: left, y: top, width: frame.width, height: frame.height };
}
