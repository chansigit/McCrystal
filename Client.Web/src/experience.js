// The native HUD bar: MainDialog.ExperienceBar draws Prguse image 8 (1004x8, at 9,143 inside the
// 1024x152 frame) clipped to Experience / MaxExperience, and ExperienceLabel prints that same
// ratio with the .NET format "{0:#0.##%}" (Client/MirScenes/Dialogs/MainDialogs.cs:253-267, 458,
// 513-523). Three packets move the numbers: S.UserInformation and S.LevelChanged carry a whole
// Experience/MaxExperience pair, while S.GainExperience carries only a delta (uint Amount) that
// GameScene adds to User.Experience (Client/MirScenes/GameScene.cs:3836-3856).

// MaxExperience is 0 for a character the server has no experience curve entry for, which is every
// character past the end of the curve. The native label divides by it regardless and prints "∞%",
// and the bar clamps that to a full fill; a full bar named "满级" says the same thing without the
// arithmetic accident, and it is the case both characters on this server are in.
export const MAXED = "满级";

// Native: percent > 1 clamps to 1, and a fill is only drawn above 0.
export function experienceRatio(experience, maximum) {
  if (!Number.isFinite(maximum) || maximum <= 0) return 1;
  if (!Number.isFinite(experience) || experience <= 0) return 0;
  return Math.min(1, experience / maximum);
}

// ".NET {0:#0.##%}": the ratio times 100, at most two decimals, trailing zeros dropped,
// always at least one integer digit.
export function experiencePercent(experience, maximum) {
  if (!Number.isFinite(maximum) || maximum <= 0) return MAXED;
  const value = Number.isFinite(experience) ? experience : 0;
  return `${Number((Math.min(1, Math.max(0, value / maximum)) * 100).toFixed(2))}%`;
}

// The raw pair the native client never shows, kept for the hover title beside the percentage.
export function experienceDetail(experience, maximum) {
  const value = Math.max(0, Number.isFinite(experience) ? experience : 0);
  if (!Number.isFinite(maximum) || maximum <= 0) return `经验 ${value.toLocaleString()}（已达经验表上限）`;
  return `经验 ${value.toLocaleString()} / ${maximum.toLocaleString()}`;
}

export class ExperienceBar {
  constructor(bar, fill, label) {
    this.bar = bar; this.fill = fill; this.label = label;
    this.reset();
  }
  reset() {
    this.experience = 0;
    this.maximum = 0;
    this.render();
  }
  // S.UserInformation and S.LevelChanged both carry the whole pair.
  set(experience, maximum) {
    this.experience = Number(experience) || 0;
    this.maximum = Number(maximum) || 0;
    this.render();
  }
  // S.GainExperience carries a delta, so the total only stays right if every one is added.
  gain(amount) {
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.experience += delta;
    this.render();
  }
  render() {
    const ratio = experienceRatio(this.experience, this.maximum);
    const percent = experiencePercent(this.experience, this.maximum);
    const detail = experienceDetail(this.experience, this.maximum);
    this.fill.style.width = `${(ratio * 100).toFixed(3)}%`;
    this.label.textContent = percent;
    this.bar.title = `${percent === MAXED ? MAXED : percent} · ${detail}`;
    this.bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    this.bar.setAttribute("aria-valuetext", this.bar.title);
  }
}
