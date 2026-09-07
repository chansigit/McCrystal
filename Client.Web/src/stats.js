// The character stat panel, ported from the native client rather than read off the wire.
//
// The server never sends a player their own computed stats: S.UserInformation
// (Shared/ServerPackets.cs:587) carries Level, HP, MP, Experience and the bags, but no Stats
// field, and no other packet addressed to the player carries one either -- the only Stats
// objects that reach a client belong to item definitions, buffs and the level-growth table.
// The native client therefore derives every number the character window shows, in
// UserObject.RefreshStats (Client/MirObjects/UserObject.cs:144-700), out of:
//   * S.BaseStatsInfo, the per-class growth formulas and stat caps (Shared/BaseStats.cs), which
//     the server sends once, before the first S.UserInformation;
//   * the equipment it already holds, plus each item's definition from S.NewItemInfo;
//   * passive skills, item sets and buffs.
// This module is that same computation. Anything it cannot see is counted in `notes` and said
// out loud by the panel instead of being quietly folded into a wrong number.
//
// Two contributions are deliberately absent, because the browser has no way to know them:
//   * awakening bonuses -- Awake.listAwake is a private field (Shared/Data/ItemData.cs:889), so
//     the gateway's serializer never sees the per-level values behind Awake.GetDC() and friends;
//     only the Awake.Type survives, which is enough to notice an awakened item and say so.
//   * guild buffs -- RefreshGuildBuffs reads the guild window's enabled buff list, and this
//     client has no guild support at all, so S.GuildBuffList never arrives.

const f = Math.fround;

// Shared/Data/Stat.cs. BaseStat.Type is a Stat enum and arrives as its number; every Stats
// object instead passes through GameSession.StatsConverter and arrives keyed by name.
export const STAT_NAMES = {
  0: "MinAC", 1: "MaxAC", 2: "MinMAC", 3: "MaxMAC", 4: "MinDC", 5: "MaxDC", 6: "MinMC", 7: "MaxMC",
  8: "MinSC", 9: "MaxSC", 10: "Accuracy", 11: "Agility", 12: "HP", 13: "MP", 14: "AttackSpeed",
  15: "Luck", 16: "BagWeight", 17: "HandWeight", 18: "WearWeight", 19: "Reflect", 20: "Strong",
  21: "Holy", 22: "Freezing", 23: "PoisonAttack", 30: "MagicResist", 31: "PoisonResist",
  32: "HealthRecovery", 33: "SpellRecovery", 34: "PoisonRecovery", 35: "CriticalRate",
  36: "CriticalDamage", 40: "MaxACRatePercent", 41: "MaxMACRatePercent", 42: "MaxDCRatePercent",
  43: "MaxMCRatePercent", 44: "MaxSCRatePercent", 45: "AttackSpeedRatePercent",
  46: "HPRatePercent", 47: "MPRatePercent", 48: "HPDrainRatePercent",
};

// Shared/Data/Stat.cs StatFormula.
const HEALTH = 0, MANA = 1, WEIGHT = 2;
// Shared/Enums.cs MirClass.
export const WARRIOR = 0, WIZARD = 1, TAOIST = 2;
// Shared/Enums.cs ItemType.
const WEAPON = 1, ARMOUR = 2, AMULET = 8, TORCH = 12, MOUNT = 19, BAIT = 30;
const RING = 7, BRACELET = 6, NECKLACE = 5, HELMET = 4, BELT = 9, BOOTS = 10;
// Shared/Enums.cs ItemSet.
const SET = {
  None: 0, Spirit: 1, Recall: 2, RedOrchid: 3, RedFlower: 4, Smash: 5, HwanDevil: 6, Purity: 7,
  FiveString: 8, Mundane: 9, NokChi: 10, TaoProtect: 11, Mir: 12, Bone: 13, Bug: 14,
  WhiteGold: 15, WhiteGoldH: 16, RedJade: 17, RedJadeH: 18, Nephrite: 19, NephriteH: 20,
  Whisker1: 21, Whisker2: 22, Whisker3: 23, Whisker4: 24, Whisker5: 25, Hyeolryong: 26,
  Monitor: 27, Oppressive: 28, Paeok: 29, Sulgwan: 30, BlueFrost: 31, DarkGhost: 38, BlueFrostH: 39,
};
// Shared/Data/ItemData.cs ItemSets.Amount: how many pieces complete each set.
const SET_SIZE = new Map([
  [SET.Mundane, 2], [SET.NokChi, 2], [SET.TaoProtect, 2], [SET.Whisker1, 2], [SET.Whisker2, 2],
  [SET.Whisker3, 2], [SET.Whisker4, 2], [SET.Whisker5, 2],
  [SET.RedOrchid, 3], [SET.RedFlower, 3], [SET.Smash, 3], [SET.HwanDevil, 3], [SET.Purity, 3],
  [SET.FiveString, 3], [SET.Bone, 3], [SET.Bug, 3], [SET.DarkGhost, 3],
  [SET.Recall, 4],
  [SET.Spirit, 5], [SET.WhiteGold, 5], [SET.WhiteGoldH, 5], [SET.RedJade, 5], [SET.RedJadeH, 5],
  [SET.Nephrite, 5], [SET.NephriteH, 5], [SET.Hyeolryong, 5], [SET.Monitor, 5],
  [SET.Oppressive, 5], [SET.Paeok, 5], [SET.Sulgwan, 5], [SET.BlueFrostH, 5], [SET.BlueFrost, 5],
]);
// Shared/Enums.cs EquipmentSlot.
const SLOT = {
  Weapon: 0, Armour: 1, Helmet: 2, Torch: 3, Necklace: 4, BraceletL: 5, BraceletR: 6,
  RingL: 7, RingR: 8, Amulet: 9, Belt: 10, Boots: 11, Stone: 12, Mount: 13,
};
// Shared/Enums.cs SpecialItemMode.Muscle.
const MUSCLE = 0x0020;
// Shared/Globals.cs FishingRodShapes.
const FISHING_ROD_SHAPES = [49, 50];
// Shared/Enums.cs Spell: the three passives that add stats in RefreshSkills.
const FENCING = 1, SLAYING = 2, SPIRIT_SWORD = 62;
// C# int.MaxValue, the implicit ceiling on a BaseStat with no Max of its own.
const INT_MAX = 2147483647;

const value = (stats, name) => stats[name] || 0;
function add(stats, source) {
  if (!source) return stats;
  for (const [name, amount] of Object.entries(source))
    if (typeof amount === "number" && amount) stats[name] = value(stats, name) + amount;
  return stats;
}
function bump(stats, name, amount) { stats[name] = value(stats, name) + amount; }

// BaseStat.Calculate (Shared/BaseStats.cs). Gain and GainRate are C# floats and every step of
// these formulas is float arithmetic, so each one is rounded back through Math.fround: at level
// 65535 a float carries steps of 128, and computing in doubles would disagree with the native
// client by hundreds of points. JSON gives back "1.8", not the float 1.8f, so the inputs are
// rounded too. The result is a C# (int) cast of a float, which truncates toward zero.
export function calculateBaseStat(stat, job, level) {
  const base = stat.Base | 0, gain = f(stat.Gain), rate = f(stat.GainRate);
  if (gain === 0) return base;
  const ceiling = stat.Max > 0 ? stat.Max : INT_MAX;
  const two = f(2), point = f(2.2);
  let total;
  if (stat.FormulaType === HEALTH)
    total = job === WARRIOR
      ? f(base + f(f(f(f(level / gain) + rate) + f(level / 20)) * level))
      : f(base + f(f(f(level / gain) + rate) * level));
  else if (stat.FormulaType === MANA) {
    if (job === WIZARD)
      total = f(f(base + f(f(f(f(level / gain) + two) * point) * level)) + f(level * rate));
    else if (job === TAOIST)
      total = f(f(base + f(f(f(level / gain) * point) * level)) + f(level * rate));
    else total = f(f(base + f(level * gain)) + f(level * rate));
  }
  else if (stat.FormulaType === WEIGHT) total = f(base + f(f(level / gain) * level));
  else total = f(base + f(level / gain));
  return Math.trunc(Math.min(f(ceiling), total));
}

// UserObject.RefreshLevelStats.
export function levelStats(baseStats, job, level) {
  const stats = {};
  for (const stat of baseStats?.Stats || []) {
    const name = STAT_NAMES[stat.Type];
    if (name) stats[name] = calculateBaseStat(stat, job, level);
  }
  return stats;
}

// UserItem.Weight (Shared/Data/ItemData.cs:317). The property is get-only, so the gateway's
// serializer drops it and the browser has to multiply the definition's weight itself.
export function itemWeight(item, info) {
  if (!item || !info) return 0;
  return info.Type === AMULET || info.Type === BAIT ? info.Weight : info.Weight * item.Count;
}

// Functions.GetRealItem (Shared/Functions/Functions.cs:342). The native client searches the same
// definitions this one has -- GameScene.ItemInfoList is exactly what S.NewItemInfo delivered.
export function realItem(origin, level, job, infos) {
  if (!origin || (!origin.ClassBased && !origin.LevelBased)) return origin;
  const classMatch = (info) => info.RequiredClass === (1 << job);
  let output = origin;
  for (const info of infos.values()) {
    if (!info.Name?.startsWith(origin.Name)) continue;
    if (origin.RequiredGender !== info.RequiredGender) continue;
    if (origin.ClassBased && origin.LevelBased) {
      if (classMatch(info) && info.RequiredType === 0 && info.RequiredAmount <= level &&
          output.RequiredAmount <= info.RequiredAmount) output = info;
    } else if (origin.ClassBased) {
      if (classMatch(info)) return info;
    } else if (info.RequiredType === 0 && info.RequiredAmount <= level &&
        output.RequiredAmount < info.RequiredAmount) output = info;
  }
  return output;
}

// UserObject.RefreshItemSetStats.
function itemSetStats(stats, sets) {
  let smash = false, purity = false, hwanDevil = false;
  for (const set of sets) {
    const has = (...types) => types.every((type) => set.types.has(type));
    if (set.set === SET.Smash && has(RING, BRACELET) && !smash) { bump(stats, "AttackSpeed", 2); smash = true; }
    if (set.set === SET.Purity && has(RING, BRACELET) && !purity) { bump(stats, "Holy", 3); purity = true; }
    if (set.set === SET.HwanDevil && has(RING, BRACELET) && !hwanDevil) {
      bump(stats, "WearWeight", 5); bump(stats, "BagWeight", 20); hwanDevil = true;
    }
    if (set.set === SET.DarkGhost && has(NECKLACE, BRACELET)) bump(stats, "HP", 25);
    if (set.count < (SET_SIZE.get(set.set) ?? 0)) continue;
    switch (set.set) {
      case SET.Mundane: bump(stats, "HP", 50); break;
      case SET.NokChi: bump(stats, "MP", 50); break;
      case SET.TaoProtect: bump(stats, "HP", 30); bump(stats, "MP", 30); break;
      case SET.RedOrchid: bump(stats, "Accuracy", 2); break;
      case SET.RedFlower: bump(stats, "HP", 50); bump(stats, "MP", -50); break;
      case SET.Smash: bump(stats, "MinDC", 1); bump(stats, "MaxDC", 3); break;
      case SET.HwanDevil: bump(stats, "MinMC", 1); bump(stats, "MaxMC", 2); break;
      case SET.Purity: bump(stats, "MinSC", 1); bump(stats, "MaxSC", 2); break;
      case SET.FiveString:
        bump(stats, "HP", Math.trunc(value(stats, "HP") / 100 * 30));
        bump(stats, "MinAC", 2); bump(stats, "MaxAC", 2); break;
      case SET.Spirit: bump(stats, "MinDC", 2); bump(stats, "MaxDC", 5); bump(stats, "AttackSpeed", 2); break;
      case SET.Bone: bump(stats, "MaxAC", 2); bump(stats, "MaxMC", 1); bump(stats, "MaxSC", 1); break;
      case SET.Bug:
        bump(stats, "MaxDC", 1); bump(stats, "MaxMC", 1); bump(stats, "MaxSC", 1);
        bump(stats, "MaxMAC", 1); bump(stats, "PoisonResist", 1); break;
      case SET.WhiteGold: bump(stats, "MaxDC", 2); bump(stats, "MaxAC", 2); break;
      case SET.WhiteGoldH: bump(stats, "MaxDC", 3); bump(stats, "HP", 30); bump(stats, "AttackSpeed", 2); break;
      case SET.RedJade: bump(stats, "MaxMC", 2); bump(stats, "MaxMAC", 2); break;
      case SET.RedJadeH: bump(stats, "MaxMC", 2); bump(stats, "MP", 40); bump(stats, "Agility", 2); break;
      case SET.Nephrite: bump(stats, "MaxSC", 2); bump(stats, "MaxAC", 1); bump(stats, "MaxMAC", 1); break;
      case SET.NephriteH:
        bump(stats, "MaxSC", 2); bump(stats, "HP", 15); bump(stats, "MP", 20);
        bump(stats, "Holy", 1); bump(stats, "Accuracy", 1); break;
      case SET.Whisker1: bump(stats, "MaxDC", 1); bump(stats, "BagWeight", 25); break;
      case SET.Whisker2: bump(stats, "MaxMC", 1); bump(stats, "BagWeight", 17); break;
      case SET.Whisker3: bump(stats, "MaxSC", 1); bump(stats, "BagWeight", 17); break;
      case SET.Whisker4: bump(stats, "MaxDC", 1); bump(stats, "BagWeight", 20); break;
      case SET.Whisker5: bump(stats, "MaxDC", 1); bump(stats, "BagWeight", 17); break;
      case SET.Hyeolryong:
        bump(stats, "MaxSC", 2); bump(stats, "HP", 15); bump(stats, "MP", 20);
        bump(stats, "Holy", 1); bump(stats, "Accuracy", 1); break;
      case SET.Monitor: bump(stats, "MagicResist", 1); bump(stats, "PoisonResist", 1); break;
      case SET.Oppressive: bump(stats, "MaxAC", 1); bump(stats, "Agility", 1); break;
      case SET.BlueFrost:
        bump(stats, "MinDC", 1); bump(stats, "MaxDC", 1); bump(stats, "MinMC", 1);
        bump(stats, "MaxMC", 1); bump(stats, "HandWeight", 1); bump(stats, "WearWeight", 2); break;
      case SET.BlueFrostH:
        bump(stats, "MinDC", 1); bump(stats, "MaxDC", 2); bump(stats, "MaxMC", 2);
        bump(stats, "Accuracy", 1); bump(stats, "HP", 50); break;
      case SET.DarkGhost: bump(stats, "MP", 25); bump(stats, "AttackSpeed", 2); break;
    }
  }
}

// UserObject.RefreshMirSetStats.
function mirSetStats(stats, mirSet) {
  const has = (...slots) => slots.every((slot) => mirSet.has(slot));
  const either = (...slots) => slots.some((slot) => mirSet.has(slot));
  if (mirSet.size === 10) {
    bump(stats, "MaxAC", 1); bump(stats, "MaxMAC", 1); bump(stats, "BagWeight", 70);
    bump(stats, "Luck", 2); bump(stats, "AttackSpeed", 2); bump(stats, "HP", 70);
    bump(stats, "MP", 80); bump(stats, "MagicResist", 6); bump(stats, "PoisonResist", 6);
  }
  if (has(SLOT.RingL, SLOT.RingR)) { bump(stats, "MaxMAC", 1); bump(stats, "MaxAC", 1); }
  if (has(SLOT.BraceletL, SLOT.BraceletR)) { bump(stats, "MinAC", 1); bump(stats, "MinMAC", 1); }
  if (either(SLOT.RingL, SLOT.RingR) && either(SLOT.BraceletL, SLOT.BraceletR) && has(SLOT.Necklace)) {
    bump(stats, "MaxMAC", 1); bump(stats, "MaxAC", 1);
    bump(stats, "BagWeight", 30); bump(stats, "WearWeight", 17);
  }
  if (has(SLOT.RingL, SLOT.RingR, SLOT.BraceletL, SLOT.BraceletR, SLOT.Necklace)) {
    bump(stats, "MaxMAC", 1); bump(stats, "MaxAC", 1);
    bump(stats, "BagWeight", 20); bump(stats, "WearWeight", 10);
  }
  if (has(SLOT.Armour, SLOT.Helmet, SLOT.Weapon)) {
    bump(stats, "MaxDC", 2); bump(stats, "MaxMC", 1); bump(stats, "MaxSC", 1); bump(stats, "Agility", 1);
  }
  if (has(SLOT.Armour, SLOT.Boots, SLOT.Belt)) {
    bump(stats, "MaxDC", 1); bump(stats, "MaxMC", 1); bump(stats, "MaxSC", 1); bump(stats, "HandWeight", 17);
  }
  if (has(SLOT.Armour, SLOT.Boots, SLOT.Belt, SLOT.Helmet, SLOT.Weapon)) {
    bump(stats, "MinDC", 1); bump(stats, "MaxDC", 1); bump(stats, "MinMC", 1);
    bump(stats, "MaxMC", 1); bump(stats, "MinSC", 1); bump(stats, "MaxSC", 1); bump(stats, "HandWeight", 17);
  }
}

// UserObject.RefreshSkills: three passives feed the character window.
export function skillStats(magics) {
  const stats = {};
  const spiritSword = [0, 3, 5, 8], slaying = [5, 6, 7, 8];
  for (const magic of magics || []) {
    const level = magic.Level | 0;
    if (magic.Spell === FENCING) bump(stats, "Accuracy", level * 3);
    else if (magic.Spell === SLAYING) {
      bump(stats, "Accuracy", level);
      bump(stats, "MaxDC", slaying[level] ?? 0);
    }
    else if (magic.Spell === SPIRIT_SWORD) bump(stats, "Accuracy", spiritSword[level] ?? 0);
  }
  return stats;
}

// UserObject.RefreshStatCaps. BaseStats.Caps is a Stats, so StatsConverter writes every stat name
// with 0 for the ones it does not hold -- and the C# indexer stores no zero, so a 0 here means
// "uncapped", never "capped at nothing".
function applyCaps(stats, caps) {
  for (const [name, cap] of Object.entries(caps || {}))
    if (typeof cap === "number" && cap !== 0) stats[name] = Math.min(cap, value(stats, name));
  for (const name of ["HP", "MP", "MinAC", "MaxAC", "MinMAC", "MaxMAC", "MinDC", "MaxDC", "MinMC", "MaxMC", "MinSC", "MaxSC"])
    stats[name] = Math.max(0, value(stats, name));
  for (const [min, max] of [["MinDC", "MaxDC"], ["MinMC", "MaxMC"], ["MinSC", "MaxSC"]])
    stats[min] = Math.min(value(stats, min), value(stats, max));
}

// UserObject.RefreshStats, in the same order: level growth, bag weight, equipment (with its
// sockets), item sets, the Mir set, passive skills and buffs, then the rate percentages and caps.
export function refreshStats(user, infos = new Map(), baseStats = null, buffs = []) {
  const stats = {};
  const notes = { baseStats: !!baseStats, unknown: 0, awakened: 0 };
  const weights = { bag: 0, wear: 0, hand: 0 };
  if (!user) return { stats, weights, notes };
  const job = user.Class | 0, level = user.Level | 0;
  const info = (item) => (item ? infos.get(item.ItemIndex) : null);
  Object.assign(stats, levelStats(baseStats, job, level));

  for (const item of user.Inventory || []) {
    if (!item) continue;
    const definition = info(item);
    if (!definition) { notes.unknown++; continue; }
    weights.bag += itemWeight(item, definition);
  }

  let mode = 0;
  const sets = [];
  const mirSet = new Set();
  const socketStats = (parent, parentInfo) => {
    // RefreshSocketStats: a fishing rod's sockets are inert, and a mount's only count while ridden.
    if (parentInfo.Type === WEAPON && FISHING_ROD_SHAPES.includes(parentInfo.Shape)) return;
    if (parentInfo.Type === MOUNT && !user.RidingMount) return;
    for (const socket of parent.Slots || []) {
      if (!socket) continue;
      const origin = info(socket);
      if (!origin) { notes.unknown++; continue; }
      const real = realItem(origin, level, job, infos);
      if (real.Type === WEAPON || real.Type === TORCH) weights.hand += itemWeight(socket, origin);
      else weights.wear += itemWeight(socket, origin);
      if (socket.CurrentDura === 0 && real.Durability > 0) continue;
      add(stats, real.Stats);
      add(stats, socket.AddedStats);
      mode |= real.Unique || 0;
    }
  };

  for (let slot = 0; slot < (user.Equipment || []).length; slot++) {
    const item = user.Equipment[slot];
    if (!item) continue;
    const origin = info(item);
    if (!origin) { notes.unknown++; continue; }
    const real = realItem(origin, level, job, infos);
    if (real.Type === WEAPON || real.Type === TORCH) weights.hand += itemWeight(item, origin);
    else weights.wear += itemWeight(item, origin);
    if (item.CurrentDura === 0 && real.Durability > 0) continue;
    if (FISHING_ROD_SHAPES.includes(origin.Shape)) continue;
    add(stats, real.Stats);
    add(stats, item.AddedStats);
    if (item.Awake?.Type) notes.awakened++;
    mode |= real.Unique || 0;
    socketStats(item, origin);
    if (!real.Set) continue;
    const open = sets.find((set) => set.set === real.Set && !set.types.has(real.Type) &&
      set.count < (SET_SIZE.get(set.set) ?? 0));
    if (open) { open.types.add(real.Type); open.count++; }
    else sets.push({ set: real.Set, count: 1, types: new Set([real.Type]) });
    if (real.Set === SET.Mir) mirSet.add(slot);
  }
  if (mode & MUSCLE)
    for (const name of ["BagWeight", "WearWeight", "HandWeight"]) stats[name] = value(stats, name) * 2;

  itemSetStats(stats, sets);
  mirSetStats(stats, mirSet);
  add(stats, skillStats(user.Magics));
  for (const buff of buffs) add(stats, buff?.Stats);

  // C# integer division truncates, so these percentages round down.
  for (const [name, percent] of [["HP", "HPRatePercent"], ["MP", "MPRatePercent"],
    ["MaxAC", "MaxACRatePercent"], ["MaxMAC", "MaxMACRatePercent"], ["MaxDC", "MaxDCRatePercent"],
    ["MaxMC", "MaxMCRatePercent"], ["MaxSC", "MaxSCRatePercent"],
    ["AttackSpeed", "AttackSpeedRatePercent"]])
    bump(stats, name, Math.trunc(value(stats, name) * value(stats, percent) / 100));
  applyCaps(stats, baseStats?.Caps);
  return { stats, weights, notes };
}

// CharacterDialog's own formats (Client/MirScenes/Dialogs/CharacterDialog.cs:96-128).
const whole = (amount) => Math.trunc(Number(amount) || 0);
export const pair = (min, max) => `${whole(min)}-${whole(max)}`;
export const over = (current, maximum) => `${whole(current)}/${whole(maximum)}`;
export const plus = (amount) => `+${whole(amount)}`;
export const percent = (amount) => `${whole(amount)}%`;
export const plain = (amount) => `${whole(amount)}`;

// The character window in native Mir, field for field.
export const STAT_ROWS = [
  ["防御", (s) => pair(s.MinAC, s.MaxAC)],
  ["魔御", (s) => pair(s.MinMAC, s.MaxMAC)],
  ["攻击", (s) => pair(s.MinDC, s.MaxDC)],
  ["魔法", (s) => pair(s.MinMC, s.MaxMC)],
  ["道术", (s) => pair(s.MinSC, s.MaxSC)],
  ["生命", (s, user) => over(user.HP, s.HP)],
  ["魔力", (s, user) => over(user.MP, s.MP)],
  ["暴击率", (s) => percent(s.CriticalRate)],
  ["暴击伤害", (s) => plain(s.CriticalDamage)],
  ["攻击速度", (s) => plain(s.AttackSpeed)],
  ["准确", (s) => plus(s.Accuracy)],
  ["敏捷", (s) => plus(s.Agility)],
  ["幸运", (s) => plain(s.Luck)],
  ["魔法躲避", (s) => plus(s.MagicResist)],
  ["中毒躲避", (s) => plus(s.PoisonResist)],
  ["生命恢复", (s) => plus(s.HealthRecovery)],
  ["魔法恢复", (s) => plus(s.SpellRecovery)],
];

export const WEIGHT_ROWS = [
  ["背包负重", "bag", "BagWeight"],
  ["穿戴负重", "wear", "WearWeight"],
  ["手持负重", "hand", "HandWeight"],
];

// Every number above is only as good as the definitions and packets behind it, so say which
// ones are missing rather than showing a total that quietly leaves them out.
export function statNotes(notes) {
  const lines = [];
  if (!notes.baseStats) lines.push("尚未收到角色成长数据（BaseStatsInfo），数值暂不可用");
  if (notes.unknown) lines.push(`${notes.unknown} 件物品的资料尚未送达，负重与属性可能偏低`);
  if (notes.awakened) lines.push(`${notes.awakened} 件觉醒装备的追加属性未计入（服务器不下发觉醒数值）`);
  return lines;
}

const $ = (id) => document.getElementById(id);

function statRow(label, text) {
  const row = document.createElement("div");
  row.className = "stat-row";
  const name = document.createElement("dt"), value = document.createElement("dd");
  name.textContent = label; value.textContent = text;
  row.append(name, value);
  return row;
}

// The stats page of the native character window (CharacterDialog's StatusPage and StatePage),
// as a tab of the equipment window the way the native dialog holds both.
export class CharacterStats {
  constructor(getUser, getInfos) {
    this.getUser = getUser; this.getInfos = getInfos;
    this.baseStats = null; this.buffs = new Map();
  }
  // The growth table belongs to the class, so a different character starts from nothing again.
  reset() {
    this.baseStats = null; this.buffs = new Map();
  }
  receive(type, p) {
    if (type === "BaseStatsInfo") this.baseStats = p?.Stats || null;
    // GameScene.AddBuff keeps one buff per type, and only the player's own
    // (Client/MirScenes/GameScene.cs:5177).
    else if (type === "AddBuff") {
      const buff = p?.Buff;
      if (!buff || buff.ObjectID !== this.getUser()?.ObjectID) return;
      this.buffs.set(buff.Type, buff);
    }
    else if (type === "RemoveBuff") {
      if (p?.ObjectID !== this.getUser()?.ObjectID) return;
      this.buffs.delete(p.Type);
    }
    else return;
    this.render();
  }
  render() {
    const panel = $("character-stats");
    if (!panel || panel.hidden) return;
    const user = this.getUser();
    if (!user) { $("stat-rows").replaceChildren(); $("stat-notes").textContent = ""; return; }
    const { stats, weights, notes } = refreshStats(user, this.getInfos(), this.baseStats, [...this.buffs.values()]);
    const rows = document.createDocumentFragment();
    for (const [label, format] of STAT_ROWS) rows.append(statRow(label, format(stats, user)));
    for (const [label, key, capacity] of WEIGHT_ROWS)
      rows.append(statRow(label, over(weights[key], stats[capacity])));
    $("stat-rows").replaceChildren(rows);
    $("stat-notes").textContent = statNotes(notes).join("；");
  }
}
