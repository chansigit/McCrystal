import test from "node:test";
import assert from "node:assert/strict";
import { applyGroupPacket, canKick, MAX_GROUP } from "./group.js";

test("the roster is built in the order the server sends it, leader first", () => {
  // PlayerObject.GroupInvite sends the joining player one S.AddMember per existing member,
  // in order, then its own -- and GroupMembers[0] is the leader every leadership check
  // compares against.
  let members = [];
  for (const Name of ["leader", "second", "me"]) members = applyGroupPacket(members, "AddMember", { Name });
  assert.deepEqual(members, ["leader", "second", "me"]);
  assert.equal(members[0], "leader");
  // A repeat is not a second seat: the server would not send one, and a duplicate row would
  // make the count wrong.
  assert.deepEqual(applyGroupPacket(members, "AddMember", { Name: "second" }), members);
  // A nameless packet is ignored rather than adding a blank row.
  assert.deepEqual(applyGroupPacket(members, "AddMember", { Name: "" }), members);
});

test("DeleteMember drops one and DeleteGroup drops the lot", () => {
  const members = ["leader", "second", "me"];
  assert.deepEqual(applyGroupPacket(members, "DeleteMember", { Name: "second" }), ["leader", "me"]);
  assert.deepEqual(applyGroupPacket(members, "DeleteMember", { Name: "nobody" }), members);
  // Not "someone left": PlayerObject.DelMember sends this to the player being removed, and
  // LeaveGroup sends it to a group that has fallen to one. Either way the receiver has no
  // group any more.
  assert.deepEqual(applyGroupPacket(members, "DeleteGroup", {}), []);
  assert.deepEqual(applyGroupPacket(members, "SwitchGroup", { AllowGroup: false }), members,
    "an unrelated packet leaves the roster alone");
});

test("only the leader can remove anyone, and never themselves", () => {
  const members = ["leader", "second"];
  assert.equal(canKick(members, "leader", "second"), true);
  assert.equal(canKick(members, "second", "leader"), false, "C.DelMember is refused for a member");
  assert.equal(canKick(members, "leader", "leader"), false, "the leader leaves by turning grouping off");
  assert.equal(canKick([], "leader", "second"), false);
});

test("the group cap is the server's", () => {
  assert.equal(MAX_GROUP, 15); // Globals.MaxGroup
});

test("grouping starts off, the way the server's own field does", async () => {
  // CharacterInfo.AllowGroup is a bool with no initialiser and the server only ever echoes a
  // change, so both clients have to assume the default. Native assumes the same
  // (GroupDialog.AllowGroup). Asserted through the module's source rather than the DOM,
  // which this suite does not have.
  const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./group.js", import.meta.url), "utf8"));
  assert.match(source, /this\.allow = false;/);
});
