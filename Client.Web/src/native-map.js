const $ = (id) => document.getElementById(id);
export function radarRect(image, map, location) {
  const width = Math.min(120, image.width), height = Math.min(108, image.height);
  return { x: Math.max(0, Math.min(image.width - width, location.X * image.width / map.width - width / 2)),
    y: Math.max(0, Math.min(image.height - height, location.Y * image.height / map.height - height / 2)), width, height };
}
export function fitMap(image, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  return { x: (width - image.width * scale) / 2, y: (height - image.height * scale) / 2,
    width: image.width * scale, height: image.height * scale, scale };
}
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas; this.lastDraw = 0; this.images = new Map(); this.records = new Map();
    this.panel = $("map-panel"); this.large = $("large-map"); this.alpha = 1; this.mode = "area";
    $("open-map").onclick = () => this.toggle();
    $("close-map").onclick = () => { this.panel.hidden = true; };
    $("map-area").onclick = () => this.select(this.info?.MapIndex);
    $("map-world").onclick = () => { this.mode = "world"; this.updateTabs(); };
    $("map-opacity").oninput = (event) => { this.alpha = Number(event.target.value) / 100; };
    $("radar-toggle").onclick = () => {
      this.canvas.hidden = !this.canvas.hidden;
      $("radar-toggle").setAttribute("aria-expanded", String(!this.canvas.hidden));
    };
    $("radar-opacity").onclick = () => {
      this.radarAlpha = this.radarAlpha === .55 ? 1 : .55;
      $("radar-opacity").setAttribute("aria-pressed", String(this.radarAlpha === .55));
    };
    this.large.addEventListener("pointermove", (event) => this.hover(event));
    this.large.addEventListener("pointerleave", () => { this.hovered = null; $("map-location").textContent = ""; });
    this.large.addEventListener("click", () => { if (this.hovered?.MapIndex != null) this.select(this.hovered.MapIndex); });
  }
  reset(newConnection = false) {
    this.panel.hidden = true; this.info = null;
    if (newConnection) { this.records.clear(); this.setup = null; $("map-world").disabled = true; }
    this.selected = null; this.hovered = null; this.requested = null; clearTimeout(this.requestTimer);
  }
  setInfo(info) {
    this.info = info; this.selected = info.MapIndex; this.mode = "area";
    this.image("MMap", info.MiniMap); this.image("MMap", info.BigMap);
    $("radar-title").textContent = info.Title; this.updateTabs();
    if (!this.panel.hidden) this.select(info.MapIndex);
  }
  setWorld(setup) {
    this.setup = setup; $("map-world").disabled = !setup?.Enabled;
    if (setup?.Enabled) {
      this.image("Prguse2", 1360);
      fetch("/assets/library?library=MapLinkIcon").then((r) => r.ok ? r.json() : null)
        .then((data) => { this.linkFrames = data?.frames; }).catch(() => {});
    }
  }
  receive(index, info) {
    this.records.set(index, info);
    if (this.requested === index) { clearTimeout(this.requestTimer); this.requested = null; }
    if (this.selected === index) { $("map-error").textContent = ""; this.updateTabs(); }
    this.image("MMap", info.BigMap);
  }
  select(index) {
    if (index == null) return;
    this.mode = "area"; this.selected = index; this.hovered = null; this.updateTabs();
    $("map-error").textContent = "";
    if (!this.records.has(index) && this.requested !== index) {
      this.requested = index;
      if (!this.send?.("RequestMapInfo", { MapIndex: index })) { this.requested = null; $("map-error").textContent = "连接已断开"; return; }
      clearTimeout(this.requestTimer);
      this.requestTimer = setTimeout(() => {
        this.requested = null;
        if (this.selected === index && !this.records.has(index)) $("map-error").textContent = "地图信息未返回，请重试";
      }, 5000);
    }
  }
  toggle() {
    if (!this.info) return;
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.select(this.info.MapIndex);
  }
  updateTabs() {
    this.layout = null;
    $("map-area").setAttribute("aria-selected", String(this.mode === "area"));
    $("map-world").setAttribute("aria-selected", String(this.mode === "world"));
    $("large-map-title").textContent = this.mode === "world" ? "世界地图" : this.records.get(this.selected)?.Title || this.info?.Title || "地图";
    $("map-location").textContent = "";
  }
  image(library, index) {
    if (!(index > 0)) return null;
    const key = `${library}:${index}`;
    if (!this.images.has(key)) {
      const image = new Image(); image.failed = false;
      image.onerror = () => { image.failed = true; };
      image.src = `/assets/frame?library=${library}&index=${index}`;
      this.images.set(key, image);
    }
    return this.images.get(key);
  }
  paint(ctx, image, source, destination, alpha) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!image?.naturalWidth) {
      ctx.fillStyle = "#e5e9de"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(!image || image.failed ? "暂无地图资源" : "载入地图…", ctx.canvas.width / 2, ctx.canvas.height / 2);
      return false;
    }
    ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, source.x, source.y, source.width, source.height, destination.x, destination.y, destination.width, destination.height);
    ctx.globalAlpha = 1; return true;
  }
  markers(ctx, objects, transform, user) {
    for (const e of objects) {
      if (!e.Location || e.Hidden || e.Dead || e.Sneaking || e.kind === "item") continue;
      const p = transform(e.Location);
      if (p.x < 0 || p.y < 0 || p.x > ctx.canvas.width || p.y > ctx.canvas.height) continue;
      ctx.fillStyle = e === user ? "#ffe066" : e.kind === "npc" ? "#67d9ff" : e.kind === "monster" ? "#ef7774" : "#f3f4ef";
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      if (e === user) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((user.Direction || 0) * Math.PI / 4);
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
  }
  draw(map, user, entities, viewport, now) {
    if (!this.info || now - this.lastDraw < 100) return;
    this.lastDraw = now;
    const image = this.image("MMap", this.info.MiniMap);
    if (!this.canvas.hidden) {
      const dimensions = { width: image?.naturalWidth || 120, height: image?.naturalHeight || 108 };
      const source = radarRect(dimensions, map, user.Location);
      const target = { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height };
      const ctx = this.canvas.getContext("2d");
      if (this.paint(ctx, image, source, target, this.radarAlpha || 1)) {
        const transform = (p) => ({ x: (p.X * dimensions.width / map.width - source.x) * target.width / source.width,
          y: (p.Y * dimensions.height / map.height - source.y) * target.height / source.height });
        this.markers(ctx, [...entities.values(), user], transform, user);
      }
    }
    if (this.panel.hidden) return;
    const ctx = this.large.getContext("2d");
    if (this.mode === "world") {
      const image = this.image("Prguse2", 1360);
      const dimensions = { width: image?.naturalWidth || 740, height: image?.naturalHeight || 500 };
      const fit = fitMap(dimensions, this.large.width, this.large.height);
      this.layout = { fit, dimensions };
      this.paint(ctx, image, { x: 0, y: 0, ...dimensions }, fit, this.alpha);
      if (this.hovered) {
        const frame = this.linkFrames?.[this.hovered.ImageIndex];
        if (frame) { ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 2; ctx.strokeRect(fit.x + frame.x * fit.scale, fit.y + frame.y * fit.scale, frame.width * fit.scale, frame.height * fit.scale); }
      }
      return;
    }
    const record = this.records.get(this.selected) || (this.selected === this.info.MapIndex
      ? { Width: map.width, Height: map.height, BigMap: this.info.BigMap } : null);
    const imageLarge = this.image("MMap", record?.BigMap);
    const dimensions = { width: imageLarge?.naturalWidth || 740, height: imageLarge?.naturalHeight || 500 };
    const fit = fitMap(dimensions, this.large.width, this.large.height);
    this.layout = { fit, record };
    if (!this.paint(ctx, imageLarge, { x: 0, y: 0, ...dimensions }, fit, this.alpha) || !record) return;
    const transform = (p) => ({ x: fit.x + p.X / record.Width * fit.width, y: fit.y + p.Y / record.Height * fit.height });
    this.markers(ctx, (record.NPCs || []).filter((e) => e.ShowOnBigMap).map((e) => ({ ...e, kind: "npc" })), transform, user);
    for (const link of record.Movements || []) {
      const p = transform(link.Location); ctx.strokeStyle = "#e7b4f1"; ctx.strokeRect(p.x - 3, p.y - 3, 6, 6);
    }
    if (this.selected === this.info.MapIndex) {
      this.markers(ctx, [...entities.values(), user], transform, user);
      const p = transform({ X: viewport.x / 48, Y: viewport.y / 32 });
      ctx.strokeStyle = "#ffffff88";
      ctx.strokeRect(p.x, p.y, viewport.width / 48 / record.Width * fit.width, viewport.height / 32 / record.Height * fit.height);
    }
  }
  hover(event) {
    if (!this.layout) return;
    const bounds = this.large.getBoundingClientRect(), { fit, record } = this.layout;
    const x = (event.clientX - bounds.left) / bounds.width * this.large.width;
    const y = (event.clientY - bounds.top) / bounds.height * this.large.height;
    this.hovered = null;
    if (this.mode === "world") {
      this.hovered = (this.setup?.Icons || []).find((icon) => {
        const frame = this.linkFrames?.[icon.ImageIndex];
        return frame && x >= fit.x + frame.x * fit.scale && x < fit.x + (frame.x + frame.width) * fit.scale &&
          y >= fit.y + frame.y * fit.scale && y < fit.y + (frame.y + frame.height) * fit.scale;
      });
      $("map-location").textContent = this.hovered?.Title || "";
    } else if (record && x >= fit.x && x < fit.x + fit.width && y >= fit.y && y < fit.y + fit.height) {
      const X = Math.floor((x - fit.x) / fit.width * record.Width), Y = Math.floor((y - fit.y) / fit.height * record.Height);
      const npc = (record.NPCs || []).find((e) => e.ShowOnBigMap && Math.abs(e.Location.X - X) < 5 && Math.abs(e.Location.Y - Y) < 5);
      $("map-location").textContent = `${npc?.Name || ""} ${X}, ${Y}`;
    } else $("map-location").textContent = "";
    this.large.style.cursor = this.hovered ? "pointer" : "crosshair";
  }
}
