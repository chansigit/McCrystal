export class Footsteps {
  sample(motion, frame, running) {
    if (this.motion !== motion) { this.motion = motion; this.played = new Set(); }
    if ((frame !== 1 && frame !== 4) || this.played.has(frame)) return null;
    this.played.add(frame);
    return (running ? 10003 : 10001) + (frame === 4 ? 1 : 0);
  }
}
export function locomotionFrame(phase, count) {
  return Math.floor(Math.max(0, Math.min(.999, phase)) * count);
}
