import test from "node:test";
import assert from "node:assert/strict";
import { weightRatio, weightFrame, fillPercent, remaining, WEIGHT_FRAMES } from "./weight.js";

test("the ratio clamps the way WeightBar_BeforeDraw does", () => {
  assert.equal(weightRatio(50, 100), 0.5);
  assert.equal(weightRatio(150, 100), 1); // percent > 1 clamps to 1
  assert.equal(weightRatio(0, 100), 0); // percent <= 0 draws nothing
  assert.equal(weightRatio(-5, 100), 0);
  assert.equal(weightRatio(10, 0), 0); // a capacity of zero would divide by zero natively
});

test("the art changes at native's two thresholds", () => {
  assert.equal(weightFrame(0.5), WEIGHT_FRAMES.normal); // <= 0.50
  assert.equal(weightFrame(0.5001), WEIGHT_FRAMES.heavy);
  assert.equal(weightFrame(0.75), WEIGHT_FRAMES.heavy); // <= 0.75
  assert.equal(weightFrame(0.7501), WEIGHT_FRAMES.full);
  assert.equal(weightFrame(1), WEIGHT_FRAMES.full);
});

test("a full bar stops two pixels short, as the clipped section does", () => {
  assert.equal(fillPercent(0), 0);
  assert.equal(Number(fillPercent(1).toFixed(3)), 97.368); // (76 - 2) / 76
  assert.equal(Number(fillPercent(0.5).toFixed(3)), 48.684);
});

test("the label counts down the capacity that is left", () => {
  assert.equal(remaining(30, 100), 70);
  assert.equal(remaining(120, 100), -20); // native prints the negative too
  assert.equal(remaining(0, 0), 0);
});
