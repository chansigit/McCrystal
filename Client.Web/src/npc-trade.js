import { BELT_SIZE, clampCount } from "./inventory.js";
import { repairCost, sellPrice } from "./item-price.js";

const $ = (id) => document.getElementById(id);
// Shared/Enums.cs BindMode. NPCDropDialog.Confirm refuses these outright, and the server
// (PlayerObject.SellItem / RepairItem) checks the same two flags before doing anything.
export const DONT_SELL = 4, DONT_REPAIR = 32;
const TITLES = { sell: "出售", repair: "修理" };
const gold = (amount) => Number(amount).toLocaleString();

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
  // Only S.NPCRepair carries a rate; S.NPCSell has no fields at all, and PlayerObject.SellItem
  // pays Price() / 2 without consulting the NPC, so a sale has no rate to keep.
  open(mode, rate) {
    if (!TITLES[mode]) return;
    clearTimeout(this.timer);
    this.mode = mode; this.pending = null;
    this.rate = mode === "repair" && Number.isFinite(rate) && rate >= 0 ? rate : null;
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
  // What the server will actually move: PlayerObject.SellItem pays Price() / 2 and
  // PlayerObject.RepairItem charges RepairPrice() times the rate S.NPCRepair carried.
  price(row, count) {
    if (!row.info) return null;
    return this.mode === "repair"
      ? repairCost(row.item, row.info, this.rate)
      : sellPrice(row.item, row.info, count);
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
      const parts = [];
      if (row.item.MaxDura > 0)
        parts.push(`持久 ${(row.item.CurrentDura / 1000).toFixed(1)}/${(row.item.MaxDura / 1000).toFixed(1)}`);
      if (row.blocked) parts.push(this.mode === "repair" ? "不可修理" : "不可出售");
      else {
        const cost = this.price(row);
        if (cost === null) parts.push("价格未就绪");
        else if (this.mode === "repair") parts.push(`修理费 ${gold(cost)} 金币${cost > user.Gold ? "（金币不足）" : ""}`);
        else parts.push(`售价 ${gold(cost)} 金币`);
      }
      detail.textContent = parts.join(" · ");
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
    // Prices are computed here from UserItem.Price() and UserItem.RepairPrice(), the same
    // routines the server charges by, so they are quotes rather than guesses. The one thing
    // this client cannot offer is the buy-back list, so say so before a sale is confirmed.
    const damagedEquipment = this.mode === "repair" &&
      (user.Equipment || []).some((item) => item && item.MaxDura > 0 && item.CurrentDura < item.MaxDura);
    $("trade-hint").textContent = this.mode === "repair"
      ? `修理费按此 NPC 的费率结算${damagedEquipment ? "；身上的装备需先卸下才能修理" : ""}`
      : "售价为物品价值的一半；本客户端没有回购界面，卖出后无法买回";
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
    const user = this.getUser();
    if (this.mode === "repair") {
      const cost = this.price(row);
      // PlayerObject.RepairItem returns without a word when the gold is short, so refuse the
      // request here rather than sending one that can only come back as silence.
      if (cost !== null && cost > user.Gold) {
        $("trade-status").textContent = `金币不足：修理需要 ${gold(cost)} 金币，现有 ${gold(user.Gold)}`;
        return;
      }
      const quote = cost === null ? "修理费由服务端从金币中扣除" : `修理费约 ${gold(cost)} 金币`;
      if (!window.confirm(`修理 ${name}？${quote}。`)) return;
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
    }
    const income = this.price(row, Count);
    const quote = income === null ? "售价由服务端结算" : `可得 ${gold(income)} 金币`;
    if (!window.confirm(`出售 ${name} × ${Count}？${quote}，且本客户端无法买回。`)) return;
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
      // S.RepairItem is enqueued before the server checks gold, range, binding and NPC type,
      // and every one of those checks returns without a message, so this acknowledges nothing
      // beyond delivery; S.ItemRepaired is the only proof the repair happened.
      $("trade-status").textContent = type === "RepairItem"
        ? "修理请求已发出，尚未确认；持久未恢复即表示服务端未受理（距离过远、此 NPC 不修这类物品或金币不足）"
        : data.Success ? "已出售" : "服务器拒绝了此次出售：物品已绑定、此 NPC 不收这类物品，或金币已满";
    }
    if (type === "ItemRepaired") $("trade-status").textContent = "修理完成";
    this.render();
  }
}
