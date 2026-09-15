import { equipmentNames } from "./inventory.js";

// Shared/Enums.cs MirClass and MirGender, in wire order.
const CLASSES = ["战士", "法师", "道士", "刺客", "弓箭手"];
const GENDERS = ["男", "女"];

export function describe(packet) {
  const parts = [
    `${CLASSES[packet?.Class] || "？"}·${GENDERS[packet?.Gender] || "？"}`,
    `${packet?.Level ?? "?"} 级`,
  ];
  if (packet?.GuildName) parts.push(`${packet.GuildName}${packet.GuildRank ? `（${packet.GuildRank}）` : ""}`);
  if (packet?.LoverName) parts.push(`配偶 ${packet.LoverName}`);
  return parts.join(" · ");
}

/// <summary>查看别人身上穿了什么.</summary>
// C.Inspect names an object id and Envir answers with S.PlayerInspect: the fourteen
// equipment slots, the class, the level, the guild and the spouse. The server sends the
// UserItems bare, so the names come from the item definitions this client already holds.
export class InspectPanel {
  constructor(getInfo, send) {
    this.getInfo = getInfo; this.send = send;
    this.panel = document.getElementById("inspect-panel");
    if (document.getElementById("inspect-close"))
      document.getElementById("inspect-close").onclick = () => this.close();
    this.close();
  }
  close() { if (this.panel) this.panel.hidden = true; }
  // The server answers an id it cannot find with nothing at all, so the window opens on the
  // answer rather than on the request.
  request(objectID) {
    if (!objectID) return false;
    return this.send("Inspect", { ObjectID: objectID, Ranking: false, Hero: false });
  }
  receive(p) {
    if (!this.panel) return;
    document.getElementById("inspect-name").textContent = p.Name || "";
    document.getElementById("inspect-detail").textContent = describe(p);
    const grid = document.createDocumentFragment();
    (p.Equipment || []).forEach((item, slot) => {
      const cell = document.createElement("div");
      cell.className = "inspect-slot";
      const info = item ? this.getInfo(item.ItemIndex) : null;
      if (info) {
        const image = document.createElement("img");
        image.alt = ""; image.draggable = false;
        image.src = `/assets/frame?library=Items&index=${info.Image}`;
        cell.append(image);
      }
      const label = document.createElement("small");
      label.textContent = info?.Name || equipmentNames[slot] || "";
      if (!info) label.className = "inspect-empty";
      cell.append(label);
      cell.title = `${equipmentNames[slot] || `第 ${slot + 1} 格`}：${info?.Name || "空"}`;
      grid.append(cell);
    });
    document.getElementById("inspect-grid").replaceChildren(grid);
    this.panel.hidden = false;
  }
}
