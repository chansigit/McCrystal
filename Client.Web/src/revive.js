// The dead player has no other way out: movement, attacking and harvesting are
// all gated on user.Dead, and only C.TownRevive clears it on the server.
export class ReviveOverlay {
  constructor(send) {
    this.send = send;
    this.panel = document.getElementById("revive-panel");
    this.button = document.getElementById("revive-town");
    this.status = document.getElementById("revive-status");
    this.button.onclick = () => {
      if (!this.send("TownRevive", {})) { this.status.textContent = "连接已断开"; return; }
      this.status.textContent = "正在回城复活…";
      // The server answers a refused revive with nothing at all, so a failure used to
      // look exactly like a dead button. Say so rather than leaving the player
      // clicking (Server/MirObjects/PlayerObject.cs, TownRevive).
      clearTimeout(this.pending);
      this.pending = setTimeout(() => {
        if (this.dead) this.status.textContent = "服务器没有响应，回城点可能无效";
      }, 3000);
    };
  }
  update(user) {
    const dead = !!user?.Dead;
    if (dead === this.dead) return;
    this.dead = dead;
    this.panel.hidden = !dead;
    this.status.textContent = "";
    clearTimeout(this.pending);
  }
}
