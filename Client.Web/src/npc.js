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
    this.inputForm = document.getElementById("npc-input-form");
    this.input = document.getElementById("npc-input-value");
    this.input.onkeydown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.cancelInput(); }
    };
    this.inputForm.onsubmit = (event) => {
      event.preventDefault();
      if (!this.inputRequest) return;
      const { NPCID, PageName } = this.inputRequest;
      if (!this.send("NPCConfirmInput", { NPCID, PageName, Value: this.input.value })) {
        document.getElementById("npc-status").textContent = "连接已断开";
        return;
      }
      this.cancelInput();
      this.waitForResponse();
    };
    document.getElementById("npc-input-cancel").onclick = () => this.cancelInput();
    document.getElementById("close-npc").onclick = () => this.close();
  }
  cancelInput() {
    if (this.inputForm.contains(document.activeElement)) document.activeElement.blur();
    this.inputRequest = null;
    this.inputForm.hidden = true;
    this.input.value = "";
  }
  requestInput(request) {
    clearTimeout(this.timer);
    this.cancelInput();
    this.inputRequest = { NPCID: request.NPCID, PageName: request.PageName };
    this.objectID = request.NPCID;
    this.interactive = true;
    this.panel.hidden = false;
    this.inputForm.hidden = false;
    document.getElementById("npc-status").textContent = "";
    this.input.focus();
  }
  close() { this.onChange?.(); this.cancelInput(); this.panel.hidden = true; this.objectID = null; this.interactive = false; clearTimeout(this.timer); }
  remove(objectID) { if (this.objectID === objectID) this.close(); }
  checkRange(user, entity) {
    if (entity?.Location && user?.Location && Math.max(Math.abs(entity.Location.X - user.Location.X),
      Math.abs(entity.Location.Y - user.Location.Y)) > 16) this.close();
  }
  open(entity) {
    this.objectID = entity.ObjectID;
    this.interactive = true;
    document.getElementById("npc-title").textContent = entity.Name?.split("_")[0] || "NPC";
    document.getElementById("npc-page").replaceChildren();
    this.panel.hidden = false;
    this.call("[@Main]");
  }
  call(key) {
    this.onChange?.();
    this.cancelInput();
    if (key.toLowerCase() === "[@exit]") { this.close(); return; }
    if (!this.objectID) return;
    const status = document.getElementById("npc-status");
    if (!this.send("CallNPC", { ObjectID: this.objectID, Key: key })) { status.textContent = "连接已断开"; return; }
    this.waitForResponse();
  }
  waitForResponse() {
    const status = document.getElementById("npc-status");
    status.textContent = "等待回应…";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { status.textContent = "NPC 未回应，请靠近后重试"; }, 5000);
  }
  page(lines) {
    this.cancelInput();
    clearTimeout(this.timer);
    document.getElementById("npc-status").textContent = "";
    const hasLines = Array.isArray(lines) && lines.length > 0;
    const body = document.getElementById("npc-page"); body.replaceChildren();
    if (!hasLines) {
      if (!this.interactive) {
        this.panel.hidden = true;
        return;
      }
      this.panel.hidden = false;
      const empty = document.createElement("p");
      empty.textContent = "这个 NPC 暂时没有可用的对话。";
      body.append(empty);
      return;
    }
    this.panel.hidden = false;
    for (const line of lines) {
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
