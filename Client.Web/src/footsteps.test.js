import test from "node:test";
import assert from "node:assert/strict";
import { Footsteps, locomotionFrame } from "./footsteps.js";
test("Walking lands left/right on frames 1 and 4, once each", () => {
  const steps = new Footsteps();
  assert.equal(steps.sample(1, 0, false), null);
  assert.equal(steps.sample(1, 1, false), 10001);
  assert.equal(steps.sample(1, 1, false), null);
  assert.equal(steps.sample(1, 4, false), 10002);
  assert.equal(steps.sample(2, 1, false), 10001);
});
test("Running sounds follow the two native landing frames without an extra audio cycle", () => {
  const hits = (running) => {
    const steps = new Footsteps(), result = [];
    for (let time = 0; time < 646; time++) {
      const frame = locomotionFrame(time / 646, 6);
      const sound = steps.sample(1, frame, running);
      if (sound !== null) result.push({ time, sound });
    }
    return result;
  };
  const walk = hits(false), run = hits(true);
  assert.deepEqual(walk.map((e) => e.sound), [10001, 10002]);
  assert.deepEqual(run.map((e) => e.sound), [10003, 10004]);
  assert.deepEqual(run.map((e) => e.time), [108, 431]);
  assert.deepEqual(run.map((e) => e.time), walk.map((e) => e.time));
});
test("Movement visuals traverse one complete cycle without restarting halfway", () => {
  const frames = [];
  for (let time = 0; time <= 646; time++) {
    const frame = locomotionFrame(time / 646, 6);
    if (frames.at(-1) !== frame) frames.push(frame);
  }
  assert.deepEqual(frames, [0, 1, 2, 3, 4, 5]);
  assert.equal(locomotionFrame(-1, 6), 0);
  assert.equal(locomotionFrame(2, 6), 5);
});
test("Skipped animation frames do not burst-play missed footsteps", () => {
  const steps = new Footsteps();
  assert.equal(steps.sample(1, 0, true), null);
  assert.equal(steps.sample(1, 5, true), null);
});
