import test from "node:test";
import assert from "node:assert/strict";
import { ExperienceBar, MAXED, experienceDetail, experiencePercent, experienceRatio } from "./experience.js";

const stub = () => {
  const bar = { title: "", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const fill = { style: {} };
  const label = { textContent: "" };
  return { bar, fill, label, view: new ExperienceBar(bar, fill, label) };
};

test("The percentage matches the native {0:#0.##%} format", () => {
  assert.equal(experiencePercent(1, 2), "50%");
  assert.equal(experiencePercent(0, 100), "0%");
  assert.equal(experiencePercent(100, 100), "100%");
  // Two decimals at most, trailing zeros dropped, never scientific notation.
  assert.equal(experiencePercent(1, 3), "33.33%");
  assert.equal(experiencePercent(2, 3), "66.67%");
  assert.equal(experiencePercent(1, 1000), "0.1%");
  assert.equal(experiencePercent(1, 100000), "0%");
  assert.equal(experiencePercent(123456789, 987654321), "12.5%");
});

test("A zero MaxExperience never divides and reads as max level", () => {
  assert.equal(experiencePercent(0, 0), MAXED);
  assert.equal(experiencePercent(4000000000, 0), MAXED);
  assert.equal(experiencePercent(1, -5), MAXED);
  assert.equal(experiencePercent(1, null), MAXED);
  // A character past the end of the curve is complete, not empty: the native bar clamps its
  // own division by zero to a full fill.
  assert.equal(experienceRatio(0, 0), 1);
  assert.equal(experienceRatio(10, 0), 1);
  assert.match(experienceDetail(1234, 0), /1,234/);
  assert.doesNotMatch(experienceDetail(1234, 0), /\//);
});

test("The ratio clamps to the drawable 0..1 range", () => {
  assert.equal(experienceRatio(50, 100), 0.5);
  assert.equal(experienceRatio(200, 100), 1);
  assert.equal(experienceRatio(-5, 100), 0);
  assert.equal(experienceRatio(0, 100), 0);
});

test("GainExperience deltas accumulate onto the total", () => {
  const { view, label } = stub();
  view.set(100, 1000);
  assert.equal(label.textContent, "10%");
  view.gain(150);
  assert.equal(view.experience, 250);
  assert.equal(label.textContent, "25%");
  view.gain(150);
  assert.equal(view.experience, 400);
  assert.equal(label.textContent, "40%");
  // Nothing the server never sends may move the total.
  view.gain(0);
  view.gain(-10);
  view.gain(undefined);
  assert.equal(view.experience, 400);
  // A level up replaces the pair rather than adding to it.
  view.set(20, 2000);
  assert.equal(view.experience, 20);
  assert.equal(label.textContent, "1%");
});

test("The rendered bar carries the fill, the label and the raw numbers", () => {
  const { view, bar, fill, label } = stub();
  view.set(250, 1000);
  assert.equal(fill.style.width, "25.000%");
  assert.equal(label.textContent, "25%");
  assert.match(bar.title, /250 \/ 1,000/);
  assert.equal(bar.attributes["aria-valuenow"], "25");
  view.set(5, 0);
  assert.equal(fill.style.width, "100.000%");
  assert.equal(label.textContent, MAXED);
  view.reset();
  assert.equal(view.experience, 0);
  assert.equal(view.maximum, 0);
});
