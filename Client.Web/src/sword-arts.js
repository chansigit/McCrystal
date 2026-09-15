import { directions } from "./world.js";

// Shared/Enums.cs Spell. These four are the 1.76 melee skills that never travel as a
// C.Magic: three the player switches on and one the server switches on for them, all of
// which then ride on the next C.Attack as its Spell.
export const SLAYING = 2, THRUSTING = 3, HALF_MOON = 4, FLAMING_SWORD = 8;
// What the player can turn on and off. 攻杀剑术 is not here: the server arms it, the
// player never does (HumanObject.cs:2955-2965).
export const TOGGLES = [THRUSTING, HALF_MOON, FLAMING_SWORD];
export const ATTACK_SPELLS = new Set([SLAYING, THRUSTING, HALF_MOON, FLAMING_SWORD]);
// Shared/Enums.cs SpellToggleState: None = -1 means "flip it", which is what the native
// client sends for nothing and this client never needs.
export const TOGGLE_ON = 1, TOGGLE_OFF = 0;
// GameScene.ToggleTime: the native client refuses a second flip inside a second.
export const TOGGLE_INTERVAL = 1000;

export function pointMove(point, direction, distance = 1) {
  const step = directions[direction] || [0, 0];
  return { X: point.X + step[0] * distance, Y: point.Y + step[1] * distance };
}

export function manaCost(magic) {
  return (magic?.BaseCost || 0) + (magic?.Level || 0) * (magic?.LevelCost || 0);
}

/// <summary>Which of the four melee skills rides on the swing about to be sent.</summary>
// Client/MirObjects/PlayerObject.cs:1355-1420 runs these as four sequential ifs, so a
// later one overwrites an earlier one and the order is the priority. Reproduced here in
// the same order: every one of them is also re-checked by HumanObject.Attack, which
// answers a skill it will not allow by degrading the swing to a plain one.
export function attackSpell(state, user, world, direction) {
  if (!user?.Location) return 0;
  const magic = (spell) => user.Magics?.find((entry) => entry.Spell === spell);
  const blocking = (point) => {
    for (const entity of world?.entities?.values() || [])
      if (entity.Location?.X === point.X && entity.Location?.Y === point.Y &&
        !entity.Dead && !entity.Hidden && entity.kind !== "npc") return true;
    return false;
  };
  let spell = 0;
  const target = blocking(pointMove(user.Location, direction, 1));
  if (state.slaying && target) spell = SLAYING;
  // 刺杀剑术 reaches two cells, and native only spends it when the second one is occupied.
  if (state.thrusting && magic(THRUSTING) && blocking(pointMove(user.Location, direction, 2)))
    spell = THRUSTING;
  if (state.halfMoon) {
    // MapControl.CanHalfMoon sweeps the facing direction and its two neighbours, four
    // cells in all, because the swing is an arc rather than a line.
    const arc = [-1, 0, 1, 2].some((offset) =>
      blocking(pointMove(user.Location, (direction + offset + 8) % 8, 1)));
    const entry = magic(HALF_MOON);
    if ((target || arc) && entry && manaCost(entry) <= user.MP) spell = HALF_MOON;
  }
  if (state.flamingSword && target && magic(FLAMING_SWORD)) spell = FLAMING_SWORD;
  return spell;
}

/// <summary>攻杀剑术, 刺杀剑术, 半月弯刀 and 烈火剑法.</summary>
// Five of 1.76's 33 skills never reached this client: these four plus 野蛮冲撞, which is a
// plain cast and only needed a mode. Two of these are a switch the player throws
// (C.SpellToggle), one is armed by casting it, and 攻杀剑术 is armed by the server on a
// roll of its own and spent by the very next swing.
export class SwordArts {
  constructor(getUser, send, world) {
    this.getUser = getUser; this.send = send; this.world = world;
    this.reset();
  }
  reset() {
    this.state = { slaying: false, thrusting: false, halfMoon: false, flamingSword: false };
    // -Infinity rather than 0: the interval below must not swallow the first press
    // of a session, which at a monotonic clock's origin is exactly zero.
    this.toggledAt = -Infinity;
    this.onChange = null;
  }
  known(spell) { return !!this.getUser()?.Magics?.some((magic) => magic.Spell === spell); }
  active(spell) {
    return spell === THRUSTING ? this.state.thrusting
      : spell === HALF_MOON ? this.state.halfMoon
      : spell === FLAMING_SWORD ? this.state.flamingSword : false;
  }
  // 烈火剑法 is not a switch: each arming costs mana and lasts one swing, so the button
  // asks for it again rather than turning it off.
  toggle(spell, now = performance.now()) {
    if (!TOGGLES.includes(spell) || !this.known(spell)) return false;
    if (now - this.toggledAt < TOGGLE_INTERVAL) return false;
    const user = this.getUser();
    const magic = user?.Magics?.find((entry) => entry.Spell === spell);
    if (spell === FLAMING_SWORD && manaCost(magic) > (user?.MP ?? 0)) return false;
    const wanted = spell === FLAMING_SWORD ? true : !this.active(spell);
    if (!this.send("SpellToggle", { Spell: spell, canUse: wanted ? TOGGLE_ON : TOGGLE_OFF })) return false;
    this.toggledAt = now;
    // 刺杀 and 半月 are the client's own state -- the server echoes nothing back for them,
    // exactly as the native client assumes (GameScene.cs:1028-1052). 烈火 waits for the
    // server's own S.SpellToggle, because the server is what pays the mana.
    if (spell !== FLAMING_SWORD) {
      this.state[spell === THRUSTING ? "thrusting" : "halfMoon"] = wanted;
      this.onChange?.();
    }
    return true;
  }
  // S.SpellToggle: the server arming 攻杀剑术 for the next swing, or confirming 烈火剑法.
  receive(p, userID) {
    if (p.ObjectID !== userID) return;
    if (p.Spell === SLAYING) this.state.slaying = !!p.CanUse;
    else if (p.Spell === FLAMING_SWORD) this.state.flamingSword = !!p.CanUse;
    else return;
    this.onChange?.();
  }
  spellFor(direction) {
    return attackSpell(this.state, this.getUser(), this.world, direction);
  }
  // Both one-shot skills are spent by the swing that carried them; the two switches stay
  // on. Native clears Slaying the same way and lets the server re-arm it.
  spent(spell) {
    if (spell === SLAYING) this.state.slaying = false;
    else if (spell === FLAMING_SWORD) this.state.flamingSword = false;
    else return;
    this.onChange?.();
  }
}
