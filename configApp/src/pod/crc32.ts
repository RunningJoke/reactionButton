/** Standard CRC-32 (zlib / Python zlib.crc32, firmware esp_rom_crc32_le with seed 0). */
import { encodeUtf8 } from "./utf8";

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** CRC of the UTF-8 bytes of a text, as the 8 hex digits the API uses. */
export function crcHex(text: string): string {
  return hex32(crc32(encodeUtf8(text)));
}

export function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
