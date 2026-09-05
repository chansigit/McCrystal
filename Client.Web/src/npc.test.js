import test from "node:test";
import assert from "node:assert/strict";
import { npcTokens } from "./npc.js";
import { chatCommand } from "./chat.js";
test("NPC options preserve native script page keys", () => {
  assert.deepEqual(npcTokens("Hello <Buy/@Buy> <Exit/Exit>"), [
    { text: "Hello " }, { text: "Buy", key: "[@Buy]" }, { text: " " }, { text: "Exit", key: "[@Exit]" }]);
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
  assert.throws(() => chatCommand("x".repeat(201), true));
});
