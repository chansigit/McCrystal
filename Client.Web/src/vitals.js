export function liquidHeight(value, maximum) {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(80, Math.trunc(80 * value / maximum)));
}
export const hpOnlyOrb = (user) => user.Class === 0 && user.Level < 28;
export function vitalLabels(user) {
  return hpOnlyOrb(user) ? [["HP", user.HP, 72]] : [["HP", user.HP, 64], ["MP", user.MP, 79]];
}
export function liquidSections(user, maxHP, maxMP) {
  const hpOnly = hpOnlyOrb(user);
  const hp = liquidHeight(user.HP, maxHP), mp = liquidHeight(user.MP, maxMP);
  return [{ index: hpOnly ? 6 : 4, x: 0, y: 80 - hp, width: hpOnly ? 100 : 50, height: hp },
    ...hpOnly ? [] : [{ index: 4, x: 51, y: 80 - mp, width: 50, height: mp }]];
}
export class Vitals {
  constructor(canvas) {
    this.canvas = canvas; this.images = new Map();
    for (const index of [0, 4, 6]) {
      const image = new Image();
      image.onload = () => this.draw();
      image.src = `/assets/frame?library=Prguse&index=${index}`;
      this.images.set(index, image);
    }
  }
  update(user, maxHP, maxMP) {
    this.user = user; this.maxHP = maxHP; this.maxMP = maxMP;
    const label = vitalLabels(user).map(([name, value]) => `${name} ${value.toLocaleString()}`).join(" / ");
    this.canvas.setAttribute("aria-label", label);
    this.canvas.title = label;
    this.draw();
  }
  draw() {
    if (!this.user) return;
    const ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, 104, 120);
    ctx.imageSmoothingEnabled = false;
    const background = this.images.get(0);
    if (background.complete && background.naturalWidth) ctx.drawImage(background, 0, 0, 104, 120, 0, 0, 104, 120);
    // Native MainDialog places the 80px liquid at (0, 30) within its frame.
    for (const section of liquidSections(this.user, this.maxHP, this.maxMP)) {
      const image = this.images.get(section.index);
      if (section.height && image.complete && image.naturalWidth)
        ctx.drawImage(image, section.x, section.y, section.width, section.height,
          section.x, 30 + section.y, section.width, section.height);
    }
    ctx.font = "11px Arial, sans-serif"; ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "#101510"; ctx.fillStyle = "#ffffff";
    for (const [label, value, y] of vitalLabels(this.user)) {
      const text = `${label} ${value.toLocaleString()}`;
      ctx.strokeText(text, 50, y, 92); ctx.fillText(text, 50, y, 92);
    }
  }
}
