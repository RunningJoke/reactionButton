import { randomBytes } from "node:crypto";

let lastMs = 0;
let seq = 0;

/**
 * UUIDv7 (RFC 9562): time-ordered, so ids sort by creation time (used for cursor pagination).
 * Monotonic within this process: ids of the same millisecond count up in the 12-bit rand_a field.
 */
export function uuidv7(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    seq = randomBytes(2).readUInt16BE() & 0x7ff;
  } else if (++seq > 0xfff) {
    lastMs++;
    seq = 0;
  }
  const b = randomBytes(16);
  b.writeUIntBE(lastMs, 0, 6);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
