import { Application, Container, Sprite, Text, Assets, Graphics, RenderTexture, Texture } from "pixi.js";
import PF from "pathfinding";
import { motionPosition, worldScale, canPath, walkingPath, singleDetourStep } from "./movement.js";
import { textureBytes, textureEvictions } from "./texture-budget.js";
import { hitSprite, tileDistance, deathFrame } from "./combat.js";
import { hairLayer, weaponLayer, wingLayer, transformLayer, transformAction } from "./appearance.js";
import { SceneIndex, groundFrame } from "./scene-index.js";
import { Minimap } from "./native-map.js";
import { AttackInput } from "./attack-input.js";
import { Footsteps } from "./footsteps.js";
import { Doors } from "./doors.js";
import { glintStyle, glintPhase } from "./item-glint.js";
import { mapAnimation, mapEffectFrame, mapPlacement, tileAnimationFrame } from "./map-effects.js";
import { TEXT_SIZE, PLAYER_NAME_SIZE, showName, nameTop, frameIndex, transitionFrame, hydraOverlay, npcIdleAction, entityDepth, assetScale } from "./entity-presentation.js";
import { spellObject, spellObjectFrame, spellObjectEffects, SPELL_OBJECT_SOUNDS } from "./spell-object.js";
import { objectEffects } from "./object-effect.js";
import { monsterOverlays } from "./monster-overlay.js";
import { poisonTint, poisonDots } from "./poison.js";
import { effectiveSetting, needsDarkness, darknessColour, lightsFor, LIGHT_STOPS,
  LIGHT_SETTING } from "./lighting.js";
import { createMissile } from "./missile.js";
import { resolveFrames, hasDeclaredAction, animationStep, actionLength, advanceAction,
  liveAction, manualDrawOffset, MOVING_ACTIONS, MOUNT_ACTIONS, REMOVED_ON_HIDE, STONED_ON_HIDE } from "./entity-action.js";

// DXManager.CreateLights paints one radial gradient and reuses it at every size, so this
// builds it once at a generous resolution and lets the sprite scale it.
let LIGHT_TEXTURE = null;
function lightTexture() {
  if (LIGHT_TEXTURE) return LIGHT_TEXTURE;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [stop, level, alpha] of LIGHT_STOPS)
    gradient.addColorStop(stop, `rgba(${level},${level},${level},${alpha / 255})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  LIGHT_TEXTURE = Texture.from(canvas);
  return LIGHT_TEXTURE;
}

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
    this.spellObjects = new Map();
    this.missiles = [];
    this.effectID = 0;
    this.attackInput = new AttackInput();
    this.footsteps = new Footsteps();
    // Given its sender by main.js once the socket exists; a door is asked for by the client.
    this.doors = new Doors(null);
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
    // Darkness is a multiply pass over the finished scene, so it renders into a texture
    // of its own first: the lights inside it are additive against the dark ground, not
    // against the screen.
    this.lightScene = new Container();
    this.lightDark = new Graphics();
    this.lightScene.addChild(this.lightDark);
    this.lightLayer = new Sprite();
    this.lightLayer.blendMode = "multiply";
    this.lightLayer.visible = false;
    this.app.stage.addChild(this.floor, this.objects, this.lightLayer);
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
    // Before the scenery loop, which asks each cell whether it carries a door.
    this.doors.load(data.doors, data.width);
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
          z: y * 32 + 31, bounds, door: layer === 2 ? this.doors.at(x, y) : null });
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
    this.spellObjects.clear();
    this.missiles = [];
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
  // S.ObjectSpell: a standing effect on a cell -- the fire wall, the poison cloud, a
  // trap. Native makes a SpellObject and keeps it until an ObjectRemove
  // (Client/MirObjects/SpellObject.cs:29-289).
  addSpellObject(packet) {
    const definition = spellObject(packet.Spell, packet.Direction || 0, !!packet.Param);
    for (const effect of spellObjectEffects(packet.Spell))
      this.addSpellEffect(effect, null, packet.Location);
    if (!definition || !packet.Location) return;
    this.spellObjects.set(packet.ObjectID, { ...packet, definition, started: performance.now() });
    this.manifest(definition.library);
    this.manifestLoads.get(definition.library)?.then(() => {
      for (let i = 0; i < definition.count; i++)
        if (this.manifests.get(definition.library)?.frames[definition.start + i])
          this.texture(definition.library, definition.start + i, true);
    });
  }
  removeSpellObject(objectID) {
    this.spellObjects.delete(objectID);
  }
  // MagicShieldDown and ElementalBarrierDown remove the effect their Up twin left running
  // (GameScene.cs:4780-4800), which is the only reason an effect carries a key.
  clearObjectEffect(objectID, key) {
    this.spellEffects = this.spellEffects.filter((e) => !(e.key === key && e.targetID === objectID));
  }
  // S.ObjectEffect: an effect attached to an object, which is why it follows the object
  // rather than a cell (Client/MirScenes/GameScene.cs:4719-4924).
  addObjectEffect(packet, user) {
    const source = packet.ObjectID === user?.ObjectID ? user : this.entities.get(packet.ObjectID);
    if (!source?.Location) return [];
    const entries = objectEffects(packet, source);
    for (const entry of entries) {
      if (entry.clear) { this.clearObjectEffect(source.ObjectID, entry.clear); continue; }
      const owner = entry.on === "other"
        ? (packet.EffectType === user?.ObjectID ? user : this.entities.get(packet.EffectType))
        : source;
      if (entry.on === "other" && !owner?.Location) continue;
      if (entry.detach) this.addSpellEffect(entry.effect, null, owner.Location, entry);
      else this.addSpellEffect(entry.effect, owner.ObjectID, owner.Location, entry);
    }
    return entries;
  }
  // Only one projectile exists natively: FireBounce (GameScene.cs:4689-4717).
  addProjectile(packet, user) {
    const source = packet.Source === user?.ObjectID ? user : this.entities.get(packet.Source);
    const target = packet.Destination === user?.ObjectID ? user : this.entities.get(packet.Destination);
    const missile = createMissile(packet.Spell, source, target);
    if (!missile) return null;
    this.missiles.push({ id: ++this.effectID, started: performance.now(), ...missile });
    this.manifest(missile.library);
    return missile;
  }
  // Native's Effect carries a delayed start, a blend flag, and a repeat that runs until a
  // deadline rather than for one pass (Client/MirObjects/Effect.cs:23-110). options is how
  // an ObjectEffect asks for those; a plain cast or impact effect needs none of them.
  addSpellEffect(effect, targetID, location, options = {}) {
    if (!effect || !location) return;
    const { blend = true, delay = 0, until = 0, behind = false, key = null } = options;
    this.spellEffects.push({ id: ++this.effectID, effect, targetID, location,
      started: performance.now(), blend, delay, until, behind, key });
    if (this.spellEffects.length > 64) this.spellEffects.shift();
  }
  // An effect ends when its one pass is over, or -- when it repeats -- at its deadline.
  spellEffectLive(effect, now) {
    const elapsed = now - effect.started - effect.delay;
    if (elapsed < 0) return true;
    if (effect.until > 0) return effect.started + effect.delay + (effect.until - effect.started) > now;
    return elapsed < effect.effect[3];
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
    const texture = this.textures.get(key);
    if (texture) texture.lastUsed = this.tick;
    return texture;
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
      sprite.assetScale = assetScale(texture, frame);
      sprite.scale.set(sprite.assetScale);
    } else frame = sprite.assetFrame;
    sprite.x = Math.round(x + (offset ? frame.x : 0));
    sprite.y = Math.round(y + (offset ? frame.y : 0) - (up ? frame.height : 0));
    sprite.zIndex = z;
    sprite.visible = true;
    sprite.seen = this.tick;
    return sprite;
  }
  animationDefinition(library, action) {
    const manifest = this.manifest(library);
    if (!manifest) return null;
    return resolveFrames(manifest.animations, library, action);
  }
  // True when the library itself declares the action, so Struck and Revive are never
  // faked out of the generic default frame table for a library that omits them.
  declaresAction(library, action) {
    const manifest = this.manifest(library);
    return !!manifest && hasDeclaredAction(manifest.animations, library, action);
  }
  actionLength(library, action) {
    const f = this.animationDefinition(library, action);
    return f ? actionLength(f) : 600;
  }
  frameAt(library, action, direction, step, offset = 0) {
    const f = this.animationDefinition(library, action);
    if (!f) return -1;
    return offset + frameIndex(f, direction, step);
  }
  // Which action an actor is in right now, and when that action started. Native reads
  // this off ActionFeed and CurrentAction (MonsterObject.cs:471); the browser keeps
  // one timestamp per action instead of a queue.
  resolveAction(entity, library, position, now) {
    if (entity.kind === "npc")
      return { action: npcIdleAction(entity, this.manifest(library)?.animations, now),
        startedAt: entity.npcIdleStartedAt };
    return liveAction(entity, position, now, {
      length: (action) => this.actionLength(library, action),
      declares: (action) => this.declaresAction(library, action),
    });
  }
  visibilityFrame(entity, library, now) {
    const manifest = this.manifest(library);
    if (!manifest) return -1;
    const f = manifest.animations[entity.visibilityAction];
    if (!f) {
      // Native drops the queued action when the library has no frames for it
      // (MonsterObject.SetAction returns false), leaving the monster as it was.
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
    entity.frameStep = step;
    if (done) this.finishVisibility(entity);
    return frameIndex(f, entity.Direction || 0, step);
  }
  // The end of MirAction.Hide in native (MonsterObject.cs:1423-1461): the burrowers
  // leave the map, the statue family freezes into its Stoned pose, and the rest simply
  // stand back up. Show releases the statues again (MonsterObject.cs:1363-1400).
  finishVisibility(entity) {
    if (entity.visibilityAction === "Hide") {
      if (REMOVED_ON_HIDE.has(entity.Image)) this.entities.delete(entity.ObjectID);
      else if (STONED_ON_HIDE.has(entity.Image)) entity.stoned = true;
    } else if (entity.visibilityAction === "Show" && STONED_ON_HIDE.has(entity.Image))
      entity.stoned = false;
    entity.visibilityAction = null;
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
    if (!ready) { entity.frameStep = 0; entity.dyingAction = "Die"; return start; }
    entity.deathPlaybackAt ??= now;
    const elapsed = now - entity.deathPlaybackAt;
    // Native leaves MirAction.Die for MirAction.Dead once the animation is over
    // (MonsterObject.SetAction), which is what stops the death overlay. Reporting the
    // action, not only the frame, is what keeps a Scarecrow's fire from burning forever.
    if (elapsed >= actionLength(f)) {
      entity.frameStep = 0;
      entity.dyingAction = "Dead";
      return this.frameAt(library, "Dead", entity.Direction || 0, 0, offset);
    }
    entity.frameStep = deathFrame(elapsed, f.count, f.interval);
    entity.dyingAction = "Die";
    return this.frameAt(library, "Die", entity.Direction || 0, entity.frameStep, offset);
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
      // An open door is the same cell with its front image shifted along by DoorOffset.
      const index = mapEffectFrame(object.index, object.animation, now) + this.doors.shift(object.door, now);
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
      const manual = manualDrawOffset(e);
      const px = position.X * 48, py = position.Y * 32;
      const x = px + manual.x, y = py + manual.y;
      const depth = entityDepth(py, e);
      const direction = e.Direction || 0;
      // A transformed player is a different body entirely, with no gender offset of its
      // own (PlayerObject.cs:310-358).
      const transform = transformLayer(e);
      const offset = transform ? transform.offset : e.kind === "player" && e.Gender === 1 ? 808 : 0;
      const library = e.kind === "item" ? "DNItems"
        : e.kind === "npc" ? `NPC/${String(e.Image).padStart(2, "0")}`
        : e.kind === "monster" ? `Monster/${String(e.Image).padStart(3, "0")}`
        : transform ? transform.library
        : `CArmour/${String(Math.max(0, e.Armour || 0)).padStart(2, "0")}`;
      let action = null, index = -1;
      if (e.kind === "item") index = e.Image;
      else if (e.visibilityAction && e.kind === "monster") {
        action = e.visibilityAction;
        index = this.visibilityFrame(e, library, now);
        if (!this.entities.has(e.ObjectID) || index < 0) continue;
      } else if ((e.Harvested || e.Skeleton) && e.kind === "monster") {
        action = this.manifest(library)?.animations.Skeleton ? "Skeleton" : "Dead";
        e.frameStep = 0;
        index = this.frameAt(library, action, direction, 0);
      } else if (e.Dead && e.diedAt != null) {
        index = this.dyingFrame(e, library, offset, now);
        action = e.dyingAction;
      } else if (e.Dead) {
        action = "Dead";
        e.frameStep = 0;
        index = this.frameAt(library, "Dead", direction, 0, offset);
      } else {
        // One frame cursor for every actor: the action decides the frame table, and the
        // phase is measured from that action's own start rather than from a wall clock.
        const resolved = this.resolveAction(e, library, position, now);
        action = e.RidingMount ? (MOUNT_ACTIONS[resolved.action] || resolved.action) : resolved.action;
        if (transform) action = transformAction(action);
        const elapsed = advanceAction(e, resolved, now);
        const f = this.animationDefinition(library, action);
        if (f) {
          const step = animationStep(f, action, elapsed, resolved.duration);
          if (e === u && position.moving && MOVING_ACTIONS.has(action) &&
              (e.from?.X !== e.Location.X || e.from?.Y !== e.Location.Y)) {
            const sound = this.footsteps.sample(e.movedAt, step, e.running);
            if (sound !== null) this.onStep?.(sound);
          }
          e.frameStep = step;
          index = offset + frameIndex(f, direction, step);
        }
      }
      // MonsterObject.Draw picks DrawBlend over Draw when the action's own Blend byte is
      // set (Client/MirObjects/MonsterObject.cs:4306); the gateway now carries that byte.
      const blend = action != null && e.kind !== "item" &&
        !!this.animationDefinition(library, action)?.blend;
      // PlayerObject.Draw calls DrawMount before the body and the weapon
      // (PlayerObject.cs:4884, 5084-5090); the mount's own frames start where the player
      // table's MountStanding does, so the body frame carries straight across.
      if (e.kind === "player" && !transform && e.RidingMount && e.MountType >= 0 && index >= 0) {
        const mount = this.sprite(`entity:mount:${e.ObjectID}`,
          `Mount/${String(e.MountType).padStart(2, "0")}`, index - offset - 416,
          x, y, depth - 0.3, this.objects, true);
        if (mount) mount.tint = poisonTint(e.Poison);
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
        depth,
        this.objects,
        true,
      );
      const body = this.nodes.get(`entity:${e.ObjectID}`);
      if (body && e.kind === "item") {
        body.scale.set(0.6 * (body.assetScale ?? 1));
        body.position.set(Math.round(x + 24 - body.width / 2), Math.round(y + 16 - body.height / 2));
        const key = `item-glint:${e.ObjectID}`;
        let glint = this.nodes.get(key);
        if (!glint) {
          glint = new Graphics();
          this.objects.addChild(glint);
          this.nodes.set(key, glint);
        }
        const star = glintStyle(e.grade, glintPhase(now, e.ObjectID));
        glint.clear();
        if (star.halo)
          glint.circle(0, 0, star.halo).fill({ color: star.colour, alpha: 0.22 });
        glint.rect(-star.arm, -0.5, star.arm * 2, 1).fill(star.colour)
          .rect(-0.5, -star.arm, 1, star.arm * 2).fill(star.colour)
          .rect(-star.arm * 0.5, -1.5, star.arm, 3).fill({ color: star.colour, alpha: 0.5 })
          .rect(-1.5, -star.arm * 0.5, 3, star.arm).fill({ color: star.colour, alpha: 0.5 })
          .circle(0, 0, star.core).fill({ color: 0xffffff, alpha: 0.85 });
        glint.position.set(x + 24, y + 8);
        glint.alpha = star.alpha;
        glint.blendMode = "add";
        glint.zIndex = depth + 0.01;
        glint.seen = this.tick;
      }
      if (body) {
        // The pink flash is kept only where the real Struck animation is not playing:
        // NPCs, and the monster libraries that declare no Struck frames. Where the
        // animation does play it is the hit feedback on its own, and tinting as well
        // would double-signal something native never tints.
        // A poisoned actor is tinted by its poison, which is what DrawColour carries; the
        // pink flash only stands in where nothing else is colouring the body.
        const poison = poisonTint(e.Poison);
        body.tint = poison !== 0xffffff ? poison
          : action !== "Struck" && now < (e.struckUntil || 0) ? 0xffa39a : 0xffffff;
        body.blendMode = blend ? "add" : "normal";
      }
      if (body && !e.Dead && ["monster", "npc"].includes(e.kind) &&
          (e.ObjectID === hoveredID || e.ObjectID === this.selectedID)) {
        const key = `entity:highlight:${e.ObjectID}`;
        this.sprite(key, library, body.assetIndex, x, y, depth + 0.02, this.objects, true);
        const highlight = this.nodes.get(key);
        if (highlight) { highlight.blendMode = "add"; highlight.alpha = 0.3; highlight.tint = body.tint; }
      }
      // MonsterObject.DrawEffects: the additive layer over the body, 275 draw calls over
      // 85 monsters, sharing the body's own frame cursor
      // (Client/MirObjects/MonsterObject.cs:4338-5595).
      if (e.kind === "monster" && action && body) {
        const table = this.animationDefinition(library, action);
        const overlays = monsterOverlays(e, action, e.frameStep || 0, direction, table?.start || 0);
        overlays.forEach((overlay, i) => {
          const sprite = this.sprite(`entity:overlay:${e.ObjectID}:${i}`,
            `Monster/${String(overlay.image).padStart(3, "0")}`, overlay.index,
            x, y, depth + 0.01 + i / 1000, this.objects, true);
          if (!sprite) return;
          sprite.blendMode = overlay.blend ? "add" : "normal";
          sprite.tint = overlay.gray ? 0x808080 : body.tint;
        });
      }
      if (e.kind === "player" && body) {
        // PlayerObject.Draw puts the head straight after the body and before the front
        // weapon pass in all eight directions; the direction test around DrawHead only
        // orders it against the wings, which are not drawn here.
        const hair = hairLayer(e, body.assetIndex);
        if (hair) {
          const key = `entity:hair:${e.ObjectID}:${e.Hair}`;
          this.sprite(key, hair.library, hair.index, x, y, depth + 0.1, this.objects, true);
          const sprite = this.nodes.get(key);
          if (sprite) sprite.tint = body.tint;
        }
        // DrawWings runs off the action's own effect strip, and native draws it blended
        // (PlayerObject.cs:5074-5081).
        const wing = wingLayer(e, this.animationDefinition(library, action), direction, e.frameStep || 0);
        if (wing) {
          const sprite = this.sprite(`entity:wing:${e.ObjectID}:${e.WingEffect}`,
            wing.library, wing.index, x, y, depth + 0.05, this.objects, true);
          if (sprite) { sprite.blendMode = "add"; sprite.tint = body.tint; }
        }
        const weapon = weaponLayer(action === "Harvest" ? { ...e, Weapon: 1, WeaponEffect: 0 } : e, body.assetIndex);
        if (weapon) {
          const key = `entity:weapon:${e.ObjectID}:${e.Weapon}`;
          const z = depth + (weapon.behind ? -0.25 : 0.25);
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
      const standing = this.frameAt(library, "Standing", direction, 0, offset);
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
      // MapObject.DrawPoison: a row of 4x4 dots on a 6x6 black ground, five pixels apart,
      // just above the actor (Client/MirObjects/MapObject.cs:508-568).
      const dots = poisonDots(e.Poison);
      if (dots.length) {
        const key = `poison:${e.ObjectID}`;
        let marks = this.nodes.get(key);
        if (!marks) { marks = new Graphics(); this.objects.addChild(marks); this.nodes.set(key, marks); }
        marks.clear();
        dots.forEach((colour, i) => {
          marks.rect(i * 5, 0, 6, 6).fill(0x000000);
          marks.rect(i * 5 + 1, 1, 4, 4).fill(colour);
        });
        marks.position.set(x + 25 - dots.length * 2.5, actorTop - 10);
        marks.scale.set(1 / scale);
        marks.zIndex = y + 101;
        marks.seen = this.tick;
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
    // Ground spells draw below everything else standing on the same row, and additively
    // where SpellObject sets Blend, at native's 0.8 (SpellObject.cs:328-348).
    for (const [objectID, object] of this.spellObjects) {
      const { definition } = object;
      const index = spellObjectFrame(definition, now - object.started);
      if (index == null) continue;
      const offset = definition.offset || { x: 0, y: 0 };
      const sprite = this.sprite(`entity:spell:${objectID}`, definition.library, index,
        object.Location.X * 48 + offset.x, object.Location.Y * 32 + offset.y,
        object.Location.Y * 32 + 32.05, this.objects, true);
      if (sprite) {
        sprite.blendMode = definition.blend ? "add" : "normal";
        sprite.alpha = definition.blend ? 0.8 : 1;
      }
    }
    this.spellEffects = this.spellEffects.filter((effect) => this.spellEffectLive(effect, now));
    for (const effect of this.spellEffects) {
      const [library, start, count, duration] = effect.effect;
      const elapsed = now - effect.started - effect.delay;
      if (elapsed < 0) continue; // Effect.Draw returns while CMain.Time < Start
      const target = effect.targetID === u.ObjectID ? u : this.entities.get(effect.targetID);
      const point = target ? motionPosition(target, now) : effect.location;
      const step = Math.floor(elapsed / (duration / count));
      const index = start + (effect.until > 0 ? step % count : Math.min(count - 1, step));
      // Effect.Blend defaults to true and Effect.Draw calls DrawBlend
      // (Client/MirObjects/Effect.cs:23, 129-132), so a spell effect is additive. Drawn
      // normally the black background of an effect frame reads as a box over the ground.
      const sprite = this.sprite(`entity:effect:${effect.id}`, library, index, point.X * 48, point.Y * 32,
        point.Y * 32 + (effect.behind ? -1 : 102), this.objects, true);
      if (sprite) sprite.blendMode = effect.blend ? "add" : "normal";
    }
    // Missiles fly from where they were fired to wherever their target is now
    // (Client/MirObjects/Effect.cs:172-215).
    this.missiles = this.missiles.filter((missile) => {
      if (now - missile.started < missile.duration) return true;
      // Missile.Complete: the impact lands on the target, unless it died in flight.
      const target = this.entities.get(missile.targetID);
      if (missile.impact && target && !target.Dead) {
        this.addSpellEffect(missile.impact.effect, missile.targetID, target.Location);
        if (missile.impact.sound) this.onEffectSound?.(missile.impact.sound);
      }
      return false;
    });
    for (const missile of this.missiles) {
      const target = missile.targetID === u.ObjectID ? u : this.entities.get(missile.targetID);
      const destination = target ? motionPosition(target, now) : missile.destination;
      const progress = Math.min(1, (now - missile.started) / missile.duration);
      const x = (missile.source.X + (destination.X - missile.source.X) * progress) * 48;
      const y = (missile.source.Y + (destination.Y - missile.source.Y) * progress) * 32;
      const step = Math.floor((now - missile.started) / missile.interval);
      const index = missile.start + (step % missile.count) +
        missile.direction * (missile.skip + missile.count);
      const sprite = this.sprite(`entity:missile:${missile.id}`, missile.library, index,
        x, y, y + 102, this.objects, true);
      if (sprite) sprite.blendMode = missile.blend ? "add" : "normal";
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
    this.drawLighting([...this.entities.values(), u], u, scale, now);
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
    this.trimTextures();
  }
  /// <summary>The night, and the holes the actors' own lights burn in it.</summary>
  // Native clears a full-screen target to the ambient colour, blends one soft ellipse per
  // lit actor, and multiplies the scene by the result (GameScene.DrawLights). This does
  // the same with a RenderTexture, which is why the sprites inside lightScene can be
  // additive without lighting up the page behind the canvas.
  drawLighting(actors, user, scale, now) {
    const setting = effectiveSetting(this.mapLights ?? LIGHT_SETTING.Day,
      this.worldLights ?? LIGHT_SETTING.Day);
    if (!needsDarkness(setting)) {
      this.lightLayer.visible = false;
      return;
    }
    const width = this.app.screen.width, height = this.app.screen.height;
    if (this.lightTexture?.width !== width || this.lightTexture?.height !== height) {
      this.lightTexture?.destroy(true);
      this.lightTexture = RenderTexture.create({ width, height });
      this.lightLayer.texture = this.lightTexture;
    }
    this.lightDark.clear();
    this.lightDark.rect(0, 0, width, height).fill(darknessColour(setting, this.mapDarkLight));
    let used = 0;
    for (const { entity, size, colour } of lightsFor(actors, user)) {
      const position = motionPosition(entity, now);
      const key = used++;
      let sprite = this.lightNodes?.[key];
      if (!sprite) {
        sprite = new Sprite(lightTexture());
        sprite.anchor.set(0.5);
        sprite.blendMode = "add";
        this.lightScene.addChild(sprite);
        (this.lightNodes ||= [])[key] = sprite;
      }
      // The ellipse is placed in screen space, on the actor's feet rather than its
      // sprite origin, and scales with the world so a torch lights the same number of
      // cells however the window is sized.
      sprite.visible = true;
      sprite.tint = colour;
      sprite.width = size[0] * scale;
      sprite.height = size[1] * scale;
      sprite.position.set(
        this.objects.x + (position.X * 48 + 24) * scale,
        this.objects.y + (position.Y * 32 + 16) * scale,
      );
    }
    for (let i = used; i < (this.lightNodes?.length || 0); i++) this.lightNodes[i].visible = false;
    this.app.renderer.render({ container: this.lightScene, target: this.lightTexture });
    this.lightLayer.visible = true;
  }

  // Runs after the nodes are reaped, so anything still on screen has been stamped
  // this tick and anything holding a texture is pinned.
  trimTextures() {
    const held = new Set();
    for (const node of this.nodes.values()) if (node.texture) held.add(node.texture);
    const entries = [];
    for (const [key, texture] of this.textures)
      if (texture) entries.push({ key, bytes: textureBytes(texture),
        lastUsed: texture.lastUsed || 0, pinned: held.has(texture) });
    for (const key of textureEvictions(entries)) {
      this.textures.get(key)?.destroy(true);
      this.textures.delete(key);
    }
  }
}
