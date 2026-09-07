export class AttackInput {
  constructor() { this.reset(); }
  reset() { this.pointer = null; this.held = false; this.shift = false; this.alt = false; }
  update(event) {
    this.held = (event.buttons & 1) !== 0 && (event.buttons & 2) === 0;
    this.shift = event.shiftKey;
    this.alt = !!event.altKey;
    this.pointer = { clientX: event.clientX, clientY: event.clientY };
  }
  get target() { return this.held && this.shift && !this.alt ? this.pointer : null; }
  get harvestTarget() { return this.held && this.alt ? this.pointer : null; }
}
