import test from "node:test";
import assert from "node:assert/strict";
import { CharacterScreen, CLASS_NAMES, GENDER_NAMES, characterNameError } from "./characters.js";

function withDocument(run) {
  const previous = globalThis.document;
  const nodes = new Map();
  const element = () => ({
    hidden: true, textContent: "", value: "", title: "", disabled: false, children: [],
    replaceChildren(...items) { this.children = items; },
  });
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement() { return element(); },
  };
  try { return run(nodes); }
  finally { globalThis.document = previous; }
}

function screen(send = () => true) {
  const sent = [];
  const view = new CharacterScreen((type, data) => { sent.push({ type, data }); return send(type, data); });
  return { view, sent };
}

test("Create form offers every native gender and class", () => {
  withDocument((nodes) => {
    screen();
    assert.deepEqual(nodes.get("create-gender").children.map((o) => o.textContent), GENDER_NAMES);
    assert.deepEqual(nodes.get("create-gender").children.map((o) => o.value), ["0", "1"]);
    assert.deepEqual(nodes.get("create-class").children.map((o) => o.textContent), CLASS_NAMES);
    // MirClass values 0-4; the server rejects anything else with result 3.
    assert.deepEqual(nodes.get("create-class").children.map((o) => o.value), ["0", "1", "2", "3", "4"]);
  });
});

test("Create form validates the name before spending a round trip", () => {
  withDocument((nodes) => {
    const { view, sent } = screen();
    view.openCreate();
    assert.equal(nodes.get("create-form").hidden, false);

    for (const bad of ["", "  ", "ab", "0123456789abcdef", "bad name", "bad-name"]) {
      nodes.get("create-name").value = bad;
      assert.equal(view.submitCreate(), false, bad);
      assert.notEqual(nodes.get("create-status").textContent, "");
    }
    assert.deepEqual(sent, []);

    nodes.get("create-name").value = " webtest1 ";
    nodes.get("create-gender").value = "1";
    nodes.get("create-class").value = "2";
    assert.equal(view.submitCreate(), true);
    assert.deepEqual(sent, [{ type: "NewCharacter", data: { Name: "webtest1", Gender: 1, Class: 2 } }]);
    assert.equal(nodes.get("create-submit").disabled, true);

    // A server refusal must hand the button back so the name can be corrected.
    view.createFailed(5);
    assert.equal(nodes.get("create-submit").disabled, false);
    assert.equal(nodes.get("create-status").textContent, "已存在同名角色。");
    view.createFailed(99);
    assert.equal(nodes.get("create-status").textContent, "创建角色失败 (99)");
  });
});

test("Create form reports a lost connection instead of pretending it sent", () => {
  withDocument((nodes) => {
    const { view } = screen(() => false);
    view.openCreate();
    nodes.get("create-name").value = "webtest1";
    assert.equal(view.submitCreate(), false);
    assert.equal(nodes.get("create-status").textContent, "连接已断开");
    assert.equal(nodes.get("create-submit").disabled, false);
  });
});

test("Chinese, latin, digits and underscore are all acceptable names", () => {
  assert.equal(characterNameError("战士甲"), null);
  assert.equal(characterNameError("web_test1"), null);
  assert.notEqual(characterNameError("战"), null);
});

test("Deletion only sends when the exact character name is typed", () => {
  withDocument((nodes) => {
    const { view, sent } = screen();
    // Nothing selected: the gate must not fabricate a target.
    assert.equal(view.submitDelete(), false);

    view.openDelete({ Index: 7, Name: "webtest1" });
    assert.equal(nodes.get("delete-form").hidden, false);
    assert.equal(nodes.get("create-form").hidden, true);

    for (const wrong of ["", "webtest", "WEBTEST1", "webtest11", "kzs"]) {
      nodes.get("delete-name").value = wrong;
      assert.equal(view.submitDelete(), false, wrong);
      assert.equal(nodes.get("delete-status").textContent, "输入有误。");
    }
    assert.deepEqual(sent, []);

    nodes.get("delete-name").value = "webtest1";
    assert.equal(view.submitDelete(), true);
    assert.deepEqual(sent, [{ type: "DeleteCharacter", data: { CharacterIndex: 7 } }]);
    assert.equal(nodes.get("delete-confirm").disabled, true);

    view.deleteFailed(0);
    assert.equal(nodes.get("delete-confirm").disabled, false);
    assert.equal(nodes.get("delete-status").textContent, "当前禁止删除角色。");
  });
});

test("Re-rendering the list drops any stale delete target", () => {
  withDocument((nodes) => {
    const { view, sent } = screen();
    view.openDelete({ Index: 7, Name: "webtest1" });
    view.reset(1);
    assert.equal(nodes.get("delete-form").hidden, true);
    assert.equal(nodes.get("create-form").hidden, true);
    nodes.get("delete-name").value = "webtest1";
    assert.equal(view.submitDelete(), false);
    assert.deepEqual(sent, []);
    // Globals.MaxCharacterCount is 4; a full account cannot open the form at all.
    assert.equal(nodes.get("open-create").disabled, false);
    view.reset(4);
    assert.equal(nodes.get("open-create").disabled, true);
  });
});
