import {
  createIcons,
  Eye,
  EyeOff,
  LogOut,
  DoorOpen,
  Send,
  X,
  Shirt,
  Backpack,
  MessagesSquare,
  WandSparkles,
  Volume2,
  Map as MapIcon,
  ChevronUp,
  Blend,
} from "lucide";
import { World, directions, directionTo } from "./world.js";
import { movementLength, beginMotion, resetMotion, MOVE_INTERVAL, blockedTurn } from "./movement.js";
import { meleeTarget } from "./combat.js";
import { addInventoryItem } from "./inventory.js";
import { InventoryUI } from "./inventory-ui.js";
import { Skills } from "./skills.js";
import { GameAudio } from "./audio.js";
import { chatCommand } from "./chat.js";
import { NPCDialog } from "./npc.js";
import { Shop } from "./shop.js";
import { actorSound, audible } from "./sound-events.js";
import { Vitals } from "./vitals.js";
import { itemUseSound, itemGainSound } from "./item-sounds.js";
import { INTRO_MUSIC, SELECT_MUSIC, LOGIN_EFFECT, registrationData, playDoor } from "./classic-login.js";
import { goldImage, beginAttackAnimation } from "./entity-presentation.js";

const $ = (id) => document.getElementById(id);
const icons = {
  Eye,
  EyeOff,
  LogOut,
  DoorOpen,
  Send,
  X,
  Shirt,
  Backpack,
  MessagesSquare,
  WandSparkles,
  Volume2,
  Map: MapIcon,
  ChevronUp,
  Blend,
};
createIcons({ icons });
const gameAudio = new GameAudio();
gameAudio.setMusic(INTRO_MUSIC);
const vitals = new Vitals($("vitals-orb"));
const state = {
  socket: null,
  ready: false,
  user: null,
  path: [],
  pending: false,
  nextMove: 0,
  items: new Map(),
  inWorld: false,
  characters: [],
  mapReady: false,
};
// Diagnostic: server packet types with no case in the receive() switch below,
// tracked so each type is only logged once per session instead of once per packet.
const unhandledPackets = new Set();
window.__unhandledPackets = unhandledPackets;
const inventory = new InventoryUI(() => state.user, (index) => state.items.get(index), send);
const npc = new NPCDialog(send);
const shop = new Shop(() => state.user, (index) => state.items.get(index), send);
npc.onChange = () => shop.close();
const world = new World($("game"), (point, entity, running, forced, harvesting) => {
  if (!state.mapReady) return;
  const pointer = world.attackInput.pointer;
  if (harvesting) { harvest(directionTo(state.user.Location, point)); return; }
  if (forced) {
    skills.cancel(); cancelAttack();
    state.path = []; state.destination = null; state.pickupTarget = false;
    world.runPointer = null;
    attack(directionTo(state.user.Location, point));
    return;
  }
  if (!running && skills.aim(point, entity)) return;
  skills.cancel();
  cancelAttack();
  if (!running && point.X === state.user.Location.X && point.Y === state.user.Location.Y) {
    state.pickupTarget = false; send("PickUp"); return;
  }
  if (!running && entity?.kind === "npc") {
    state.path = []; state.destination = null; state.pickupTarget = false;
    npc.open(entity);
    return;
  }
  if (!running && entity?.kind === "monster" && !entity.Dead) {
    state.attackTarget = entity.ObjectID;
    state.path = [];
    state.destination = null;
    state.running = false;
    state.pickupTarget = false;
    state.nextChase = 0;
    return;
  }
  if (!running && entity?.kind !== "item") {
    state.turnPoint = point;
    world.walkPointer = pointer;
    state.path = world.walkPath(point);
    state.destination = state.path.at(-1) || null;
  } else {
    state.path = world.path(point);
    state.destination = point;
  }
  state.running = running;
  // Walking onto loot only positions the player. A second click on the occupied
  // cell performs the native PickUp action.
  state.pickupTarget = false;
});
const skills = new Skills(() => state.user, send, world, () => {
  cancelAttack(); state.path = []; world.runPointer = null;
}, (delay) => { state.nextMove = performance.now() + delay; state.nextAttack = state.nextMove; });
world.onStep = (sound) => gameAudio.play(sound, 80);
world.minimap.send = send;
await world.init();
function send(type, data = {}) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type, data }));
    return true;
  }
  return false;
}
function status(message) {
  $("login-status").textContent = message;
}
function worldStatus(message) {
  $("world-status").textContent = message;
  $("world-status").hidden = !message;
}
function setBusy(busy) {
  state.loginBusy = busy;
  $("login").disabled = busy || !state.ready;
  $("login").textContent = busy ? "登录中…" : "登录";
}
function connect() {
  world.minimap.reset(true);
  state.ready = false;
  setBusy(false);
  $("connection").textContent = "正在连接";
  const socket = new WebSocket(`ws://${location.host}/game`);
  state.socket = socket;
  socket.onmessage = (e) => {
    try {
      const p = JSON.parse(e.data);
      receive(p.type, p.data);
    } catch (error) {
      console.error("Packet handling failed", error);
      worldStatus("客户端状态异常，请重新登录");
    }
  };
  socket.onerror = () => status("无法连接，请检查服务端是否已启动");
  socket.onclose = () => {
    if (state.socket !== socket) return;
    state.ready = false;
    state.path = [];
    state.pending = false;
    setBusy(false);
    $("connection").textContent = "连接已断开";
    status("连接已断开，正在重连…");
    if (state.inWorld) {
      leaveWorld();
    }
    gameAudio.setMusic(INTRO_MUSIC);
    setTimeout(() => {
      if (state.socket === socket) connect();
    }, 2500);
  };
}
function leaveWorld() {
  gameAudio.clearEffects();
  gameAudio.setMusic(null);
  clearTimeout(state.attackModeTimer);
  state.attackMode = null;
  $("attack-mode").disabled = true;
  world.minimap.reset();
  npc.close();
  skills.reset();
  $("skills-panel").hidden = true;
  $("equipment").hidden = true;
  inventory.reset();
  cancelAttack();
  world.runPointer = null;
  state.lastMovedAt = 0;
  state.inWorld = false;
  state.mapReady = false;
  state.user = null;
  world.user = null;
  world.map = null;
  world.mapToken = null;
  world.entities.clear();
  world.clearNodes();
  state.path = [];
  state.pending = false;
  for (const id of ["world-header", "hud", "chat-panel", "inventory", "equipment", "minimap"])
    $(id).hidden = true;
  $("account-screen").hidden = false;
  $("characters").hidden = true;
  $("login-form").hidden = false;
  worldStatus("");
}
function moveObject(object, data) {
  beginMotion(object, data.Location, performance.now());
  object.Direction = data.Direction;
}
function playActorSound(actor, event) {
  const sound = actorSound(actor, event);
  if (sound !== null && audible(actor, state.user)) gameAudio.play(sound);
}
function receive(type, p) {
  switch (type) {
    case "TeleportIn": gameAudio.play(10110); break;
    case "ObjectTeleportIn":
    case "ObjectTeleportOut": {
      const object = p.ObjectID === state.user?.ObjectID ? state.user : world.entities.get(p.ObjectID);
      if (audible(object, state.user) && !p.Type) gameAudio.play(10110);
      break;
    }
    case "PlaySound":
      if (Number.isInteger(p.Sound) && p.Sound > 0 && p.Sound <= 999999) gameAudio.play(p.Sound);
      break;
    case "WorldMapSetupInfo": world.minimap.setWorld(p.Setup); break;
    case "NewMapInfo": world.minimap.receive(p.MapIndex, p.Info); break;
    case "NPCUpdate": npc.objectID = p.NPCID; break;
    case "NPCResponse": if (npc.objectID) npc.page(p.Page); break;
    case "NPCRequestInput": if (npc.objectID === p.NPCID) npc.requestInput(p); break;
    case "NPCGoods":
      if (!npc.objectID) break;
      clearTimeout(npc.timer); $("npc-status").textContent = "";
      shop.open(p); break;
    case "ChangeAMode":
      if (Number.isInteger(p.Mode) && p.Mode >= 0 && p.Mode <= 5) {
        state.attackMode = p.Mode;
        clearTimeout(state.attackModeTimer);
        $("attack-mode").value = String(p.Mode);
        $("attack-mode").disabled = false;
      }
      break;
    case "NPCSell":
      clearTimeout(npc.timer);
      if (!shop.goods) $("npc-status").textContent = "出售窗口暂不可用";
      break;
    case "NPCRepair":
    case "NPCStorage":
      clearTimeout(npc.timer);
      $("npc-status").textContent = "此交易窗口尚未接入网页客户端";
      break;
    case "ClientVersion":
      state.ready = p.Result === 1;
      $("connection").textContent = state.ready
        ? "本地服务端已连接"
        : "客户端版本不匹配";
      status(state.ready ? "" : "客户端版本不匹配");
      setBusy(false);
      break;
    case "Login": {
      const errors = {
        0: "登录暂时关闭",
        1: "账号格式不正确",
        2: "密码格式不正确",
        3: "账号不存在",
        4: "密码不正确",
        5: "账号需要先修改密码",
      };
      status(errors[p.Result] || `登录失败 (${p.Result})`);
      setBusy(false);
      break;
    }
    case "LoginBanned":
      status(`账号被封禁：${p.Reason}`);
      setBusy(false);
      break;
    case "LoginSuccess":
      state.characters = p.Characters;
      gameAudio.play(LOGIN_EFFECT);
      $("account-screen").classList.add("opening");
      playDoor((index) => $("door-frame").src = `/assets/frame?library=ChrSel&index=${index}`, () => {
        $("account-screen").classList.remove("opening"); showCharacters();
      });
      break;
    case "NewAccount": {
      const errors = ["服务器已关闭注册", "账号格式不正确", "密码格式不正确", "邮箱格式不正确",
        "姓名格式不正确", "密保问题格式不正确", "密保答案格式不正确", "账号已经存在"];
      $("register").disabled = false;
      $("register-status").textContent = p.Result === 8 ? "账号创建成功，可以登录" : errors[p.Result] || `注册失败 (${p.Result})`;
      if (p.Result === 8) { $("register-form").hidden = true; $("login-form").hidden = false; }
      break;
    }
    case "StartGame":
      if (p.Result !== 4) {
        status(`进入游戏失败 (${p.Result})`);
        $("character-list")
          .querySelectorAll("button")
          .forEach((b) => (b.disabled = false));
      }
      break;
    case "StartGameDelay":
      status("角色仍在退出中，请稍后重试");
      $("character-list")
        .querySelectorAll("button")
        .forEach((b) => (b.disabled = false));
      break;
    case "StartGameBanned":
      status(`角色被封禁：${p.Reason}`);
      break;
    case "MapChanged":
    case "MapInformation":
      gameAudio.clearEffects();
      gameAudio.setMusic(p.Music);
      if (type === "MapChanged" && state.user) resetMotion(state.user, p.Location, p.Direction);
      world.minimap.setInfo(p);
      npc.close();
      skills.cancel();
      cancelAttack();
      world.runPointer = null;
      state.lastMovedAt = 0;
      state.mapReady = false;
      state.path = [];
      state.pending = false;
      state.destination = null;
      state.pendingTarget = null;
      state.pickupTarget = false;
      state.moveToken = Symbol();
      state.runBlockedUntil = 0;
      state.nextMove = performance.now() + 400;
      $("map-title").textContent = p.Title;
      worldStatus("正在载入地图…");
      world
        .setMap(p.FileName)
        .then((loaded) => {
          if (!loaded) return;
          state.mapReady = true;
          worldStatus("");
        })
        .catch((error) => worldStatus(error.message));
      break;
    case "UserInformation":
      npc.close();
      skills.reset();
      inventory.reset();
      state.user = { ...p, kind: "player", Armour: 0 };
      skills.render();
      state.maxHP = 1;
      state.maxMP = 1;
      world.user = state.user;
      state.inWorld = true;
      $("account-screen").hidden = true;
      for (const id of ["world-header", "hud", "chat-panel", "minimap"])
        $(id).hidden = false;
      $("password").value = "";
      updateHud();
      updateInventory();
      break;
    case "UserLocation":
      if (!state.user) break;
      const old = state.user.Location;
      moveObject(state.user, p);
      if (state.pending && old.X === p.Location.X && old.Y === p.Location.Y) {
        if (state.pendingRun) {
          state.runBlockedUntil = performance.now() + 2500;
          state.path = state.mapReady && state.destination ? world.path(state.destination) : [];
        } else state.path = [];
      } else if (old.X !== p.Location.X || old.Y !== p.Location.Y) {
        state.lastMovedAt = performance.now();
        if (state.mapReady && state.pending && state.destination && state.pendingTarget &&
            (state.pendingTarget.X !== p.Location.X || state.pendingTarget.Y !== p.Location.Y))
          state.path = world.path(state.destination);
      }
      state.pending = false;
      updateHud();
      break;
    case "ObjectPlayer":
    case "ObjectMonster":
    case "ObjectNPC":
    case "ObjectItem":
      world.entities.set(p.ObjectID, {
        ...p,
        kind: {
          ObjectPlayer: "player",
          ObjectMonster: "monster",
          ObjectNPC: "npc",
          ObjectItem: "item",
        }[type],
      });
      world.preloadEntity(world.entities.get(p.ObjectID));
      break;
    case "ObjectGold":
      world.entities.set(p.ObjectID, { ...p, kind: "item", Name: `金币 (${p.Gold})`, Image: goldImage(p.Gold) });
      world.preloadEntity(world.entities.get(p.ObjectID));
      break;
    case "ObjectWalk":
    case "ObjectRun":
    case "ObjectTurn": {
      const o = world.entities.get(p.ObjectID);
      if (o) moveObject(o, p);
      break;
    }
    case "ObjectShow":
    case "ObjectHide": {
      const entity = world.entities.get(p.ObjectID);
      if (entity?.kind === "monster" && entity.Image === 371) {
        if (type === "ObjectShow") playActorSound(entity, "show");
        entity.Hidden = false;
        entity.visibilityAction = type === "ObjectShow" ? "Show" : "Hide";
        entity.visibilityStartedAt = null;
      }
      break;
    }
    case "ObjectHidden": {
      const entity = world.entities.get(p.ObjectID);
      if (entity) entity.Hidden = p.Hidden;
      break;
    }
    case "PlayerUpdate": {
      const player = p.ObjectID === state.user?.ObjectID ? state.user : world.entities.get(p.ObjectID);
      if (player) Object.assign(player, { Weapon: p.Weapon, WeaponEffect: p.WeaponEffect,
        Armour: p.Armour, WingEffect: p.WingEffect, Light: p.Light });
      break;
    }
    case "ObjectRemove":
      npc.remove(p.ObjectID);
      if (state.attackTarget === p.ObjectID) cancelAttack();
      world.entities.delete(p.ObjectID);
      break;
    case "ObjectDied": {
      if (p.ObjectID === state.user?.ObjectID) skills.cancel();
      if (state.attackTarget === p.ObjectID || p.ObjectID === state.user?.ObjectID) cancelAttack();
      const o =
        p.ObjectID === state.user?.ObjectID
          ? state.user
          : world.entities.get(p.ObjectID);
      if (o) {
        if (!o.Dead) {
          playActorSound(o, "die");
          o.diedAt = performance.now();
          o.deathPlaybackAt = null;
        }
        o.Dead = true;
        o.Location = p.Location || o.Location;
      }
      break;
    }
    case "ObjectRevived": {
      const o = world.entities.get(p.ObjectID);
      if (o) { o.Dead = false; o.diedAt = null; o.deathPlaybackAt = null; }
      break;
    }
    case "ObjectAttack": {
      const o = world.entities.get(p.ObjectID);
      if (o) {
        o.Direction = p.Direction;
        if (beginAttackAnimation(o, performance.now())) playActorSound(o, "attack");
      }
      break;
    }
    case "ObjectHarvest": {
      const object = p.ObjectID === state.user?.ObjectID ? state.user : world.entities.get(p.ObjectID);
      if (object) {
        object.Direction = p.Direction; object.Location = p.Location;
        object.harvestStartedAt = performance.now(); object.harvestUntil = object.harvestStartedAt + 600;
      }
      break;
    }
    case "ObjectHarvested": {
      const object = world.entities.get(p.ObjectID);
      if (object) { object.Harvested = true; object.Dead = true; object.Direction = p.Direction; object.Location = p.Location; }
      break;
    }
    case "ObjectStruck": {
      const object = p.ObjectID === state.user?.ObjectID ? state.user : world.entities.get(p.ObjectID);
      if (object) object.struckUntil = performance.now() + 180;
      playActorSound(object, "struck");
      break;
    }
    case "ObjectHealth": {
      const object = world.entities.get(p.ObjectID);
      if (object) { object.healthPercent = Math.max(0, Math.min(100, p.Percent)); object.healthUntil = performance.now() + p.Expire * 1000; }
      break;
    }
    case "DamageIndicator":
      world.addDamage(p);
      break;
    case "NewMagic":
    case "RemoveMagic":
    case "MagicLeveled":
    case "MagicDelay":
    case "MagicCast":
    case "Magic":
      skills.receive(type, p);
      if (type === "Magic" && p.Cast) gameAudio.play(20000 + p.Spell * 10 + 1);
      break;
    case "ObjectMagic": {
      if (p.ObjectID === state.user?.ObjectID && !p.SelfBroadcast) break;
      const caster = p.ObjectID === state.user?.ObjectID ? state.user : world.entities.get(p.ObjectID);
      if (caster && p.Cast) { caster.castStartedAt = performance.now(); caster.castUntil = caster.castStartedAt + 600; }
      if (p.Cast) { world.showCastSpell(p.Spell, caster); world.showSpell(p.Spell, p.TargetID, p.Target); }
      break;
    }
    case "HealthChanged":
      if (state.user) {
        state.user.HP = p.HP;
        state.user.MP = p.MP;
        updateHud();
      }
      break;
    case "NewItemInfo":
      if (p.Info) {
        state.items.set(p.Info.Index, p.Info);
        updateInventory();
        shop.receive(type, p);
      }
      break;
    case "GainedItem":
      if (state.user && p.Item) {
        gainItem(p.Item);
        gameAudio.play(itemGainSound(state.items.get(p.Item.ItemIndex)));
        updateInventory();
      }
      shop.receive(type, p);
      break;
    case "DeleteItem":
    case "MoveItem":
    case "EquipItem":
    case "RemoveItem":
    case "UseItem":
    case "RefreshItem":
    case "DuraChanged":
    case "ItemRepaired": {
      const used = type === "UseItem" ? state.user?.Inventory?.find((item) => item?.UniqueID === p.UniqueID) : null;
      const sound = used ? itemUseSound(p, state.items.get(used.ItemIndex)) : null;
      inventory.receive(type, p);
      if (sound !== null) gameAudio.play(sound);
      break;
    }
    case "GainedGold":
      if (state.user) {
        state.user.Gold += p.Gold;
        if (p.Gold > 0) gameAudio.play(10106);
        updateInventory();
      }
      break;
    case "LoseGold":
      if (state.user) {
        state.user.Gold -= p.Gold;
        updateInventory();
      }
      break;
    case "Chat":
      addMessage(p.Message, p.Type);
      $("chat-status").textContent = "";
      break;
    case "ObjectChat": {
      addMessage(p.Text, p.Type);
      const actor = p.ObjectID === state.user?.ObjectID ? state.user : world.entities.get(p.ObjectID);
      if (actor) { actor.chatText = p.Text; actor.chatUntil = performance.now() + 5000; }
      $("chat-status").textContent = "";
      break;
    }
    case "SendOutputMessage":
      addMessage(p.Message, 2);
      $("chat-status").textContent = "";
      break;
    case "KeepAlive":
      $("latency").textContent =
        `${Math.max(0, Date.now() - Number(p.Time))} ms`;
      break;
    case "LogOutSuccess":
      state.characters = p.Characters || state.characters;
      leaveWorld();
      showCharacters();
      break;
    case "Disconnect":
      status("服务端断开了连接");
      break;
    default:
      if (!unhandledPackets.has(type)) {
        unhandledPackets.add(type);
        console.log(`[unhandled] ${type}`);
      }
      break;
  }
}
function showCharacters() {
  gameAudio.setMusic(SELECT_MUSIC);
  $("register-form").hidden = true;
  $("login-form").hidden = true;
  $("characters").hidden = false;
  $("character-list").replaceChildren();
  for (const character of state.characters) {
    const button = document.createElement("button");
    button.className = "character";
    const text = document.createElement("div"),
      name = document.createElement("strong"),
      detail = document.createElement("small");
    name.textContent = character.Name;
    detail.textContent = `${["战士", "法师", "道士", "刺客", "弓手"][character.Class] || "角色"} · 等级 ${character.Level}`;
    text.append(name, detail);
    button.append(text);
    button.onclick = () => {
      $("character-list")
        .querySelectorAll("button")
        .forEach((b) => (b.disabled = true));
      send("StartGame", { CharacterIndex: character.Index });
    };
    $("character-list").append(button);
  }
  if (!state.characters.length) {
    const empty = document.createElement("p");
    empty.textContent = "该账号暂无角色";
    $("character-list").append(empty);
  }
}
function addMessage(message, type = 0) {
  const line = document.createElement("p");
  line.textContent = message;
  line.dataset.chatType = type;
  $("messages").append(line);
  while ($("messages").children.length > 100) $("messages").firstChild.remove();
  $("messages").scrollTop = $("messages").scrollHeight;
}
function updateHud() {
  const u = state.user;
  if (!u) return;
  $("player-name").textContent = u.Name;
  $("player-level").textContent =
    `${["战士", "法师", "道士", "刺客", "弓手"][u.Class] || ""} · ${u.Level}`;
  $("coordinates").textContent = `${u.Location.X}, ${u.Location.Y}`;
  state.maxHP = Math.max(state.maxHP || 1, u.HP);
  state.maxMP = Math.max(state.maxMP || 1, u.MP);
  vitals.update(u, state.maxHP, state.maxMP);
}
function gainItem(item) {
  addInventoryItem(state.user.Inventory, item, state.items.get(item.ItemIndex));
}
function updateInventory() {
  if (shop.goods) shop.details();
  inventory.render();
}
function cancelAttack() {
  state.turnPoint = null;
  world.walkPointer = null;
  world.attackInput.reset();
  if (state.attackTarget != null) state.path = [];
  state.attackTarget = null;
  state.queuedAttack = false;
}
function queueAttack() {
  skills.cancel();
  state.queuedAttack = true;
  state.path = [];
  world.runPointer = null;
}
function harvest(direction) {
  if (!state.user || !state.mapReady || state.user.Dead || state.user.RidingMount || state.pending || performance.now() < state.nextMove) return;
  skills.cancel();
  state.path = []; state.destination = null; state.pickupTarget = false;
  state.attackTarget = null; state.queuedAttack = false;
  world.walkPointer = null; world.runPointer = null;
  const facing = direction >= 0 ? direction : state.user.Direction;
  if (!send("Harvest", { Direction: facing })) return;
  state.user.Direction = facing;
  state.user.attackUntil = 0; state.user.castUntil = 0;
  state.user.harvestStartedAt = performance.now();
  state.user.harvestUntil = state.user.harvestStartedAt + 600;
  state.nextMove = state.user.harvestStartedAt + MOVE_INTERVAL;
}
function attack(direction = state.user?.Direction) {
  if (
    !state.user ||
    !state.mapReady ||
    state.user.Dead ||
    state.pending || performance.now() < state.nextMove ||
    performance.now() < (state.nextAttack || 0)
  )
    return;
  state.path = [];
  world.runPointer = null;
  const d = direction >= 0 ? direction : state.user.Direction;
  send("Attack", { Direction: d, Spell: 0 });
  gameAudio.play(state.user.Weapon >= 0 ? 10052 : 10056);
  state.user.Direction = d;
  state.user.attackStartedAt = performance.now();
  state.user.attackUntil = performance.now() + 600;
  state.nextAttack = performance.now() + 650;
  state.nextMove = performance.now() + 570;
  state.queuedAttack = false;
}
$("login-form").onsubmit = (e) => {
  e.preventDefault();
  if (!state.ready || state.loginBusy) return;
  setBusy(true);
  status("");
  send("Login", {
    AccountID: $("account").value.trim(),
    Password: $("password").value,
  });
};
$("open-register").onclick = () => { $("login-form").hidden = true; $("register-form").hidden = false; $("register-account").focus(); };
$("cancel-register").onclick = () => { $("register-form").hidden = true; $("login-form").hidden = false; };
$("register-form").onsubmit = (event) => {
  event.preventDefault();
  try {
    const data = registrationData({AccountID:$("register-account").value.trim(), Password:$("register-password").value,
      Confirm:$("register-confirm").value, EMailAddress:$("register-email").value.trim(), UserName:$("register-name").value.trim(),
      BirthDate:$("register-birth").value, SecretQuestion:$("register-question").value.trim(), SecretAnswer:$("register-answer").value.trim()});
    $("register-status").textContent = "正在创建账号…"; $("register").disabled = true;
    if (!send("NewAccount", data)) throw new Error("连接已断开");
  } catch (error) { $("register").disabled = false; $("register-status").textContent = error.message; }
};
$("login-form").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || e.repeat) return;
  if (e.target !== $("account") && e.target !== $("password")) return;
  e.preventDefault();
  if (state.ready && !state.loginBusy) $("login-form").requestSubmit($("login"));
});
$("show-password").onclick = () => {
  const shown = $("password").type === "password";
  $("password").type = shown ? "text" : "password";
  $("show-password").setAttribute(
    "aria-label",
    shown ? "隐藏密码" : "显示密码",
  );
  $("show-password").title = shown ? "隐藏密码" : "显示密码";
  $("show-password").innerHTML =
    `<i data-lucide="${shown ? "eye-off" : "eye"}"></i>`;
  createIcons({ icons });
};
$("back-login").onclick = () => { $("door-frame").src = "/assets/frame?library=ChrSel&index=0"; gameAudio.setMusic(INTRO_MUSIC); state.socket.close(); };
$("logout").onclick = () => {
  cancelAttack();
  state.path = [];
  send("LogOut");
};
$("exit-account").onclick = () => { cancelAttack(); state.path=[]; state.socket.close(); };
$("open-inventory").onclick = () => {
  $("inventory").hidden = !$("inventory").hidden;
};
$("open-equipment").onclick = () => { $("equipment").hidden = !$("equipment").hidden; inventory.render(); };
$("open-skills").onclick = () => {
  $("skills-panel").hidden = !$("skills-panel").hidden;
  skills.render();
};
$("close-skills").onclick = () => { $("skills-panel").hidden = true; };
$("close-inventory").onclick = () => {
  $("inventory").hidden = true;
  if ($("equipment").hidden) inventory.hideDetails();
};
$("close-equipment").onclick = () => {
  $("equipment").hidden = true;
  if ($("inventory").hidden) inventory.hideDetails();
};
$("toggle-chat").onclick = () => {
  $("chat-panel").hidden = !$("chat-panel").hidden;
  if (!$("chat-panel").hidden) $("chat").focus();
};
function requestAttackMode(mode) {
  if (!state.inWorld || $("attack-mode").disabled || !Number.isInteger(mode) || mode < 0 || mode > 5) return;
  $("attack-mode").value = String(state.attackMode ?? 0);
  if (!send("ChangeAMode", { Mode: mode })) return;
  $("attack-mode").disabled = true;
  state.attackModeTimer = setTimeout(() => {
    $("attack-mode").disabled = !state.inWorld;
    addMessage("攻击模式切换未确认，请重试", 0);
  }, 5000);
}
$("attack-mode").onchange = (event) => requestAttackMode(Number(event.target.value));
const nameToggle = $("name-toggle");
nameToggle.setAttribute("aria-pressed", String(world.nameView));
nameToggle.onclick = () => {
  world.nameView = !world.nameView;
  localStorage.setItem("crystal-name-view", String(world.nameView));
  nameToggle.setAttribute("aria-pressed", String(world.nameView));
};
$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    const command = chatCommand($("chat").value, state.inWorld && state.ready && state.socket?.readyState === WebSocket.OPEN);
    if (!command) return;
    if (!send("Chat", command)) throw new Error("连接已断开，消息未发送");
    $("chat").value = "";
    $("chat-status").textContent = "已提交";
  } catch (error) { $("chat-status").textContent = error.message; }
};
$("chat").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) $("chat-form").requestSubmit();
  }
  if (e.key === "Escape") { e.preventDefault(); $("chat").blur(); }
});
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || !state.inWorld)
    return;
  const key = e.key.toLowerCase();
  if (key === "h" && e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (!e.repeat && Number.isInteger(state.attackMode)) requestAttackMode((state.attackMode + 1) % 6);
    return;
  }
  if (["shift", "alt"].includes(key) && !e.repeat) {
    e.preventDefault();
    const pointer = world.attackInput.pointer, held = world.attackInput.held;
    const shift = key === "shift" || world.attackInput.shift, alt = key === "alt" || world.attackInput.alt;
    cancelAttack(); skills.cancel();
    state.path = []; state.destination = null; state.pickupTarget = false;
    world.attackInput.pointer = pointer; world.attackInput.held = held; world.attackInput.shift = shift; world.attackInput.alt = alt;
  }
  if (/^f[1-8]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault(); if (!e.repeat) skills.hotkey(Number(key.slice(1))); return;
  }
  if (
    [
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      "w",
      "a",
      "s",
      "d",
      "shift",
      " ",
    ].includes(key)
  ) {
    e.preventDefault();
    keys.add(key);
  }
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) { cancelAttack(); skills.cancel(); }
  if (key === " ") queueAttack();
  if (key === "i") $("open-inventory").click();
  if (key === "c") $("open-equipment").click();
  if (key === "k") $("open-skills").click();
  if (key === "m" && !e.repeat) world.minimap.toggle();
  if (key === "tab") { e.preventDefault(); if (!e.repeat) $("radar-toggle").click(); }
  if (/^[1-6]$/.test(key) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault(); inventory.activate({ grid: "bag", index: Number(key) - 1 });
  }
  if (key === "enter") {
    e.preventDefault();
    $("chat-panel").hidden = false;
    $("chat").focus();
  }
  if (key === "escape") {
    world.minimap.panel.hidden = true;
    npc.close();
    skills.cancel(); $("skills-panel").hidden = true;
    cancelAttack();
    world.runPointer = null;
    state.path = [];
    $("inventory").hidden = true;
    $("equipment").hidden = true;
    inventory.hideDetails();
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
  if (e.key === "Shift") world.attackInput.shift = false;
  if (e.key === "Alt") world.attackInput.alt = false;
});
window.addEventListener("focusin", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
    skills.cancel();
    cancelAttack();
    keys.clear();
    state.path = [];
    world.runPointer = null;
  }
});
window.addEventListener("blur", () => {
  skills.cancel();
  cancelAttack();
  keys.clear();
  state.path = [];
});
setInterval(() => {
  if (state.ready) send("KeepAlive", { Time: Date.now() });
}, 5000);
setInterval(() => {
  const interlocutor = world.entities.get(npc.objectID);
  world.selectedID = state.attackTarget;
  npc.checkRange(state.user, interlocutor);
  if (
    !state.inWorld ||
    !state.mapReady ||
    state.pending ||
    performance.now() < state.nextMove ||
    state.user.Dead
  )
    return;
  let dx =
      Number(keys.has("d") || keys.has("arrowright")) -
      Number(keys.has("a") || keys.has("arrowleft")),
    dy =
      Number(keys.has("s") || keys.has("arrowdown")) -
      Number(keys.has("w") || keys.has("arrowup"));
  let target;
  let running = state.running;
  if (world.attackInput.harvestTarget) {
    harvest(directionTo(state.user.Location, world.pointerCell(world.attackInput.harvestTarget)));
    return;
  }
  if (world.attackInput.target) {
    const point = world.pointerCell(world.attackInput.target);
    state.path = []; state.destination = null; state.pickupTarget = false;
    state.attackTarget = null; state.queuedAttack = false; world.runPointer = null;
    skills.cancel();
    attack(directionTo(state.user.Location, point));
    return;
  }
  if (skills.process()) return;
  if (state.attackTarget != null) {
    const enemy = world.entities.get(state.attackTarget);
    const intent = meleeTarget(state.user, enemy);
    if (intent === "cancel") { cancelAttack(); return; }
    if (intent === "attack") {
      state.path = [];
      attack(directionTo(state.user.Location, enemy.Location));
      return;
    }
    const changed = state.chaseLocation?.X !== enemy.Location.X || state.chaseLocation?.Y !== enemy.Location.Y;
    if ((changed || !state.path.length) && performance.now() >= (state.nextChase || 0)) {
      state.path = world.pathToMelee(enemy.Location);
      state.destination = state.path.at(-1);
      state.chaseLocation = { ...enemy.Location };
      state.nextChase = performance.now() + 500;
    }
    running = false;
  } else if (state.queuedAttack) {
    attack();
    return;
  }
  if (dx || dy) {
    world.runPointer = null;
    state.path = [];
    state.destination = null;
    target = { X: state.user.Location.X + dx, Y: state.user.Location.Y + dy };
    state.turnPoint = target;
    running = false;
    const distance = state.user.RidingMount || (state.user.Sprint && !state.user.Sneaking) ? 3 : 2;
    state.path = world.straightPath(directionTo(state.user.Location, target), distance);
    target = state.path[0];
  } else {
    if (world.runPointer) {
      state.destination = world.pointerCell(world.runPointer);
      state.turnPoint = state.destination;
      const distance = state.user.RidingMount || (state.user.Sprint && !state.user.Sneaking) ? 3 : 2;
      const remaining = Math.max(Math.abs(state.destination.X - state.user.Location.X),
        Math.abs(state.destination.Y - state.user.Location.Y));
      state.path = world.straightPath(directionTo(state.user.Location, state.destination), Math.min(distance, remaining));
      running = true;
    } else if (world.walkPointer) {
      const point = world.pointerCell(world.walkPointer);
      state.turnPoint = point;
      state.path = world.walkPath(point);
      state.destination = state.path.at(-1) || null;
      running = false;
    }
    target = state.path[0];
  }
  if (!target) {
    const turn = state.turnPoint && blockedTurn(directionTo(state.user.Location, state.turnPoint),
      state.user.Direction, state.path);
    state.turnPoint = null;
    if (turn != null && !state.attackTarget && !state.pickupTarget && send("Turn", { Direction: turn })) {
      state.user.Direction = turn;
      state.nextMove = performance.now() + MOVE_INTERVAL;
    }
    if (state.pickupTarget) {
      send("PickUp");
      state.pickupTarget = false;
    }
    return;
  }
  const direction = directionTo(state.user.Location, target);
  state.turnPoint = null;
  if (direction < 0) return;
  const now = performance.now();
  const canRun = running && state.lastMovedAt > 0 && now - state.lastMovedAt < 1000 &&
    now >= (state.runBlockedUntil || 0) && state.user.HP >= 10;
  const steps = movementLength(state.user.Location, state.path, canRun,
    state.user.RidingMount || (state.user.Sprint && !state.user.Sneaking) ? 3 : 2);
  state.pendingTarget = state.path[steps - 1];
  state.path.splice(0, steps);
  if (dx || dy) state.path = [];
  state.pendingRun = steps > 1;
  send(state.pendingRun ? "Run" : "Walk", { Direction: direction });
  state.pending = true;
  const moveToken = Symbol();
  state.moveToken = moveToken;
  state.nextMove = performance.now() + MOVE_INTERVAL;
  setTimeout(() => {
    if (state.moveToken === moveToken) state.pending = false;
  }, 1500);
}, 16);
connect();
