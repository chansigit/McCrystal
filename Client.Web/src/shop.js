const $ = (id) => document.getElementById(id);

export function shopCost(basePrice, rate, count) {
  if (!Number.isInteger(basePrice) || basePrice < 0 || !Number.isFinite(rate) || rate < 0 ||
      !Number.isInteger(count) || count < 1 || count > 65535 || basePrice * count > 4294967295) return null;
  // The native server multiplies its uint item price by a single-precision rate.
  const cost = Math.trunc(Math.fround(Math.fround(basePrice * count) * Math.fround(rate)));
  return cost <= 4294967295 ? cost : null;
}

export function purchaseCommand(item, info, count) {
  if (!item || !info || !Number.isInteger(count) || count < 1 || count > Math.min(65535, info.StackSize)) return null;
  return { ItemIndex: item.UniqueID, Count: count, Type: 0 };
}

export class Shop {
  constructor(getUser, getInfo, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.send = send;
    this.panel = $("npc-shop");
    $("shop-search").oninput = () => this.render();
    $("shop-count").oninput = () => this.details();
    $("shop-buy").onclick = () => this.buy();
    this.close();
  }
  close() {
    clearTimeout(this.timer); this.pending = null; this.uncertain = false;
    this.panel.hidden = true; this.goods = null; this.selected = null;
    $("shop-status").textContent = "";
  }
  open(goods) {
    if (![0, 1].includes(goods.Type)) {
      this.close(); $("npc-status").textContent = "此合成窗口尚未接入"; return;
    }
    this.goods = goods;
    this.panel.hidden = false;
    if (!goods.List.some(item => item.UniqueID === this.selected)) this.selected = goods.List[0]?.UniqueID;
    $("shop-count").value = String(goods.List.find(item => item.UniqueID === this.selected)?.Count || 1);
    $("shop-search").value = "";
    this.render();
  }
  render() {
    if (!this.goods) return;
    const rows = document.createDocumentFragment();
    const query = $("shop-search").value.trim().toLowerCase();
    for (const item of this.goods.List) {
      const info = this.getInfo(item.ItemIndex);
      if (query && !info?.Name.toLowerCase().includes(query)) continue;
      const row = document.createElement("button"); row.type = "button"; row.className = "shop-row";
      row.setAttribute("aria-pressed", String(item.UniqueID === this.selected));
      row.disabled = !!this.pending || this.uncertain;
      const image = document.createElement("img"); image.alt = ""; image.draggable = false;
      if (info) image.src = `/assets/frame?library=Items&index=${info.Image}`;
      const name = document.createElement("span"); name.textContent = `${info?.Name || "加载中…"}${item.Count > 1 ? ` × ${item.Count}` : ""}`;
      const price = document.createElement("small");
      const cost = shopCost(this.goods.BasePrices?.[item.UniqueID], this.goods.Rate, item.Count || 1);
      price.textContent = cost === null ? "价格未就绪" : `${cost.toLocaleString()} 金币`;
      row.append(image, name, price);
      row.onclick = () => { this.selected = item.UniqueID; $("shop-count").value = String(item.Count || 1); this.render(); };
      rows.append(row);
    }
    $("shop-list").replaceChildren(rows);
    this.details();
  }
  details() {
    const item = this.goods?.List.find(item => item.UniqueID === this.selected);
    const info = item && this.getInfo(item.ItemIndex);
    const count = $("shop-count").valueAsNumber;
    const cost = shopCost(this.goods?.BasePrices?.[item?.UniqueID], this.goods?.Rate, count);
    const gold = this.getUser()?.Gold ?? 0;
    $("shop-count").max = String(Math.min(65535, info?.StackSize || 1));
    $("shop-count").disabled = !!this.pending || this.uncertain;
    $("shop-total").textContent = `合计 ${cost === null ? "-" : cost.toLocaleString()} · 金币 ${gold.toLocaleString()}`;
    $("shop-buy").disabled = !this.getUser() || this.getUser().Dead || !!this.pending || this.uncertain ||
      !purchaseCommand(item, info, count) || cost === null || cost > gold;
  }
  buy() {
    this.details();
    if ($("shop-buy").disabled) return;
    const item = this.goods.List.find(item => item.UniqueID === this.selected);
    const command = purchaseCommand(item, this.getInfo(item.ItemIndex), $("shop-count").valueAsNumber);
    if (!this.send("BuyItem", command)) { $("shop-status").textContent = "连接已断开"; return; }
    this.pending = { itemIndex: item.ItemIndex };
    $("shop-status").textContent = "等待服务器确认…";
    this.timer = setTimeout(() => {
      this.uncertain = true;
      $("shop-status").textContent = "未确认购买结果，请检查背包、金币或重新打开商店；未自动重试";
      this.render();
    }, 8000);
    this.render();
  }
  receive(type, data) {
    if (type === "GainedItem" && this.pending?.itemIndex === data.Item?.ItemIndex) {
      clearTimeout(this.timer); this.pending = null; this.uncertain = false;
      $("shop-status").textContent = "物品已入包";
    }
    if (!this.panel.hidden) this.render();
  }
}
