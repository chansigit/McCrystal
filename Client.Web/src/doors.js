// Doors are per index, not per cell. Map.AddDoor masks the map byte with 0x7F and returns
// the door it already has for that index, so every cell carrying index 3 is one door and
// they all swing together -- which is also why the server's S.Opendoor names only an index.
//
// Two timers, deliberately different. Map.Process closes a door 5000ms after it opened;
// GameScene.CheckDoorOpen asks again after 4000ms, so the client renews the door before the
// server drops it and the player never walks into one that has just shut.
export const DOOR_HOLD_MS = 5000;     // Map.Process
export const DOOR_RENEW_MS = 4000;    // GameScene._doorTime

/// <summary>The door cells of one map, keyed the way the cell array is.</summary>
export function doorCells(list, width) {
  const cells = new Map();
  for (const entry of list || []) {
    const [x, y, index, offset] = entry;
    if (!(index > 0)) continue;
    cells.set(y * width + x, { x, y, index, offset: offset || 0 });
  }
  return cells;
}

export class Doors {
  constructor(send) { this.send = send; this.reset(); }
  reset() { this.cells = new Map(); this.opened = new Map(); this.width = 0; this.nextRequest = 0; }
  load(list, width) {
    this.cells = doorCells(list, width);
    this.opened = new Map();
    this.width = width;
    this.nextRequest = 0;
  }
  at(x, y) { return this.cells.get(y * this.width + x) || null; }
  isOpen(index, now) {
    const since = this.opened.get(index);
    return since != null && now - since < DOOR_HOLD_MS;
  }
  // S.Opendoor carries the index and whether this is the close. The server sends the open to
  // the player who asked *and* broadcasts it, so the same packet can arrive twice; taking the
  // latest tick is what native does too (it just overwrites LastTick).
  receive(p, now = performance.now()) {
    const index = Number(p?.DoorIndex);
    if (!(index > 0)) return false;
    if (p.Close) this.opened.delete(index);
    else this.opened.set(index, now);
    return true;
  }
  /// <summary>Native's CheckDoorOpen: may the player step onto this cell, and ask if not.</summary>
  // A closed door refuses the step and sends one request, throttled so a player held against
  // a door does not spam the server. An open one is passable, and is asked again once it is
  // within a second of the server's own 5000ms timeout.
  check(x, y, now = performance.now()) {
    const door = this.at(x, y);
    if (!door) return true;
    const open = this.isOpen(door.index, now);
    if (open && now - this.opened.get(door.index) < DOOR_RENEW_MS) return true;
    if (now >= this.nextRequest) {
      this.nextRequest = now + DOOR_RENEW_MS;
      this.send?.("Opendoor", { DoorIndex: door.index });
    }
    return open;
  }
  /// <summary>How far an open door shifts its cell's front-layer image.</summary>
  // GameScene: `index += (DoorInfo.ImageIndex + 1) * cell.DoorOffset`. ImageIndex exists for
  // an animation nothing in Crystal ever advances, so it is always 0 and the shift is exactly
  // one DoorOffset.
  shift(door, now = performance.now()) {
    return door && this.isOpen(door.index, now) ? door.offset : 0;
  }
}
