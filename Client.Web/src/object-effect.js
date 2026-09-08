// S.ObjectEffect attaches an effect to an object: a heal, a teleport flash, a shield, a
// stun. Native answers it with one switch that adds Effects to the object
// (Client/MirScenes/GameScene.cs:4719-4924); this is that switch as data.
//
// Each entry is { effect: [library, start, count, duration], blend, until, on, sound }.
// blend defaults to true because Effect.Blend does. `until` marks the ones native repeats
// with a RepeatUntil deadline. `on: "other"` targets the object named by EffectType
// rather than the one the packet is about.

const monster = (image) => `Monster/${String(image).padStart(3, "0")}`;
const spellSound = (spell, variant = 0) => 20000 + spell * 10 + variant;
const TELEPORT_SOUND = 10110; // SoundList.Teleport

// Effects with no state of their own: one library, one frame run, one optional sound.
const SIMPLE = {
  32: { effect: [monster(406), 400, 6, 600], sound: spellSound(91) }, // FurbolgWarriorCritical
  1: { effect: ["Magic2", 1940, 4, 400], sound: spellSound(91) }, // FatalSword
  23: { effect: ["Magic3", 610, 10, 600], sound: TELEPORT_SOUND }, // StormEscape
  2: { effect: ["Magic", 1600, 10, 600], sound: TELEPORT_SOUND }, // Teleport
  3: { effect: ["Magic", 370, 10, 800], sound: spellSound(61, 1) }, // Healing
  4: { effect: [monster(62), 32, 6, 400], blend: false }, // RedMoonEvil
  5: { effect: ["Magic2", 380, 6, 800] }, // TwinDrakeBlade
  18: { effect: ["Magic3", 60, 3, 400] }, // Bleeding
  10: { effect: ["Effect", 580, 10, 70] }, // Reflect
  27: { effect: [monster(231), 18, 8, 800] }, // IcePillar
  34: { effect: ["Magic3", 705, 10, 800] }, // MoonMist
};

// Effects that add more than one layer at once.
const LAYERED = {
  17: [ // Hemorrhage
    { effect: ["Magic3", 0, 4, 400], sound: spellSound(104) },
    { effect: ["Magic3", 28, 6, 600] },
    { effect: ["Magic3", 46, 8, 800] },
  ],
  9: [ // Entrapment
    { effect: ["Magic2", 1010, 10, 1500] },
    { effect: ["Magic2", 1020, 8, 1200] },
  ],
  14: [{ effect: ["Magic3", 1910, 7, 1400], sound: 20000 + 131 * 10 + 5 }], // ElementalBarrierDown
};

// The awakening results: a blended layer that carries the sound and an opaque one under
// it, both delayed by the packet's own DelayTime.
const AWAKENING = {
  19: [["Magic3", 900, 16, 1600], ["Magic3", 840, 16, 1600], 50002], // Success
  20: [["Magic3", 920, 9, 900], ["Magic3", 860, 9, 900], 50003], // Fail
  22: [["Magic3", 880, 5, 500], ["Magic3", 820, 5, 500], 50001], // Hit
  21: [["Magic3", 890, 5, 500], ["Magic3", 830, 5, 500], 50000], // Miss
};

// A buff that stays up until its Down twin arrives, rather than for a fixed time. Native
// keeps a handle on the effect and removes it; a long deadline is the same thing here,
// and the Down effect is what a player actually sees.
const HELD = 3600000;

export function objectEffects(packet, source) {
  const effect = packet.Effect;
  const delay = Number(packet.DelayTime) || 0;
  const time = Number(packet.Time) || 0;

  if (SIMPLE[effect]) return [{ blend: true, ...SIMPLE[effect] }];
  if (LAYERED[effect]) return LAYERED[effect].map((entry) => ({ blend: true, ...entry }));

  if (AWAKENING[effect]) {
    const [blended, opaque, sound] = AWAKENING[effect];
    return [
      { effect: blended, blend: true, delay, sound },
      { effect: opaque, blend: false, delay },
    ];
  }

  switch (effect) {
    case 6: // MagicShieldUp: Repeat = true, held until MagicShieldDown
      return [{ effect: ["Magic", 3890, 3, 600], blend: true, until: HELD, key: "shield" }];
    case 7: // MagicShieldDown
      return [{ clear: "shield" }];
    case 13: // ElementalBarrierUp
      return [{ effect: ["Magic3", 1890, 10, 2000], blend: true, until: HELD, key: "barrier" }];
    case 8: // GreatFoxSpirit: native picks one of three 20-frame runs at random
      return [{ effect: [monster(134), 375 + Math.floor(Math.random() * 3) * 20, 20, 1400],
        blend: true, sound: 134 * 10 + 5 }];
    case 16: // MPEater: one effect on the caster and a longer one on the drained object
      return [
        { effect: ["Magic2", 2400, 9, 900], blend: true, sound: spellSound(91) },
        { effect: ["Magic2", 2411, 19, 1900], blend: true, on: "other" },
      ];
    case 15: // DelayedExplosion: EffectType is the stage, ten frames apart
      return [{ effect: ["Magic3", 1590 + (Number(packet.EffectType) || 0) * 10, 8, 1200], blend: true }];
    case 24: // TurtleKing: one of two runs at random
      return [{ effect: [monster(187), Math.random() < 0.5 ? 922 : 934, 12, 1200],
        blend: true, sound: spellSound(35, 1) }];
    case 25: // Behemoth: two layers on the cell, not on the object
      return [
        { effect: [monster(158), 788, 10, 1500], blend: true, detach: true },
        { effect: [monster(158), 778, 10, 1500], blend: false, detach: true, behind: true },
      ];
    case 26: // Stunned: repeats for the duration the packet carries
      return [{ effect: [monster(201), 632, 10, 1000], blend: true, until: time }];
    case 31: // FlamingMutantWeb: same shape
      return [{ effect: [monster(200), 330, 10, 1000], blend: true, until: time }];
    case 28: // KingGuard, two variants chosen by EffectType
    case 29:
      return [{ effect: [monster(252), packet.EffectType === 0 ? 753 : 763, 10, 1000], blend: false }];
    case 30: // DeathCrawlerBreath: four frames per direction of the breathing object
      return [{ effect: [monster(261), 272 + (source.Direction || 0) * 4, 4, 400], blend: true }];
    default:
      return []; // Critical draws nothing natively, and Mine and Tester have no case
  }
}
