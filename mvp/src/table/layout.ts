/**
 * Seat geometry. The table is a stadium (a rectangle with fully rounded ends):
 * wide on desktop, tall on a phone. Seats are spaced evenly along its edge,
 * starting at the bottom centre — the viewer's own seat — and going clockwise.
 */
export interface Pt {
  x: number;
  y: number;
}

/** Point at distance `s` along a stadium outline with half-width a and half-height b, centred on the origin. Starts bottom-centre, runs clockwise on screen. */
function stadiumPoint(a: number, b: number, s: number): Pt {
  const r = Math.min(a, b);
  if (a >= b) {
    const straight = a - r;
    const segments = [straight, Math.PI * r, 2 * straight, Math.PI * r, straight];
    let d = s;
    if (d < segments[0]!) return { x: -d, y: b };
    d -= segments[0]!;
    if (d < segments[1]!) {
      const angle = Math.PI / 2 + d / r;
      return { x: -straight + r * Math.cos(angle), y: r * Math.sin(angle) };
    }
    d -= segments[1]!;
    if (d < segments[2]!) return { x: -straight + d, y: -b };
    d -= segments[2]!;
    if (d < segments[3]!) {
      const angle = -Math.PI / 2 + d / r;
      return { x: straight + r * Math.cos(angle), y: r * Math.sin(angle) };
    }
    d -= segments[3]!;
    return { x: straight - d, y: b };
  }
  const straight = b - r;
  const quarter = (Math.PI * r) / 2;
  let d = s;
  if (d < quarter) {
    const angle = Math.PI / 2 + d / r;
    return { x: r * Math.cos(angle), y: straight + r * Math.sin(angle) };
  }
  d -= quarter;
  if (d < 2 * straight) return { x: -a, y: straight - d };
  d -= 2 * straight;
  if (d < Math.PI * r) {
    const angle = Math.PI + d / r;
    return { x: r * Math.cos(angle), y: -straight + r * Math.sin(angle) };
  }
  d -= Math.PI * r;
  if (d < 2 * straight) return { x: a, y: -straight + d };
  d -= 2 * straight;
  const angle = d / r;
  return { x: r * Math.cos(angle), y: straight + r * Math.sin(angle) };
}

function stadiumLength(a: number, b: number): number {
  const r = Math.min(a, b);
  return 2 * Math.PI * r + 4 * (Math.max(a, b) - r);
}

/**
 * Pixel positions (relative to the stage's top-left) for each display slot.
 * Slot 0 is bottom centre. `a` and `b` are the half-sizes of the seat outline.
 */
export function seatSlots(count: number, centre: Pt, a: number, b: number): Pt[] {
  const length = stadiumLength(a, b);
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const p = stadiumPoint(a, b, (i * length) / count);
    out.push({ x: centre.x + p.x, y: centre.y + p.y });
  }
  return out;
}

/** A point part of the way from a seat towards the centre of the table. */
export function towards(from: Pt, centre: Pt, fraction: number): Pt {
  return { x: from.x + (centre.x - from.x) * fraction, y: from.y + (centre.y - from.y) * fraction };
}

/** Which display slot a seat occupies when `heroSeat` is drawn at the bottom. */
export const slotOf = (seat: number, heroSeat: number, maxSeats: number): number => (seat - heroSeat + maxSeats) % maxSeats;
