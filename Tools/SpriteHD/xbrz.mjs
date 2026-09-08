// Batch xBRZ 2x over a stream of raw RGBA frames, one process for the whole run.
//
// The native xBRZ CLIs build a 64 MB colour-distance table per process (~150 ms),
// which across the corpus's 461,902 frames is two hours of pure startup instead of
// four minutes of work -- so the WASM port is driven from one long-lived process
// (docs/sprite-upscaling-research.md, "Tooling on macOS Apple Silicon").
//
// Protocol, little-endian, on stdin and stdout:
//   int32 count, then per frame: int32 width, int32 height, width*height*4 bytes RGBA.
// Output is the same shape at the scaled size.

import { Scaler } from "@kayahr/xbrz";

const FACTOR = Number(process.argv[2] ?? 2);

const input = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
  process.stdin.on("error", reject);
});

const count = input.readInt32LE(0);
let at = 4;
const out = [];
const scalers = new Map(); // one Scaler per distinct source size

for (let i = 0; i < count; i++) {
  const width = input.readInt32LE(at);
  const height = input.readInt32LE(at + 4);
  at += 8;
  const bytes = width * height * 4;
  const source = new Uint8ClampedArray(input.buffer, input.byteOffset + at, bytes);
  at += bytes;

  const key = `${width}x${height}`;
  let scaler = scalers.get(key);
  if (!scaler) scalers.set(key, (scaler = new Scaler(width, height, FACTOR)));

  const header = Buffer.alloc(8);
  header.writeInt32LE(scaler.targetWidth, 0);
  header.writeInt32LE(scaler.targetHeight, 4);
  out.push(header, Buffer.from(scaler.scale(source))); // scale() reuses its buffer
}

const header = Buffer.alloc(4);
header.writeInt32LE(count, 0);
process.stdout.write(Buffer.concat([header, ...out]));
