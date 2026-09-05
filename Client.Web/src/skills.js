import { tileDistance } from "./combat.js";

// Spell values are the existing Shared/Enums.cs wire IDs.
export const skillModes = new Map([
  ...[7, 31, 33, 34, 36, 41, 44, 45, 47, 63, 64, 70, 76].map((id) => [id, "target"]),
  ...[35, 38, 39, 40, 46, 50, 52, 68, 69, 71, 73, 83, 86].map((id) => [id, "ground"]),
  ...[9, 12, 13, 16, 17, 32, 42, 43, 48, 49, 51, 61, 65, 67, 72, 75, 78, 80].map((id) => [id, "self"]),
]);
export function manaCost(magic) { return magic.BaseCost + magic.Level * magic.LevelCost; }
export function castError(user, magic, target, location, now, readyAt = 0) {
  if (!user || user.Dead) return "当前无法施法";
  if (!magic || !user.Magics.some((entry) => entry.Spell === magic.Spell)) return "尚未学会此技能";
  const mode = skillModes.get(magic.Spell);
  if (!mode) return "此技能暂未接入";
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
      if (type === "Magic") this.world.showSpell(p.Spell, p.TargetID, p.Target);
    }
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
      button.type = "button"; button.disabled = !skillModes.has(magic.Spell);
      button.setAttribute("aria-pressed", String(this.selected === magic.Spell));
      button.title = `${magic.Name} · MP ${manaCost(magic)} · 距离 ${magic.Range}`;
      const icon = document.createElement("img"); icon.alt = "";
      icon.src = `/assets/frame?library=MagIcon2&index=${magic.Icon * 2}`;
      const name = document.createElement("strong"); name.textContent = magic.Name;
      const meta = document.createElement("small");
      meta.textContent = `Lv.${magic.Level} · MP ${manaCost(magic)}${magic.Key >= 1 && magic.Key <= 8 ? ` · F${magic.Key}` : ""}${button.disabled ? " · 暂不可施放" : ""}`;
      const text = document.createElement("span"); text.append(name, meta);
      const cooldown = document.createElement("span"); cooldown.className = "skill-cooldown"; cooldown.dataset.spell = magic.Spell;
      button.append(icon, text, cooldown); button.onclick = () => this.select(magic.Spell); grid.append(button);
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
