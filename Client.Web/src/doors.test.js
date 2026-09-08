import test from "node:test";
import assert from "node:assert/strict";
import { Doors, doorCells, DOOR_HOLD_MS, DOOR_RENEW_MS } from "./doors.js";

const sent = [];
const make = () => { sent.length = 0; return new Doors((type, data) => sent.push([type, data])); };

test("door cells are keyed like the cell array, and index zero is not a door", () => {
  const cells = doorCells([[3, 2, 7, 4], [4, 2, 7, 4], [0, 0, 0, 9]], 10);
  assert.equal(cells.size, 2);
  assert.deepEqual(cells.get(2 * 10 + 3), { x: 3, y: 2, index: 7, offset: 4 });
  assert.equal(doorCells(null, 10).size, 0);
});

test("a cell with no door is always passable and asks nothing", () => {
  const doors = make();
  doors.load([[3, 2, 7, 4]], 10);
  assert.equal(doors.check(9, 9, 1000), true);
  assert.deepEqual(sent, []);
});

test("a closed door refuses the step, asks once, and opens on the answer", () => {
  const doors = make();
  doors.load([[3, 2, 7, 4], [4, 2, 7, 4]], 10);
  assert.equal(doors.check(3, 2, 1000), false, "closed");
  assert.deepEqual(sent, [["Opendoor", { DoorIndex: 7 }]]);
  // Held against the door, the request is throttled rather than repeated every frame.
  assert.equal(doors.check(3, 2, 1100), false);
  assert.equal(sent.length, 1);
  doors.receive({ DoorIndex: 7, Close: false }, 1200);
  assert.equal(doors.check(3, 2, 1300), true);
  // One door, many cells: Map.AddDoor returns the same door for every cell of that index.
  assert.equal(doors.check(4, 2, 1300), true);
});

test("the door lapses on the server's timer, and is renewed before it does", () => {
  const doors = make();
  doors.load([[3, 2, 7, 4]], 10);
  doors.receive({ DoorIndex: 7 }, 0);
  assert.equal(doors.isOpen(7, DOOR_HOLD_MS - 1), true);
  assert.equal(doors.isOpen(7, DOOR_HOLD_MS), false, "Map.Process closes it after 5000ms");
  // Between the renewal point and the timeout the door is still passable, and one more
  // request goes out so the server does not drop it under the player.
  sent.length = 0;
  assert.equal(doors.check(3, 2, DOOR_RENEW_MS + 1), true);
  assert.deepEqual(sent, [["Opendoor", { DoorIndex: 7 }]]);
});

test("a close packet shuts the door, and a nameless one changes nothing", () => {
  const doors = make();
  doors.load([[3, 2, 7, 4]], 10);
  doors.receive({ DoorIndex: 7 }, 0);
  assert.equal(doors.receive({ DoorIndex: 7, Close: true }, 100), true);
  assert.equal(doors.isOpen(7, 200), false);
  assert.equal(doors.receive({ DoorIndex: 0 }, 200), false);
  assert.equal(doors.receive(null, 200), false);
});

test("an open door shifts its cell's front image by exactly one DoorOffset", () => {
  // GameScene: index += (ImageIndex + 1) * DoorOffset, and ImageIndex is always 0 because
  // nothing in Crystal advances the door animation.
  const doors = make();
  doors.load([[3, 2, 7, 4]], 10);
  const door = doors.at(3, 2);
  assert.equal(doors.shift(door, 0), 0);
  doors.receive({ DoorIndex: 7 }, 0);
  assert.equal(doors.shift(door, 10), 4);
  assert.equal(doors.shift(null, 10), 0);
});

test("loading a map forgets the previous map's doors", () => {
  const doors = make();
  doors.load([[3, 2, 7, 4]], 10);
  doors.receive({ DoorIndex: 7 }, 0);
  doors.load([[1, 1, 2, 3]], 10);
  assert.equal(doors.at(3, 2), null);
  assert.equal(doors.isOpen(7, 10), false);
});
