const $ = (id) => document.getElementById(id);

// PanelType.Craft. S.NPCGoods carries the same three shapes -- Buy, BuySub and Craft --
// and only the type byte says which window the server meant to open.
export const CRAFT_PANEL = 2;
// NPCScript.Craft spends (count * 1000) durability per tool, so a tool is worth as many
// crafts as it has thousands left.
export const TOOL_DURABILITY = 1000;
// MirAmountBox in the native craft dialog never offers more than this.
export const MAX_CRAFT = 99;

/// <summary>Picks one bag slot per tool and per ingredient, the way the server matches them.</summary>
// NPCScript.Craft walks the slots the client sent, takes the first unused one whose
// ItemInfo matches, and then insists usedSlots.Count == Tools.Count + Ingredients.Count.
// So exactly one slot per requirement has to go in the packet: a second slot holding the
// same herb is not a bigger pile to the server, it is a count mismatch and a refusal.
//
// Where the native dialog's AutoFill takes the first matching stack, this takes the
// largest one. The server cannot tell the difference -- it is still one slot per
// requirement -- and the player gets the higher ceiling they can actually see in the bag.
export function craftPlan(recipe, bag, getInfo) {
  const rows = [];
  const used = new Set();
  const inventory = Array.isArray(bag) ? bag : [];
  const pick = (need, isTool) => {
    let best = -1;
    inventory.forEach((item, slot) => {
      if (!item || used.has(slot) || item.ItemIndex !== need.ItemIndex) return;
      if (isTool) {
        if (item.CurrentDura < TOOL_DURABILITY) return;
        if (best < 0 || item.CurrentDura > inventory[best].CurrentDura) best = slot;
        return;
      }
      if (item.Count < need.Count) return;
      // A recipe may demand a minimum durability on an ingredient (the third column of a
      // recipe line); zero there means MaxDura, which is the "any condition" case.
      if (need.CurrentDura < need.MaxDura && item.CurrentDura < need.CurrentDura) return;
      if (best < 0 || item.Count > inventory[best].Count) best = slot;
    });
    return best;
  };
  for (const [list, isTool] of [[recipe?.Tools, true], [recipe?.Ingredients, false]]) {
    for (const need of list || []) {
      const slot = pick(need, isTool);
      if (slot >= 0) used.add(slot);
      rows.push({
        tool: isTool, need, slot,
        info: getInfo?.(need.ItemIndex) || null,
        have: slot >= 0 ? inventory[slot] : null,
        // What the bag holds in total, so a player whose herbs are split across two stacks
        // is told why a bag that looks full enough is not.
        total: inventory.reduce((sum, item) => sum + (item?.ItemIndex === need.ItemIndex ? item.Count : 0), 0),
      });
    }
  }
  return { rows, slots: rows.map((row) => row.slot), ready: rows.length > 0 && rows.every((row) => row.slot >= 0) };
}

/// <summary>How many times this recipe can be run right now.</summary>
// Every ceiling here is one the server enforces: tool durability, stack counts, the
// ingredient's own stack size (Craft refuses when ingredient.Count * count exceeds it),
// the product's stack size, and the gold. Reaching the same number the server would lets
// the window refuse locally instead of spending a refusal on the wire.
export function maxCraft(plan, recipe, productInfo, gold, getInfo) {
  if (!plan?.ready || !recipe) return 0;
  let max = MAX_CRAFT;
  for (const row of plan.rows) {
    if (row.tool) {
      max = Math.min(max, Math.floor(row.have.CurrentDura / TOOL_DURABILITY));
      continue;
    }
    const need = Math.max(1, row.need.Count);
    max = Math.min(max, Math.floor(row.have.Count / need));
    const stack = (row.info || getInfo?.(row.need.ItemIndex))?.StackSize;
    if (Number.isInteger(stack) && stack > 0) max = Math.min(max, Math.floor(stack / need));
  }
  const yield_ = Math.max(1, recipe.Item?.Count || 1);
  if (Number.isInteger(productInfo?.StackSize) && productInfo.StackSize > 0)
    max = Math.min(max, Math.floor(productInfo.StackSize / yield_));
  if (recipe.Gold > 0) max = Math.min(max, Math.floor((gold || 0) / recipe.Gold));
  return Math.max(0, max);
}

/// <summary>The 合成 window: 1.76's 合成师, 药剂师 and the four 药房老板.</summary>
// The server opens it with the same S.NPCGoods a shop uses, and answers C.CraftItem with a
// single bool. That bool means "the attempt was processed", not "you got the item": when
// the recipe has a chance below 100 the failure arrives as a chat line and nothing else.
export class CraftPanel {
  constructor(getUser, getInfo, getRecipe, send) {
    this.getUser = getUser; this.getInfo = getInfo; this.getRecipe = getRecipe; this.send = send;
    this.panel = $("npc-craft");
    if ($("craft-count")) $("craft-count").oninput = () => this.details();
    if ($("craft-make")) $("craft-make").onclick = () => this.craft();
    this.close();
  }
  close() {
    this.goods = null; this.selected = null;
    if (this.panel) this.panel.hidden = true;
    if ($("craft-status")) $("craft-status").textContent = "";
  }
  open(goods) {
    this.goods = goods;
    this.panel.hidden = false;
    if (!goods.List.some((item) => item.UniqueID === this.selected)) this.selected = goods.List[0]?.UniqueID;
    $("craft-count").value = "1";
    $("craft-status").textContent = "";
    this.render();
  }
  refresh() { if (this.goods) this.render(); }
  recipe() { return (this.selected == null ? null : this.getRecipe(this.selected)) || null; }
  product() { return this.goods?.List.find((item) => item.UniqueID === this.selected) || null; }
  render() {
    if (!this.goods) return;
    const list = document.createDocumentFragment();
    for (const item of this.goods.List) {
      const info = this.getInfo(item.ItemIndex);
      const recipe = this.getRecipe(item.UniqueID);
      const row = document.createElement("button");
      row.type = "button"; row.className = "shop-row";
      row.setAttribute("aria-pressed", String(item.UniqueID === this.selected));
      const image = document.createElement("img"); image.alt = ""; image.draggable = false;
      if (info) image.src = `/assets/frame?library=Items&index=${info.Image}`;
      const name = document.createElement("span");
      name.textContent = `${info?.Name || "加载中…"}${item.Count > 1 ? ` × ${item.Count}` : ""}`;
      const detail = document.createElement("small");
      const notes = [];
      if (!recipe) notes.push("配方未同步");
      else {
        if (recipe.Chance < 100) notes.push(`成功率 ${recipe.Chance}%`);
        if (recipe.Gold > 0) notes.push(`${recipe.Gold.toLocaleString()} 金币`);
      }
      detail.textContent = notes.join(" · ");
      row.append(image, name, detail);
      row.onclick = () => { this.selected = item.UniqueID; $("craft-count").value = "1"; this.render(); };
      list.append(row);
    }
    $("craft-list").replaceChildren(list);
    this.details();
  }
  details() {
    const recipe = this.recipe(), product = this.product();
    const user = this.getUser();
    const plan = recipe ? craftPlan(recipe, user?.Inventory, (index) => this.getInfo(index)) : null;
    const max = plan ? maxCraft(plan, recipe, this.getInfo(product?.ItemIndex), user?.Gold ?? 0,
      (index) => this.getInfo(index)) : 0;
    const rows = document.createDocumentFragment();
    for (const row of plan?.rows || []) {
      const line = document.createElement("div");
      line.className = "craft-need";
      const image = document.createElement("img"); image.alt = ""; image.draggable = false;
      if (row.info) image.src = `/assets/frame?library=Items&index=${row.info.Image}`;
      const name = document.createElement("span");
      name.textContent = `${row.info?.Name || "加载中…"}${row.tool ? "（工具）" : ` × ${row.need.Count}`}`;
      const state = document.createElement("small");
      state.textContent = row.slot >= 0
        ? row.tool ? `耐久 ${Math.floor(row.have.CurrentDura / TOOL_DURABILITY)} 次` : `背包 ${row.have.Count}`
        : row.total > 0 ? `单格不足（共 ${row.total}）` : "缺";
      state.className = row.slot >= 0 ? "craft-ok" : "craft-missing";
      line.append(image, name, state);
      rows.append(line);
    }
    if (!plan) {
      const empty = document.createElement("p");
      empty.textContent = recipe === null && this.selected != null
        ? "这条配方还没从服务端同步过来，重新登录一次即可。" : "选择一件要合成的物品。";
      rows.append(empty);
    }
    $("craft-needs").replaceChildren(rows);
    const count = $("craft-count");
    count.max = String(Math.max(1, max));
    const wanted = count.valueAsNumber;
    const gold = user?.Gold ?? 0;
    const cost = (recipe?.Gold || 0) * (Number.isInteger(wanted) ? wanted : 0);
    $("craft-total").textContent = recipe
      ? `最多可做 ${max} 次${recipe.Gold > 0 ? ` · 手工费 ${cost.toLocaleString()} / 金币 ${gold.toLocaleString()}` : ""}`
      : "";
    $("craft-make").disabled = !user || user.Dead || !plan?.ready || max < 1 ||
      !Number.isInteger(wanted) || wanted < 1 || wanted > max;
    $("craft-hint").textContent = !recipe ? ""
      : !plan.ready ? "材料不齐——服务端要求每样材料都在同一个背包格里凑够"
      : recipe.Chance < 100 ? `材料会先扣掉，成功率 ${recipe.Chance}%，失败与否只在聊天里说`
      : "材料齐了，点「合成」";
  }
  craft() {
    this.details();
    if ($("craft-make").disabled) return;
    const recipe = this.recipe(), product = this.product();
    const plan = craftPlan(recipe, this.getUser()?.Inventory, (index) => this.getInfo(index));
    if (!plan.ready) { this.render(); return; }
    const count = $("craft-count").valueAsNumber;
    if (!this.send("CraftItem", { UniqueID: product.UniqueID, Count: count, Slots: plan.slots })) {
      $("craft-status").textContent = "连接已断开"; return;
    }
    $("craft-status").textContent = "等待服务器…";
  }
  receive(type, p) {
    if (type === "CraftItem") {
      const recipe = this.recipe();
      $("craft-status").textContent = !p.Success
        ? "服务器拒绝了这次合成：材料、金币或背包格不符"
        : recipe && recipe.Chance < 100 ? "已尝试合成，成败见聊天" : "合成完成";
    }
    if (this.goods) this.render();
  }
}
