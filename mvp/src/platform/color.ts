/** Small colour helpers for deriving table shades from one chosen colour. Pure, no DOM. */

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3);
    g = f(p, q, h);
    b = f(p, q, h - 1 / 3);
  }
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Lighten (+) or darken (−) by a lightness delta in [−1, 1], with an optional saturation delta. */
export function shade(hex: string, dl: number, ds = 0): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, Math.max(0, Math.min(1, s + ds)), Math.max(0, Math.min(1, l + dl)));
}

/** The CSS variables the table cloth is drawn from, derived from a felt colour and a rail colour. */
export function tableVars(felt: string, rail: string): Record<string, string> {
  return {
    '--felt-a': shade(felt, 0.06, 0.04),
    '--felt-b': felt,
    '--felt-c': shade(felt, -0.12),
    '--rail-a': shade(rail, 0.08),
    '--rail-c': rail,
    '--rail-b': shade(rail, -0.08),
    '--felt-line': 'rgb(255 255 255 / 0.2)',
  };
}
