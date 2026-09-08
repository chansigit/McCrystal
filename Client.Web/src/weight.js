// The native HUD's weight block: MainDialog.WeightBar draws a 76x12 bar at (919, 103) inside
// the 1024x152 frame, with WeightLabel at (919, 101) and SpaceLabel at (994, 101)
// (Client/MirScenes/Dialogs/MainDialogs.cs:286-309, 460-463, 529-559).

// Native switches the art three ways on how full the bag is, so the bar turns amber and then
// red as a character approaches the cap. All three frames are 76x12.
export const WEIGHT_FRAMES = {
  normal: "/assets/frame?library=Prguse&index=76",
  heavy: "/assets/frame?library=UI_32bit&index=473",
  full: "/assets/frame?library=UI_32bit&index=472",
};

// WeightBar_BeforeDraw: percent > 1 clamps to 1, and nothing is drawn at or below 0.
export function weightRatio(current, capacity) {
  if (!Number.isFinite(capacity) || capacity <= 0) return 0;
  if (!Number.isFinite(current) || current <= 0) return 0;
  return Math.min(1, current / capacity);
}

export function weightFrame(ratio) {
  if (ratio <= 0.5) return WEIGHT_FRAMES.normal;
  if (ratio <= 0.75) return WEIGHT_FRAMES.heavy;
  return WEIGHT_FRAMES.full;
}

// The section native clips is (Size.Width - 2) * percent out of a 76 wide bar, so a full
// bag stops two pixels short of the end rather than filling the frame.
export function fillPercent(ratio) {
  return ((76 - 2) / 76) * ratio * 100;
}

// WeightLabel shows what is left, not what is carried, and never goes negative on screen
// even though an over-weight character's arithmetic does.
export function remaining(current, capacity) {
  const left = (Number(capacity) || 0) - (Number(current) || 0);
  return Math.round(left);
}

export class WeightBar {
  constructor(bar, fill, weightLabel, spaceLabel) {
    this.bar = bar; this.fill = fill;
    this.weightLabel = weightLabel; this.spaceLabel = spaceLabel;
    this.reset();
  }
  reset() {
    this.update(null);
  }
  update(summary) {
    if (!summary) {
      this.fill.style.width = "0%";
      this.weightLabel.textContent = "";
      this.spaceLabel.textContent = "";
      this.bar.removeAttribute("title");
      return;
    }
    const { current, capacity, free } = summary;
    const ratio = weightRatio(current, capacity);
    this.fill.style.width = `${fillPercent(ratio).toFixed(3)}%`;
    this.fill.style.backgroundImage = `url("${weightFrame(ratio)}")`;
    this.weightLabel.textContent = String(remaining(current, capacity));
    this.spaceLabel.textContent = String(free ?? "");
    this.bar.title = `负重 ${Math.round(current)}/${Math.round(capacity)} · 空格 ${free ?? "?"}`;
    this.bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    this.bar.setAttribute("aria-valuetext", this.bar.title);
  }
}
