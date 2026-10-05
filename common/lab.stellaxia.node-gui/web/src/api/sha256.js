// GUI 원본(maingui) src/api/sha256.js 와 같은 코드 — SHA-256 (조각씩 넣는 방식) — 파일 올리기의 checksum_sha256. crypto.subtle은 한 번에 다 넣어야 하고
// https가 아닌 사설망 주소(http://192.168…)에선 아예 없으므로 직접 계산한다.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

export class Sha256 {
  constructor() { this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); this.buf = new Uint8Array(64); this.n = 0; this.len = 0; this.w = new Uint32Array(64); }
  block(b, o) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  update(bytes) {
    let i = 0; this.len += bytes.length;
    if (this.n) { while (this.n < 64 && i < bytes.length) this.buf[this.n++] = bytes[i++]; if (this.n === 64) { this.block(this.buf, 0); this.n = 0; } }
    for (; i + 64 <= bytes.length; i += 64) this.block(bytes, i);
    while (i < bytes.length) this.buf[this.n++] = bytes[i++];
    return this;
  }
  hex() {
    const bits = this.len * 8, pad = new Uint8Array(((this.n < 56 ? 56 : 120) - this.n) + 8);
    pad[0] = 0x80; const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0, L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi; pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
    this.len -= pad.length; this.update(pad);
    return Array.from(this.h, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

/** Blob(File)의 SHA-256 — 4 MiB씩 읽는다 */
export async function sha256Blob(blob, onProgress) {
  const H = new Sha256(), step = 4 * 1048576;
  for (let off = 0; off < blob.size; off += step) { H.update(new Uint8Array(await blob.slice(off, off + step).arrayBuffer())); if (onProgress) onProgress(Math.min(blob.size, off + step)); }
  return H.hex();
}

/** base64 → 바이트 (받기 조각의 data) */
export function fromB64(s) {
  const bin = atob(String(s || '')), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 바이트 → base64 (io.terra.file 조각의 data) — 큰 배열을 한 번에 String.fromCharCode 에 넘기지 않는다 */
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
