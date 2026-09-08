const $ = (id) => document.getElementById(id);

// Globals.MaxGroup. PlayerObject.AddMember refuses an invite once the group is this size.
export const MAX_GROUP = 15;

/// <summary>The roster, kept in the order the server builds it.</summary>
// GroupMembers[0] is the leader and everything the server gates on leadership compares
// against it, so order is not cosmetic. A joining member is sent one S.AddMember per
// existing member, in order, before its own -- so appending in arrival order reproduces
// the server's list exactly.
export function applyGroupPacket(members, type, p) {
  switch (type) {
    case "AddMember": {
      const name = p?.Name;
      if (!name || members.includes(name)) return members;
      return [...members, name];
    }
    case "DeleteMember":
      return members.filter((name) => name !== p?.Name);
    // Not "a member left": PlayerObject.DelMember sends this to the player being removed,
    // and LeaveGroup sends it to a group that has dropped to one. Either way the receiver
    // no longer has a group at all.
    case "DeleteGroup":
      return [];
    default:
      return members;
  }
}

// A group in Crystal is left by refusing to be in one. PlayerObject.SwitchGroup calls
// LeaveGroup the moment grouping is turned off, and a member who is not the leader has no
// other way out: C.DelMember is refused for anyone but GroupMembers[0].
export function canKick(members, self, name) {
  return members.length > 0 && members[0] === self && name !== self;
}

export class GroupPanel {
  constructor(getUser, send) {
    this.getUser = getUser; this.send = send;
    this.panel = $("group-panel");
    this.reset();
  }
  reset() {
    this.members = [];
    // CharacterInfo.AllowGroup is a plain bool, so a new character starts with grouping off,
    // and the server never states the value -- S.SwitchGroup is only ever an echo of a
    // change. Native has the same gap and makes the same assumption
    // (GroupDialog.AllowGroup is a static bool set from that echo alone), so the first
    // press of the button is what synchronises the two.
    this.allow = false;
    this.invited = null;
    this.locations = new Map();
    if ($("group-invite")) $("group-invite").hidden = true;
    this.render();
  }
  toggle() {
    const panel = this.panel;
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) this.render();
  }
  self() { return this.getUser()?.Name || ""; }
  leader() { return this.members[0] || ""; }
  ask(name) {
    this.invited = name || "";
    $("group-invite-name").textContent = `${this.invited} 邀请你组队`;
    $("group-invite").hidden = false;
  }
  answer(accept) {
    $("group-invite").hidden = true;
    this.invited = null;
    this.send("GroupInvite", { AcceptInvite: !!accept });
  }
  invite(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) { this.status("请输入要邀请的角色名"); return; }
    if (trimmed === this.self()) { this.status("不能邀请自己"); return; }
    if (this.members.length >= MAX_GROUP) { this.status(`队伍已满（${MAX_GROUP} 人）`); return; }
    this.send("AddMember", { Name: trimmed });
    this.status("邀请已发出；对方关闭了组队、已在别的队里或不在线时，服务端会在聊天里说明");
    $("group-name").value = "";
  }
  kick(name) {
    if (!canKick(this.members, this.self(), name)) { this.status("只有队长能踢人"); return; }
    this.send("DelMember", { Name: name });
  }
  // Turning grouping off is also how a member leaves, which is worth saying on the button
  // rather than leaving the player to discover it.
  setAllow(allow) { this.send("SwitchGroup", { AllowGroup: !!allow }); }
  status(text) { const node = $("group-status"); if (node) node.textContent = text; }
  receive(type, p) {
    switch (type) {
      case "GroupInvite": this.ask(p.Name); return;
      case "SwitchGroup":
        this.allow = !!p.AllowGroup;
        break;
      case "GroupMembersMap":
        this.locations.set(p.PlayerName, p.PlayerMap);
        break;
      case "SendMemberLocation":
        this.locations.set(p.MemberName,
          `${this.locations.get(p.MemberName)?.split(" ")[0] || ""} ${p.MemberLocation.X},${p.MemberLocation.Y}`.trim());
        break;
      case "AddMember":
      case "DeleteMember":
      case "DeleteGroup": {
        const before = this.members;
        this.members = applyGroupPacket(before, type, p);
        if (type === "DeleteGroup") { this.locations.clear(); this.status("已离开队伍"); }
        else if (type === "AddMember" && this.members.length > before.length) this.status(`${p.Name} 加入队伍`);
        else if (type === "DeleteMember") this.status(`${p.Name} 离开队伍`);
        break;
      }
      default: return;
    }
    this.render();
  }
  render() {
    if (!this.panel) return;
    const self = this.self();
    const list = document.createDocumentFragment();
    for (const name of this.members) {
      const row = document.createElement("div");
      row.className = "group-row";
      const label = document.createElement("span");
      const marks = [];
      if (name === this.leader()) marks.push("队长");
      if (name === self) marks.push("你");
      const where = this.locations.get(name);
      label.textContent = `${name}${marks.length ? `（${marks.join("・")}）` : ""}${where ? ` · ${where}` : ""}`;
      row.append(label);
      if (canKick(this.members, self, name)) {
        const kick = document.createElement("button");
        kick.type = "button"; kick.textContent = "踢出";
        kick.onclick = () => this.kick(name);
        row.append(kick);
      }
      list.append(row);
    }
    if (!this.members.length) {
      const empty = document.createElement("p");
      empty.textContent = "你不在任何队伍里。";
      list.append(empty);
    }
    $("group-list").replaceChildren(list);
    $("group-count").textContent = this.members.length ? `${this.members.length}/${MAX_GROUP}` : "";
    const allow = $("group-allow");
    allow.setAttribute("aria-pressed", String(this.allow));
    allow.textContent = this.allow ? "允许组队：开" : "允许组队：关";
    $("group-hint").textContent = this.members.length && this.members[0] !== self
      ? "关掉「允许组队」就是退队——服务端没有别的退队指令，踢人只有队长能做"
      : "只有队长能邀请和踢人；关掉「允许组队」会立刻退出当前队伍";
  }
}
