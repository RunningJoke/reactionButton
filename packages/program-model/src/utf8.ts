/** UTF-8 byte count. The pod API counts offsets and sizes in bytes (config-api.md §4). */
export function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4; // surrogate pair = one 4-byte character
      i++;
    } else bytes += 3;
  }
  return bytes;
}
