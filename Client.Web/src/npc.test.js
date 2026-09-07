import test from "node:test";
import assert from "node:assert/strict";
import { npcTokens, NPCDialog } from "./npc.js";
import { chatCommand } from "./chat.js";
test("NPC options preserve native script page keys", () => {
  assert.deepEqual(npcTokens("Hello <Buy/@Buy> <Exit/Exit>"), [
    { text: "Hello " }, { text: "Buy", key: "[@Buy]" }, { text: " " }, { text: "Exit", key: "[@Exit]" }]);
  assert.deepEqual(npcTokens("<Name/@@Name>"), [{ text: "Name", key: "[@@Name]" }]);
});
test("NPC large buttons and colored text do not expose raw markup", () => {
  assert.deepEqual(npcTokens("<<Shop/@Buy/Yellow>> {Welcome/Red}"), [
    { text: "Shop", key: "[@Buy]" }, { text: " " }, { text: "Welcome" }]);
  assert.deepEqual(npcTokens("<script>alert(1)</script>"), [{ text: "<script>alert(1)</script>" }]);
});
test("Chat preserves GM command syntax for the authoritative server", () => {
  assert.deepEqual(chatCommand("@INFO gan", true), { Message: "@INFO gan", LinkedItems: [] });
  assert.deepEqual(chatCommand("hello", true), { Message: "hello", LinkedItems: [] });
  assert.equal(chatCommand("  ", true), null);
  assert.throws(() => chatCommand("hello", false));
  assert.throws(() => chatCommand("x".repeat(81), true));
});

test("NPC input submits once, preserves text and clears on close or page change", () => {
  const previous = globalThis.document;
  const nodes = new Map();
  globalThis.document = {
    activeElement: null,
    createElement() { return { textContent: "" }; },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        hidden: true, value: "", textContent: "", children: [],
        replaceChildren() { this.children = []; }, append(node) { this.children.push(node); },
        contains(node) { return node === nodes.get("npc-input-value"); },
        focus() { document.activeElement = this; }, blur() { document.activeElement = null; },
      });
      return nodes.get(id);
    },
  };
  let dialog;
  try {
    const sent = [];
    let connected = true;
    dialog = new NPCDialog((type, data) => {
      if (!connected) return false;
      sent.push({ type, data }); return true;
    });
    const request = { NPCID: 123, PageName: "[@Name]" };
    const submit = () => dialog.inputForm.onsubmit({ preventDefault() {} });
    dialog.requestInput(request);
    assert.equal(document.activeElement, dialog.input);
    assert.equal(dialog.inputForm.hidden, false);
    dialog.input.value = "  example name  ";
    submit(); submit();
    assert.deepEqual(sent, [{ type: "NPCConfirmInput", data: { ...request, Value: "  example name  " } }]);
    assert.equal(dialog.inputForm.hidden, true);
    assert.equal(dialog.input.value, "");
    assert.equal(document.activeElement, null);

    dialog.requestInput(request);
    connected = false;
    dialog.input.value = "retry";
    submit();
    assert.equal(dialog.inputForm.hidden, false);
    assert.equal(dialog.input.value, "retry");
    assert.equal(sent.length, 1);

    dialog.input.onkeydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    submit();
    assert.equal(sent.length, 1);
    assert.equal(dialog.inputRequest, null);
    dialog.requestInput(request);
    dialog.page([]);
    assert.equal(dialog.inputRequest, null);
    assert.equal(dialog.panel.hidden, false);
    assert.equal(nodes.get("npc-page").children[0].textContent, "这个 NPC 暂时没有可用的对话。");
    dialog.close();
    dialog.objectID = 999;
    dialog.page([]);
    assert.equal(dialog.panel.hidden, true);
    assert.equal(nodes.get("npc-page").children.length, 0);
    dialog.requestInput(request);
    let closed = 0;
    dialog.onChange = () => closed++;
    dialog.checkRange({Location:{X:0,Y:0}}, {Location:{X:16,Y:16}});
    assert.equal(dialog.objectID, 123);
    dialog.checkRange({Location:{X:0,Y:0}}, {Location:{X:17,Y:0}});
    assert.equal(dialog.objectID, null);
    assert.equal(dialog.inputRequest, null);
    assert.equal(closed, 1);
    dialog.requestInput(request);
    dialog.remove(999);
    assert.equal(dialog.objectID, 123);
    dialog.remove(123);
    assert.equal(dialog.objectID, null);
    assert.equal(closed, 2);
    dialog.requestInput(request);
    dialog.close();
    assert.equal(dialog.inputForm.hidden, true);
    assert.equal(dialog.inputRequest, null);
  } finally {
    dialog?.close();
    globalThis.document = previous;
  }
});
