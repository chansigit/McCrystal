import { applyGridMove, firstEmptySlot } from "./grid-transfer.js";

const $ = (id) => document.getElementById(id);

// CharacterInfo.Trade is ten slots and the server refuses any index outside it.
export const TRADE_SLOTS = 10;
// Shared/Enums.cs BindMode.DontTrade. PlayerObject.DepositTradeItem checks it on the
// definition and again on a rental's own binding flags before it moves anything.
export const DONT_TRADE = 16;

export function blockedFromTrade(item, info) {
  return !!((info?.Bind & DONT_TRADE) || (item?.RentalInformation?.BindingFlags & DONT_TRADE));
}

// PlayerObject.TradeGold adds to the offer rather than setting it, takes the gold out of the
// account there and then, and refuses anything under 1 or over what the player holds without
// a word. So the box is an "add this much" box, clamped to both bounds before it is sent.
export function tradeGoldAmount(raw, held) {
  const amount = Math.floor(Number(raw));
  if (!Number.isFinite(amount) || amount < 1) return null;
  const wallet = Math.max(0, Math.floor(Number(held) || 0));
  if (wallet < 1) return null;
  return Math.min(amount, wallet, 4294967295);
}

/// <summary>Applies an accepted deposit or retrieval between the bag and the trade grid.</summary>
export function applyTradeMove(bag, trade, type, p) {
  if (type !== "DepositTradeItem" && type !== "RetrieveTradeItem") return false;
  if (!p?.Success) return false;
  const [source, target] = type === "DepositTradeItem" ? [bag, trade] : [trade, bag];
  applyGridMove(source, target, p.From, p.To, {
    slot: "交易位置同步异常，请刷新页面",
    source: "交易物品同步异常，请刷新页面",
    target: "交易目标格同步异常，请刷新页面",
  });
  return true;
}

// The trade window is the whole player-to-player exchange for a web player, so it carries
// its own view of the bag beside the two offers, the way the native TradeDialog puts the
// inventory next to itself.
//
// One thing the server never tells a player is the state of their partner's lock: it says so
// in a chat line and nothing else (PlayerObject.TradeConfirm). And S.TradeConfirm, despite the
// name, is not a lock at all -- it is sent to both sides once the swap has already happened.
export class PlayerTrade {
  constructor(getUser, getInfo, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.send = send;
    this.panel = $("trade-window");
    this.reset();
  }
  reset() {
    this.partner = null;
    this.mine = new Array(TRADE_SLOTS).fill(null);
    this.theirs = new Array(TRADE_SLOTS).fill(null);
    this.myGold = 0; this.theirGold = 0;
    this.pendingGold = 0;
    this.locked = false;
    this.invited = null;
    if (this.panel) this.panel.hidden = true;
    if ($("trade-invite")) $("trade-invite").hidden = true;
  }
  // A trade opens on S.TradeAccept, which reaches both sides at once, and never on the ask.
  open(partner) {
    this.reset();
    this.partner = partner || "";
    this.panel.hidden = false;
    this.status("");
    this.render();
  }
  status(text) { $("trade-window-status").textContent = text; }
  ask(name) {
    this.invited = name || "";
    $("trade-invite-name").textContent = `${this.invited} 想和你交易`;
    $("trade-invite").hidden = false;
  }
  answer(accept) {
    $("trade-invite").hidden = true;
    this.invited = null;
    this.send("TradeReply", { AcceptInvite: !!accept });
  }
  // C.TradeRequest carries no target: the server trades with whoever stands on the cell the
  // player is facing (PlayerObject.TradeRequest), so there is nobody to name here.
  invite() { this.send("TradeRequest", {}); }
  // Every deposit, retrieval and gold change calls TradeUnlock on the server, which drops
  // both locks. The browser has to forget its own at the same moments or it shows a lock
  // that is already gone.
  deposit(index) {
    const user = this.getUser();
    if (!this.partner || !user) return;
    const item = user.Inventory?.[index];
    if (!item) return;
    if (blockedFromTrade(item, this.getInfo(item.ItemIndex))) { this.status("此物品不可交易"); return; }
    const to = firstEmptySlot(this.mine);
    if (to < 0) { this.status("交易格已满"); return; }
    this.send("DepositTradeItem", { From: index, To: to });
  }
  retrieve(index) {
    const user = this.getUser();
    if (!this.partner || !user || !this.mine[index]) return;
    const to = firstEmptySlot(user.Inventory || []);
    if (to < 0) { this.status("背包已满"); return; }
    this.send("RetrieveTradeItem", { From: index, To: to });
  }
  addGold(raw) {
    if (!this.partner) return;
    const user = this.getUser();
    const amount = tradeGoldAmount(raw, user?.Gold);
    if (amount === null) { this.status("金币数量无效，或身上没有金币"); return; }
    // The offer total only moves when the gold actually leaves the account, which arrives as
    // S.LoseGold; until then this is what was asked for, not what was accepted.
    this.pendingGold = amount;
    this.send("TradeGold", { Amount: amount });
  }
  // S.LoseGold is the receipt for a gold offer. It also fires for purchases and repairs, so
  // it counts only while a trade is open and an offer of exactly that size is outstanding.
  goldLeft(amount) {
    if (!this.partner || !this.pendingGold || Number(amount) !== this.pendingGold) return;
    this.myGold += this.pendingGold;
    this.pendingGold = 0;
    this.locked = false;
    this.render();
  }
  lock() { this.send("TradeConfirm", { Locked: true }); this.locked = true; this.render(); }
  unlock() { this.send("TradeConfirm", { Locked: false }); this.locked = false; this.render(); }
  cancel() { this.send("TradeCancel", {}); }
  receive(type, p) {
    switch (type) {
      case "TradeRequest": this.ask(p.Name); return;
      case "TradeAccept": this.open(p.Name); return;
      case "LoseGold": this.goldLeft(p.Gold); return;
      case "TradeCancel":
        // Unlock means the confirm failed -- one side could not hold what the other offered
        // -- and the trade carries on with both locks dropped.
        if (p?.Unlock) {
          this.locked = false;
          this.status("有一方装不下对方的东西，双方锁定已解除");
          break;
        }
        this.reset();
        return;
      case "TradeConfirm":
        // Not a lock: PlayerObject.TradeConfirm sends this to both sides after the items and
        // the gold have already changed hands.
        this.reset();
        return;
      case "TradeGold":
        this.theirGold = Number(p.Amount) || 0;
        this.locked = false;
        break;
      case "TradeItem":
        this.theirs = (p.TradeItems || []).slice(0, TRADE_SLOTS);
        while (this.theirs.length < TRADE_SLOTS) this.theirs.push(null);
        this.locked = false;
        break;
      case "DepositTradeItem":
      case "RetrieveTradeItem": {
        const user = this.getUser();
        if (!user || !this.partner) return;
        if (!p.Success) {
          this.status(type === "DepositTradeItem"
            ? "服务器拒绝了此次放入：物品不可交易，或交易格已被占用"
            : "服务器拒绝了此次取回：背包格已被占用");
          break;
        }
        try { applyTradeMove(user.Inventory, this.mine, type, p); }
        catch (error) { const message = error.message; this.reset(); this.status(message); return; }
        this.locked = false;
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
    if (!this.partner) return;
    const user = this.getUser();
    if (!user) return;
    $("trade-partner").textContent = this.partner;
    const mine = document.createDocumentFragment();
    this.mine.forEach((item, index) =>
      mine.append(this.cell(item, item ? () => this.retrieve(index) : null)));
    $("trade-mine").replaceChildren(mine);
    const theirs = document.createDocumentFragment();
    this.theirs.forEach((item) => theirs.append(this.cell(item, null)));
    $("trade-theirs").replaceChildren(theirs);
    const bag = document.createDocumentFragment();
    (user.Inventory || []).forEach((item, index) => {
      if (!item) return;
      bag.append(this.cell(item, () => this.deposit(index)));
    });
    $("trade-bag").replaceChildren(bag);
    $("trade-my-gold").textContent = Number(this.myGold).toLocaleString();
    $("trade-their-gold").textContent = Number(this.theirGold).toLocaleString();
    $("trade-wallet").textContent = Number(user.Gold || 0).toLocaleString();
    $("trade-lock").textContent = this.locked ? "解除锁定" : "锁定";
    $("trade-lock").setAttribute("aria-pressed", String(this.locked));
    $("trade-slot-hint").textContent = "点背包物品放入交易，点自己这边的物品取回。"
      + "金币是累加的，加进去就先离开钱袋，取消交易才退回。"
      + "任何一方改动内容都会解除双方锁定；对方是否已锁定服务端只在聊天里说。";
  }
}
