import test from "node:test";
import assert from "node:assert/strict";
import { ReviveOverlay } from "./revive.js";

function withDocument(run) {
  const previous = globalThis.document;
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: "" });
      return nodes.get(id);
    },
  };
  try { return run(nodes); }
  finally { globalThis.document = previous; }
}

test("Revive overlay follows the local player's death state", () => {
  withDocument((nodes) => {
    const sent = [];
    const overlay = new ReviveOverlay((type, data) => { sent.push({ type, data }); return true; });
    const panel = nodes.get("revive-panel");

    overlay.update(null);
    assert.equal(panel.hidden, true);
    overlay.update({ Dead: false });
    assert.equal(panel.hidden, true);

    overlay.update({ Dead: true });
    assert.equal(panel.hidden, false);

    overlay.button.onclick();
    assert.deepEqual(sent, [{ type: "TownRevive", data: {} }]);
    assert.equal(nodes.get("revive-status").textContent, "正在回城复活…");

    overlay.update({ Dead: false });
    assert.equal(panel.hidden, true);
    assert.equal(nodes.get("revive-status").textContent, "");

    overlay.update(null);
    assert.equal(panel.hidden, true);
  });
});

test("Revive overlay reports a lost connection instead of pretending it sent", () => {
  withDocument((nodes) => {
    const overlay = new ReviveOverlay(() => false);
    overlay.update({ Dead: true });
    overlay.button.onclick();
    assert.equal(nodes.get("revive-status").textContent, "连接已断开");
    assert.equal(nodes.get("revive-panel").hidden, false);
  });
});
