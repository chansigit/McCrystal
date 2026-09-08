// A poisoned actor is tinted, and carries a row of coloured dots above its head. Both
// tables are native's: the tint is one priority-ordered switch shared by players and
// monsters (Client/MirObjects/PlayerObject.cs:865-876, MonsterObject.cs:447-458) and the
// dots are MapObject.DrawPoison (MapObject.cs:508-568).

export const POISON = {
  Green: 1, Red: 2, Slow: 4, Frozen: 8, Stun: 16, Paralysis: 32,
  DelayedExplosion: 64, Bleeding: 128, LRParalysis: 256, Blindness: 512, Dazed: 1024,
};

const WHITE = 0xffffff;

// The switch falls through in this order, so a frozen and poisoned monster reads as
// frozen. .NET's own Color values, so Green really is 0x008000 rather than pure green.
const TINTS = [
  [POISON.DelayedExplosion, 0xffa500], // Orange
  [POISON.Paralysis | POISON.LRParalysis, 0x808080], // Gray
  [POISON.Frozen, 0x0000ff], // Blue
  [POISON.Blindness, 0xc71585], // MediumVioletRed
  [POISON.Stun | POISON.Dazed, 0xffff00], // Yellow
  [POISON.Slow, 0x800080], // Purple
  [POISON.Bleeding, 0x8b0000], // DarkRed
  [POISON.Red, 0xff0000], // Red
  [POISON.Green, 0x008000], // Green
];

export function poisonTint(poison) {
  const flags = Number(poison) || 0;
  for (const [mask, colour] of TINTS) if (flags & mask) return colour;
  return WHITE;
}

// DrawPoison walks the flags in its own order, which is not the tint order, and packs the
// dots left to right at five pixels apart.
const DOTS = [
  [POISON.Green, 0x008000],
  [POISON.Red, 0xff0000],
  [POISON.Bleeding, 0x8b0000],
  [POISON.Slow, 0x800080],
  [POISON.Stun | POISON.Dazed, 0xffff00],
  [POISON.Blindness, 0xc71585],
  [POISON.Frozen, 0x0000ff],
  [POISON.Paralysis | POISON.LRParalysis, 0x808080],
  [POISON.DelayedExplosion, 0xffa500],
];

export function poisonDots(poison) {
  const flags = Number(poison) || 0;
  if (!flags) return [];
  const dots = [];
  for (const [mask, colour] of DOTS) if (flags & mask) dots.push(colour);
  return dots;
}
