export class GameAudio {
  constructor() {
    this.buffers = new Map(); this.active = new Set(); this.volume = 0.35; this.muted = false;
    this.epoch = 0;
    this.music = new Audio(); this.music.loop = true; this.music.preload = "none";
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (button && !button.disabled) this.play(10104);
    }, { capture: true });
    document.getElementById("sound-toggle").onclick = () => {
      this.muted = !this.muted; this.update();
      if (this.muted) this.clearEffects();
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
    this.startMusic();
  }
  setMusic(id) {
    const next = Number.isInteger(id) && id > 0 ? id : null;
    if (next === this.musicID) return;
    this.music.pause(); this.musicID = next;
    if (next === null) { this.music.removeAttribute("src"); this.music.load(); return; }
    this.music.src = `/assets/sound?id=${next}`;
    this.startMusic();
  }
  clearEffects() {
    this.epoch++;
    for (const source of this.active) source.stop();
  }
  startMusic() {
    if (this.musicID !== null && this.musicID !== undefined && !this.muted && this.volume > 0 && this.music.paused)
      this.music.play().catch(() => {});
  }
  update() {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    this.music.volume = this.volume; this.music.muted = this.muted;
    if (this.muted || !this.volume) this.music.pause();
    else this.startMusic();
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
    const epoch = this.epoch;
    const buffer = await this.load(id);
    if (!buffer || epoch !== this.epoch || this.muted || this.context.state !== "running" || this.active.size >= 12 || performance.now() - requested > maxDelay) return;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
    this.active.add(source); source.onended = () => { this.active.delete(source); source.disconnect(); };
    source.start();
  }
}
