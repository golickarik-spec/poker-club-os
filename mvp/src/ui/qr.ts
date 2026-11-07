/**
 * A small QR Code encoder (ISO/IEC 18004): byte mode, versions 1–9, error-correction
 * level M, automatic mask selection. Enough for club and invitation addresses, with no
 * dependency. `encodeQr(text)` returns the module matrix (true = dark); `qrSvg` renders it.
 */

// ----- Tables (versions 1–10) --------------------------------------------------------------

/** Total codewords per version. */
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
/** Level M error correction: [ecPerBlock, blocksGroup1, dataGroup1, blocksGroup2, dataGroup2]. */
const EC_M: [number, number, number, number, number][] = [
  [0, 0, 0, 0, 0],
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 52]];

// ----- GF(256) arithmetic for Reed–Solomon -----------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]!;
      next[j + 1] ^= mul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g;
}

function rsRemainder(data: number[], ecCount: number): number[] {
  const gen = rsGenerator(ecCount);
  const out = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ out.shift()!;
    out.push(0);
    if (factor !== 0) for (let i = 0; i < ecCount; i++) out[i] ^= mul(gen[i + 1]!, factor);
  }
  return out;
}

// ----- Encoding ----------------------------------------------------------------------------------

function utf8(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** Versions 1–9 (up to 180 bytes at level M) are verified against an independent decoder; version 10 is not offered. */
const MAX_VERSION = 9;

function chooseVersion(length: number): number {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const [ec, b1, d1, b2, d2] = EC_M[v]!;
    const dataCodewords = b1 * d1 + b2 * d2;
    const countBits = v <= 9 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + length * 8) / 8);
    if (needed <= dataCodewords && ec > 0) return v;
  }
  throw new Error(`Text too long for a version-${MAX_VERSION} QR code (${length} bytes)`);
}

function dataBits(bytes: number[], version: number): number[] {
  const [, b1, d1, b2, d2] = EC_M[version]!;
  const capacity = (b1 * d1 + b2 * d2) * 8;
  const bits: number[] = [];
  const push = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  let pad = 0xec;
  while (bits.length < capacity) {
    push(pad, 8);
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return bits;
}

function codewords(bits: number[], version: number): number[] {
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    data.push(v);
  }
  const [ec, b1, d1, b2, d2] = EC_M[version]!;
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let pos = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const size = i < b1 ? d1 : d2;
    const block = data.slice(pos, pos + size);
    pos += size;
    blocks.push(block);
    ecBlocks.push(rsRemainder(block, ec));
  }
  const out: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) for (const block of blocks) if (i < block.length) out.push(block[i]!);
  for (let i = 0; i < ec; i++) for (const block of ecBlocks) out.push(block[i]!);
  if (out.length !== TOTAL[version]) throw new Error('codeword count mismatch');
  return out;
}

// ----- Matrix -------------------------------------------------------------------------------------

type Matrix = { size: number; dark: Uint8Array; reserved: Uint8Array };

function newMatrix(version: number): Matrix {
  const size = version * 4 + 17;
  return { size, dark: new Uint8Array(size * size), reserved: new Uint8Array(size * size) };
}
const set = (m: Matrix, x: number, y: number, dark: boolean, reserve = true) => {
  const i = y * m.size + x;
  m.dark[i] = dark ? 1 : 0;
  if (reserve) m.reserved[i] = 1;
};
const get = (m: Matrix, x: number, y: number): boolean => m.dark[y * m.size + x] === 1;

function placeFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(m, x, y, d !== 2 && d !== 4);
    }
  }
}

function placeAlignment(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(m, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
}

function placeFunctionPatterns(m: Matrix, version: number): void {
  placeFinder(m, 3, 3);
  placeFinder(m, m.size - 4, 3);
  placeFinder(m, 3, m.size - 4);
  for (let i = 8; i < m.size - 8; i++) {
    set(m, i, 6, i % 2 === 0);
    set(m, 6, i, i % 2 === 0);
  }
  const centres = ALIGN[version]!;
  for (const cy of centres) {
    for (const cx of centres) {
      // Skip the three that would sit on a finder; the ones on the timing lines are real.
      const finder = (cx <= 8 && cy <= 8) || (cx >= m.size - 9 && cy <= 8) || (cx <= 8 && cy >= m.size - 9);
      if (finder) continue;
      placeAlignment(m, cx, cy);
    }
  }
  // Reserve the format areas and the dark module.
  for (let i = 0; i < 9; i++) {
    m.reserved[8 * m.size + i] = 1;
    m.reserved[i * m.size + 8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8 * m.size + (m.size - 1 - i)] = 1;
    m.reserved[(m.size - 1 - i) * m.size + 8] = 1;
  }
  set(m, 8, m.size - 8, true);
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m.reserved[(m.size - 11 + j) * m.size + i] = 1;
        m.reserved[i * m.size + (m.size - 11 + j)] = 1;
      }
    }
  }
}

function placeData(m: Matrix, words: number[]): void {
  let bitIndex = 0;
  const total = words.length * 8;
  const bitAt = (i: number) => (words[i >> 3]! >> (7 - (i & 7))) & 1;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        const idx = y * m.size + x;
        if (m.reserved[idx]) continue;
        m.dark[idx] = bitIndex < total ? bitAt(bitIndex) : 0;
        bitIndex++;
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number): void {
  const f = MASKS[mask]!;
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (!m.reserved[y * m.size + x] && f(x, y)) m.dark[y * m.size + x] ^= 1;
}

function bch(value: number, poly: number, bits: number, total: number): number {
  let v = value << (total - bits);
  for (let i = total - 1; i >= total - bits; i--) if ((v >> i) & 1) v ^= poly << (i - (total - bits));
  return (value << (total - bits)) | v;
}

function placeFormat(m: Matrix, mask: number): void {
  // Level M = 00.
  const info = bch((0b00 << 3) | mask, 0x537, 5, 15) ^ 0x5412;
  const bit = (i: number) => ((info >> i) & 1) === 1;
  for (let i = 0; i < 6; i++) set(m, 8, i, bit(i));
  set(m, 8, 7, bit(6));
  set(m, 8, 8, bit(7));
  set(m, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(m, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(m, m.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(m, 8, m.size - 15 + i, bit(i));
}

function placeVersion(m: Matrix, version: number): void {
  if (version < 7) return;
  const info = bch(version, 0x1f25, 6, 18);
  for (let i = 0; i < 18; i++) {
    const dark = ((info >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = m.size - 11 + (i % 3);
    set(m, a, b, dark);
    set(m, b, a, dark);
  }
}

function penalty(m: Matrix): number {
  const n = m.size;
  let score = 0;
  // Runs of five or more in rows and columns.
  for (let y = 0; y < n; y++) {
    let run = 1;
    for (let x = 1; x < n; x++) {
      if (get(m, x, y) === get(m, x - 1, y)) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let x = 0; x < n; x++) {
    let run = 1;
    for (let y = 1; y < n; y++) {
      if (get(m, x, y) === get(m, x, y - 1)) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  // 2×2 blocks.
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = get(m, x, y);
    if (c === get(m, x + 1, y) && c === get(m, x, y + 1) && c === get(m, x + 1, y + 1)) score += 3;
  }
  // Finder-like patterns.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const check = (cells: boolean[]) => {
    for (let i = 0; i + 11 <= cells.length; i++) {
      const seg = cells.slice(i, i + 11);
      const a = pattern.every((p, k) => seg[k + 4] === (p === 1)) && seg.slice(0, 4).every((c) => !c);
      const b = pattern.every((p, k) => seg[k] === (p === 1)) && seg.slice(7).every((c) => !c);
      if (a || b) score += 40;
    }
  };
  for (let y = 0; y < n; y++) check(Array.from({ length: n }, (_, x) => get(m, x, y)));
  for (let x = 0; x < n; x++) check(Array.from({ length: n }, (_, y) => get(m, x, y)));
  // Dark proportion.
  let darkCount = 0;
  for (let i = 0; i < n * n; i++) darkCount += m.dark[i]!;
  const pct = (darkCount * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

export interface QrCode {
  size: number;
  version: number;
  /** modules[y][x] */
  modules: boolean[][];
}

export function encodeQr(text: string): QrCode {
  const bytes = utf8(text);
  const version = chooseVersion(bytes.length);
  const words = codewords(dataBits(bytes, version), version);
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = newMatrix(version);
    placeFunctionPatterns(m, version);
    placeData(m, words);
    applyMask(m, mask);
    placeFormat(m, mask);
    placeVersion(m, version);
    const score = penalty(m);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  const m = best!;
  const modules: boolean[][] = [];
  for (let y = 0; y < m.size; y++) modules.push(Array.from({ length: m.size }, (_, x) => get(m, x, y)));
  return { size: m.size, version, modules };
}

/** An SVG string of the code with a quiet zone of four modules; `scale` pixels per module. */
export function qrSvg(text: string, scale = 4, dark = '#0b0f13', light = '#ffffff'): string {
  const qr = encodeQr(text);
  const quiet = 4;
  const total = (qr.size + quiet * 2) * scale;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y]![x]) path += `M${(x + quiet) * scale} ${(y + quiet) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

export const qrDataUrl = (text: string, scale = 4): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, scale))}`;
