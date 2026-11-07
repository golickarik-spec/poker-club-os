import { chips as formatChips } from '../app/format.ts';
import { cx } from '../ui/core.tsx';

/** Denominations and their colours, largest first. */
const DENOMINATIONS: [number, string][] = [
  [100_000, '#e8b74a'],
  [25_000, '#3fb4a3'],
  [5_000, '#e2703a'],
  [1_000, '#e9d9a6'],
  [500, '#8a5bd6'],
  [100, '#2b2f36'],
  [25, '#2e9e5b'],
  [5, '#d1424b'],
  [1, '#d9dde3'],
];

/** Pick up to `limit` chip colours that represent an amount. */
export function chipColours(amount: number, limit = 5): string[] {
  const out: string[] = [];
  let rest = Math.max(0, Math.round(amount));
  for (const [value, colour] of DENOMINATIONS) {
    while (rest >= value && out.length < limit) {
      out.push(colour);
      rest -= value;
    }
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : ['#d9dde3'];
}

/** A small stack of chips with the amount beside it. */
export function ChipStack({ amount, size = 16, label = true, compact, className }: { amount: number; size?: number; label?: boolean; compact?: boolean; className?: string }) {
  const colours = chipColours(amount, 4);
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <span className="relative shrink-0" style={{ width: size, height: size + (colours.length - 1) * 3 }} aria-hidden>
        {colours
          .slice()
          .reverse()
          .map((colour, i) => (
            <span key={i} className="pc-chip absolute left-0" style={{ '--chip': colour, '--chip-size': `${size}px`, bottom: i * 3 }} />
          ))}
      </span>
      {label && <span className="text-[12.5px] font-semibold leading-none text-white tabular-nums drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]">{formatChips(amount, compact)}</span>}
    </span>
  );
}
