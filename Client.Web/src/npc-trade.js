import { BELT_SIZE, clampCount } from "./inventory.js";

const $ = (id) => document.getElementById(id);
// Shared/Enums.cs BindMode. NPCDropDialog.Confirm refuses these outright, and the server
// (PlayerObject.SellItem / RepairItem) checks the same two flags before doing anything.
export const DONT_SELL = 4, DONT_REPAIR = 32;
const TITLES = { sell: "出售", repair: "修理" };

// The native amount box never offers more than the stack it was opened on, and the
// server refuses a count larger than the stack it finds; ushort is the wire limit.
export function sellCount(raw, item, info) {
  if (!item || !Number.isInteger(item.Count) || item.Count < 1) return 0;
  const stack = Number.isInteger(info?.StackSize) && info.StackSize > 0 ? info.StackSize : item.Count;
  return clampCount(raw, Math.min(item.Count, stack, 65535));
}

// Both NPCDropDialog and PlayerObject.RepairItem look at the bag alone: an equipped
// item has to be taken off first, so listing equipment here would only produce refusals.
export function repairList(bag, getInfo) {
  const rows = [];
  bag.forEach((item, index) => {
    if (!item || !(item.MaxDura > 0) || !(item.CurrentDura < item.MaxDura)) return;
    const info = getInfo(item.ItemIndex);
    // Info.Durability == 0 marks a type that never wears; the native cell refuses those.
    if (info && !(info.Durability > 0)) return;
    rows.push({ index, item, info, blocked: !!(info?.Bind & DONT_REPAIR) });
  });
  return rows;
}

export function sellList(bag, getInfo) {
  const rows = [];
  bag.forEach((item, index) => {
    if (!item) return;
    const info = getInfo(item.ItemIndex);
    rows.push({ index, item, info, blocked: !!(info?.Bind & DONT_SELL) });
  });
  return rows;
}

// The sell and repair services share one frame because the native client shares one
// dialog (NPCDropDialog) between them, switching only its label and its confirm packet.
export class NPCTrade {
  constructor(getUser, getInfo, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.send = send;
    this.panel = $("npc-trade");
    this.close();
  }
  close() {
    clearTimeout(this.timer);
    this.mode = null; this.rate = null; this.pending = null;
    this.panel.hidden = true;
    $("trade-status").textContent = "";
  }
  open(mode, rate) {
    if (!TITLES[mode]) return;
    clearTimeout(this.timer);
    this.mode = mode; this.rate = rate; this.pending = null;
    this.panel.hidden = false;
    $("trade-title").textContent = TITLES[mode];
    $("trade-status").textContent = "";
    this.render();
  }
  refresh() { if (this.mode) this.render(); }
  available() {
    const user = this.getUser();
    return !!user && !user.Dead && !this.pending;
  }
  rows() {
    const bag = this.getUser()?.Inventory || [];
    return this.mode === "repair" ? repairList(bag, this.getInfo) : sellList(bag, this.getInfo);
  }
  render() {
    const user = this.getUser();
    if (!user) return;
    const rows = this.rows();
    const list = document.createDocumentFragment();
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "shop-row";
      button.disabled = !this.available() || row.blocked;
      const image = document.createElement("img"); image.alt = ""; image.draggable = false;
      if (row.info) image.src = `/assets/frame?library=Items&index=${row.info.Image}`;
      const name = document.createElement("span");
      const slot = row.index < BELT_SIZE ? `快捷栏 ${row.index + 1}` : `背包 ${row.index - BELT_SIZE + 1}`;
      name.textContent = `${row.info?.Name || "加载中…"}${row.item.Count > 1 ? ` × ${row.item.Count}` : ""}（${slot}）`;
      const detail = document.createElement("small");
      detail.textContent = row.blocked
        ? (this.mode === "repair" ? "不可修理" : "不可出售")
        : row.item.MaxDura > 0
          ? `持久 ${(row.item.CurrentDura / 1000).toFixed(1)}/${(row.item.MaxDura / 1000).toFixed(1)}`
          : "";
      button.append(image, name, detail);
      button.onclick = () => this.choose(row.item.UniqueID);
      list.append(button);
    }
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.textContent = this.mode === "repair" ? "背包里没有需要修理的物品。" : "背包是空的。";
      list.append(empty);
    }
    $("trade-list").replaceChildren(list);
    // The server never quotes a sale or repair price: S.NPCSell carries no fields and
    // S.NPCRepair carries only the NPC rate, so a number here could only be a guess.
    const damagedEquipment = this.mode === "repair" &&
      (user.Equipment || []).some((item) => item && item.MaxDura > 0 && item.CurrentDura < item.MaxDura);
    $("trade-hint").textContent = this.mode === "repair"
      ? `修理费由服务端结算${damagedEquipment ? "；身上的装备需先卸下才能修理" : ""}`
      : "售价由服务端结算";
    $("trade-total").textContent = `金币 ${Number(user.Gold || 0).toLocaleString()}`;
  }
  choose(uniqueID) {
    if (!this.available()) return;
    const row = this.rows().find((row) => row.item.UniqueID === uniqueID);
    if (!row) return;
    if (row.blocked) {
      $("trade-status").textContent = this.mode === "repair" ? "此物品无法修理" : "此物品无法出售";
      return;
    }
    const name = row.info?.Name || "未知物品";
    if (this.mode === "repair") {
      if (!window.confirm(`修理 ${name}？修理费由服务端从金币中扣除。`)) return;
      this.request("RepairItem", { UniqueID: uniqueID });
      return;
    }
    // The native sell panel hands the whole stack over; a count prompt only narrows that.
    let Count = 1;
    if (row.item.Count > 1) {
      const answer = window.prompt(`出售 ${name} 的数量（1-${row.item.Count}）`, String(row.item.Count));
      if (answer === null) return;
      Count = sellCount(answer, row.item, row.info);
      if (!Count) { $("trade-status").textContent = "出售数量无效"; return; }
    } else if (!window.confirm(`出售 ${name}？`)) return;
    this.request("SellItem", { UniqueID: uniqueID, Count });
  }
  request(type, data) {
    if (!this.send(type, data)) { $("trade-status").textContent = "连接已断开"; return; }
    this.pending = { type, uniqueID: data.UniqueID };
    $("trade-status").textContent = "等待服务器确认…";
    // Nothing is applied optimistically, so a late reply still lands correctly; an
    // unanswered command only has to release the lock instead of stranding the panel.
    this.timer = setTimeout(() => {
      this.pending = null;
      $("trade-status").textContent = "服务器未回应，请重试";
      this.render();
    }, 8000);
    this.render();
  }
  receive(type, data) {
    if (!this.mode) return;
    if (this.pending?.type === type && this.pending.uniqueID === data.UniqueID) {
      clearTimeout(this.timer); this.pending = null;
      // S.RepairItem is enqueued before the server checks gold, binding and NPC type,
      // so it acknowledges the request only; S.ItemRepaired is the actual success.
      $("trade-status").textContent = type === "RepairItem"
        ? "修理请求已受理，若持久未恢复请查看聊天提示"
        : data.Success ? "已出售" : "服务器拒绝了此次出售：物品已绑定、此 NPC 不收这类物品，或金币已满";
    }
    if (type === "ItemRepaired") $("trade-status").textContent = "修理完成";
    this.render();
  }
}
