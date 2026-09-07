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
    };
  }
  update(user) {
    const dead = !!user?.Dead;
    if (dead === this.dead) return;
    this.dead = dead;
    this.panel.hidden = !dead;
    this.status.textContent = "";
  }
}
