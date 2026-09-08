import { applyGridMove, firstEmptySlot } from "./grid-transfer.js";

const $ = (id) => document.getElementById(id);

// CharacterInfo.Refine is sixteen slots; the server refuses any index outside it.
export const REFINE_SLOTS = 16;
// Shared/Enums.cs BindMode.DontUpgrade, checked on the definition and again on a rental's
// own binding flags (PlayerObject.RefineItem).
export const DONT_UPGRADE = 64;
// Shared/Enums.cs ItemType.Weapon. Settings.OnlyRefineWeapon is the usual configuration and
// the server refuses anything else outright when it is on.
export const WEAPON = 1;

/// <summary>Applies an accepted deposit or retrieval between the bag and the refine grid.</summary>
export function applyRefineMove(bag, refine, type, p) {
  if (type !== "DepositRefineItem" && type !== "RetrieveRefineItem") return false;
  if (!p?.Success) return false;
  const [source, target] = type === "DepositRefineItem" ? [bag, refine] : [refine, bag];
  applyGridMove(source, target, p.From, p.To, {
    slot: "修炼位置同步异常，请刷新页面",
    source: "修炼物品同步异常，请刷新页面",
    target: "修炼目标格同步异常，请刷新页面",
  });
  return true;
}

/// <summary>The weapons the server will accept, and why it would refuse the rest.</summary>
// PlayerObject.RefineItem walks the bag alone -- an equipped weapon has to come off first --
// and refuses in this order: an item that already carries a refinement and has not been
// checked, a non-weapon while OnlyRefineWeapon is on, and DontUpgrade on either the
// definition or a rental.
export function refineList(bag, getInfo, onlyWeapons = true) {
  const rows = [];
  (bag || []).forEach((item, index) => {
    if (!item) return;
    const info = getInfo(item.ItemIndex);
    if (info && onlyWeapons && info.Type !== WEAPON) return;
    let reason = null;
    if (item.RefineAdded) reason = "已修炼过，先去鉴定";
    else if ((info?.Bind & DONT_UPGRADE) || (item.RentalInformation?.BindingFlags & DONT_UPGRADE))
      reason = "此物品不可修炼";
    rows.push({ index, item, info, reason });
  });
  return rows;
}

// PlayerObject.RefineItem charges (Info.RequiredAmount * 10) * Settings.RefineCost, and
// S.NPCRefine carries that same RefineCost as its Rate.
export function refineCost(info, rate) {
  if (!info || !Number.isInteger(info.RequiredAmount) || info.RequiredAmount < 0) return null;
  const applied = Number.isFinite(rate) && rate >= 0 ? rate : 1;
  return Math.trunc(Math.fround(info.RequiredAmount * 10 * Math.fround(applied)));
}

// The refine window is two grids and one decision. Its awkwardness is the server's: the
// weapon leaves the bag for real minutes, nothing reports how long is left except a chat
// line, and the only proof it came back is S.NPCCollectRefine.
export class RefinePanel {
  constructor(getUser, getInfo, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.send = send;
    this.panel = $("refine-panel");
    this.reset();
  }
  reset() {
    this.open_ = false;
    this.mode = null;
    this.rate = null;
    this.refining = false;
    this.grid = new Array(REFINE_SLOTS).fill(null);
    if (this.panel) this.panel.hidden = true;
  }
  // S.NPCRefine opens the workshop; S.NPCCheckRefine opens the appraiser, which shares the
  // frame because it is the same list of the player's own items with a different verb.
  open(mode, { rate, refining } = {}) {
    this.mode = mode;
    this.open_ = true;
    if (mode === "refine") {
      this.rate = Number.isFinite(rate) && rate >= 0 ? rate : null;
      this.refining = !!refining;
    }
    this.panel.hidden = false;
    this.status("");
    this.render();
  }
  close() { this.reset(); }
  status(text) { $("refine-status").textContent = text; }
  refresh() { if (this.open_) this.render(); }
  deposit(index) {
    const user = this.getUser();
    if (!user?.Inventory?.[index]) return;
    const to = firstEmptySlot(this.grid);
    if (to < 0) { this.status("材料格已满"); return; }
    this.send("DepositRefineItem", { From: index, To: to });
  }
  retrieve(index) {
    const user = this.getUser();
    if (!user || !this.grid[index]) return;
    const to = firstEmptySlot(user.Inventory || []);
    if (to < 0) { this.status("背包已满"); return; }
    this.send("RetrieveRefineItem", { From: index, To: to });
  }
  start(uniqueID) {
    const row = refineList(this.getUser()?.Inventory, this.getInfo)
      .find((row) => row.item.UniqueID === uniqueID);
    if (!row) return;
    if (row.reason) { this.status(row.reason); return; }
    const name = row.info?.Name || "此武器";
    const cost = refineCost(row.info, this.rate);
    const quote = cost === null ? "费用由服务端从金币中扣除" : `需要 ${Number(cost).toLocaleString()} 金币`;
    if (!window.confirm(`把 ${name} 交去修炼？${quote}。武器会离开背包若干分钟，之后回来取。`)) return;
    this.send("RefineItem", { UniqueID: uniqueID });
    this.status("已交出武器；到时间回来点「取回」");
  }
  check(uniqueID) {
    this.send("CheckRefine", { UniqueID: uniqueID });
    this.status("鉴定结果服务端会在聊天里说明");
  }
  receive(type, p) {
    switch (type) {
      case "NPCRefine": this.open("refine", { rate: p.Rate, refining: p.Refining }); return;
      case "NPCCheckRefine": this.open("check", {}); return;
      case "NPCCollectRefine":
        // Success only means the item came back; the chat line says whether it improved.
        this.refining = !p.Success && this.refining;
        this.status(p.Success ? "武器已取回，结果见聊天" : "还没到时间，或者背包满了——详见聊天");
        break;
      case "RefineItem":
        // Enqueued twice by the server, before and after the checks, so it acknowledges
        // delivery and nothing else. The weapon leaving the bag is the real signal.
        this.refining = true;
        break;
      case "DepositRefineItem":
      case "RetrieveRefineItem": {
        const user = this.getUser();
        if (!user || !this.open_) return;
        if (!p.Success) {
          this.status(type === "DepositRefineItem"
            ? "服务器拒绝了此次放入：离 NPC 太远、不在修炼页，或材料格已被占用"
            : "服务器拒绝了此次取回：背包格已被占用");
          break;
        }
        try { applyRefineMove(user.Inventory, this.grid, type, p); }
        catch (error) { const message = error.message; this.reset(); alert(message); return; }
        break;
      }
      default: return;
    }
    this.render();
  }
  cell(item, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    // Reuses the inventory slot styling so a cell here looks like a cell anywhere else.
    button.className = "slot";
    button.disabled = !item || !onClick;
    if (item) {
      const info = this.getInfo(item.ItemIndex);
      const image = document.createElement("img");
      image.alt = ""; image.draggable = false;
      if (info) image.src = `/assets/frame?library=Items&index=${info.Image}`;
      button.append(image);
      button.title = `${info?.Name || "加载中…"}${item.Count > 1 ? ` × ${item.Count}` : ""}`;
      if (item.Count > 1) {
        const count = document.createElement("small");
        count.textContent = item.Count;
        button.append(count);
      }
    }
    if (onClick) button.onclick = onClick;
    return button;
  }
  render() {
    if (!this.open_) return;
    const user = this.getUser();
    if (!user) return;
    const checking = this.mode === "check";
    $("refine-title").textContent = checking ? "鉴定" : "修炼";
    $("refine-materials-block").hidden = checking;
    if (!checking) {
      const grid = document.createDocumentFragment();
      this.grid.forEach((item, index) =>
        grid.append(this.cell(item, item ? () => this.retrieve(index) : null)));
      $("refine-grid").replaceChildren(grid);
      const bag = document.createDocumentFragment();
      (user.Inventory || []).forEach((item, index) => {
        if (!item) return;
        bag.append(this.cell(item, () => this.deposit(index)));
      });
      $("refine-bag").replaceChildren(bag);
    }
    const rows = refineList(user.Inventory, this.getInfo, !checking)
      .filter((row) => (checking ? row.item.RefineAdded : true));
    const list = document.createDocumentFragment();
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "shop-row";
      button.disabled = !checking && !!row.reason;
      const image = document.createElement("img"); image.alt = ""; image.draggable = false;
      if (row.info) image.src = `/assets/frame?library=Items&index=${row.info.Image}`;
      const name = document.createElement("span");
      name.textContent = row.info?.Name || "加载中…";
      const detail = document.createElement("small");
      const cost = refineCost(row.info, this.rate);
      detail.textContent = checking ? "点一下鉴定"
        : row.reason ? row.reason
        : cost === null ? "费用未就绪" : `${Number(cost).toLocaleString()} 金币`;
      button.append(image, name, detail);
      button.onclick = () => (checking ? this.check(row.item.UniqueID) : this.start(row.item.UniqueID));
      list.append(button);
    }
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.textContent = checking ? "背包里没有修炼过、等待鉴定的物品。" : "背包里没有可修炼的武器。";
      list.append(empty);
    }
    $("refine-list").replaceChildren(list);
    $("refine-hint").textContent = checking
      ? "鉴定告诉你修炼加了什么；服务端只在聊天里回答"
      : this.refining
      ? "你已经有一件武器在修炼中——到时间去 NPC 的「取回」页领"
      : "先把材料放进左边的格子，再点下面的武器开始。武器会离开背包若干分钟。";
  }
}
