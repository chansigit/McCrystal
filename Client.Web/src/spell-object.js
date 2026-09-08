// S.ObjectSpell puts a standing effect on a map cell -- a fire wall, a poison cloud, a
// trap. Native builds one SpellObject per packet and looks its appearance up in a single
// switch (Client/MirObjects/SpellObject.cs:29-289); this is that switch, as data.
//
// A monster library is named the way the gateway serves it, since native indexes
// Libraries.Monsters by the Monster enum value.
const monster = (image) => `Monster/${String(image).padStart(3, "0")}`;

// { library, start, count, interval, blend, repeat, offset }
// repeat false stops on the last frame and draws nothing after it, which is what
// SpellObject.Draw's `FrameIndex >= FrameCount && !Repeat` return does.
export const SPELL_OBJECTS = {
  73: { library: "Magic", start: 1390, count: 10, interval: 100, blend: true, repeat: true }, // TrapHexagon
  39: { library: "Magic", start: 1630, count: 6, interval: 120, blend: true, repeat: true }, // FireWall
  83: { library: "Magic2", start: 1650, count: 20, interval: 120, blend: true, repeat: true }, // PoisonCloud
  50: { library: "Magic2", start: 1550, count: 30, interval: 100, blend: true, repeat: false, offset: { x: 0, y: -20 } }, // Blizzard
  52: { library: "Magic2", start: 1610, count: 30, interval: 100, blend: true, repeat: false, offset: { x: 0, y: -20 } }, // MeteorStrike
  79: { library: "Magic2", start: 1680, count: 10, interval: 100, blend: true, repeat: true }, // Reincarnation
  98: { library: "Magic2", start: 2360, count: 8, interval: 100, blend: true, repeat: true }, // Trap
  152: { library: "Magic2", start: 2360, count: 8, interval: 100, blend: true, repeat: true }, // Portal
  86: { library: "Magic3", start: 630, count: 11, interval: 80, blend: true, repeat: true }, // HealingCircle
  208: { library: monster(304), start: 368, count: 8, interval: 100, blend: false, repeat: false, directionStride: 8, sound: 8304 }, // StoneGolemQuake
  209: { library: monster(305), start: 441, count: 8, interval: 100, blend: false, repeat: false, sound: 8331 }, // EarthGolemPile
  211: { library: monster(307), start: 82, count: 15, interval: 100, blend: false, repeat: false, sound: 8341 }, // TreeQueenMassRoots
  212: { library: monster(307), start: 48, count: 9, interval: 100, blend: false, repeat: false, sound: 8342 }, // TreeQueenGroundRoots
  210: { library: monster(307), start: 111, count: 15, interval: 100, blend: false, repeat: false, sound: 8343 }, // TreeQueenRoot
  213: { library: monster(296), start: 572, count: 20, interval: 100, blend: true, repeat: false }, // TucsonGeneralRock
  214: { library: monster(202), start: 314, count: 20, interval: 100, blend: true, repeat: false, sound: 8303 }, // FlyingStatueIceTornado
  215: { library: monster(320), start: 1630, count: 9, interval: 100, blend: true, repeat: false, directionStride: 9, sound: 3209 }, // DarkOmaKingNuke
  216: { library: monster(346), start: 634, count: 10, interval: 100, blend: true, repeat: true, sound: 8306 }, // HornedSorcererDustTornado
  217: { library: monster(348), start: 1066, count: 12, interval: 100, blend: true, repeat: true, sound: 8456 }, // HornedCommanderRockFall
  218: { library: monster(348), start: 1190, count: 9, interval: 100, blend: false, repeat: true, sound: 8457 }, // HornedCommanderRockSpike
  // A single frame chosen by direction, standing still: the creature climbing out of the
  // ground, and the rubble a Horned Commander leaves behind.
  200: { library: monster(69), start: 304, count: 1, interval: 10000, blend: false, repeat: true, directionFrame: true }, // DigOutZombie
  206: { library: monster(290), start: 472, count: 1, interval: 10000, blend: false, repeat: true, directionFrame: true }, // DigOutArmadillo
};

// The one entry whose art depends on a flag rather than a direction: an explosive trap
// is either armed or going off (SpellObject.cs:110-129).
export function spellObject(spell, direction = 0, param = false) {
  if (spell === 124) // ExplosiveTrap
    return param
      ? { library: "Magic3", start: 1570, count: 9, interval: 100, blend: true, repeat: false, sound: 21245 }
      : { library: "Magic3", start: 1560, count: 10, interval: 100, blend: true, repeat: true };
  // Rubble is drawn only for directions 1..5, and direction 0 draws nothing at all.
  if (spell === 201)
    return direction === 0 ? null
      : { library: "Effect", start: 64 + Math.min(4, direction - 1), count: 1, interval: 10000, blend: false, repeat: true };
  const base = SPELL_OBJECTS[spell];
  if (!base) return null;
  if (base.directionFrame) return { ...base, start: base.start + direction };
  if (base.directionStride) return { ...base, start: base.start + direction * base.directionStride };
  return base;
}

// Native counts frames off its own clock and simply stops drawing a non-repeating object
// once it runs past the end (SpellObject.cs:292-331).
export function spellObjectFrame(definition, elapsed) {
  if (!definition) return null;
  const step = Math.floor(Math.max(0, elapsed) / Math.max(1, definition.interval));
  if (step >= definition.count && !definition.repeat) return null;
  return definition.start + (definition.repeat ? step % definition.count : step);
}

// Several entries add a free-standing effect beside the standing one, and a few are
// nothing but that effect. [library, start, count, duration], the shape world.js already
// uses for spell effects.
export function spellObjectEffects(spell) {
  return ({
    52: [["Magic2", 1600, 10, 800]], // MeteorStrike, repeating for 3s natively
    202: [["Dragon", 400, 5, 600]], // MapLightning; native randomises 400/410/420
    203: [["Dragon", 440, 20, 1600], ["Dragon", 470, 10, 800]], // MapLava
    204: [[monster(247), 27, 12, 1200]], // MapQuake1
    205: [[monster(247), 39, 13, 1300]], // MapQuake2
    207: [[monster(284), 522, 7, 700]], // GeneralMeowMeowThunder
    211: [[monster(307), 97, 14, 1400]], // TreeQueenMassRoots
    212: [[monster(307), 57, 9, 900]], // TreeQueenGroundRoots
    213: [[monster(296), 552, 20, 2000]], // TucsonGeneralRock
    218: [[monster(348), 1199, 9, 900]], // HornedCommanderRockSpike
  })[spell] || [];
}

// The ones with no standing object of their own; native plays a sound and an effect.
export const SPELL_OBJECT_SOUNDS = { 202: 8301, 203: 8302, 204: 8304, 205: 8304, 207: 8321 };
