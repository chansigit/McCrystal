import test from "node:test";
import assert from "node:assert/strict";
import { registrationData, playDoor } from "./classic-login.js";

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
