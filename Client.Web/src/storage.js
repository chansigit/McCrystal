import { BELT_SIZE, emptyBagSlot } from "./inventory.js";
import { applyGridMove, firstEmptySlot as firstEmpty } from "./grid-transfer.js";

const $ = (id) => document.getElementById(id);
// Shared/Enums.cs BindMode. PlayerObject.StoreItem refuses an item whose definition or whose
// rental binding carries this flag, before it ever looks at the destination slot.
export const DONT_STORE = 8;
// Globals.StorageGridSize. AccountInfo.Storage starts at one page and AccountInfo.ExpandStorage
// doubles it for a rented vault, which is the largest the server ever allows.
export const STORAGE_PAGE = 80;
// PlayerObject.StoreItem and PlayerObject.TakeBackItem both refuse everything they cannot do
// with a bare Success = false, so name the causes the server actually checks.
const failures = {
  StoreItem: "服务器拒绝了此次存入：仓库格已被占用、物品不可入库，或仓库需要密码",
  TakeBackItem: "服务器拒绝了此次取出：背包格已被占用，或仓库需要密码",
};

export function blockedFromStorage(item, info) {
  return !!((info?.Bind & DONT_STORE) || (item?.RentalInformation?.BindingFlags & DONT_STORE));
}

// Neither transfer swaps and neither merges: the server only fills a slot it finds empty.
// A vault whose rental has lapsed keeps its second page in the array while the server refuses
// those indexes again, so the search stops at the slots that are actually usable.
export const firstEmptySlot = firstEmpty;

// S.StoreItem and S.TakeBackItem echo the From and To of the request plus the outcome.
// Nothing is applied before the answer arrives, exactly as the bag model in inventory.js
// works, so a refusal reverts to itself: both grids still hold what the server holds.
// A desync locks the panel until reset(), which runs when a new socket opens and not when a
// character logs out and back in on the same one, so a page reload is the only recovery there
// is -- these messages have to ask for that rather than for a re-login that changes nothing.
export function applyStorageMove(bag, storage, type, p) {
  if (type !== "StoreItem" && type !== "TakeBackItem") return false;
  if (!p?.Success) return false;
  const [source, target] = type === "StoreItem" ? [bag, storage] : [storage, bag];
  applyGridMove(source, target, p.From, p.To, {
    slot: "仓库位置同步异常，请刷新页面",
    source: "仓库物品同步异常，请刷新页面",
    target: "仓库目标格同步异常，请刷新页面",
  });
  return true;
}

export function slotLabel(grid, index) {
  if (grid === "storage") return `仓库 ${index + 1}`;
  return index < BELT_SIZE ? `快捷栏 ${index + 1}` : `背包 ${index - BELT_SIZE + 1}`;
}

// The vault window is the whole storage system for a web player, so it carries its own view
// of the bag rather than relying on the floating inventory panel: the two grids sit side by
// side in one frame the way NPCDialogs.StorageDialog puts the inventory next to itself.
export class StorageUI {
  constructor(getUser, getInfo, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.send = send;
    this.panel = $("npc-storage");
    this.items = null;
    this.uncertain = false;
    this.close();
  }
  // PlayerObject.SendStorage guards on Connection.StorageSent, so the vault contents arrive
  // once per connection: the copy has to survive closing the window and every later visit.
  reset() {
    this.items = null;
    this.uncertain = false;
    this.close();
  }
  close() {
    clearTimeout(this.timer);
    this.opened = false; this.pending = null; this.dragged = null;
    this.panel.hidden = true;
    $("storage-status").textContent = "";
  }
  open() {
    clearTimeout(this.timer);
    this.opened = true; this.pending = null; this.dragged = null;
    this.panel.hidden = false;
    $("storage-status").textContent = "";
    this.render();
  }
  refresh() { if (this.opened) this.render(); }
  available() {
    const user = this.getUser();
    return !!user && !user.Dead && !!this.items && !this.pending && !this.uncertain;
  }
  grid(name) {
    return name === "storage" ? this.items : this.getUser()?.Inventory;
  }
  // NPCDialogs.RefreshStorage2 keeps the second vault page locked unless the rental is live,
  // and AccountInfo.IsValidStorageIndex refuses those indexes then. ExpandStorage only ever
  // grows Storage, so an expired rental leaves a 160-slot array with 80 usable slots.
  slots() {
    if (!this.items) return 0;
    return this.getUser()?.HasExpandedStorage ? this.items.length : Math.min(this.items.length, STORAGE_PAGE);
  }
  // S.ResizeStorage announces the new length when ADDSTORAGE buys a page and again when the
  // rental lapses; without it the grid would stay at its old size until the page is reloaded.
  resize(p) {
    if (!Number.isInteger(p?.Size) || p.Size < 0) return;
    const user = this.getUser();
    if (user) user.HasExpandedStorage = !!p.HasExpandedStorage;
    if (this.items) {
      const size = Math.min(p.Size, 2 * STORAGE_PAGE);
      // Only ever grow the copy: the server keeps the items on a lapsed page, and dropping
      // them here would tell the player they are gone when they are only out of reach.
      while (this.items.length < size) this.items.push(null);
    }
    this.refresh();
  }
  item(ref) { return this.grid(ref.grid)?.[ref.index]; }
  request(type, From, To) {
    if (!this.send(type, { From, To })) { $("storage-status").textContent = "连接已断开"; return; }
    this.pending = { type, From, To };
    $("storage-status").textContent = "等待服务器确认…";
    // Nothing is applied optimistically, so a late reply still lands correctly; an
    // unanswered command only has to release the lock instead of stranding the vault.
    this.timer = setTimeout(() => {
      this.pending = null;
      $("storage-status").textContent = "服务器未回应，请重试";
      this.render();
    }, 8000);
    this.render();
  }
  // A transfer only ever crosses the two grids: there is no packet that moves an item
  // inside the vault, and moving inside the bag belongs to the inventory panel.
  move(from, to) {
    if (!this.available() || from.grid === to.grid) return;
    if (to.grid === "storage" && to.index >= this.slots()) {
      $("storage-status").textContent = "该仓库格尚未开通";
      return;
    }
    const item = this.item(from);
    if (!item || this.item(to)) return;
    if (from.grid === "bag" && blockedFromStorage(item, this.getInfo(item.ItemIndex))) {
      $("storage-status").textContent = "此物品无法存入仓库";
      return;
    }
    this.request(from.grid === "bag" ? "StoreItem" : "TakeBackItem", from.index, to.index);
  }
  // Click-to-move: the native cell picks the destination itself, and the bag prefers a
  // regular slot over a belt slot exactly as a pickup does.
  transfer(ref) {
    if (!this.available()) return;
    const item = this.item(ref);
    if (!item) return;
    const target = ref.grid === "bag" ? firstEmptySlot(this.items, this.slots()) : emptyBagSlot(this.getUser().Inventory);
    if (target < 0) {
      $("storage-status").textContent = ref.grid === "bag" ? "仓库已满" : "背包已满";
      return;
    }
    this.move(ref, { grid: ref.grid === "bag" ? "storage" : "bag", index: target });
  }
  slot(ref) {
    const item = this.item(ref), info = item && this.getInfo(item.ItemIndex);
    const label = slotLabel(ref.grid, ref.index);
    const button = document.createElement("button");
    button.type = "button"; button.className = "slot";
    button.disabled = !this.available();
    button.draggable = !!item && this.available();
    button.setAttribute("aria-label", `${label}${item ? `：${info?.Name || "未知物品"}，${item.Count} 个` : "：空"}`);
    button.title = button.getAttribute("aria-label");
    if (info) {
      const image = document.createElement("img");
      image.src = `/assets/frame?library=Items&index=${info.Image}`;
      image.alt = ""; image.draggable = false; button.append(image);
    }
    if (item?.Count > 1) {
      const count = document.createElement("small"); count.textContent = item.Count; button.append(count);
    }
    button.onclick = () => this.transfer(ref);
    button.ondragstart = (event) => {
      this.dragged = { ...ref, uniqueID: item.UniqueID };
      event.dataTransfer.setData("text/plain", "crystal-storage");
      event.dataTransfer.effectAllowed = "move";
    };
    button.ondragend = () => { this.dragged = null; };
    button.ondragover = (event) => { if (this.dragged && this.dragged.grid !== ref.grid) event.preventDefault(); };
    button.ondrop = (event) => {
      event.preventDefault();
      const from = this.dragged; this.dragged = null;
      if (from && this.item(from)?.UniqueID === from.uniqueID) this.move(from, ref);
    };
    return button;
  }
  fill(id, name) {
    const grid = this.grid(name) || [];
    const cells = document.createDocumentFragment();
    const count = name === "storage" ? this.slots() : grid.length;
    for (let index = 0; index < count; index++) cells.append(this.slot({ grid: name, index }));
    $(id).replaceChildren(cells);
  }
  render() {
    const user = this.getUser();
    if (!user) return;
    // Settings.RequireStoragePassword plus a password on the account makes SendStorage
    // return without a S.UserStorage, and CanAccessStorage refuses every transfer after
    // that. Say so rather than showing an empty vault the player cannot use.
    const locked = !!(user.RequireStoragePassword && user.HasStoragePassword);
    $("storage-grids").hidden = !this.items;
    if (!this.items) {
      $("storage-hint").textContent = locked
        ? "此账号的仓库设置了密码。网页客户端暂不支持仓库密码，请使用原版客户端存取物品。"
        : "仓库内容尚未送达，请关闭对话后重新与仓库管理员交谈。";
      return;
    }
    this.fill("storage-grid", "storage");
    this.fill("storage-bag-grid", "bag");
    const slots = this.slots();
    const used = this.items.slice(0, slots).filter(Boolean).length;
    const carried = user.Inventory.filter(Boolean).length;
    const stranded = this.items.length - slots > 0 ? this.items.slice(slots).filter(Boolean).length : 0;
    $("storage-hint").textContent =
      `仓库 ${used}/${slots} · 背包 ${carried}/${user.Inventory.length} · 点击物品存取，拖动可指定格子` +
      (stranded ? ` · 扩充仓库已到期，另有 ${stranded} 件物品需续租后才能取出` : "");
  }
  receive(type, p) {
    if (type === "UserStorage") {
      this.items = Array.isArray(p?.Storage) ? p.Storage.slice() : null;
      this.uncertain = false;
      this.refresh();
      return;
    }
    // HumanObject.ProcessItems empties an expired vault slot outright and announces only the
    // full count, so clear the whole slot rather than leaving a copy the player can still click.
    if (type === "DeleteItem") {
      if (!this.items) return;
      const index = this.items.findIndex((slot) => slot?.UniqueID === p?.UniqueID);
      if (index < 0) return;
      this.items[index] = null;
      this.refresh();
      return;
    }
    if (type !== "StoreItem" && type !== "TakeBackItem") return;
    if (this.pending?.type === type && this.pending.From === p.From && this.pending.To === p.To) {
      clearTimeout(this.timer); this.pending = null;
      $("storage-status").textContent = p.Success ? "" : failures[type];
    }
    const user = this.getUser();
    if (user && this.items) {
      try { applyStorageMove(user.Inventory, this.items, type, p); }
      catch (error) { this.uncertain = true; $("storage-status").textContent = error.message; }
    } else if (p?.Success) {
      // A transfer the server carried out that no local copy can absorb leaves the vault and
      // the bag out of step exactly as a rejected apply does, so fail the same way instead of
      // dropping the acknowledgement and letting the player keep clicking.
      this.uncertain = true;
      $("storage-status").textContent = "仓库同步异常，请刷新页面";
    }
    this.refresh();
  }
}
