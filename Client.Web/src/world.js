import { Application, Container, Sprite, Text, Assets, Graphics } from "pixi.js";
import PF from "pathfinding";
import { motionPosition, worldScale, canPath, walkingPath, singleDetourStep } from "./movement.js";
import { hitSprite, tileDistance, deathFrame } from "./combat.js";
import { weaponLayer } from "./appearance.js";
import { SceneIndex, groundFrame } from "./scene-index.js";
import { Minimap } from "./native-map.js";
import { AttackInput } from "./attack-input.js";
import { Footsteps, locomotionFrame } from "./footsteps.js";
import { mapAnimation, mapEffectFrame, mapPlacement, tileAnimationFrame } from "./map-effects.js";
import { TEXT_SIZE, PLAYER_NAME_SIZE, showName, nameTop, frameIndex, transitionFrame, hydraOverlay, npcIdleAction } from "./entity-presentation.js";

export const directions = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
export function directionTo(from, to) {
  return directions.findIndex(
    ([x, y]) =>
      x === Math.sign(to.X - from.X) && y === Math.sign(to.Y - from.Y),
  );
}

export class World {
  constructor(host, onClick) {
    this.host = host;
    this.onClick = onClick;
    this.entities = new Map();
    this.nameView = localStorage.getItem("crystal-name-view") !== "false";
    this.manifests = new Map();
    this.manifestLoads = new Map();
    this.textures = new Map();
    this.failedTextures = new Set();
    this.nodes = new Map();
    this.labels = new Map();
    this.queue = [];
    this.active = 0;
    this.map = null;
    this.user = null;
    this.damageEvents = [];
    this.spellEffects = [];
    this.effectID = 0;
    this.attackInput = new AttackInput();
    this.footsteps = new Footsteps();
    this.minimap = new Minimap(document.getElementById("minimap-canvas"));
  }
  async init() {
    this.app = new Application();
    await this.app.init({
      resizeTo: this.host,
      background: "#101b14",
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
      antialias: false,
      roundPixels: true,
    });
    this.host.append(this.app.canvas);
    this.itemTooltip = document.createElement("div");
    this.itemTooltip.className = "ground-item-tooltip";
    this.itemTooltip.hidden = true;
    this.host.append(this.itemTooltip);
    this.floor = new Container();
    this.objects = new Container();
    this.objects.sortableChildren = true;
    this.app.stage.addChild(this.floor, this.objects);
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("pointermove", (e) => {
      this.hoverPointer = { clientX: e.clientX, clientY: e.clientY };
      this.attackInput.update(e);
      if (this.runPointer && (e.buttons & 2))
        this.runPointer = { clientX: e.clientX, clientY: e.clientY };
      if (this.walkPointer && (e.buttons & 1))
        this.walkPointer = { clientX: e.clientX, clientY: e.clientY };
    });
    const releasePointer = () => { this.walkPointer = null; this.runPointer = null; this.attackInput.reset(); };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("blur", releasePointer);
    this.app.canvas.addEventListener("pointerleave", releasePointer);
    this.app.canvas.addEventListener("pointerleave", () => { this.hoverPointer = null; this.itemTooltip.hidden = true; });
    window.addEventListener("blur", () => { this.hoverPointer = null; this.itemTooltip.hidden = true; });
    this.app.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (!this.user || !this.map) return;
      e.preventDefault();
      this.attackInput.update(e);
      this.walkPointer = null;
      this.runPointer = e.button === 2
        ? { clientX: e.clientX, clientY: e.clientY } : null;
      const point = this.pointerCell(e);
      const r = this.app.canvas.getBoundingClientRect();
      const worldPoint = {
        X: (e.clientX - r.left - this.objects.x) / this.objects.scale.x,
        Y: (e.clientY - r.top - this.objects.y) / this.objects.scale.y,
      };
      const candidates = [];
      for (const entity of this.entities.values()) {
        const sprite = this.nodes.get(`entity:${entity.ObjectID}`);
        if (!["monster", "npc"].includes(entity.kind) || entity.Dead || entity.Hidden || !sprite?.visible) continue;
        candidates.push({ entity, z: sprite.zIndex, bounds: {
          x: sprite.x, y: sprite.y, width: sprite.width, height: sprite.height,
        } });
      }
      const entity = hitSprite(worldPoint, candidates) || [...this.entities.values()].find(
        (o) =>
          o.Location?.X === point.X &&
          o.Location?.Y === point.Y &&
          o.ObjectID !== this.user.ObjectID,
      );
      this.onClick(point, entity, e.button === 2, e.button === 0 && e.shiftKey, e.button === 0 && e.altKey);
      this.attackInput.update(e);
    });
    this.app.ticker.add(() => this.draw());
  }
  pointerCell(pointer) {
    const r = this.app.canvas.getBoundingClientRect();
    return {
      X: Math.floor((pointer.clientX - r.left - this.floor.x) / this.floor.scale.x / 48),
      Y: Math.floor((pointer.clientY - r.top - this.floor.y) / this.floor.scale.y / 32),
    };
  }
  async setMap(name) {
    this.map = null;
    this.grid = null;
    this.entities.clear();
    this.clearNodes();
    const token = Symbol();
    this.mapToken = token;
    const response = await fetch(
      `/assets/map?name=${encodeURIComponent(name)}`,
    );
    if (this.mapToken !== token) return false;
    if (!response.ok) throw new Error("地图资源未找到");
    const data = await response.json();
    if (this.mapToken !== token) return false;
    const libraries = new Set();
    for (const cell of data.cells) for (const layer of [1, 2])
      if (cell[layer * 2 + 1] >= 0 && data.libraries[cell[layer * 2]]) libraries.add(data.libraries[cell[layer * 2]]);
    if (data.cells.some((cell) => cell[11] > 0 && cell[13] > 0) && data.libraries[190])
      libraries.add(data.libraries[190]);
    for (const library of libraries) this.manifest(library);
    await Promise.all([...libraries].map((library) => this.manifestLoads.get(library)));
    if (this.mapToken !== token) return false;
    this.scenery = new SceneIndex();
    for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y * data.width + x];
      for (const layer of [1, 2]) {
        const library = data.libraries[cell[layer * 2]], index = cell[layer * 2 + 1];
        const frame = this.manifests.get(library)?.frames[index];
        const animation = mapAnimation(cell, layer);
        if (!frame || (groundFrame(frame) && !animation.count && !animation.blend) || frame.width <= 0 || frame.height <= 0) continue;
        const bounds = mapPlacement(cell, layer, index, frame, x, y);
        for (let i = 1; i < animation.count; i++) {
          const next = this.manifests.get(library)?.frames[index + i];
          if (!next) continue;
          const b = mapPlacement(cell, layer, index + i, next, x, y);
          const right = Math.max(bounds.x + bounds.width, b.x + b.width), bottom = Math.max(bounds.y + bounds.height, b.y + b.height);
          bounds.x = Math.min(bounds.x, b.x); bounds.y = Math.min(bounds.y, b.y);
          bounds.width = right - bounds.x; bounds.height = bottom - bounds.y;
        }
        this.scenery.add({ key: `${layer}:${x},${y}`, library, index, x, y, cell, layer, animation,
          z: y * 32 + 31, bounds });
      }
    }
    this.map = data;
    this.grid = new PF.Grid(data.width, data.height);
    for (let y = 0; y < data.height; y++)
      for (let x = 0; x < data.width; x++)
        if (data.cells[y * data.width + x][6])
          this.grid.setWalkableAt(x, y, false);
    return true;
  }
  path(to) {
    if (
      !this.map ||
      !this.user ||
      !canPath(this.grid, this.user.Location, to) ||
      to.X < 0 ||
      to.Y < 0 ||
      to.X >= this.map.width ||
      to.Y >= this.map.height
    )
      return [];
    const grid = this.grid.clone();
    for (const e of this.entities.values())
      if (
        e.kind !== "item" &&
        !e.Dead && !e.Hidden && e.visibilityAction !== "Hide" &&
        e.ObjectID !== this.user.ObjectID &&
        grid.isInside(e.Location.X, e.Location.Y)
      )
        grid.setWalkableAt(e.Location.X, e.Location.Y, false);
    grid.setWalkableAt(this.user.Location.X, this.user.Location.Y, true);
    return new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: false })
      .findPath(this.user.Location.X, this.user.Location.Y, to.X, to.Y, grid)
      .slice(1)
      .map(([X, Y]) => ({ X, Y }));
  }
  straightPath(direction, distance) {
    if (!this.map || !this.user || direction < 0) return [];
    const [dx, dy] = directions[direction];
    const path = [];
    for (let step = 1; step <= distance; step++) {
      const point = { X: this.user.Location.X + dx * step, Y: this.user.Location.Y + dy * step };
      if (!this.grid.isInside(point.X, point.Y) || !this.grid.isWalkableAt(point.X, point.Y)) break;
      if ([...this.entities.values()].some((e) => e.kind !== "item" && !e.Dead && !e.Hidden && e.visibilityAction !== "Hide" &&
          e.ObjectID !== this.user.ObjectID && e.Location?.X === point.X && e.Location?.Y === point.Y)) break;
      path.push(point);
    }
    return path;
  }
  walkPath(point) {
    if (!this.user) return [];
    const direct = walkingPath(directionTo(this.user.Location, point), direction => this.straightPath(direction, 1));
    return singleDetourStep(direct, direct.length ? [] : this.path(point));
  }
  pathToMelee(target) {
    if (!this.map || !this.user || !canPath(this.grid, this.user.Location, target)) return [];
    const goals = directions.map(([dx, dy]) => ({ X: target.X + dx, Y: target.Y + dy }))
      .filter((point) => this.grid.isInside(point.X, point.Y) && this.grid.isWalkableAt(point.X, point.Y))
      .sort((a, b) => tileDistance(a, this.user.Location) - tileDistance(b, this.user.Location));
    for (const goal of goals) {
      const path = this.path(goal);
      if (path.length) return path;
    }
    return [];
  }
  clearNodes() {
    this.damageEvents = [];
    this.spellEffects = [];
    for (const n of this.nodes.values()) n.destroy();
    for (const n of this.labels.values()) n.destroy();
    this.nodes.clear();
    this.labels.clear();
  }
  addDamage(packet) {
    const entity = packet.ObjectID === this.user?.ObjectID ? this.user : this.entities.get(packet.ObjectID);
    if (!entity) return;
    this.damageEvents.push({ ...packet, id: ++this.effectID, location: { ...entity.Location }, started: performance.now() });
    if (this.damageEvents.length > 64) this.damageEvents.shift();
  }
  spellEffect(spell) {
    // Impact frames match PlayerObject's native completed-cast rendering.
    return ({ 31: ["Magic", 170, 10, 600], 33: ["Magic", 1570, 10, 1000],
      34: ["Magic", 570, 10, 600], 36: ["Magic2", 10, 5, 400],
      38: ["Magic", 1660, 10, 1000], 41: ["Magic2", 570, 8, 600],
      44: ["Magic", 3930, 15, 1000], 45: ["Magic2", 1060, 20, 1000],
      46: ["Magic", 3850, 20, 1300], 47: ["Magic2", 140, 10, 600],
      61: ["Magic", 370, 10, 800], 63: ["Magic", 770, 10, 1000],
      64: ["Magic", 1360, 10, 600], 70: ["Magic", 3990, 10, 1000],
      74: ["Magic2", 620, 10, 800], 75: ["Magic", 1800, 10, 1000],
      76: ["Magic2", 1110, 10, 1000], 86: ["Magic3", 620, 10, 1200] })[spell];
  }
  castSpellEffects(spell) {
    // Effects attached to the caster when MirAction.Spell begins.
    const effect = ({ 7:["Magic2",990,10,600], 9:["Magic2",710,20,1200],
      12:["Magic2",1520,10,600], 13:["Magic2",1510,10,600],
      16:["Magic3",187,10,1000], 17:["Magic3",550,17,1600],
      31:["Magic",0,10,600], 32:["Magic",900,6,600], 33:["Magic",1560,10,600],
      34:["Magic",400,10,600], 35:["Magic",920,10,600], 36:["Magic2",20,3,300],
      37:["Magic",1590,10,600], 38:["Magic",1650,10,600], 39:["Magic",1620,10,600],
      41:["Magic2",400,10,600], 42:["Magic",1680,10,600], 43:["Magic",3880,10,600],
      44:["Magic",3920,10,600], 45:["Magic2",1040,7,600], 46:["Magic",3840,10,600],
      47:["Magic2",130,6,600], 48:["Magic2",650,10,600], 49:["Magic2",910,23,1800],
      50:["Magic2",1540,8,600], 51:["Magic3",80,9,900], 52:["Magic2",1590,10,600],
      55:["Magic3",590,10,600], 61:["Magic",200,10,600], 63:["Magic",600,10,600],
      65:["Magic",1500,10,600], 67:["Magic",1520,10,600], 70:["Magic",3960,20,1200],
      72:["Magic2",190,6,600], 73:["Magic",1380,10,600], 75:["Magic",1790,10,600],
      77:["Magic2",160,15,1000], 78:["Magic2",0,10,600], 86:["Magic3",620,10,600]
    })[spell];
    return effect ? [effect] : [];
  }
  preloadSpell(spell) {
    const effects = [...this.castSpellEffects(spell), this.spellEffect(spell)].filter(Boolean);
    for (const [library, start, count] of effects) {
      this.manifest(library);
      this.manifestLoads.get(library)?.then(() => {
        for (let i = 0; i < count; i++) if (this.manifests.get(library)?.frames[start + i]) this.texture(library, start + i, true);
      });
    }
  }
  addSpellEffect(effect, targetID, location) {
    if (!effect || !location) return;
    this.spellEffects.push({ id: ++this.effectID, effect, targetID, location, started: performance.now() });
    if (this.spellEffects.length > 32) this.spellEffects.shift();
  }
  showCastSpell(spell, caster) {
    if (!caster?.Location) return;
    this.preloadSpell(spell);
    for (const effect of this.castSpellEffects(spell)) this.addSpellEffect(effect, caster.ObjectID, caster.Location);
  }
  showSpell(spell, targetID, location) {
    const effect = this.spellEffect(spell); if (!effect || !location) return;
    this.preloadSpell(spell);
    this.addSpellEffect(effect, targetID, location);
  }
  manifest(library) {
    if (!library) return null;
    if (!this.manifests.has(library)) {
      this.manifests.set(library, null);
      this.manifestLoads.set(library, fetch(`/assets/library?library=${encodeURIComponent(library)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => this.manifests.set(library, m))
        .catch(() => {}));
    }
    return this.manifests.get(library);
  }
  preloadEntity(entity) {
    if (!["monster", "npc"].includes(entity.kind)) return;
    const library = entity.kind === "npc"
      ? `NPC/${String(entity.Image).padStart(2, "0")}`
      : `Monster/${String(entity.Image).padStart(3, "0")}`;
    this.manifest(library);
    this.manifestLoads.get(library)?.then(() => {
      const manifest = this.manifests.get(library);
      if (!manifest) return;
      const actions = entity.kind === "npc" ? ["Standing", "Harvest"] : ["Standing"];
      const directions = entity.kind === "npc" ? 3 : 8;
      for (const action of actions) {
        const frame = manifest.animations[action];
        if (!frame) continue;
        for (let direction = 0; direction < directions; direction++)
          for (let step = 0; step < frame.count; step++) {
            const index = frameIndex(frame, direction, step);
            if (manifest.frames[index]) this.texture(library, index, true);
          }
      }
    });
  }
  texture(library, index, priority = false) {
    const key = `${library}:${index}`;
    if (!this.textures.has(key)) {
      this.textures.set(key, null);
      this.queue[priority ? "unshift" : "push"]({
        key,
        url: `/assets/frame?library=${encodeURIComponent(library)}&index=${index}`,
      });
      this.pump();
    } else if (priority && !this.textures.get(key)) {
      const queued = this.queue.findIndex((request) => request.key === key);
      if (queued > 0) this.queue.unshift(...this.queue.splice(queued, 1));
    }
    return this.textures.get(key);
  }
  pump() {
    while (this.active < 12 && this.queue.length) {
      const item = this.queue.shift();
      this.active++;
      Assets.load({ src: item.url, loadParser: "loadTextures" })
        .then((texture) => {
          texture.source.scaleMode = "nearest";
          this.textures.set(item.key, texture);
        })
        .catch(() => { this.failedTextures.add(item.key); })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
  sprite(key, library, index, x, y, z, layer, offset = false, up = false) {
    const manifest = this.manifest(library);
    let frame = manifest?.frames[index];
    if (!frame) return;
    const texture = this.texture(library, index, key.startsWith("entity:"));
    let sprite = this.nodes.get(key);
    if (!texture && !sprite) return;
    if (!sprite) {
      sprite = new Sprite(texture);
      layer.addChild(sprite);
      this.nodes.set(key, sprite);
    }
    if (texture) {
      sprite.texture = texture;
      sprite.assetFrame = frame;
      sprite.assetIndex = index;
    } else frame = sprite.assetFrame;
    sprite.x = Math.round(x + (offset ? frame.x : 0));
    sprite.y = Math.round(y + (offset ? frame.y : 0) - (up ? frame.height : 0));
    sprite.zIndex = z;
    sprite.visible = true;
    sprite.seen = this.tick;
  }
  animationDefinition(library, action) {
    const manifest = this.manifest(library);
    if (!manifest) return null;
    const defaults = {
      Standing: { start: 0, count: 4, skip: 0, interval: 500 },
      Walking: { start: 32, count: 6, skip: 0, interval: 100 },
      Attack1: { start: 80, count: 6, skip: 0, interval: 100 },
      Die: { start: 144, count: 10, skip: 0, interval: 100 },
      Dead: { start: 153, count: 1, skip: 9, interval: 1000 },
    };
    if (library.startsWith("CArmour/")) {
      defaults.Running = { start: 80, count: 6, skip: 0, interval: 100 };
      defaults.Spell = { start: 296, count: 6, skip: 0, interval: 100 };
      defaults.Harvest = { start: 344, count: 2, skip: 0, interval: 300 };
      defaults.Attack1 = { start: 136, count: 6, skip: 0, interval: 100 };
      defaults.Die = { start: 384, count: 4, skip: 0, interval: 100 };
      defaults.Dead = { start: 387, count: 1, skip: 3, interval: 1000 };
    }
    return (
      manifest.animations[action] ||
      defaults[action] ||
      manifest.animations.Standing ||
      defaults.Standing);
  }
  animation(library, action, direction, time, offset = 0) {
    const f = this.animationDefinition(library, action);
    if (!f) return -1;
    return (
      offset +
      f.start +
      direction * (f.count + f.skip) + (f.reverse ? -1 : 1) *
      (action === "Die" ? deathFrame(time, f.count, f.interval) :
        Math.floor(time / Math.max(50, f.interval)) % Math.max(1, f.count))
    );
  }
  visibilityFrame(entity, library, now) {
    const manifest = this.manifest(library);
    if (!manifest) return -1;
    const f = manifest.animations[entity.visibilityAction];
    if (!f) {
      if (entity.visibilityAction === "Hide") this.entities.delete(entity.ObjectID);
      entity.visibilityAction = null;
      return -1;
    }
    let ready = true;
    for (let i = 0; i < f.count; i++) {
      const index = frameIndex(f, entity.Direction || 0, i);
      const frames = entity.Image === 371 ? [index, hydraOverlay(index)] : [index];
      for (const n of frames) {
        if (n == null || !manifest.frames[n]) continue;
        if (!this.texture(library, n, true) && !this.failedTextures.has(`${library}:${n}`)) ready = false;
      }
    }
    const {step, done} = transitionFrame(entity, f, now, ready);
    if (done) {
      if (entity.visibilityAction === "Hide") this.entities.delete(entity.ObjectID);
      entity.visibilityAction = null;
    }
    return frameIndex(f, entity.Direction || 0, step);
  }
  dyingFrame(entity, library, offset, now) {
    const f = this.animationDefinition(library, "Die");
    if (!f) return -1;
    const start = offset + f.start + (entity.Direction || 0) * (f.count + f.skip);
    let ready = true;
    for (let i = 0; i < f.count; i++) {
      const index = start + i;
      if (!this.manifests.get(library).frames[index]) continue;
      if (!this.texture(library, index, true) && !this.failedTextures.has(`${library}:${index}`)) ready = false;
    }
    if (!ready) return start;
    entity.deathPlaybackAt ??= now;
    const elapsed = now - entity.deathPlaybackAt;
    return this.animation(library, elapsed < f.count * Math.max(50, f.interval) ? "Die" : "Dead",
      entity.Direction || 0, elapsed, offset);
  }
  draw() {
    if (!this.map || !this.user || !this.app) return;
    const now = performance.now();
    this.tick = (this.tick || 0) + 1;
    const u = this.user;
    const { X: ux, Y: uy } = motionPosition(u, now);
    const scale = worldScale(this.app.screen.width, this.app.screen.height);
    this.floor.scale.set(scale);
    this.objects.scale.set(scale);
    this.floor.position.set(
      Math.round(this.app.screen.width / 2 - (ux * 48 + 24) * scale),
      Math.round(this.app.screen.height / 2 - (uy * 32 + 16) * scale),
    );
    this.objects.position.copyFrom(this.floor.position);
    const rect = this.app.canvas.getBoundingClientRect();
    const pointer = this.hoverPointer && { X: (this.hoverPointer.clientX - rect.left - this.objects.x) / scale,
      Y: (this.hoverPointer.clientY - rect.top - this.objects.y) / scale };
    const hoverCandidates = [];
    for (const entity of [...this.entities.values(), u]) {
      const body = this.nodes.get(`entity:${entity.ObjectID}`);
      if (!body || entity.Hidden || entity.Dead) continue;
      hoverCandidates.push({entity, z: body.zIndex, bounds: {x: body.x, y: body.y, width: body.width, height: body.height}});
    }
    const hoveredID = pointer ? hitSprite(pointer, hoverCandidates)?.ObjectID : null;
    const hoveredItem = hoveredID == null ? null : this.entities.get(hoveredID);
    if (hoveredItem?.kind === "item" && this.hoverPointer) {
      this.itemTooltip.textContent = hoveredItem.Name || "物品";
      this.itemTooltip.style.left = `${Math.min(window.innerWidth - 12, this.hoverPointer.clientX + 12)}px`;
      this.itemTooltip.style.top = `${Math.max(8, this.hoverPointer.clientY - 32)}px`;
      this.itemTooltip.hidden = false;
    } else this.itemTooltip.hidden = true;
    const viewport = { x: -this.floor.x / scale, y: -this.floor.y / scale,
      width: this.app.screen.width / scale, height: this.app.screen.height / scale };
    this.minimap.draw(this.map, u, this.entities, viewport, now);
    const rx = Math.ceil(this.app.screen.width / scale / 96) + 4,
      ry = Math.ceil(this.app.screen.height / scale / 64) + 8;
    for (
      let y = Math.max(0, u.Location.Y - ry);
      y < Math.min(this.map.height, u.Location.Y + ry);
      y++
    )
      for (
        let x = Math.max(0, u.Location.X - rx);
        x < Math.min(this.map.width, u.Location.X + rx);
        x++
      ) {
        const c = this.map.cells[y * this.map.width + x],
          px = x * 48,
          py = y * 32;
        if (x % 2 === 0 && y % 2 === 0)
          this.sprite(
            `b${x},${y}`,
            this.map.libraries[c[0]],
            c[1],
            px,
            py,
            0,
            this.floor,
          );
        const tileIndex = tileAnimationFrame(c, now);
        if (tileIndex >= 0) {
          const library = this.map.libraries[190];
          this.sprite(`tile-animation:${x},${y}`, library, tileIndex, px, py + 32,
            py + 30, this.floor, false, true);
        }
        for (let layer = 1; layer <= 2; layer++) {
          const lib = this.map.libraries[c[layer * 2]],
            index = c[layer * 2 + 1],
            f = this.manifest(lib)?.frames[index];
          const animation = mapAnimation(c, layer);
          if (!groundFrame(f) || animation.count || animation.blend) continue;
          const ground =
            (f.width === 48 && f.height === 32) ||
            (f.width === 96 && f.height === 64);
          this.sprite(
            `${layer}:${x},${y}`,
            lib,
            index,
            px,
            ground ? py : py + 32,
            py + 31,
            ground ? this.floor : this.objects,
            false,
            !ground,
          );
        }
      }
    for (const object of this.scenery.query({ x: viewport.x - 96, y: viewport.y - 96,
      width: viewport.width + 192, height: viewport.height + 192 })) {
      const index = mapEffectFrame(object.index, object.animation, now);
      const frame = this.manifests.get(object.library)?.frames[index];
      if (!frame) continue;
      const position = mapPlacement(object.cell, object.layer, index, frame, object.x, object.y);
      this.sprite(object.key, object.library, index, position.x, position.y, object.z, this.objects);
      const sprite = this.nodes.get(object.key);
      if (sprite) sprite.blendMode = object.animation.blend ? "add" : "normal";
    }
    for (const e of [...this.entities.values(), u]) {
      if (
        !e.Location ||
        Math.abs(e.Location.X - u.Location.X) > rx ||
        Math.abs(e.Location.Y - u.Location.Y) > ry ||
        e.Hidden
      )
        continue;
      const position = motionPosition(e, now);
      const x = position.X * 48, y = position.Y * 32;
      let library,
        index,
        action = e.Dead
          ? (e.Harvested ? "Skeleton" : "Dead")
          : now < (e.harvestUntil || 0)
            ? "Harvest"
          : now < (e.castUntil || 0)
            ? "Spell"
          : now < (e.attackUntil || 0)
            ? "Attack1"
            : position.moving
              ? (e.running ? "Running" : "Walking")
              : "Standing";
      if (e.kind === "item") {
        library = "DNItems";
        index = e.Image;
      } else if (e.kind === "npc") {
        library = `NPC/${String(e.Image).padStart(2, "0")}`;
        action = npcIdleAction(e, this.manifest(library)?.animations, now);
        index = this.animation(library, action, e.Direction || 0, now - (e.npcIdleStartedAt || now));
      } else if (e.kind === "monster") {
        library = `Monster/${String(e.Image).padStart(3, "0")}`;
        index = this.animation(library, action, e.Direction || 0, now);
      } else {
        library = `CArmour/${String(Math.max(0, e.Armour || 0)).padStart(2, "0")}`;
        index = this.animation(
          library,
          action,
          e.Direction || 0,
          now,
          e.Gender === 1 ? 808 : 0,
        );
      }
      if (e.visibilityAction && e.kind === "monster") {
        index = this.visibilityFrame(e, library, now);
        if (!this.entities.has(e.ObjectID) || index < 0) continue;
      }
      else if ((e.Harvested || e.Skeleton) && e.kind === "monster")
        index = this.animation(library, this.manifest(library)?.animations.Skeleton ? "Skeleton" : "Dead", e.Direction || 0, 0);
      else if (e.Dead && e.diedAt != null && e.kind !== "item")
        index = this.dyingFrame(e, library, e.kind === "player" && e.Gender === 1 ? 808 : 0, now);
      else if (e.kind === "player" && (position.moving || ["Attack1", "Spell", "Harvest"].includes(action))) {
        const f = this.animationDefinition(library, action);
        if (f) {
          const duration = ["Attack1", "Spell", "Harvest"].includes(action) ? 600 : e.moveDuration;
          const started = action === "Harvest" ? e.harvestStartedAt : action === "Spell" ? e.castStartedAt : action === "Attack1" ? e.attackStartedAt : e.movedAt;
          const phase = Math.max(0, Math.min(0.999, (now - started) / duration));
          const movingAction = ["Walking", "Running"].includes(action);
          const frame = locomotionFrame(phase, f.count);
          if (e === u && position.moving && ["Walking", "Running"].includes(action) &&
              (e.from?.X !== e.Location.X || e.from?.Y !== e.Location.Y)) {
            const sound = this.footsteps.sample(e.movedAt, frame, e.running);
            if (sound !== null) this.onStep?.(sound);
          }
          index = this.animation(library, action, e.Direction || 0,
            (movingAction ? frame : phase * f.count) * Math.max(50, f.interval), e.Gender === 1 ? 808 : 0);
        }
      }
      if (e.kind === "player" && !e.Dead) {
        const key = `shadow:${e.ObjectID}`;
        let shadow = this.nodes.get(key);
        if (!shadow) {
          shadow = new Graphics().ellipse(0, 0, 15, 5).fill({ color: 0x000000, alpha: 0.12 })
            .ellipse(0, 0, 10, 3).fill({ color: 0x000000, alpha: 0.17 });
          this.objects.addChild(shadow);
          this.nodes.set(key, shadow);
        }
        shadow.position.set(x + 24, y + 16);
        shadow.zIndex = y + 31.5;
        shadow.seen = this.tick;
      }
      this.sprite(
        `entity:${e.ObjectID}`,
        library,
        index,
        x,
        y,
        y + 32,
        this.objects,
        true,
      );
      const body = this.nodes.get(`entity:${e.ObjectID}`);
      if (body && e.kind === "item") {
        body.scale.set(0.78);
        body.position.set(Math.round(x + 24 - body.width / 2), Math.round(y + 16 - body.height / 2));
        const key = `item-glint:${e.ObjectID}`;
        let glint = this.nodes.get(key);
        if (!glint) {
          glint = new Graphics();
          this.objects.addChild(glint);
          this.nodes.set(key, glint);
        }
        const phase = ((now + Math.abs(Number(e.ObjectID) || 0) * 137) % 1800) / 1800;
        const alpha = phase < 0.28 ? Math.sin(phase / 0.28 * Math.PI) * 0.9 : 0;
        glint.clear().rect(-5, 0, 11, 1).fill(0xffedaa).rect(0, -5, 1, 11).fill(0xffedaa)
          .rect(-2, -2, 5, 5).fill({color: 0xffffff, alpha: 0.55});
        glint.position.set(x + 24, y + 8);
        glint.alpha = alpha;
        glint.blendMode = "add";
        glint.zIndex = y + 32.1;
        glint.seen = this.tick;
      }
      if (body) body.tint = now < (e.struckUntil || 0) ? 0xffa39a : 0xffffff;
      if (body && !e.Dead && ["monster", "npc"].includes(e.kind) &&
          (e.ObjectID === hoveredID || e.ObjectID === this.selectedID)) {
        const key = `entity:highlight:${e.ObjectID}`;
        this.sprite(key, library, body.assetIndex, x, y, y + 32.02, this.objects, true);
        const highlight = this.nodes.get(key);
        if (highlight) { highlight.blendMode = "add"; highlight.alpha = 0.3; highlight.tint = body.tint; }
      }
      if (e.kind === "monster" && e.Image === 371 && body) {
        const overlay = hydraOverlay(body.assetIndex);
        if (overlay != null) {
          const key = `entity:overlay:${e.ObjectID}`;
          this.sprite(key, library, overlay, x, y, y + 32.01, this.objects, true);
          const sprite = this.nodes.get(key);
          if (sprite) sprite.blendMode = "add";
        }
      }
      if (e.kind === "player" && body) {
        const weapon = weaponLayer(action === "Harvest" ? { ...e, Weapon: 1, WeaponEffect: 0 } : e, body.assetIndex);
        if (weapon) {
          const key = `entity:weapon:${e.ObjectID}:${e.Weapon}`;
          const z = y + (weapon.behind ? 31.75 : 32.25);
          this.sprite(key, weapon.library, weapon.index, x, y, z, this.objects, true);
          const sprite = this.nodes.get(key);
          if (sprite) sprite.tint = body.tint;
          if (weapon.effectLibrary) {
            const effectKey = `entity:weapon-effect:${e.ObjectID}:${e.WeaponEffect}`;
            this.sprite(effectKey, weapon.effectLibrary, weapon.index, x, y, z + 0.01, this.objects, true);
            const effect = this.nodes.get(effectKey);
            if (effect) { effect.alpha = 0.4; effect.blendMode = "add"; }
          }
        }
      }
      if (e.kind === "monster" && !e.Dead && now < (e.healthUntil || 0)) {
        const key = `health:${e.ObjectID}`;
        let bar = this.nodes.get(key);
        if (!bar) { bar = new Graphics(); this.objects.addChild(bar); this.nodes.set(key, bar); }
        bar.clear().rect(-21, 0, 42, 5).fill(0x172018)
          .rect(-20, 1, 40 * e.healthPercent / 100, 3).fill(0xc46c60);
        bar.position.set(x + 24, y - 58); bar.zIndex = y + 101; bar.seen = this.tick;
      }
      const hovered = e.ObjectID === hoveredID;
      const standing = this.animation(library, "Standing", e.Direction || 0, 0,
        e.kind === "player" && e.Gender === 1 ? 808 : 0);
      const top = this.manifests.get(library)?.frames[standing]?.y;
      let actorTop = Math.min(y - 40, y + (top ?? -40));
      if (showName(e, this.nameView, hovered)) {
        let label = this.labels.get(e.ObjectID);
        if (!label) {
          label = new Text({text:e.kind === "monster" ? (e.Name || "").replaceAll("_", "\n") : e.Name || "",
            style:{fontFamily:"Arial, sans-serif",fontSize:e.kind === "player" ? PLAYER_NAME_SIZE : TEXT_SIZE,align:"center",
              fill:e.kind === "monster" ? "#ffcf9c" : e.kind === "npc" ? "#a5e7d0" : "#f1f3e1",
              stroke:{color:"#000000",width:2}},resolution:2});
          label.anchor.set(0.5,0); this.objects.addChild(label); this.labels.set(e.ObjectID,label);
        }
        label.scale.set(1 / scale);
        label.position.set(x + 25, e.kind === "item" ? y + 16 :
          nameTop(y, top, label.height, scale, e.kind === "player" ? -2 : 4));
        label.zIndex = y + 100; label.visible = true; label.seen = this.tick;
        actorTop = label.y;
      }
      if (e.chatText && now < (e.chatUntil || 0)) {
        const key = `chat:${e.ObjectID}`;
        let chat = this.nodes.get(key);
        if (!chat) {
          chat = new Text({text:e.chatText, style:{fontFamily:"Arial, sans-serif",fontSize:TEXT_SIZE,
            fill:"#ffffff",stroke:{color:"#000000",width:2},wordWrap:true,wordWrapWidth:200,align:"center"},resolution:2});
          chat.anchor.set(0.5,1); this.objects.addChild(chat); this.nodes.set(key,chat);
        }
        if (chat.text !== e.chatText) chat.text = e.chatText;
        chat.scale.set(1 / scale); chat.position.set(x + 24, actorTop - 20 / scale);
        chat.zIndex = y + 102; chat.visible = true; chat.seen = this.tick;
      }
    }
    this.spellEffects = this.spellEffects.filter((effect) => now - effect.started < effect.effect[3]);
    for (const effect of this.spellEffects) {
      const [library, start, count, duration] = effect.effect;
      const target = effect.targetID === u.ObjectID ? u : this.entities.get(effect.targetID);
      const point = target ? motionPosition(target, now) : effect.location;
      const index = start + Math.min(count - 1, Math.floor((now - effect.started) / duration * count));
      this.sprite(`entity:effect:${effect.id}`, library, index, point.X * 48, point.Y * 32,
        point.Y * 32 + 102, this.objects, true);
    }
    this.damageEvents = this.damageEvents.filter((event) => now - event.started < 900);
    for (const event of this.damageEvents) {
      const key = `damage:${event.id}`;
      let text = this.nodes.get(key);
      if (!text) {
        text = new Text({ text: event.Type === 1 ? "MISS" : String(Math.abs(event.Damage)),
          style: { fontFamily: "Arial, sans-serif", fontSize: TEXT_SIZE,
            fontWeight: "bold", fill: event.Type === 2 ? "#ffe09b" : event.ObjectID === u.ObjectID ? "#ff9187" : "#fff1d5",
            stroke: { color: "#000000", width: 2 } }, resolution: 2 });
        text.anchor.set(0.5, 1); this.objects.addChild(text); this.nodes.set(key, text);
      }
      const elapsed = now - event.started;
      text.scale.set(1 / scale);
      text.position.set(event.location.X * 48 + 15, event.location.Y * 32 - 75 - elapsed * (50 / 900));
      text.alpha = Math.min(1, (900 - elapsed) / 300); text.zIndex = 1000000; text.seen = this.tick;
    }
    for (const [key, node] of this.nodes)
      if (node.seen !== this.tick) {
        node.destroy();
        this.nodes.delete(key);
      }
    for (const [key, node] of this.labels)
      if (node.seen !== this.tick) {
        node.destroy();
        this.labels.delete(key);
      }
  }
}
