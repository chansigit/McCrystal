export class GameAudio {
  constructor() {
    this.buffers = new Map(); this.active = new Set(); this.volume = 0.35; this.muted = false;
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    document.getElementById("sound-toggle").onclick = () => {
      this.muted = !this.muted; this.update();
      if (this.muted) for (const source of this.active) source.stop();
      else this.unlock();
    };
    document.getElementById("sound-volume").oninput = (event) => { this.volume = Number(event.target.value) / 100; this.update(); };
    this.update();
  }
  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain(); this.gain.connect(this.context.destination); this.update();
      for (const id of [10001, 10002, 10003, 10004]) this.load(id);
    }
    if (this.context.state === "suspended") this.context.resume().then(() => this.update()).catch(() => {});
  }
  update() {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    const button = document.getElementById("sound-toggle");
    button.setAttribute("aria-pressed", String(!this.muted));
    button.title = this.muted ? "开启声音" : "静音";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("muted", this.muted);
  }
  load(id) {
    if (!this.buffers.has(id)) {
      this.buffers.set(id, fetch(`/assets/sound?id=${id}`).then((response) => {
        if (!response.ok) throw new Error("Missing sound");
        return response.arrayBuffer();
      }).then((data) => this.context.decodeAudioData(data)).catch(() => null));
      if (this.buffers.size > 64) this.buffers.delete(this.buffers.keys().next().value);
    }
    return this.buffers.get(id);
  }
  async play(id, maxDelay = 700) {
    if (this.muted || !this.volume || this.context?.state !== "running" || this.active.size >= 12) return;
    const requested = performance.now();
    const buffer = await this.load(id);
    if (!buffer || this.muted || this.context.state !== "running" || this.active.size >= 12 || performance.now() - requested > maxDelay) return;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
    this.active.add(source); source.onended = () => { this.active.delete(source); source.disconnect(); };
    source.start();
  }
}
