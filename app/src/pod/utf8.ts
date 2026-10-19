/** UTF-8 helpers. The API counts offsets and sizes in bytes (config-api.md §4). */

import { byteLength } from "@reactpod/program-model";

const encoder = new TextEncoder();

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export { byteLength };

/**
 * Splits text into pieces of at most `maxBytes` UTF-8 bytes each, never inside a character
 * (a surrogate pair stays together). `maxBytes` must be at least 4.
 */
export function splitUtf8(text: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new RangeError("maxBytes must be >= 4");
  const pieces: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
    const units = pair ? 2 : 1;
    if (bytes + size > maxBytes) {
      pieces.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += units;
  }
  if (start < text.length || pieces.length === 0) pieces.push(text.slice(start));
  return pieces;
}

/**
 * Collects bytes into lines ending in "\n" and decodes each complete line as UTF-8,
 * so a character split over two BLE packets is decoded correctly.
 */
export class LineDecoder {
  private buffer = new Uint8Array(0);
  private readonly decoder = new TextDecoder("utf-8");

  /** Adds bytes, returns the complete lines (without "\r\n" / "\n"). */
  push(bytes: Uint8Array): string[] {
    const merged = new Uint8Array(this.buffer.length + bytes.length);
    merged.set(this.buffer);
    merged.set(bytes, this.buffer.length);
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] === 0x0a) {
        let end = i;
        if (end > start && merged[end - 1] === 0x0d) end--;
        lines.push(this.decoder.decode(merged.subarray(start, end)));
        start = i + 1;
      }
    }
    this.buffer = merged.slice(start);
    return lines;
  }

  reset() {
    this.buffer = new Uint8Array(0);
  }
}
