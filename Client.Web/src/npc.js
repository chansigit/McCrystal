export function npcTokens(line) {
  const pattern = /<<([^<>]+?)\/([^<>]+?)>>|<([^<>]+?)\/([^<>]+?)>|\{([^{}]+?)\/([^{}]+?)\}/g;
  const tokens = [];
  let end = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > end) tokens.push({ text: line.slice(end, match.index) });
    if (match[5] !== undefined) tokens.push({ text: match[5] });
    else {
      const action = (match[2] ?? match[4]).split("/")[0];
      tokens.push({ text: match[1] ?? match[3], key: `[@${action.replace(/^@/, "")}]` });
    }
    end = match.index + match[0].length;
  }
  if (end < line.length) tokens.push({ text: line.slice(end) });
  return tokens;
}
export class NPCDialog {
  constructor(send) {
    this.send = send;
    this.panel = document.getElementById("npc-panel");
    document.getElementById("close-npc").onclick = () => this.close();
  }
  close() { this.panel.hidden = true; this.objectID = null; clearTimeout(this.timer); }
  open(entity) {
    this.objectID = entity.ObjectID;
    document.getElementById("npc-title").textContent = entity.Name?.split("_")[0] || "NPC";
    document.getElementById("npc-page").replaceChildren();
    this.panel.hidden = false;
    this.call("[@Main]");
  }
  call(key) {
    if (key.toLowerCase() === "[@exit]") { this.close(); return; }
    if (!this.objectID) return;
    const status = document.getElementById("npc-status");
    if (!this.send("CallNPC", { ObjectID: this.objectID, Key: key })) { status.textContent = "连接已断开"; return; }
    status.textContent = "等待回应…";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { status.textContent = "NPC 未回应，请靠近后重试"; }, 5000);
  }
  page(lines) {
    clearTimeout(this.timer);
    document.getElementById("npc-status").textContent = "";
    this.panel.hidden = !lines?.length;
    const body = document.getElementById("npc-page"); body.replaceChildren();
    for (const line of lines || []) {
      const row = document.createElement("p");
      for (const token of npcTokens(line)) {
        const node = document.createElement(token.key ? "button" : "span");
        node.textContent = token.text;
        if (token.key) { node.className = "npc-choice"; node.onclick = () => this.call(token.key); }
        row.append(node);
      }
      body.append(row);
    }
  }
}
