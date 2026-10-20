// Draws the app icon (DESIGN.md, "app icon": six-segment ring, 4 blue "ready" + 2 green "go",
// white button in the middle) as SVG and PNG without extra dependencies.
// Run: npm run icons  → public/icons/*
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [11, 20, 38]; // Midnight --bg
const READY = [91, 155, 255]; // --accent
const GO = [34, 197, 94]; // --led-green
const BUTTON = [231, 238, 250]; // --text
const RING_R = 160 / 512;
const RING_W = 56 / 512;
const DISC_R = 70 / 512;
// segments clockwise from 12 o'clock; 60° each, 12° gap, the round caps take about 10° per end
const SEGMENTS = [GO, GO, READY, READY, READY, READY].map((color, k) => ({ color, from: k * 60 + 16, to: (k + 1) * 60 - 16 }));

const polar = (deg, r, scale) => {
  const t = (deg * Math.PI) / 180;
  return [0.5 + Math.sin(t) * r * scale, 0.5 - Math.cos(t) * r * scale];
};

function colorAt(x, y, scale) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const d = Math.hypot(dx, dy);
  if (d <= DISC_R * scale) return BUTTON;
  const half = (RING_W * scale) / 2;
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  for (const s of SEGMENTS) {
    if (Math.abs(d - RING_R * scale) <= half && deg >= s.from && deg <= s.to) return s.color;
    for (const end of [s.from, s.to]) {
      const [ex, ey] = polar(end, RING_R, scale);
      if ((x - ex) ** 2 + (y - ey) ** 2 <= half * half) return s.color;
    }
  }
  return BG;
}

function svg() {
  const rgb = (c) => `rgb(${c.join(",")})`;
  const arcs = SEGMENTS.map((s) => {
    const [x1, y1] = polar(s.from, RING_R, 1).map((v) => (v * 512).toFixed(1));
    const [x2, y2] = polar(s.to, RING_R, 1).map((v) => (v * 512).toFixed(1));
    return `<path d="M${x1} ${y1}A160 160 0 0 1 ${x2} ${y2}" fill="none" stroke="${rgb(s.color)}" stroke-width="56" stroke-linecap="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="${rgb(BG)}"/>${arcs}<circle cx="256" cy="256" r="70" fill="${rgb(BUTTON)}"/></svg>\n`;
}

function png(size, { scale, rounded }) {
  const ss = 4; // supersampling per axis
  const radius = rounded ? 116 / 512 : 0;
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
          const color = colorAt(x, y, scale);
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
