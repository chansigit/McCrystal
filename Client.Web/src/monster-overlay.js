// The additive layer native draws over 85 monsters after the body: the flames on a
// Behemoth's swing, the sparks off a Zuma's hammer, the fire that consumes a Scarecrow as
// it dies. MonsterObject.DrawEffects is one 1,260-line switch of 275 draw calls
// (Client/MirObjects/MonsterObject.cs:4338-5595); this is that switch as data.
//
// A row is { image, base, stride, offset } and resolves to
//   image library, frame = base + step + direction * stride + offset
// with image null meaning the monster's own library. Everything else is a guard or a
// departure: `min`/`max`/`below` bound the frame step, `static` ignores it, `reverse`
// counts it down, `relative` measures base from the live frame table's start,
// `blend: false` draws opaque, `gray` tints, `effect` requires that spawn Effect byte,
// `onlyImage` and `minDirection` narrow a shared block, and `exceptDead` is the aura a
// Behemoth wears in every action but one.
//
// Generated from the C# and checked against it: every expression was evaluated in both
// forms over nine frame and direction pairs.
export const MONSTER_OVERLAYS = {
  1: { // TaoistGuard
    Attack1: [{ image: 1, base: 80, stride: 3 }],
  },
  5: { // Scarecrow
    Die: [{ image: 5, base: 224 }],
  },
  20: { // CaveMaggot
    Attack1: [{ image: 20, base: 175, stride: 5, min: 1 }],
  },
  22: { // Skeleton
    Die: [{ image: 22, base: 224 }],
  },
  23: { // BoneFighter
    Die: [{ image: 22, base: 224 }],
  },
  24: { // AxeSkeleton
    Die: [{ image: 22, base: 224 }],
  },
  25: { // BoneWarrior
    Die: [{ image: 22, base: 224 }],
  },
  26: { // BoneElite
    Die: [{ image: 22, base: 224 }],
  },
  27: { // Dung
    Attack1: [{ image: 27, base: 223, stride: 5, min: 1 }],
  },
  34: { // WoomaTaurus
    Attack1: [{ image: 34, base: 224, stride: 6 }],
  },
  44: { // WedgeMoth
    Attack1: [{ image: 44, base: 224, stride: 6 }],
  },
  67: { // RedThunderZuma
    Standing: [{ image: 67, base: 320, stride: 4 }],
    Walking: [{ image: 67, base: 352, stride: 6 }],
    Pushed: [{ image: 67, base: 352, stride: 6 }],
    Attack1: [{ image: 67, base: 400, stride: 6 }],
    Struck: [{ image: 67, base: 448, stride: 2 }],
    AttackRange1: [{ image: 67, base: 464, stride: 6 }],
  },
  76: { // KingHog
    Attack1: [{ image: 76, base: 224, stride: 6 }],
  },
  77: { // DarkDevil
    Attack1: [{ image: 77, base: 342, stride: 6 }],
  },
  93: { // BoneLord
    Standing: [{ image: 93, base: 400, stride: 4 }],
    Walking: [{ image: 93, base: 432, stride: 6 }],
    Pushed: [{ image: 93, base: 432, stride: 6 }],
    Attack1: [{ image: 93, base: 480, stride: 6 }],
    Attack2: [{ image: 93, base: 528, stride: 6 }],
    AttackRange1: [{ image: 93, base: 576, stride: 6 }],
    Struck: [{ image: 93, base: 624, stride: 2 }],
    Die: [{ image: 93, base: 640, stride: 20 }],
  },
  102: { // FrostTiger
    Standing: [{ image: 353, base: 528, stride: 4, gray: true, effect: 1 }],
    Walking: [{ image: 353, base: 560, stride: 6, gray: true, effect: 1 }],
    Attack1: [{ image: 353, base: 608, stride: 6, gray: true, effect: 1 }],
    Struck: [{ image: 353, base: 656, stride: 2, gray: true, effect: 1 }],
    Die: [{ image: 353, base: 672, stride: 10, gray: true, effect: 1 }],
    AttackRange1: [{ image: 353, base: 752, stride: 6, gray: true, effect: 1 }],
    SitDown: [{ image: 353, base: 800, stride: 4, gray: true, effect: 1 }],
  },
  117: { // HolyDeva
    Standing: [{ image: 117, base: 226, stride: 4, blend: false }],
    Walking: [{ image: 117, base: 258, stride: 6, blend: false }],
    Pushed: [{ image: 117, base: 258, stride: 6, blend: false }],
    AttackRange1: [{ image: 117, base: 306, stride: 6, blend: false }],
    Struck: [{ image: 117, base: 354, stride: 2, blend: false }],
    Die: [{ image: 117, base: 370, stride: 6, blend: false, max: 6 }],
    Appear: [{ image: 117, base: 418, offset: -5, blend: false, min: 5 }],
  },
  124: { // YinDevilNode
    Standing: [{ image: 124, base: 22 }],
  },
  125: { // YangDevilNode
    Standing: [{ image: 125, base: 22 }],
  },
  126: { // OmaKing
    Attack1: [{ image: 126, base: 624, stride: 4, offset: -3, min: 3 }],
    Attack2: [{ image: 126, base: 656 }],
    Die: [{ image: 126, base: 304, stride: 20 }],
  },
  127: { // BlackFoxman
    Attack2: [{ image: 127, base: 234, stride: 4, offset: -3, min: 3 }],
  },
  131: { // GuardianRock
    AttackRange1: [{ image: 131, base: 8 }],
  },
  132: { // ThunderElement
    Standing: [{ image: 132, base: 44 }],
    Walking: [{ image: 132, base: 54 }],
    Pushed: [{ image: 132, base: 54 }],
    Attack1: [{ image: 132, base: 64 }],
    Struck: [{ image: 132, base: 74 }],
    Die: [{ image: 132, base: 78 }],
  },
  133: { // CloudElement
    Standing: [{ image: 133, base: 44 }],
    Walking: [{ image: 133, base: 54 }],
    Pushed: [{ image: 133, base: 54 }],
    Attack1: [{ image: 133, base: 64 }],
    Struck: [{ image: 133, base: 74 }],
    Die: [{ image: 133, base: 78 }],
  },
  134: { // GreatFoxSpirit
    Standing: [{ image: 134, base: 30, relative: true }],
    Attack1: [{ image: 134, base: 30, relative: true }],
    AttackRange1: [{ image: 134, base: 30, relative: true }],
    Struck: [{ image: 134, base: 30, relative: true }],
    Die: [{ image: 134, base: 318 }],
  },
  153: { // CyanoGhast
    Standing: [{ image: 153, base: 448, stride: 4 }],
    Walking: [{ image: 153, base: 480, stride: 6 }],
    Attack1: [{ image: 153, base: 528, stride: 6 }],
    Struck: [{ image: 153, base: 576, stride: 2 }],
    Die: [{ image: 153, base: 592, stride: 10 }],
    Revive: [{ image: 153, base: 592, stride: 10 }],
  },
  154: { // MutatedManworm
    Attack1: [{ image: 154, base: 285, stride: 6 }],
    Attack2: [{ image: 154, base: 333, stride: 8 }],
  },
  155: { // CrazyManworm
    Attack2: [{ image: 155, base: 272, stride: 8 }],
  },
  158: { // Behemoth
    "*": [{ image: 158, base: 648, exceptDead: true }], // the aura, drawn after the switch
    Walking: [{ image: 158, base: 464, stride: 6 }],
    Struck: [{ image: 158, base: 464, stride: 6 }],
    Standing: [{ image: 158, base: 512, stride: 10 }],
    Revive: [{ image: 158, base: 512, stride: 10 }],
    Attack2: [{ image: 158, base: 592, stride: 7 }],
    Attack3: [{ image: 158, base: 592, stride: 7 }],
    AttackRange1: [{ image: 158, base: 592, stride: 7 }],
    AttackRange2: [{ image: 158, base: 592, stride: 7 }],
    Attack1: [{ image: 158, base: 667, stride: 2, offset: -4, min: 4 }, { image: 158, base: 592, stride: 7 }],
    Die: [{ image: 158, base: 658, offset: -1, min: 1 }],
  },
  159: { // DarkDevourer
    Standing: [{ image: 159, base: 272, stride: 4 }],
    Walking: [{ image: 159, base: 304, stride: 6 }],
    Attack1: [{ image: 159, base: 352, stride: 6 }],
    AttackRange1: [{ image: 159, base: 540, stride: 8 }],
    Struck: [{ image: 159, base: 400, stride: 2 }],
    Die: [{ image: 159, base: 416, stride: 8 }],
    Revive: [{ image: 159, base: 416, stride: 8 }],
  },
  163: { // DreamDevourer
    AttackRange1: [{ image: 163, base: 320, stride: 5, offset: -3, min: 3 }],
  },
  184: { // WingedTigerLord
    Attack1: [{ image: 184, base: 584, stride: 6, offset: -2, min: 2 }],
    Attack2: [{ image: 184, base: 560, stride: 3, offset: -2, min: 2 }],
  },
  187: { // TurtleKing
    Standing: [{ image: 187, base: 456, stride: 4 }],
    Walking: [{ image: 187, base: 488, stride: 6 }],
    Attack1: [{ image: 187, base: 536, stride: 10 }],
    Struck: [{ image: 187, base: 616, stride: 2 }],
    Die: [{ image: 187, base: 632, stride: 9 }],
    Revive: [{ image: 187, base: 632, stride: 9 }],
    Attack2: [{ image: 187, base: 704, stride: 6 }],
    AttackRange1: [{ image: 187, base: 752, stride: 6 }],
    AttackRange2: [{ image: 187, base: 800, stride: 6 }],
    AttackRange3: [{ image: 187, base: 848, stride: 8 }],
  },
  194: { // BoneWhoo
    Die: [{ image: 22, base: 224 }],
  },
  201: { // StoningStatue
    Attack2: [{ image: 201, base: 464, stride: 20 }],
  },
  211: { // FrozenRedZuma
    Standing: [{ image: 67, base: 320, stride: 4 }],
    Walking: [{ image: 67, base: 352, stride: 6 }],
    Pushed: [{ image: 67, base: 352, stride: 6 }],
    Attack1: [{ image: 67, base: 400, stride: 6 }],
    Struck: [{ image: 67, base: 448, stride: 2 }],
    AttackRange1: [{ image: 67, base: 464, stride: 6 }],
  },
  215: { // HellSlasher
    Attack1: [{ image: 215, base: 304, stride: 4, offset: -2, min: 2, below: 6 }],
  },
  216: { // HellPirate
    Attack2: [{ image: 216, base: 280, stride: 4, offset: -3, min: 3 }],
  },
  217: { // HellCannibal
    Attack1: [{ image: 217, base: 304 }],
  },
  218: { // HellKeeper
    Attack2: [{ image: 218, base: 40 }],
  },
  224: { // ManectricStaff
    Attack2: [{ image: 224, base: 296, stride: 6 }],
  },
  228: { // ManectricBlest
    Attack2: [{ image: 228, base: 328, stride: 4, offset: -4, min: 4 }],
    Attack3: [{ image: 228, base: 360, stride: 5, offset: -2, min: 2 }],
  },
  229: { // ManectricKing
    Standing: [{ image: 229, base: 360, stride: 4 }],
    Walking: [{ image: 229, base: 392, stride: 6 }],
    Attack1: [{ image: 229, base: 440, stride: 6 }],
    Attack2: [{ image: 229, base: 576, stride: 8 }],
    Struck: [{ image: 229, base: 488, stride: 2 }],
  },
  238: { // FlameSpear
    Standing: [{ image: null, base: 272, stride: 4 }],
    Walking: [{ image: null, base: 304, stride: 6 }],
    Attack1: [{ image: null, base: 352, stride: 6 }],
    Struck: [{ image: null, base: 400, stride: 2 }],
    Die: [{ image: null, base: 416, stride: 10 }],
    AttackRange1: [{ image: null, base: 496, stride: 6 }, { image: null, base: 544, stride: 6, offset: -6, onlyImage: 240, minDirection: 1 }, { image: null, base: 544, stride: 6, onlyImage: 241 }],
  },
  239: { // FlameMage
    Standing: [{ image: null, base: 272, stride: 4 }],
    Walking: [{ image: null, base: 304, stride: 6 }],
    Attack1: [{ image: null, base: 352, stride: 6 }],
    Struck: [{ image: null, base: 400, stride: 2 }],
    Die: [{ image: null, base: 416, stride: 10 }],
    AttackRange1: [{ image: null, base: 496, stride: 6 }, { image: null, base: 544, stride: 6, offset: -6, onlyImage: 240, minDirection: 1 }, { image: null, base: 544, stride: 6, onlyImage: 241 }],
  },
  240: { // FlameScythe
    Standing: [{ image: null, base: 272, stride: 4 }],
    Walking: [{ image: null, base: 304, stride: 6 }],
    Attack1: [{ image: null, base: 352, stride: 6 }],
    Struck: [{ image: null, base: 400, stride: 2 }],
    Die: [{ image: null, base: 416, stride: 10 }],
    AttackRange1: [{ image: null, base: 496, stride: 6 }, { image: null, base: 544, stride: 6, offset: -6, onlyImage: 240, minDirection: 1 }, { image: null, base: 544, stride: 6, onlyImage: 241 }],
  },
  241: { // FlameAssassin
    Standing: [{ image: null, base: 272, stride: 4 }],
    Walking: [{ image: null, base: 304, stride: 6 }],
    Attack1: [{ image: null, base: 352, stride: 6 }],
    Struck: [{ image: null, base: 400, stride: 2 }],
    Die: [{ image: null, base: 416, stride: 10 }],
    AttackRange1: [{ image: null, base: 496, stride: 6 }, { image: null, base: 544, stride: 6, offset: -6, onlyImage: 240, minDirection: 1 }, { image: null, base: 544, stride: 6, onlyImage: 241 }],
  },
  242: { // FlameQueen
    Standing: [{ image: 242, base: 360, stride: 4 }],
    Walking: [{ image: 242, base: 392, stride: 6 }],
    Attack1: [{ image: 242, base: 440, stride: 6 }],
    Struck: [{ image: 242, base: 488, stride: 2 }],
    Die: [{ image: 242, base: 504, stride: 10 }],
    AttackRange1: [{ image: 242, base: 584, stride: 9 }],
  },
  243: { // HellKnight1
    Appear: [{ image: null, base: 224, stride: 4 }],
    Standing: [{ image: null, base: 224, stride: 4 }],
    Walking: [{ image: null, base: 256, stride: 6 }],
    Attack1: [{ image: null, base: 304, stride: 6 }],
    Struck: [{ image: null, base: 352, stride: 2 }],
    Die: [{ image: null, base: 368, stride: 4 }],
    Attack2: [{ image: null, base: 400, stride: 6 }],
  },
  244: { // HellKnight2
    Appear: [{ image: null, base: 224, stride: 4 }],
    Standing: [{ image: null, base: 224, stride: 4 }],
    Walking: [{ image: null, base: 256, stride: 6 }],
    Attack1: [{ image: null, base: 304, stride: 6 }],
    Struck: [{ image: null, base: 352, stride: 2 }],
    Die: [{ image: null, base: 368, stride: 4 }],
    Attack2: [{ image: null, base: 400, stride: 6 }],
  },
  245: { // HellKnight3
    Appear: [{ image: null, base: 224, stride: 4 }],
    Standing: [{ image: null, base: 224, stride: 4 }],
    Walking: [{ image: null, base: 256, stride: 6 }],
    Attack1: [{ image: null, base: 304, stride: 6 }],
    Struck: [{ image: null, base: 352, stride: 2 }],
    Die: [{ image: null, base: 368, stride: 4 }],
    Attack2: [{ image: null, base: 400, stride: 6 }],
  },
  246: { // HellKnight4
    Appear: [{ image: null, base: 224, stride: 4 }],
    Standing: [{ image: null, base: 224, stride: 4 }],
    Walking: [{ image: null, base: 256, stride: 6 }],
    Attack1: [{ image: null, base: 304, stride: 6 }],
    Struck: [{ image: null, base: 352, stride: 2 }],
    Die: [{ image: null, base: 368, stride: 4 }],
    Attack2: [{ image: null, base: 400, stride: 6 }],
  },
  247: { // HellLord
    Standing: [{ image: 247, base: 15, blend: false, static: true }],
    Attack1: [{ image: 247, base: 15, blend: false, static: true }],
    Struck: [{ image: 247, base: 15, blend: false, static: true }],
    Die: [{ image: 247, base: 16, blend: false }],
    Dead: [{ image: 247, base: 20, blend: false, static: true }],
  },
  248: { // WaterGuard
    Attack2: [{ image: 248, base: 264, stride: 3, offset: -4, min: 4 }],
  },
  252: { // KingGuard
    Standing: [{ image: 252, base: 392, stride: 4 }],
    Walking: [{ image: 252, base: 424, stride: 6 }],
    Attack1: [{ image: 252, base: 472, stride: 6 }],
    Attack2: [{ image: 252, base: 616, stride: 6 }],
    Pushed: [{ image: 252, base: 352, stride: 6 }],
    Struck: [{ image: 252, base: 520, stride: 2 }],
    AttackRange1: [{ image: 252, base: 664, stride: 8 }],
    AttackRange2: [{ image: 252, base: 728, stride: 7 }],
  },
  262: { // BurningZombie
    AttackRange1: [{ image: 262, base: 352 }],
  },
  263: { // MudZombie
    Die: [{ image: 263, base: 304 }],
  },
  271: { // HardenRhino
    Running: [{ image: 271, base: 397, stride: 6 }],
  },
  272: { // AncientBringer
    AttackRange1: [{ image: 272, base: 648, stride: 5, offset: -3, min: 3 }, { image: 272, base: 730, stride: 10, offset: -3, min: 3 }],
    AttackRange2: [{ image: 272, base: 730, stride: 10, offset: -3, min: 3 }],
  },
  277: { // BlackHammerCat
    Standing: [{ image: 277, base: 336, stride: 4 }],
    Walking: [{ image: 277, base: 368, stride: 6 }],
    Attack1: [{ image: 277, base: 416, stride: 7 }],
    Attack2: [{ image: 277, base: 472, stride: 12 }],
    Struck: [{ image: 277, base: 568, stride: 3 }],
    Die: [{ image: 277, base: 589, stride: 7 }],
  },
  278: { // StrayCat
    Attack3: [{ image: 278, base: 632, stride: 12 }],
  },
  279: { // CatShaman
    Standing: [{ image: 279, base: 360, stride: 4 }],
    Walking: [{ image: 279, base: 392, stride: 10 }],
    Attack1: [{ image: 279, base: 472, stride: 6 }],
    AttackRange1: [{ image: 279, base: 520, stride: 7 }],
    AttackRange2: [{ image: 279, base: 576, stride: 7 }, { image: 279, base: 746 }],
    Struck: [{ image: 279, base: 632, stride: 2 }],
    Die: [{ image: 279, base: 648, stride: 9 }],
  },
  281: { // Jar2
    Standing: [{ image: 281, base: 312, stride: 10 }],
    Attack1: [{ image: 281, base: 392, stride: 6 }],
    AttackRange1: [{ image: 281, base: 440, stride: 10 }],
    Struck: [{ image: 281, base: 520, stride: 3 }],
    Die: [{ image: 281, base: 544, stride: 10 }],
  },
  282: { // SeedingsGeneral
    Standing: [{ image: 282, base: 536, stride: 4 }],
    Walking: [{ image: 282, base: 568, stride: 4 }],
    Attack1: [{ image: 282, base: 704, stride: 9 }],
    Attack2: [{ image: 282, base: 776, stride: 9 }],
    Dead: [{ image: 282, base: 1015, stride: 1 }],
    Struck: [{ image: 282, base: 984, stride: 3 }],
    Die: [{ image: 282, base: 1008, stride: 8 }],
    AttackRange1: [{ image: 282, base: 848, stride: 8 }],
    AttackRange2: [{ image: 282, base: 912, stride: 9 }],
  },
  296: { // TucsonGeneral
    Attack1: [{ image: 296, base: 504, stride: 5, offset: -2, min: 2 }],
  },
  301: { // RhinoWarrior
    Attack1: [{ image: 301, base: 320, stride: 7 }],
  },
  306: { // TreeGuardian
    Attack2: [{ image: 306, base: 608, stride: 5, min: 5 }],
  },
  316: { // OmaWitchDoctor
    Standing: [{ image: 316, base: 400, stride: 9 }],
    Walking: [{ image: 316, base: 472, stride: 6 }],
    Attack1: [{ image: 316, base: 520, stride: 7 }],
    AttackRange1: [{ image: 316, base: 576, stride: 7 }],
    AttackRange2: [{ image: 316, base: 632, stride: 9 }],
    Struck: [{ image: 316, base: 704, stride: 3 }],
    Die: [{ image: 316, base: 727, stride: 8 }],
  },
  317: { // LightningBead
    Standing: [{ image: 317, base: 30 }],
    AttackRange1: [{ image: 317, base: 37 }],
    Struck: [{ image: 317, base: 43 }],
    Die: [{ image: 317, base: 50 }],
    Appear: [{ image: 317, base: 58 }],
  },
  318: { // HealingBead
    Standing: [{ image: 318, base: 30 }],
    AttackRange1: [{ image: 318, base: 37 }],
    Struck: [{ image: 318, base: 43 }],
    Die: [{ image: 318, base: 46 }],
    Appear: [{ image: 318, base: 54 }],
  },
  319: { // PowerUpBead
    Standing: [{ image: 319, base: 30 }],
    AttackRange1: [{ image: 319, base: 37 }],
    Struck: [{ image: 319, base: 43 }],
    Die: [{ image: 319, base: 49 }],
    Appear: [{ image: 319, base: 58 }],
  },
  320: { // DarkOmaKing
    Standing: [{ image: 320, base: 784, stride: 10 }],
    Walking: [{ image: 320, base: 864, stride: 6 }],
    Attack1: [{ image: 320, base: 912, stride: 9 }],
    Attack2: [{ image: 320, base: 984, stride: 34 }],
    Attack3: [{ image: 320, base: 1256, stride: 8 }],
    Attack4: [{ image: 320, base: 1320, stride: 9 }],
    AttackRange1: [{ image: 320, base: 1392, stride: 9 }],
    Struck: [{ image: 320, base: 1464, stride: 3 }],
    Die: [{ image: 320, base: 1488, stride: 10 }],
  },
  323: { // PlagueCrab
    Standing: [{ image: 323, base: 248, stride: 4 }],
    Walking: [{ image: 323, base: 280, stride: 6 }],
    Attack1: [{ image: 323, base: 328, stride: 8 }],
    Struck: [{ image: 323, base: 392, stride: 3 }],
    Die: [{ image: 323, base: 423, stride: 7 }],
  },
  333: { // ClawBeast
    Standing: [{ image: 333, base: 256, stride: 4 }],
    Walking: [{ image: 333, base: 288, stride: 6 }],
    Attack1: [{ image: 333, base: 336, stride: 10 }],
    Struck: [{ image: 333, base: 416, stride: 3 }],
    Die: [{ image: 333, base: 440, stride: 8 }],
  },
  334: { // DarkCaptain
    Standing: [{ image: 334, base: 584, stride: 10 }],
    Walking: [{ image: 334, base: 664, stride: 8 }],
    Attack1: [{ image: 334, base: 728, stride: 7 }],
    Attack2: [{ image: 334, base: 784, stride: 7 }],
    AttackRange1: [{ image: 334, base: 840, stride: 7 }],
    AttackRange2: [{ image: 334, base: 896, stride: 7 }],
    Attack3: [{ image: 334, base: 952, stride: 7 }],
    AttackRange3: [{ image: 334, base: 1008, stride: 7 }],
    Struck: [{ image: 334, base: 1064, stride: 3 }],
    Die: [{ image: 334, base: 1088, stride: 10 }],
  },
  339: { // HornedMage
    Standing: [{ image: 339, base: 384, stride: 4 }],
    Walking: [{ image: 339, base: 416, stride: 6 }],
    Attack1: [{ image: 339, base: 464, stride: 8 }],
    AttackRange1: [{ image: 339, base: 528, stride: 9 }],
    AttackRange2: [{ image: 339, base: 600, stride: 8 }],
    Struck: [{ image: 339, base: 664, stride: 3 }],
    Die: [{ image: 339, base: 688, stride: 10 }],
  },
  343: { // HornedWarrior
    Standing: [{ image: 343, base: 376, stride: 4 }],
    Walking: [{ image: 343, base: 408, stride: 6 }],
    Attack1: [{ image: 343, base: 456, stride: 8 }],
    Attack2: [{ image: 343, base: 520, stride: 9 }],
    Attack3: [{ image: 343, base: 592, stride: 8 }],
    Struck: [{ image: 343, base: 656, stride: 3 }],
    Die: [{ image: 343, base: 680, stride: 9 }],
  },
  344: { // FloatingRock
    AttackRange1: [{ image: 344, base: 160, stride: 7, max: 6 }],
  },
  367: { // FrozenGolem
    Standing: [{ image: 367, base: 264, stride: 4 }],
    Walking: [{ image: 367, base: 296, stride: 6 }],
    Attack1: [{ image: 367, base: 344, stride: 8 }],
    Die: [{ image: 367, base: 408, stride: 12 }],
  },
  368: { // IcePhantom
    Standing: [{ image: 368, base: 320, stride: 4 }],
    Walking: [{ image: 368, base: 352, stride: 6 }],
    Attack1: [{ image: 368, base: 400, stride: 9 }],
    AttackRange1: [{ image: 368, base: 472, stride: 8 }],
    AttackRange2: [{ image: 368, base: 472, stride: 8 }],
    Struck: [{ image: 368, base: 536, stride: 3 }],
    Die: [{ image: 368, base: 560, stride: 10 }],
  },
  371: { // WaterDragon
    Show: [{ image: 371, base: 400, stride: 8 }],
    Standing: [{ image: 371, base: 464, stride: 6 }],
    AttackRange1: [{ image: 371, base: 512, stride: 8 }],
    Attack1: [{ image: 371, base: 576, stride: 10 }],
    Struck: [{ image: 371, base: 656, stride: 3 }],
    Die: [{ image: 371, base: 680, stride: 15 }],
    Hide: [{ image: 371, base: 407, stride: 8, reverse: true }],
  },
  373: { // Manticore
    Attack2: [{ image: 373, base: 536, stride: 4, offset: -3, min: 3 }],
  },
  376: { // Kirin
    Standing: [{ image: 376, base: 392, stride: 4 }],
    Walking: [{ image: 376, base: 496, stride: 6 }],
    Attack1: [{ image: 376, base: 544, stride: 7 }],
    Attack2: [{ image: 376, base: 600, stride: 12 }],
    Attack3: [{ image: 376, base: 696, stride: 6 }],
    Struck: [{ image: 376, base: 744, stride: 3 }],
    Die: [{ image: 376, base: 744, stride: 1, offset: -1 }],
  },
  385: { // DarkWraith
    Standing: [{ image: 385, base: 360, stride: 4 }],
    Walking: [{ image: 385, base: 392, stride: 6 }],
    Attack1: [{ image: 385, base: 440, stride: 8 }],
    Attack2: [{ image: 385, base: 504, stride: 10 }],
    Attack3: [{ image: 385, base: 584, stride: 4 }],
    Struck: [{ image: 385, base: 616, stride: 3 }],
    Die: [{ image: 385, base: 640, stride: 10 }],
  },
  386: { // DarkSpirit
    Standing: [{ image: 386, base: 256, stride: 4 }],
    Walking: [{ image: 386, base: 288, stride: 6 }],
    AttackRange1: [{ image: 386, base: 336, stride: 9 }],
    Struck: [{ image: 386, base: 408, stride: 3 }],
    Die: [{ image: 386, base: 432, stride: 10 }],
  },
};

// Native draws the overlay with the same frame cursor as the body, so it needs the step
// the body is on, not a clock of its own.
export function monsterOverlays(entity, action, step, direction, frameStart = 0) {
  const table = MONSTER_OVERLAYS[entity?.Image];
  if (!table) return [];
  const rows = [...(table[action] || []), ...(table["*"] || [])];
  const out = [];
  for (const row of rows) {
    if (row.exceptDead && action === "Dead") continue;
    if (row.min != null && step < row.min) continue;
    if (row.max != null && step > row.max) continue;
    if (row.below != null && step >= row.below) continue;
    if (row.onlyImage != null && entity.Image !== row.onlyImage) continue;
    if (row.minDirection != null && direction < row.minDirection) continue;
    if (row.effect != null && entity.Effect !== row.effect) continue;
    const cursor = row.static ? 0 : (row.reverse ? -step : step);
    out.push({
      image: row.image === null ? entity.Image : row.image,
      index: (row.relative ? frameStart : 0) + row.base + cursor +
        direction * (row.stride || 0) + (row.offset || 0),
      blend: row.blend !== false,
      gray: row.gray === true,
    });
  }
  return out;
}
