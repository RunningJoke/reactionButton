// Draws the app icon (pod with 18-LED ring) as SVG and PNG without extra dependencies.
// Run: npm run icons  → public/icons/*
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [16, 20, 24];
const POD = [36, 42, 50];
const OFF = [58, 66, 78];
const LIT = { 0: [52, 211, 153], 6: [96, 165, 250], 12: [96, 165, 250] };
const BUTTON = [230, 236, 242];

// Shapes in unit coordinates (0..1). `scale` shrinks the drawing for the maskable safe zone.
function shapes(scale) {
  const c = 0.5;
  const s = (v) => v * scale;
  const list = [{ x: c, y: c, r: s(0.42), color: POD }];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 - Math.PI / 2;
    list.push({ x: c + Math.cos(a) * s(0.34), y: c + Math.sin(a) * s(0.34), r: s(0.04), color: LIT[i] ?? OFF });
  }
  list.push({ x: c, y: c, r: s(0.2), color: BUTTON });
  return list;
}

function svg() {
  const circles = shapes(1)
    .map((d) => `<circle cx="${d.x * 512}" cy="${d.y * 512}" r="${d.r * 512}" fill="rgb(${d.color.join(",")})"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="rgb(${BG.join(",")})"/>${circles}</svg>\n`;
}

function png(size, { scale, rounded }) {
  const ss = 4; // supersampling per axis
  const list = shapes(scale);
  const radius = rounded ? 112 / 512 : 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (!insideRoundedRect(x, y, radius)) continue;
          let color = BG;
          for (const d of list) if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r ** 2) color = d.color;
          r += color[0]; g += color[1]; b += color[2]; a += 255;
        }
      }
      const n = ss * ss;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const cover = a / 255;
      raw[o] = cover ? r / cover : 0;
      raw[o + 1] = cover ? g / cover : 0;
      raw[o + 2] = cover ? b / cover : 0;
      raw[o + 3] = a / n;
    }
  }
  return encodePng(size, raw);
}

function insideRoundedRect(x, y, r) {
  if (r === 0) return true;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function encodePng(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; // 8 bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

writeFileSync(new URL("icon.svg", OUT), svg());
writeFileSync(new URL("icon-192.png", OUT), png(192, { scale: 1, rounded: true }));
writeFileSync(new URL("icon-512.png", OUT), png(512, { scale: 1, rounded: true }));
writeFileSync(new URL("icon-maskable-512.png", OUT), png(512, { scale: 0.8, rounded: false }));
writeFileSync(new URL("apple-touch-icon.png", OUT), png(180, { scale: 0.9, rounded: false }));
console.log("icons written to public/icons/");
