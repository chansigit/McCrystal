import { tileDistance } from "./combat.js";
import { TOGGLES, FLAMING_SWORD } from "./sword-arts.js";

// Spell values are the existing Shared/Enums.cs wire IDs.
export const skillModes = new Map([
  ...[7, 31, 33, 34, 36, 41, 44, 45, 47, 63, 64, 70, 76].map((id) => [id, "target"]),
  // 5 is 野蛮冲撞 and 37 瞬息移动: both are ordinary casts the server reads a direction or a
  // cell off, and both were missing from this table, which is the whole reason a warrior
  // could not dash and a wizard could not blink.
  ...[5, 35, 37, 38, 39, 40, 46, 50, 52, 68, 69, 71, 73, 83, 86].map((id) => [id, "ground"]),
  ...[9, 12, 13, 16, 17, 32, 42, 43, 48, 49, 51, 61, 65, 67, 72, 75, 78, 80].map((id) => [id, "self"]),
]);
// 攻杀剑术, 刺杀剑术, 半月弯刀 and 烈火剑法 never travel as a C.Magic -- they ride on the next
// swing instead -- so they are not a mode here. src/sword-arts.js is where they live.
export const MELEE_SKILLS = new Set([2, 3, 4, 8]);
export function manaCost(magic) { return magic.BaseCost + magic.Level * magic.LevelCost; }

// UserMagic.Key: 1..8 are F1..F8 and 9..16 are Ctrl+F1..F8, the two rows AssignKeyPanel
// offers a player (Client/MirScenes/Dialogs/MainDialogs.cs:3313-3330). 0 means unbound.
export function keyName(key) {
  if (!Number.isInteger(key) || key < 1 || key > 16) return "";
  return key <= 8 ? `F${key}` : `Ctrl+F${key - 8}`;
}
export function castError(user, magic, target, location, now, readyAt = 0) {
  if (!user || user.Dead) return "当前无法施法";
  if (!magic || !user.Magics.some((entry) => entry.Spell === magic.Spell)) return "尚未学会此技能";
  const mode = skillModes.get(magic.Spell);
  if (!mode) return MELEE_SKILLS.has(magic.Spell) ? "这是随攻击发动的剑术，用技能栏上的开关" : "此技能暂未接入";
  if (now < readyAt) return "技能冷却中";
  if (user.MP < manaCost(magic)) return "魔法不足";
  if (mode === "target" && (!target || target.Dead || target.Hidden || target.kind !== "monster")) return "请选择存活的怪物";
  if (!location || !Number.isInteger(location.X) || !Number.isInteger(location.Y)) return "目标位置无效";
  if (magic.Range && tileDistance(user.Location, location) > magic.Range) return "目标超出施法距离";
  return "";
}
export class Skills {
  constructor(getUser, send, world, stopMovement, lockAction) {
    this.getUser = getUser; this.send = send; this.world = world;
    this.stopMovement = stopMovement; this.lockAction = lockAction;
    this.reset();
    this.ticker = setInterval(() => this.updateCooldowns(), 100);
  }
  reset() {
    clearTimeout(this.timeout);
    this.selected = null; this.queued = null; this.pending = null;
    this.readyAt = new Map(); this.lastCast = new Map();
    this.globalReadyAt = 0;
    document.getElementById("skill-status").textContent = "";
    document.getElementById("game").classList.remove("aiming");
  }
  cancel() {
    this.selected = null; this.queued = null;
    this.status("");
    document.getElementById("game").classList.remove("aiming");
    this.render();
  }
  status(text) { document.getElementById("skill-status").textContent = text; }
  select(spell) {
    const magic = this.getUser()?.Magics.find((entry) => entry.Spell === spell);
    if (!magic || !skillModes.has(spell) || this.pending) return;
    this.stopMovement(); this.selected = spell; this.queued = null; this.status("");
    this.world.preloadSpell(spell);
    document.getElementById("game").classList.toggle("aiming", skillModes.get(spell) !== "self");
    if (skillModes.get(spell) === "self") this.aim(this.getUser().Location, this.getUser());
    this.render();
  }
  aim(point, target) {
    if (this.selected == null) return false;
    this.queued = { spell: this.selected, point, targetID: target?.ObjectID ?? 0 };
    this.stopMovement();
    return true;
  }
  process() {
    if (this.pending) return true;
    if (!this.queued) return false;
    if (performance.now() < this.globalReadyAt) return true;
    const user = this.getUser(), command = this.queued;
    const magic = user?.Magics.find((entry) => entry.Spell === command.spell);
    const target = command.targetID === user?.ObjectID ? user : this.world.entities.get(command.targetID);
    const location = command.targetID ? target?.Location : command.point;
    const error = castError(user, magic, target, location, performance.now(), this.readyAt.get(command.spell));
    if (error) { this.status(error); this.queued = null; return true; }
    const dx = Math.sign(location.X - user.Location.X), dy = Math.sign(location.Y - user.Location.Y);
    const direction = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]].findIndex(([x,y]) => x === dx && y === dy);
    this.pending = { ...command, direction: direction < 0 ? user.Direction : direction }; this.queued = null;
    this.globalReadyAt = performance.now() + 1800;
    this.status("施法中…");
    this.send("Magic", { ObjectID: user.ObjectID, Spell: magic.Spell, Direction: direction < 0 ? user.Direction : direction,
      TargetID: command.targetID, Location: location, SpellTargetLock: !!command.targetID });
    this.lockAction(650);
    this.timeout = setTimeout(() => { this.pending = null; this.status("未收到施法确认"); }, 5000);
    return true;
  }
  receive(type, p) {
    const user = this.getUser(); if (!user) return;
    if (type === "NewMagic" && !p.Hero) {
      const index = user.Magics.findIndex((magic) => magic.Spell === p.Magic.Spell);
      if (index < 0) user.Magics.push(p.Magic); else user.Magics[index] = p.Magic;
      this.render();
    } else if (type === "RemoveMagic") {
      if (!Number.isInteger(p.PlaceId) || p.PlaceId < 0 || p.PlaceId >= user.Magics.length) return;
      const removed = user.Magics.splice(p.PlaceId, 1)[0];
      if (removed?.Spell === this.selected) this.cancel();
      this.render();
    } else if (type === "MagicLeveled" && p.ObjectID === user.ObjectID) {
      const magic = user.Magics.find((entry) => entry.Spell === p.Spell);
      if (magic) { magic.Level = p.Level; magic.Experience = p.Experience; this.render(); }
    } else if (type === "MagicDelay" && p.ObjectID === user.ObjectID) {
      const magic = user.Magics.find((entry) => entry.Spell === p.Spell);
      if (magic) {
        magic.Delay = p.Delay;
        if (this.lastCast.has(p.Spell)) this.readyAt.set(p.Spell, this.lastCast.get(p.Spell) + Math.max(0, p.Delay));
      }
    } else if (type === "Magic" || type === "MagicCast") {
      const direction = this.pending?.spell === p.Spell ? this.pending.direction : null;
      if (this.pending?.spell === p.Spell) { clearTimeout(this.timeout); this.pending = null; }
      if (type === "Magic" && !p.Cast) { this.status("施法未成功，目标、状态或材料不满足条件"); return; }
      const magic = user.Magics.find((entry) => entry.Spell === p.Spell);
      const now = performance.now();
      if (direction != null) user.Direction = direction;
      this.lastCast.set(p.Spell, now); this.readyAt.set(p.Spell, now + Math.max(0, magic?.Delay || 0));
      user.castStartedAt = now; user.castUntil = now + 600;
      this.lockAction(600);
      this.status("");
      if (type === "Magic") {
        this.world.showCastSpell(p.Spell, user);
        this.world.showSpell(p.Spell, p.TargetID, p.Target);
      }
    }
  }
  // AssignKeyPanel offers F1..F8 as keys 1..8 and Ctrl+F1..F8 as 9..16
  // (Client/MirScenes/Dialogs/MainDialogs.cs:3313-3330). 17 and up belong to a hero,
  // which this client never spawns.
  keySelect(magic) {
    const select = document.createElement("select");
    select.className = "skill-key";
    select.title = `${magic.Name} 的快捷键`;
    select.setAttribute("aria-label", `${magic.Name} 的快捷键`);
    for (let key = 0; key <= 16; key++) {
      const option = document.createElement("option");
      option.value = String(key); option.textContent = keyName(key) || "—";
      select.append(option);
    }
    select.value = String(magic.Key >= 1 && magic.Key <= 16 ? magic.Key : 0);
    select.onchange = () => this.assignKey(magic, Number(select.value));
    return select;
  }
  // MirConnection.MagicKey clears the key off whatever else was holding it
  // (Server/MirNetwork/MirConnection.cs:1543-1566), and AssignKeyPanel does the same
  // locally before sending, because the server answers with nothing.
  assignKey(magic, key) {
    const user = this.getUser();
    const old = magic.Key || 0;
    if (!user || key === old) return;
    if (key !== 0) for (const entry of user.Magics) if (entry.Key === key) entry.Key = 0;
    magic.Key = key;
    this.send("MagicKey", { Spell: magic.Spell, Key: key, OldKey: old });
    this.render();
  }
  hotkey(number) {
    const magics = this.getUser()?.Magics || [];
    const magic = magics.find((entry) => entry.Key === number);
    if (magic) this.select(magic.Spell);
  }
  render() {
    const grid = document.getElementById("skill-list"); grid.replaceChildren();
    for (const magic of this.getUser()?.Magics || []) {
      const button = document.createElement("button"); button.className = "skill-entry";
      button.type = "button";
      button.setAttribute("aria-pressed", String(this.selected === magic.Spell));
      button.title = `${magic.Name} · MP ${manaCost(magic)} · 距离 ${magic.Range} · 点击设置快捷键`;
      const icon = document.createElement("img"); icon.alt = "";
      icon.src = `/assets/frame?library=MagIcon2&index=${magic.Icon * 2}`;
      const name = document.createElement("strong"); name.textContent = magic.Name;
      const meta = document.createElement("small");
      const castable = skillModes.has(magic.Spell);
      const melee = MELEE_SKILLS.has(magic.Spell);
      meta.textContent = `Lv.${magic.Level} · MP ${manaCost(magic)}${keyName(magic.Key) ? ` · ${keyName(magic.Key)}` : ""}` +
        (castable || melee ? "" : " · 暂不可施放");
      const text = document.createElement("span"); text.append(name, meta);
      const cooldown = document.createElement("span"); cooldown.className = "skill-cooldown"; cooldown.dataset.spell = magic.Spell;
      button.append(icon, text, cooldown);
      const row = document.createElement("div"); row.className = "skill-row";
      const select = this.keySelect(magic);
      // 刺杀剑术 and 半月弯刀 are switches and 烈火剑法 is armed one swing at a time, so the
      // three of them get a button here instead of a hotkey: there is nothing to aim at.
      const arts = this.swordArts;
      let toggle = null;
      if (arts && TOGGLES.includes(magic.Spell)) {
        toggle = document.createElement("button");
        toggle.type = "button"; toggle.className = "skill-toggle";
        const armed = arts.active(magic.Spell);
        toggle.setAttribute("aria-pressed", String(armed));
        toggle.textContent = magic.Spell === FLAMING_SWORD ? (armed ? "已引燃" : "引燃") : armed ? "开" : "关";
        toggle.title = magic.Spell === FLAMING_SWORD
          ? "烈火剑法：点一次燃一剑，耗魔由服务端扣"
          : `${magic.Name}：开着的时候自动附在下一次攻击上`;
        toggle.onclick = (event) => { event.stopPropagation(); arts.toggle(magic.Spell); this.render(); };
      }
      // Native's skill list opens AssignKeyPanel on click; it does not cast. Casting is
      // the hotkey (MainDialogs.cs:3292-3313).
      button.onclick = () => { select.focus(); select.showPicker?.(); };
      button.disabled = false;
      row.append(button, select);
      if (toggle) row.append(toggle);
      grid.append(row);
    }
    if (!grid.children.length) { const empty = document.createElement("p"); empty.textContent = "尚未学习技能"; grid.append(empty); }
    this.updateCooldowns();
  }
  updateCooldowns() {
    for (const label of document.querySelectorAll("[data-spell]")) {
      const remaining = Math.max(this.globalReadyAt, this.readyAt.get(Number(label.dataset.spell)) || 0) - performance.now();
      label.textContent = remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : "";
    }
  }
}
