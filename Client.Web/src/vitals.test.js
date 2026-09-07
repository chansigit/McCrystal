import test from "node:test";
import assert from "node:assert/strict";
import { liquidHeight, liquidSections, vitalLabels } from "./vitals.js";
test("Native liquid uses a clamped 80 pixel bottom-up fill", () => {
  assert.equal(liquidHeight(50, 100), 40);
  assert.equal(liquidHeight(0, 100), 0);
  assert.equal(liquidHeight(120, 100), 80);
  assert.equal(liquidHeight(-10, 100), 0);
  assert.equal(liquidHeight(1, 0), 0);
});
test("HP and MP halves clip independently at native source positions", () => {
  assert.deepEqual(liquidSections({ Class: 1, Level: 10, HP: 25, MP: 75 }, 100, 100), [
    { index: 4, x: 0, y: 60, width: 50, height: 20 }, { index: 4, x: 51, y: 20, width: 50, height: 60 }]);
});
test("Warriors remain single-chamber through level 27 and switch at 28", () => {
  for (const Level of [1, 25, 26, 27]) {
    const user = { Class: 0, Level, HP: 50, MP: 10 };
    assert.deepEqual(liquidSections(user, 100, 100), [{ index: 6, x: 0, y: 40, width: 100, height: 40 }]);
    assert.deepEqual(vitalLabels(user), [["HP", 50, 72]]);
  }
  for (const Level of [28, 29]) {
    const user = { Class: 0, Level, HP: 100, MP: 100 };
    assert.equal(liquidSections(user, 100, 100).length, 2);
    assert.equal(vitalLabels(user)[1][0], "MP");
  }
});
test("Other classes retain both chambers below level 28", () => {
  for (const Class of [1, 2, 3, 4]) {
    const user = { Class, Level: 1, HP: 10, MP: 10 };
    assert.equal(liquidSections(user, 10, 10).length, 2);
    assert.equal(vitalLabels(user).length, 2);
  }
});
