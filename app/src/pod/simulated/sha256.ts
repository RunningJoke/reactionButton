/**
 * SHA-256 (FIPS 180-4) fed in pieces: the demo pod hashes a firmware image as it arrives and keeps only the
 * 8 state words and one 64-byte block, never the image. Synchronous, so the demo pod's handle() can check
 * otaEnd without crypto.subtle (async).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private bytes = 0;

  update(data: Uint8Array): void {
    this.bytes += data.length;
    for (let i = 0; i < data.length; i++) {
      this.block[this.blockLength++] = data[i]!;
      if (this.blockLength === 64) {
        this.compress();
        this.blockLength = 0;
      }
    }
  }

  /** Finishes the hash: 64 lowercase hex characters. Call once; the object is spent afterwards. */
  hexDigest(): string {
    const bits = this.bytes * 8;
    this.block[this.blockLength++] = 0x80;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      this.compress();
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    const view = new DataView(this.block.buffer);
    view.setUint32(56, Math.floor(bits / 0x100000000));
    view.setUint32(60, bits >>> 0);
    this.compress();
    let hex = "";
    for (const word of this.h) hex += word.toString(16).padStart(8, "0");
    return hex;
  }

  private compress(): void {
    const w = new Uint32Array(64);
    const view = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(4 * i);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1; // Uint32Array keeps it mod 2^32
    }
    const v = Array.from(this.h);
    let [a, b, c, d, e, f, g, hh] = [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!;
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const state = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) this.h[i] = this.h[i]! + state[i]!;
  }
}
