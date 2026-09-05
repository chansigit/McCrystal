import test from "node:test";
import assert from "node:assert/strict";
import { SceneIndex } from "./scene-index.js";
test("Tall trees remain visible when their base is below the viewport", () => {
  const index = new SceneIndex();
  const tree = { bounds: { x: 0, y: -200, width: 300, height: 1200 } };
  index.add(tree);
  assert.deepEqual([...index.query({ x: 0, y: 0, width: 400, height: 300 })], [tree]);
});
test("Wide scenery uses image bounds, and spanning chunks never duplicates sprites", () => {
  const index = new SceneIndex();
  const tree = { bounds: { x: -1000, y: 0, width: 2000, height: 1000 } };
  index.add(tree);
  assert.equal(index.query({ x: 0, y: 0, width: 1000, height: 1000 }).size, 1);
  assert.equal(index.query({ x: 1000, y: 0, width: 100, height: 100 }).size, 0);
});
