import { createIcons, Shirt, PackageOpen, FlaskConical, Trash2, Split } from "lucide";
import { BELT_SIZE, equipmentNames, usableTypes, equipSlot, canEquipAt, emptyBagSlot, applyInventoryPacket, placeItem, clampCount } from "./inventory.js";
import { equippedWeapon } from "./appearance.js";

const $ = (id) => document.getElementById(id);
// A command is settled by the packet the server answers it with; only a split is
// acknowledged under a different name (S.SplitItem1 carries the result, S.SplitItem the new stack).
const acks = {
  MoveItem: "MoveItem", EquipItem: "EquipItem", RemoveItem: "RemoveItem",
  UseItem: "UseItem", DropItem: "DropItem", SplitItem: "SplitItem1",
};
// The server refuses a drop or a split without saying why, so name the causes it actually checks.
const failures = {
  DropItem: "无法丢弃：物品已绑定，或此地图禁止丢弃",
  SplitItem: "无法拆分：数量超出堆叠或背包已满",
};
export class InventoryUI {
  constructor(getUser, getInfo, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.send = send;
    this.reset();
    $("item-action").onclick = () => this.selected && this.activate(this.selected);
    $("item-drop").onclick = () => this.dropItem();
    $("item-split").onclick = () => this.splitItem();
    $("drop-gold").onclick = () => this.dropGold();
  }
  reset() {
    clearTimeout(this.timer);
    this.pending = null; this.uncertain = false; this.selected = null; this.dragged = null;
    $("inventory-status").textContent = "";
    $("item-details").hidden = true;
  }
  item(ref) {
    return this.getUser()?.[ref.grid === "equipment" ? "Equipment" : "Inventory"]?.[ref.index];
  }
  available() { return !!this.getUser() && !this.getUser().Dead && !this.pending && !this.uncertain; }
  request(type, data) {
    if (!this.available()) return;
    this.pending = { type, data };
    $("inventory-status").textContent = "等待服务器确认…";
    this.send(type, data);
    // Nothing here is applied optimistically, so a late reply still lands correctly.
    // An unanswered command therefore only has to release the UI lock; keeping it, as
    // this timeout used to, stranded the whole bag until the player logged in again.
    this.timer = setTimeout(() => {
      this.pending = null;
      $("inventory-status").textContent = "服务器未回应，请重试";
      this.render();
    }, 8000);
    this.render();
  }
  receive(type, data) {
    if (!this.getUser()) return;
    if (this.pending && acks[this.pending.type] === type &&
        (type === "MoveItem" ? this.pending.data.From === data.From && this.pending.data.To === data.To
          : this.pending.data.UniqueID === data.UniqueID)) {
      const attempted = this.pending.type;
      clearTimeout(this.timer); this.pending = null;
      $("inventory-status").textContent = data.Success ? "" : failures[attempted] || "服务器未允许此操作";
    }
    try {
      if (type === "SplitItem") {
        if (data.Grid === 1 && data.Item) placeItem(this.getUser().Inventory, data.Item, this.getInfo(data.Item.ItemIndex));
      } else applyInventoryPacket(this.getUser(), type, data);
    }
    catch (error) { this.uncertain = true; $("inventory-status").textContent = error.message; }
    if (type === "DuraChanged" || type === "ItemRepaired") {
      this.updateAppearance(this.getUser()); this.renderDetails(this.getUser());
    }
    else this.render();
  }
  activate(ref) {
    const item = this.item(ref);
    if (!item || !this.available()) return;
    const info = this.getInfo(item.ItemIndex);
    if (!info) return;
    if (ref.grid === "equipment") {
      const To = emptyBagSlot(this.getUser().Inventory);
      if (To < 0) { $("inventory-status").textContent = "背包已满"; return; }
      this.request("RemoveItem", { Grid: 1, UniqueID: item.UniqueID, To });
    } else {
      const To = equipSlot(info, this.getUser().Equipment);
      if (To >= 0) this.request("EquipItem", { Grid: 1, UniqueID: item.UniqueID, To });
      else if (usableTypes.has(info.Type)) {
        if (info.Type === 13 && info.Shape === 4 && !window.confirm(`使用 ${info.Name}？`)) return;
        this.request("UseItem", { Grid: 1, UniqueID: item.UniqueID });
      }
    }
  }
  // Native drop: a single item asks for confirmation, a stack asks for an amount instead.
  dropItem() {
    const ref = this.selected, item = ref?.grid === "bag" && this.item(ref);
    if (!item || !this.available()) return;
    const name = this.getInfo(item.ItemIndex)?.Name || "未知物品";
    let Count = 1;
    if (item.Count > 1) {
      const answer = window.prompt(`丢弃 ${name} 的数量（1-${item.Count}）`, String(item.Count));
      if (answer === null) return;
      Count = clampCount(answer, item.Count);
      if (!Count) { $("inventory-status").textContent = "丢弃数量无效"; return; }
    } else if (!window.confirm(`丢弃 ${name}？`)) return;
    this.request("DropItem", { UniqueID: item.UniqueID, Count, HeroInventory: false });
  }
  // The server rejects a split that fills the bag or takes the whole stack, so ask for
  // an amount the server can actually honour rather than burning the lock on a refusal.
  splitItem() {
    const ref = this.selected, item = ref?.grid === "bag" && this.item(ref);
    if (!item || item.Count < 2 || !this.available()) return;
    if (emptyBagSlot(this.getUser().Inventory) < 0) { $("inventory-status").textContent = "背包已满"; return; }
    const name = this.getInfo(item.ItemIndex)?.Name || "未知物品", max = item.Count - 1;
    const answer = window.prompt(`拆分 ${name} 的数量（1-${max}）`, "1");
    if (answer === null) return;
    const Count = clampCount(answer, max);
    if (!Count) { $("inventory-status").textContent = "拆分数量无效"; return; }
    this.request("SplitItem", { Grid: 1, UniqueID: item.UniqueID, Count });
  }
  // Gold is never acknowledged: the server answers a successful drop with S.LoseGold and
  // stays silent otherwise, so this must not take the inventory lock it could never release.
  dropGold() {
    const user = this.getUser();
    if (!user || user.Dead) return;
    const gold = Number(user.Gold || 0);
    if (gold < 1) { $("inventory-status").textContent = "没有可丢弃的金币"; return; }
    const answer = window.prompt(`丢弃金币的数量（1-${gold}）`, "1");
    if (answer === null) return;
    const Amount = clampCount(answer, gold);
    if (!Amount) { $("inventory-status").textContent = "金币数量无效"; return; }
    $("inventory-status").textContent = this.send("DropGold", { Amount }) ? `正在丢弃 ${Amount} 金币…` : "连接已断开";
  }
  drop(from, to) {
    const item = this.item(from);
    if (!item || !this.available()) return;
    if (from.grid === "bag" && to.grid === "bag" && from.index !== to.index)
      this.request("MoveItem", { Grid: 1, From: from.index, To: to.index });
    else if (from.grid === "bag" && to.grid === "equipment" && canEquipAt(this.getInfo(item.ItemIndex), to.index))
      this.request("EquipItem", { Grid: 1, UniqueID: item.UniqueID, To: to.index });
    else if (from.grid === "equipment" && to.grid === "bag" && !this.item(to))
      this.request("RemoveItem", { Grid: 1, UniqueID: item.UniqueID, To: to.index });
  }
  slot(ref, label, quick = false) {
    const item = this.item(ref), info = item && this.getInfo(item.ItemIndex);
    const button = document.createElement("button");
    button.type = "button"; button.className = "slot";
    button.disabled = !this.available();
    button.draggable = !!item && this.available();
    button.setAttribute("aria-label", `${label}${item ? `：${info?.Name || "未知物品"}，${item.Count} 个` : "：空"}`);
    button.title = button.getAttribute("aria-label");
    if (this.selected?.grid === ref.grid && this.selected?.index === ref.index) button.classList.add("selected");
    if (info) {
      const img = document.createElement("img");
      img.src = `/assets/frame?library=Items&index=${info.Image}`;
      img.alt = ""; img.draggable = false; button.append(img);
    }
    if (item?.Count > 1) {
      const count = document.createElement("small"); count.textContent = item.Count; button.append(count);
    }
    if (quick) {
      const key = document.createElement("span"); key.className = "belt-key";
      key.textContent = ref.index + 1; button.append(key);
    }
    button.onclick = () => {
      if (!item && this.selected && this.item(this.selected)) {
        this.drop(this.selected, ref); return;
      }
      this.selected = ref;
      if (quick) this.activate(ref);
      else {
        document.querySelectorAll(".slot.selected").forEach((slot) => slot.classList.remove("selected"));
        button.classList.add("selected"); this.renderDetails(this.getUser());
      }
    };
    button.ondblclick = () => { if (!quick) this.activate(ref); };
    button.oncontextmenu = (e) => { e.preventDefault(); this.selected = ref; this.activate(ref); };
    button.ondragstart = (e) => {
      this.dragged = { ...ref, uniqueID: item.UniqueID };
      e.dataTransfer.setData("text/plain", "crystal-item");
      e.dataTransfer.effectAllowed = "move";
    };
    button.ondragend = () => { this.dragged = null; };
    button.ondragover = (e) => { if (this.dragged) e.preventDefault(); };
    button.ondrop = (e) => {
      e.preventDefault();
      const from = this.dragged; this.dragged = null;
      if (from && this.item(from)?.UniqueID === from.uniqueID) this.drop(from, ref);
    };
    return button;
  }
  render() {
    const user = this.getUser();
    if (!user) return;
    const bag = document.createDocumentFragment();
    for (let i = BELT_SIZE; i < user.Inventory.length; i++) bag.append(this.slot({ grid: "bag", index: i }, `背包 ${i - BELT_SIZE + 1}`));
    $("inventory-grid").replaceChildren(bag);
    const belt = document.createDocumentFragment();
    for (let i = 0; i < Math.min(BELT_SIZE, user.Inventory.length); i++) belt.append(this.slot({ grid: "bag", index: i }, `快捷栏 ${i + 1}`, true));
    $("belt").replaceChildren(belt);
    const equipment = document.createDocumentFragment();
    for (let i = 0; i < user.Equipment.length; i++) {
      const entry = document.createElement("div"); entry.className = "equipment-entry";
      const label = document.createElement("span"); label.textContent = equipmentNames[i];
      entry.append(this.slot({ grid: "equipment", index: i }, equipmentNames[i]), label); equipment.append(entry);
    }
    $("equipment-grid").replaceChildren(equipment);
    $("gold").textContent = `金币 ${Number(user.Gold || 0).toLocaleString()} · 背包 ${user.Inventory.slice(BELT_SIZE).filter(Boolean).length}/${user.Inventory.length - BELT_SIZE}`;
    $("drop-gold").disabled = !!user.Dead || Number(user.Gold || 0) < 1;
    this.updateAppearance(user);
    this.renderDetails(user);
  }
  renderDetails(user) {
    const item = this.selected && this.item(this.selected), info = item && this.getInfo(item.ItemIndex);
    $("item-details").hidden = !item;
    $("item-name").textContent = info?.Name || "未知物品";
    const details = [];
    if (item) {
      details.push(`数量 ${item.Count}`);
      if (item.MaxDura) details.push(`持久 ${(item.CurrentDura / 1000).toFixed(1)}/${(item.MaxDura / 1000).toFixed(1)}`);
      if (info?.Weight) details.push(`重量 ${info.Weight}`);
      if (info?.RequiredAmount) details.push(`需求 ${info.RequiredAmount}`);
      const names = { MinDC: "攻击下限", MaxDC: "攻击上限", MinMC: "魔法下限", MaxMC: "魔法上限", MinSC: "道术下限", MaxSC: "道术上限", MinAC: "防御下限", MaxAC: "防御上限", MinMAC: "魔御下限", MaxMAC: "魔御上限", HP: "生命", MP: "魔法", Accuracy: "准确", Agility: "敏捷", AttackSpeed: "攻速" };
      for (const [stat, label] of Object.entries(names)) {
        const value = (info?.Stats?.[stat] || 0) + (item.AddedStats?.[stat] || 0);
        if (value) details.push(`${label} ${value}`);
      }
    }
    $("item-stats").textContent = details.join(" · ");
    const removing = this.selected?.grid === "equipment", equipping = equipSlot(info, user.Equipment) >= 0;
    const action = $("item-action");
    action.hidden = !item || (!removing && !equipping && !usableTypes.has(info?.Type));
    action.disabled = !this.available();
    action.replaceChildren();
    const icon = document.createElement("i"); icon.dataset.lucide = removing ? "package-open" : equipping ? "shirt" : "flask-conical";
    const text = document.createElement("span"); text.textContent = removing ? "卸下" : equipping ? "装备" : "使用";
    action.append(icon, text);
    createIcons({ icons: { Shirt, PackageOpen, FlaskConical }, root: action });
    // Only bag items can be thrown away or split; equipment has to be taken off first.
    const bagged = this.selected?.grid === "bag" && !!item;
    this.extraAction("item-drop", bagged, "trash-2", "丢弃");
    this.extraAction("item-split", bagged && item.Count > 1, "split", "拆分");
  }
  extraAction(id, visible, lucide, label) {
    const button = $(id);
    button.hidden = !visible;
    button.disabled = !this.available();
    button.replaceChildren();
    if (!visible) return;
    const icon = document.createElement("i"); icon.dataset.lucide = lucide;
    const text = document.createElement("span"); text.textContent = label;
    button.append(icon, text);
    createIcons({ icons: { Trash2, Split }, root: button });
  }
  hideDetails() {
    this.selected = null;
    $("item-details").hidden = true;
    document.querySelectorAll(".slot.selected").forEach((slot) => slot.classList.remove("selected"));
  }
  updateAppearance(user) {
    user.Armour = this.getInfo(user.Equipment[1]?.ItemIndex)?.Shape || 0;
    const weapon = user.Equipment[0];
    Object.assign(user, equippedWeapon(weapon, this.getInfo(weapon?.ItemIndex)));
  }
}
