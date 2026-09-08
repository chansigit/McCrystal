import test from "node:test";
import assert from "node:assert/strict";
import { registrationData, playDoor, preloadDoor, DOOR_FRAMES } from "./classic-login.js";

test("registration validates confirmation and emits native DateTime JSON", () => {
  const data = registrationData({AccountID:"newid",Password:"secret",Confirm:"secret",
    BirthDate:"2000-01-02",UserName:"Name",SecretQuestion:"Q",SecretAnswer:"A",EMailAddress:"a@b.co"});
  assert.equal(data.BirthDate, "2000-01-02T00:00:00");
  assert.throws(() => registrationData({...data, Confirm:"wrong"}));
});

test("classic door plays all nineteen native frames once", async () => {
  const frames = [];
  await new Promise(resolve => playDoor(frame => frames.push(frame), resolve, 1));
  assert.deepEqual(frames, Array.from({length:19},(_,i)=>i));
});

test("the gate frames are all requested before anyone logs in", () => {
  // One request per frame at 100 ms a frame is why the animation only plays when the
  // frames are already cached; the preload is what makes that always true.
  const created = [];
  const frames = preloadDoor((index) => `/f/${index}`, DOOR_FRAMES, () => {
    const image = {}; created.push(image); return image;
  });
  assert.equal(DOOR_FRAMES, 19); // ChrSel 0..18, the range playDoor walks
  assert.equal(frames.length, 19);
  assert.deepEqual(created.map((image) => image.src),
    Array.from({ length: 19 }, (_, index) => `/f/${index}`));
});
