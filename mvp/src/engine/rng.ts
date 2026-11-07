/**
 * Random number sources.
 *
 * - `cryptoRng()` draws from the platform CSPRNG (Web Crypto in the browser,
 *   node:crypto webcrypto on a server) with rejection sampling, so integer
 *   draws are unbiased. This is what a real deployment's authoritative server
 *   should use for shuffling.
 * - `seededRng()` is a deterministic PRNG for tests and for clearly labelled
 *   demo fixtures only. It must never be used to deal hands to real players.
 *
 * Nothing here is externally certified. Certification of an RNG is a separate
 * lab process that a production launch would have to go through.
 */
export interface Rng {
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

export function cryptoRng(): Rng {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No cryptographically secure random source available');
  }
  const buf = new Uint32Array(64);
  let pos = buf.length;
  const next32 = (): number => {
    if (pos >= buf.length) {
      c.getRandomValues(buf);
      pos = 0;
    }
    return buf[pos++]!;
  };
  return {
    int(n: number): number {
      if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new RangeError(`int(${n})`);
      // Rejection sampling: discard the tail of the 32-bit range that would bias the modulo.
      const limit = Math.floor(0x100000000 / n) * n;
      let x = next32();
      while (x >= limit) x = next32();
      return x % n;
    },
    float(): number {
      // 53 random bits -> [0, 1)
      const hi = next32() >>> 5;
      const lo = next32() >>> 6;
      return (hi * 67108864 + lo) / 9007199254740992;
    },
  };
}

/** Deterministic PRNG (sfc32). For tests and labelled demo fixtures only. */
export function seededRng(seed: number): Rng {
  let a = 0x9e3779b9 ^ seed;
  let b = 0x243f6a88 ^ (seed << 7);
  let c = 0xb7e15162 ^ (seed >>> 3);
  let d = 1;
  const next32 = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 16; i++) next32();
  return {
    int(n: number): number {
      if (!Number.isInteger(n) || n <= 0) throw new RangeError(`int(${n})`);
      const limit = Math.floor(0x100000000 / n) * n;
      let x = next32();
      while (x >= limit) x = next32();
      return x % n;
    },
    float(): number {
      return next32() / 0x100000000;
    },
  };
}

/** In-place Fisher–Yates shuffle. */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error('pick() from empty list');
  return items[rng.int(items.length)]!;
}

/** Fast non-cryptographic source for things that do not need secrecy (bot think-time, bot mixed strategies). */
export function mathRng(): Rng {
  return {
    int: (n: number) => Math.floor(Math.random() * n),
    float: () => Math.random(),
  };
}
