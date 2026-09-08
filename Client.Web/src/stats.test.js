import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBaseStat, itemWeight, levelStats, over, pair, percent, plain, plus, realItem,
  refreshStats, skillStats, statNotes,
} from "./stats.js";

// Every expectation below was produced by the real BaseStat.Calculate (Shared/BaseStats.cs),
// run over BaseStats(job).Stats for each class. The values past level 33 are quantised the way
// a C# float quantises -- 1288745728, not 1288745714 -- which is exactly what these guard.
const GROWTH = [
  [0, 33, { FormulaType: 0, Base: 14, Gain: 4, GainRate: 4.5, Max: 0 }, 489],
  [0, 65535, { FormulaType: 0, Base: 14, Gain: 4, GainRate: 4.5, Max: 0 }, 1288745728],
  [0, 65535, { FormulaType: 1, Base: 11, Gain: 3.5, GainRate: 0, Max: 0 }, 229383],
  [0, 65535, { FormulaType: 2, Base: 50, Gain: 3, GainRate: 0, Max: 0 }, 1431612032],
  [0, 65535, { FormulaType: 3, Base: 0, Gain: 5, GainRate: 0, Max: 0 }, 13107],
  [1, 33, { FormulaType: 0, Base: 14, Gain: 15, GainRate: 1.8, Max: 0 }, 146],
  [1, 65535, { FormulaType: 0, Base: 14, Gain: 15, GainRate: 1.8, Max: 0 }, 286440352],
  [1, 65535, { FormulaType: 1, Base: 13, Gain: 5, GainRate: 0, Max: 0 }, 1890016384],
  [2, 33, { FormulaType: 1, Base: 13, Gain: 8, GainRate: 0, Max: 0 }, 312],
  [2, 65535, { FormulaType: 1, Base: 13, Gain: 8, GainRate: 0, Max: 0 }, 1181079936],
  [3, 65535, { FormulaType: 0, Base: 14, Gain: 4, GainRate: 3.25, Max: 0 }, 1073922048],
  [4, 65535, { FormulaType: 1, Base: 11, Gain: 4, GainRate: 0, Max: 0 }, 262151],
];

test("Level growth reproduces BaseStat.Calculate in C# float arithmetic", () => {
  for (const [job, level, stat, expected] of GROWTH)
    assert.equal(calculateBaseStat(stat, job, level), expected, `${job}/${level}/${stat.FormulaType}`);
  // Gain 0 short-circuits to the base, and a Max of its own caps the formula.
  assert.equal(calculateBaseStat({ FormulaType: 3, Base: 15, Gain: 0, GainRate: 0, Max: 0 }, 0, 65535), 15);
  assert.equal(calculateBaseStat({ FormulaType: 3, Base: 0, Gain: 5, GainRate: 0, Max: 40 }, 0, 65535), 40);
});

test("Level growth is keyed by the numeric Stat the packet carries", () => {
  const table = { Stats: [
    { Type: 12, FormulaType: 0, Base: 14, Gain: 4, GainRate: 4.5, Max: 0 },
    { Type: 16, FormulaType: 2, Base: 50, Gain: 3, GainRate: 0, Max: 0 },
    { Type: 11, FormulaType: 3, Base: 15, Gain: 0, GainRate: 0, Max: 0 },
  ] };
  assert.deepEqual(levelStats(table, 0, 33), { HP: 489, BagWeight: 413, Agility: 15 });
  assert.deepEqual(levelStats(null, 0, 33), {});
});

test("Item weight follows UserItem.Weight, including the two kinds that never stack up", () => {
  assert.equal(itemWeight({ Count: 5 }, { Type: 1, Weight: 20 }), 100);
  assert.equal(itemWeight({ Count: 500 }, { Type: 8, Weight: 1 }), 1); // Amulet
  assert.equal(itemWeight({ Count: 500 }, { Type: 30, Weight: 1 }), 1); // Bait
  assert.equal(itemWeight({ Count: 5 }, null), 0);
});

const table = {
  Job: 0,
  Stats: [
    { Type: 12, FormulaType: 0, Base: 14, Gain: 4, GainRate: 4.5, Max: 0 },   // HP
    { Type: 13, FormulaType: 1, Base: 11, Gain: 3.5, GainRate: 0, Max: 0 },   // MP
    { Type: 16, FormulaType: 2, Base: 50, Gain: 3, GainRate: 0, Max: 0 },     // BagWeight
    { Type: 18, FormulaType: 2, Base: 15, Gain: 20, GainRate: 0, Max: 0 },    // WearWeight
    { Type: 17, FormulaType: 2, Base: 12, Gain: 13, GainRate: 0, Max: 0 },    // HandWeight
    { Type: 1, FormulaType: 3, Base: 0, Gain: 7, GainRate: 0, Max: 0 },       // MaxAC
    { Type: 5, FormulaType: 3, Base: 0, Gain: 5, GainRate: 0, Max: 0 },       // MaxDC
  ],
  Caps: { MagicResist: 2, PoisonResist: 6, CriticalRate: 18, CriticalDamage: 10, MaxDC: 0, HP: 0 },
};
const blank = { MinDC: 0, MaxDC: 0, MinAC: 0, MaxAC: 0, HP: 0, MP: 0, Accuracy: 0, MagicResist: 0 };
const definition = (Index, extra) => ({
  Index, Name: `item${Index}`, Type: 1, Shape: 0, Weight: 10, Durability: 100, Set: 0, Unique: 0,
  RequiredType: 0, RequiredAmount: 0, RequiredClass: 31, RequiredGender: 3,
  ClassBased: false, LevelBased: false, Stats: { ...blank }, ...extra,
});
const carried = (ItemIndex, extra) => ({
  UniqueID: ItemIndex, ItemIndex, Count: 1, CurrentDura: 1000, MaxDura: 1000,
  AddedStats: { ...blank }, Slots: [], Awake: { Type: 0 }, ...extra,
});

test("Equipment, sockets and passives add exactly what the native client adds", () => {
  const infos = new Map([
    [1, definition(1, { Type: 1, Weight: 20, Stats: { ...blank, MinDC: 3, MaxDC: 9 } })], // weapon
    [2, definition(2, { Type: 2, Weight: 30, Stats: { ...blank, MaxAC: 6 } })],           // armour
    [3, definition(3, { Type: 18, Weight: 0, Stats: { ...blank, MaxDC: 1 } })],           // gem in a socket
    [4, definition(4, { Type: 13, Weight: 4 })],                                          // potion in the bag
  ]);
  const user = {
    Class: 0, Level: 1, HP: 18, MP: 14,
    Equipment: [
      carried(1, { Slots: [carried(3)], AddedStats: { ...blank, MaxDC: 2 } }),
      carried(2),
    ],
    Inventory: [carried(4, { Count: 3 }), null],
    Magics: [{ Spell: 1, Level: 3 }],
  };
  const { stats, weights, notes } = refreshStats(user, infos, table);
  // Level 1 warrior growth, then the weapon (3-9, +2 added, +1 from its socket) and armour.
  assert.equal(stats.HP, 18);
  assert.equal(stats.MinDC, 3);
  assert.equal(stats.MaxDC, 12);
  assert.equal(stats.MaxAC, 6);
  assert.equal(stats.Accuracy, 9); // Fencing level 3 -> +3 per level
  // Weapons and torches weigh on the hand, everything else on the body; the bag counts stacks.
  assert.deepEqual(weights, { bag: 12, wear: 30, hand: 20 });
  assert.deepEqual(notes, { baseStats: true, unknown: 0, awakened: 0 });
});

test("A broken item keeps its weight and loses its stats", () => {
  const infos = new Map([[1, definition(1, { Weight: 20, Stats: { ...blank, MaxDC: 9 } })]]);
  const user = { Class: 0, Level: 1, Equipment: [carried(1, { CurrentDura: 0 })], Inventory: [], Magics: [] };
  const { stats, weights } = refreshStats(user, infos, table);
  assert.equal(stats.MaxDC, 0);
  assert.equal(weights.hand, 20);
  // An item with no durability at all is never broken.
  const eternal = new Map([[1, definition(1, { Weight: 20, Durability: 0, Stats: { ...blank, MaxDC: 9 } })]]);
  assert.equal(refreshStats(user, eternal, table).stats.MaxDC, 9);
});

test("Rate percentages truncate and caps clamp, the way the C# ints do", () => {
  const infos = new Map([[1, definition(1, {
    Weight: 0, Stats: { ...blank, MaxDC: 7, MaxDCRatePercent: 15, MagicResist: 9, CriticalRate: 40 },
  })]]);
  const user = { Class: 0, Level: 1, Equipment: [carried(1)], Inventory: [], Magics: [] };
  const { stats } = refreshStats(user, infos, table);
  assert.equal(stats.MaxDC, 8); // 7 + trunc(7 * 15 / 100)
  assert.equal(stats.MagicResist, 2); // capped
  assert.equal(stats.CriticalRate, 18); // capped
  // A cap of 0 is an absent cap, not a cap of nothing: StatsConverter writes every stat name.
  assert.equal(stats.HP > 0, true);
});

test("An unknown definition is reported instead of silently weighing nothing", () => {
  const user = { Class: 0, Level: 1, Equipment: [carried(1)], Inventory: [carried(2)], Magics: [] };
  const { weights, notes } = refreshStats(user, new Map(), table);
  assert.deepEqual(weights, { bag: 0, wear: 0, hand: 0 });
  assert.equal(notes.unknown, 2);
  assert.equal(statNotes(notes).length, 1);
  // An awakened item is flagged because the server never sends the awakening values.
  const infos = new Map([[1, definition(1)]]);
  const awake = { Class: 0, Level: 1, Equipment: [carried(1, { Awake: { Type: 1 } })], Inventory: [], Magics: [] };
  assert.equal(refreshStats(awake, infos, table).notes.awakened, 1);
  assert.equal(statNotes(refreshStats(null, infos, null).notes)[0].includes("BaseStatsInfo"), true);
});

test("Buffs and the Muscle ring join the same total", () => {
  const infos = new Map([[1, definition(1, { Weight: 0, Unique: 0x20 })]]);
  const user = { Class: 0, Level: 1, Equipment: [carried(1)], Inventory: [], Magics: [] };
  const worn = refreshStats(user, infos, table).stats;
  assert.equal(worn.BagWeight, 100); // 50 doubled by SpecialItemMode.Muscle
  const buffed = refreshStats(user, infos, table, [{ Stats: { ...blank, MaxDC: 5 } }, { Stats: { ...blank, MaxDC: 3 } }]);
  assert.equal(buffed.stats.MaxDC, 8);
});

test("Passive skills follow the native tables", () => {
  assert.deepEqual(skillStats([{ Spell: 1, Level: 2 }]), { Accuracy: 6 });
  assert.deepEqual(skillStats([{ Spell: 2, Level: 0 }]), { Accuracy: 0, MaxDC: 5 });
  assert.deepEqual(skillStats([{ Spell: 2, Level: 3 }]), { Accuracy: 3, MaxDC: 8 });
  assert.deepEqual(skillStats([{ Spell: 62, Level: 3 }]), { Accuracy: 8 });
  assert.deepEqual(skillStats([{ Spell: 99, Level: 3 }]), {});
});

test("A class based definition resolves to the wearer's own variant", () => {
  const origin = definition(1, { Name: "Sword", ClassBased: true, Stats: { ...blank, MaxDC: 1 } });
  const wizard = definition(2, { Name: "Sword(Wizard)", RequiredClass: 2, Stats: { ...blank, MaxDC: 5 } });
  const infos = new Map([[1, origin], [2, wizard]]);
  assert.equal(realItem(origin, 1, 1, infos).Index, 2);
  assert.equal(realItem(origin, 1, 0, infos).Index, 1);
  assert.equal(realItem(definition(3), 1, 1, infos).Index, 3);
});

test("Each field is formatted the way CharacterDialog formats it", () => {
  assert.equal(pair(3, 9), "3-9");
  assert.equal(pair(undefined, undefined), "0-0");
  assert.equal(over(120, 489), "120/489");
  assert.equal(plus(7), "+7");
  assert.equal(plus(0), "+0");
  assert.equal(percent(18), "18%");
  assert.equal(plain(1288745728), "1288745728");
});

// The panel itself, over a document just real enough for the rows it builds: this is the whole
// path a browser takes, from S.BaseStatsInfo to the text in each cell.
function fakeDocument(ids) {
  const make = (tag) => ({
    tag, children: [], textContent: "", hidden: false,
    append(...nodes) { for (const node of nodes) this.children.push(...node.tag === "#fragment" ? node.children : [node]); },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
  });
  const elements = new Map(ids.map((id) => [id, make("div")]));
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: make,
    createDocumentFragment: () => make("#fragment"),
  };
  return elements;
}

test("The panel renders the native field list once the growth table arrives", async () => {
  const { CharacterStats } = await import("./stats.js");
  const elements = fakeDocument(["character-stats", "stat-rows", "stat-notes"]);
  const infos = new Map([[1, definition(1, { Type: 1, Weight: 20, Stats: { ...blank, MinDC: 3, MaxDC: 9 } })]]);
  const user = {
    ObjectID: 7, Class: 0, Level: 1, HP: 12, MP: 9,
    Equipment: [carried(1)], Inventory: [], Magics: [],
  };
  const panel = new CharacterStats(() => user, () => infos);
  // A closed panel draws nothing at all.
  elements.get("character-stats").hidden = true;
  panel.receive("BaseStatsInfo", { Stats: table });
  assert.equal(elements.get("stat-rows").children.length, 0);

  elements.get("character-stats").hidden = false;
  panel.render();
  const rows = new Map(elements.get("stat-rows").children.map((row) =>
    [row.children[0].textContent, row.children[1].textContent]));
  assert.equal(rows.size, 20);
  assert.equal(rows.get("攻击"), "3-9");
  assert.equal(rows.get("防御"), "0-0");
  assert.equal(rows.get("生命"), "12/18");
  assert.equal(rows.get("魔力"), "9/14");
  assert.equal(rows.get("准确"), "+0");
  assert.equal(rows.get("暴击率"), "0%");
  assert.equal(rows.get("手持负重"), "20/12");
  assert.equal(rows.get("背包负重"), "0/50");
  assert.equal(elements.get("stat-notes").textContent, "");

  // A buff on the player joins the total; one on somebody else never does.
  panel.receive("AddBuff", { Buff: { Type: 3, ObjectID: 7, Stats: { ...blank, MaxDC: 4 } } });
  panel.receive("AddBuff", { Buff: { Type: 3, ObjectID: 8, Stats: { ...blank, MaxDC: 40 } } });
  const buffed = elements.get("stat-rows").children.find((row) => row.children[0].textContent === "攻击");
  assert.equal(buffed.children[1].textContent, "3-13");
  panel.receive("RemoveBuff", { Type: 3, ObjectID: 7 });
  assert.equal(elements.get("stat-rows").children.find((row) => row.children[0].textContent === "攻击")
    .children[1].textContent, "3-9");

  // Losing the growth table (a new character) says so instead of printing zeroes as facts.
  panel.reset();
  panel.render();
  assert.match(elements.get("stat-notes").textContent, /BaseStatsInfo/);
});
