export const BELT_SIZE = 6;
export const equipmentNames = ["武器", "衣服", "头盔", "照明", "项链", "左手镯", "右手镯", "左戒指", "右戒指", "护身符", "腰带", "鞋", "宝石", "坐骑"];
const slotsByType = { 1: [0], 2: [1], 4: [2], 5: [4], 6: [6, 5], 7: [8, 7], 8: [9], 9: [10], 10: [11], 11: [12], 12: [3], 19: [13] };
export const usableTypes = new Set([13, 17, 20, 21, 27, 36, 37, 38, 40, 42]);
export function equipSlot(info, equipment) {
  const slots = slotsByType[info?.Type];
  if (!slots) return -1;
  return slots.find((slot) => !equipment[slot]) ?? slots.at(-1);
}
export function canEquipAt(info, slot) { return slotsByType[info?.Type]?.includes(slot) || false; }
export function emptyBagSlot(bag) {
  const regular = bag.findIndex((item, index) => index >= BELT_SIZE && !item);
  return regular >= 0 ? regular : bag.findIndex((item) => !item);
}
// A split never merges: the server already created a second stack, so the new item
// only ever needs the native free-slot preference the belt relies on.
export function placeItem(bag, item, info) {
  if (!info) throw new Error("物品资料尚未同步，请重新登录");
  const preferred = info.Type === 13 || info.Type === 17 || (info.Type === 21 && info.Effect === 1)
    ? [0, 1, 2, 3] : info.Type === 8 ? [4, 5] : bag.map((_, i) => i).slice(BELT_SIZE);
  const slot = preferred.find((i) => i < bag.length && !bag[i]) ?? bag.findIndex((i) => !i);
  if (slot < 0) throw new Error("背包同步异常，请重新登录");
  bag[slot] = item;
  return slot;
}
export function addInventoryItem(bag, item, info) {
  if (!info) throw new Error("物品资料尚未同步，请重新登录");
  let count = item.Count;
  if (info.StackSize > 1) for (const existing of bag) {
    if (existing?.ItemIndex !== item.ItemIndex) continue;
    const amount = Math.min(count, Math.max(0, info.StackSize - existing.Count));
    existing.Count += amount;
    count -= amount;
    if (!count) return;
  }
  placeItem(bag, { ...item, Count: count }, info);
}
// Amount prompts are free text: anything that is not a whole number of at least one
// is a cancelled operation, and the native amount box never offers more than the stack.
export function clampCount(raw, max) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 1 || max < 1) return 0;
  return Math.min(value, max);
}
function requireSlot(array, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= array.length) throw new Error("物品位置同步异常，请重新登录");
}
export function applyInventoryPacket(user, type, p) {
  const bag = user.Inventory, equipment = user.Equipment;
  const arrays = [bag, equipment];
  if (["MoveItem", "EquipItem", "RemoveItem", "UseItem"].includes(type)) {
    if (p.Grid !== 1 || !p.Success) return false;
    if (type === "MoveItem") {
      requireSlot(bag, p.From); requireSlot(bag, p.To);
      [bag[p.From], bag[p.To]] = [bag[p.To], bag[p.From]];
      return true;
    }
    const source = type === "RemoveItem" ? equipment : bag;
    const index = source.findIndex((item) => item?.UniqueID === p.UniqueID);
    if (index < 0) throw new Error("物品身份同步异常，请重新登录");
    if (type === "UseItem") {
      if (source[index].Count > 1) source[index].Count--;
      else source[index] = null;
    } else if (type === "EquipItem") {
      requireSlot(equipment, p.To);
      [bag[index], equipment[p.To]] = [equipment[p.To], bag[index]];
    } else {
      requireSlot(bag, p.To);
      if (bag[p.To]) throw new Error("卸装位置已被占用，请重新登录");
      bag[p.To] = equipment[index]; equipment[index] = null;
    }
    return true;
  }
  // The server drops from the bag only; the hero inventory is not part of this client.
  if (type === "DropItem" || type === "SplitItem1") {
    if (!p.Success || p.HeroItem || (type === "SplitItem1" && p.Grid !== 1)) return false;
    const index = bag.findIndex((item) => item?.UniqueID === p.UniqueID);
    if (index < 0) throw new Error("物品身份同步异常，请重新登录");
    bag[index].Count -= p.Count;
    if (bag[index].Count <= 0) bag[index] = null;
    return true;
  }
  for (const array of arrays) {
    const index = array.findIndex((item) => item?.UniqueID === (p.UniqueID ?? p.Item?.UniqueID));
    if (index < 0) continue;
    if (type === "RefreshItem") array[index] = p.Item;
    else if (type === "DuraChanged" || type === "ItemRepaired") {
      array[index].CurrentDura = p.CurrentDura;
      if (type === "ItemRepaired") array[index].MaxDura = p.MaxDura;
    } else if (type === "DeleteItem") {
      array[index].Count -= p.Count;
      if (array[index].Count <= 0) array[index] = null;
    }
    return true;
  }
  return false;
}
