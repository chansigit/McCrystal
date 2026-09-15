import test from "node:test";
import assert from "node:assert/strict";
import { describe } from "./inspect.js";

test("the line under the name says class, level, guild and spouse", () => {
  // S.PlayerInspect carries all four; 1.76 shows the guild rank in brackets after the name.
  assert.equal(describe({ Class: 0, Gender: 0, Level: 42 }), "战士·男 · 42 级");
  assert.equal(describe({ Class: 2, Gender: 1, Level: 7, GuildName: "沙巴克", GuildRank: "掌门" }),
    "道士·女 · 7 级 · 沙巴克（掌门）");
  assert.equal(describe({ Class: 1, Gender: 0, Level: 30, LoverName: "阿花" }), "法师·男 · 30 级 · 配偶 阿花");
});

test("a packet with nothing in it still renders a line rather than throwing", () => {
  assert.equal(describe({}), "？·？ · ? 级");
  assert.equal(describe(null), "？·？ · ? 级");
  // Warrior is class 0 and male is gender 0, so a falsy value here is a real answer and
  // must not be mistaken for a missing one.
  assert.equal(describe({ Class: 0, Gender: 0 }), "战士·男 · ? 级");
});
