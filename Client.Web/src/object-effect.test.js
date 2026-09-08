import test from "node:test";
import assert from "node:assert/strict";
import { objectEffects } from "./object-effect.js";
import { direction16, missileDuration, createMissile } from "./missile.js";

const packet = (Effect, extra = {}) => ({ ObjectID: 1, Effect, EffectType: 0, DelayTime: 0, Time: 0, ...extra });
const source = { ObjectID: 1, Direction: 0, Location: { X: 5, Y: 5 } };

test("a simple attached effect carries its library, run and sound", () => {
  // Healing: Magic 370, ten frames over 800 ms (GameScene.cs:4744-4747).
  const [heal] = objectEffects(packet(3), source);
  assert.deepEqual(heal.effect, ["Magic", 370, 10, 800]);
  assert.equal(heal.blend, true);
  assert.equal(heal.sound, 20000 + 61 * 10 + 1);
  // RedMoonEvil is one of the few native draws opaque.
  assert.equal(objectEffects(packet(4), source)[0].blend, false);
});

test("hemorrhage stacks three layers, the first carrying the sound", () => {
  const layers = objectEffects(packet(17), source);
  assert.equal(layers.length, 3);
  assert.deepEqual(layers.map((l) => l.effect[1]), [0, 28, 46]);
  assert.equal(layers[0].sound, 20000 + 104 * 10);
  assert.equal(layers[1].sound, undefined);
});

test("a shield stays up until its Down twin clears it", () => {
  const [up] = objectEffects(packet(6), source);
  assert.deepEqual(up.effect, ["Magic", 3890, 3, 600]);
  assert.ok(up.until > 0); // Repeat = true natively, with no end of its own
  assert.equal(up.key, "shield");
  assert.deepEqual(objectEffects(packet(7), source), [{ clear: "shield" }]);
  assert.equal(objectEffects(packet(13), source)[0].key, "barrier");
});

test("a stun repeats for exactly the time the packet carries", () => {
  // RepeatUntil = CMain.Time + p.Time (GameScene.cs:4886-4893).
  assert.equal(objectEffects(packet(26, { Time: 5000 }), source)[0].until, 5000);
  assert.equal(objectEffects(packet(26), source)[0].until, 0); // Time 0 means one pass
});

test("the packet's own fields pick the art", () => {
  // DelayedExplosion steps ten frames per stage (GameScene.cs:4826-4840).
  assert.equal(objectEffects(packet(15, { EffectType: 2 }), source)[0].effect[1], 1590 + 20);
  // KingGuard has two runs (GameScene.cs:4900-4910).
  assert.equal(objectEffects(packet(28, { EffectType: 0 }), source)[0].effect[1], 753);
  assert.equal(objectEffects(packet(28, { EffectType: 1 }), source)[0].effect[1], 763);
  // DeathCrawlerBreath is four frames per direction of the breather (GameScene.cs:4919).
  assert.equal(objectEffects(packet(30), { ...source, Direction: 3 })[0].effect[1], 272 + 12);
  // MPEater puts its longer half on the object EffectType names.
  const eater = objectEffects(packet(16, { EffectType: 9 }), source);
  assert.equal(eater[1].on, "other");
  assert.deepEqual(eater[1].effect, ["Magic2", 2411, 19, 1900]);
});

test("an awakening result delays both layers by the packet's DelayTime", () => {
  const [blended, opaque] = objectEffects(packet(19, { DelayTime: 400 }), source);
  assert.equal(blended.delay, 400);
  assert.equal(opaque.delay, 400);
  assert.equal(blended.blend, true);
  assert.equal(opaque.blend, false); // the pair native draws one over the other
  assert.equal(blended.sound, 50002);
});

test("effects native draws nothing for produce nothing", () => {
  for (const effect of [11, 12, 33, 200]) // Critical, Mine, Tester, and an unknown
    assert.deepEqual(objectEffects(packet(effect), source), []);
});

test("a missile heads in one of sixteen directions and flies 50ms a cell", () => {
  const at = (x, y) => direction16({ X: 0, Y: 0 }, { X: x, Y: y });
  assert.equal(at(0, -1), 0); // due north is direction 0
  assert.equal(at(1, -1), 2); // north-east is a quarter of the way round
  assert.equal(at(1, 0), 4);
  assert.equal(at(0, 1), 8);
  assert.equal(at(-1, 0), 12);
  assert.equal(at(0, 0), 0); // no distance, no rotation
  assert.equal(missileDuration({ X: 0, Y: 0 }, { X: 6, Y: 2 }), 300); // MaxDistance * 50
  assert.equal(missileDuration({ X: 4, Y: 4 }, { X: 4, Y: 4 }), 50); // never zero
});

test("FireBounce is the one projectile, and it lands an impact on its target", () => {
  const missile = createMissile(46, source, { ObjectID: 2, Location: { X: 5, Y: 1 } });
  assert.deepEqual(
    { library: missile.library, start: missile.start, count: missile.count,
      interval: missile.interval, skip: missile.skip },
    { library: "Magic", start: 410, count: 6, interval: 30, skip: 4 }); // GameScene.cs:4701
  assert.equal(missile.direction, 0);
  assert.equal(missile.duration, 200);
  assert.deepEqual(missile.impact.effect, ["Magic", 570, 10, 600]);
  assert.equal(createMissile(31, source, { ObjectID: 2, Location: { X: 1, Y: 1 } }), null);
  assert.equal(createMissile(46, source, null), null);
});
