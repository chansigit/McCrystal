export const groundFrame = (f) => f && ((f.width === 48 && f.height === 32) || (f.width === 96 && f.height === 64));
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export class SceneIndex {
  constructor() { this.chunks = new Map(); }
  keys(rect) {
    const keys = [];
    for (let y = Math.floor(rect.y / 512); y <= Math.floor((rect.y + rect.height) / 512); y++)
      for (let x = Math.floor(rect.x / 768); x <= Math.floor((rect.x + rect.width) / 768); x++) keys.push(`${x},${y}`);
    return keys;
  }
  add(object) {
    for (const key of this.keys(object.bounds)) {
      if (!this.chunks.has(key)) this.chunks.set(key, []);
      this.chunks.get(key).push(object);
    }
  }
  query(rect) {
    const result = new Set();
    for (const key of this.keys(rect)) for (const object of this.chunks.get(key) || [])
      if (intersects(object.bounds, rect)) result.add(object);
    return result;
  }
}
