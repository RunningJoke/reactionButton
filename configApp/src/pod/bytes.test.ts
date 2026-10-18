import { describe, expect, it } from "vitest";
import { crc32, crcHex } from "./crc32";
import { byteLength, encodeUtf8, LineDecoder, splitUtf8 } from "./utf8";

describe("crc32", () => {
  it("matches zlib.crc32", () => {
    expect(crcHex("123456789")).toBe("cbf43926");
    expect(crcHex("")).toBe("00000000");
    // python: format(zlib.crc32("Übung ✓ 🏃".encode()), "08x")
    expect(crcHex("Übung ✓ 🏃")).toBe("e7e5d357");
    expect(crc32(encodeUtf8("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("utf8", () => {
  const text = 'a"ü€🏃\n'.repeat(50);

  it("counts bytes like TextEncoder", () => {
    for (const s of ["", "abc", "ü", "€", "🏃", text]) expect(byteLength(s)).toBe(encodeUtf8(s).length);
  });

  it("splits at character boundaries within the byte limit", () => {
    for (const max of [4, 5, 7, 64, 1000]) {
      const pieces = splitUtf8(text, max);
      expect(pieces.join("")).toBe(text);
      for (const piece of pieces) {
        expect(byteLength(piece)).toBeLessThanOrEqual(max);
        expect(piece).toBe(new TextDecoder().decode(encodeUtf8(piece))); // no broken surrogate
      }
    }
    expect(splitUtf8("", 10)).toEqual([""]);
  });

  it("decodes lines whose characters are split between packets", () => {
    const decoder = new LineDecoder();
    const bytes = encodeUtf8('{"a":"ü🏃"}\r\nlog line\n{"b":1}');
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i++) lines.push(...decoder.push(bytes.subarray(i, i + 1)));
    expect(lines).toEqual(['{"a":"ü🏃"}', "log line"]);
    expect(decoder.push(encodeUtf8("\n"))).toEqual(['{"b":1}']);
  });
});
