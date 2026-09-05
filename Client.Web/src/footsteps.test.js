import test from "node:test";
import assert from "node:assert/strict";
import { Footsteps, locomotionFrame, footstepFrame } from "./footsteps.js";
test("Walking lands left/right on frames 1 and 4, once each", () => {
  const steps = new Footsteps();
  assert.equal(steps.sample(1, 0, false), null);
  assert.equal(steps.sample(1, 1, false), 10001);
  assert.equal(steps.sample(1, 1, false), null);
  assert.equal(steps.sample(1, 4, false), 10002);
  assert.equal(steps.sample(2, 1, false), 10001);
});
test("Running retains its faster audio cadence independently of visual frames", () => {
  const hits = (running) => {
    const steps = new Footsteps(), result = [];
    for (let time = 0; time < 646; time++) {
      const { frame, cycle } = footstepFrame(time / 646, 6, running);
      const sound = steps.sample(1, frame, running, cycle);
      if (sound !== null) result.push({ time, sound });
    }
    return result;
  };
  const walk = hits(false), run = hits(true);
  assert.deepEqual(walk.map((e) => e.sound), [10001, 10002]);
  assert.deepEqual(run.map((e) => e.sound), [10003, 10004, 10003, 10004]);
  assert.ok(run[1].time - run[0].time < walk[1].time - walk[0].time);
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
  assert.equal(steps.sample(1, 5, true, 1), null);
});
