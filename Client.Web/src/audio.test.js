import test from "node:test";
import assert from "node:assert/strict";
import { GameAudio } from "./audio.js";
test("Map music loops separately from effects, reuses the same track and honours mute and exit", () => {
  const original = { Audio: globalThis.Audio, window: globalThis.window, document: globalThis.document };
  class Audio {
    paused = true; plays = 0;
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ""; }
    load() {}
  }
  globalThis.Audio = Audio;
  globalThis.window = { addEventListener() {} };
  globalThis.document = { getElementById: () => ({ setAttribute() {}, classList: { toggle() {} } }) };
  try {
    const audio = new GameAudio();
    audio.setMusic(30001);
    assert.equal(audio.music.loop, true);
    assert.equal(audio.music.src, "/assets/sound?id=30001");
    assert.equal(audio.music.plays, 1);
    audio.setMusic(30001);
    assert.equal(audio.music.plays, 1);
    audio.muted = true; audio.update();
    assert.equal(audio.music.paused, true);
    audio.setMusic(30002);
    assert.equal(audio.music.paused, true);
    audio.muted = false; audio.update();
    assert.equal(audio.music.plays, 2);
    audio.volume = 0; audio.update();
    assert.equal(audio.music.paused, true);
    audio.setMusic(null);
    assert.equal(audio.music.src, "");
    assert.equal(audio.music.paused, true);
    assert.equal(audio.active.size, 0);
  } finally { Object.assign(globalThis, original); }
});
