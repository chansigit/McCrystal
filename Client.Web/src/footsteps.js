export class Footsteps {
  sample(motion, frame, running, cycle = 0) {
    if (this.motion !== motion) { this.motion = motion; this.played = new Set(); }
    const key = `${cycle}:${frame}`;
    if ((frame !== 1 && frame !== 4) || this.played.has(key)) return null;
    this.played.add(key);
    return (running ? 10003 : 10001) + (frame === 4 ? 1 : 0);
  }
}
export function locomotionFrame(phase, count) {
  return Math.floor(Math.max(0, Math.min(.999, phase)) * count);
}
export function footstepFrame(phase, count, running) {
  const step = Math.floor(Math.max(0, Math.min(.999, phase)) * count * (running ? 2 : 1));
  return { frame: step % count, cycle: Math.floor(step / count) };
}
