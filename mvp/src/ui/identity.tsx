import { useMemo, type ReactNode } from 'react';
import { initials, readableInk } from '../app/format.ts';
import { seededRng } from '../engine/rng.ts';
import type { BannerStyle, Club, ClubBranding, CoverPattern, LogoGlyph, User } from '../platform/types.ts';
import { cx } from './core.tsx';

// ----- Glyphs (original vector shapes, 24×24) -------------------------------------------------

const star = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 10 : 4.3;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

export const GLYPH_PATHS: Record<Exclude<LogoGlyph, 'club' | 'wave'>, string> = {
  spade:
    'M12 2C12 2 3 9 3 14c0 2.8 2 4.5 4.3 4.5 1.6 0 2.9-.7 3.7-1.9-.2 2.4-1.2 4.2-3 5.4h8c-1.8-1.2-2.8-3-3-5.4.8 1.2 2.1 1.9 3.7 1.9C19 18.500 21 16.800 21 14 21 9 12 2 12 2Z',
  heart: 'M12 21s-9-6.500-9-12.500c0-3 2.200-5 4.800-5 1.800 0 3.300 1 4.200 2.500.9-1.500 2.400-2.500 4.200-2.500 2.600 0 4.800 2 4.800 5C21 14.500 12 21 12 21Z',
  diamond: 'M12 2 20.500 12 12 22 3.500 12Z',
  crown: 'M3 17.500 4.600 7 9 11.800 12 4.500l3 7.300L19.400 7 21 17.500ZM4 19.300h16v2.200H4Z',
  star,
  moon: 'M20.500 14.300A9 9 0 1 1 9.700 3.500a7.200 7.200 0 0 0 10.800 10.800Z',
};

export function Glyph({ glyph, className }: { glyph: LogoGlyph; className?: string }) {
  if (glyph === 'club') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <circle cx="12" cy="7.300" r="4.300" />
        <circle cx="6.800" cy="13.600" r="4.300" />
        <circle cx="17.200" cy="13.600" r="4.300" />
        <path d="M11 12.500c0 5-.9 7.600-2.700 9.500h7.400c-1.800-1.900-2.700-4.500-2.700-9.500Z" />
      </svg>
    );
  }
  if (glyph === 'wave') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.400" strokeLinecap="round" aria-hidden>
        <path d="M2.500 8.500c3-3.600 6-3.600 9.500 0s6.500 3.600 9.500 0" />
        <path d="M2.500 15.500c3-3.600 6-3.600 9.500 0s6.500 3.600 9.500 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={GLYPH_PATHS[glyph]} />
    </svg>
  );
}

export const LOGO_GLYPHS: LogoGlyph[] = ['spade', 'heart', 'diamond', 'club', 'crown', 'star', 'moon', 'wave'];

// ----- Product mark ----------------------------------------------------------------------

/** The Poker Club OS mark: a chip seen from above, its edge inlays doubling as a status ring. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f1720" />
      <circle cx="16" cy="16" r="10.500" fill="none" stroke="#14b8a6" strokeWidth="3.200" strokeDasharray="5.500 2.747" strokeDashoffset="2.750" />
      <path d="M16 10.800 20.200 16 16 21.200 11.800 16Z" fill="#f4f6f8" />
    </svg>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)} dir="ltr">
      <BrandMark className="size-8 shrink-0" />
      {!compact && (
        <span className="text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">
          Poker Club <span className="text-brand">OS</span>
        </span>
      )}
    </span>
  );
}

// ----- People -----------------------------------------------------------------------------

export function Avatar({ user, size = 36, className, ring }: { user: Pick<User, 'name' | 'hue'>; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white/95 select-none', ring && 'ring-2 ring-bg', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        background: `linear-gradient(155deg, oklch(0.52 0.09 ${user.hue}), oklch(0.36 0.07 ${user.hue + 24}))`,
      }}
      aria-hidden
    >
      {initials(user.name)}
    </span>
  );
}

// ----- Clubs ------------------------------------------------------------------------------

/** CSS variables that re-skin everything inside with a club's accent colour. */
export function accentStyle(accent: string): Record<string, string> {
  return { '--accent': accent, '--accent-ink': readableInk(accent) };
}

export function ClubScope({ club, children, className }: { club: Pick<Club, 'branding'> | null | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={className} style={club ? accentStyle(club.branding.accent) : undefined}>
      {children}
    </div>
  );
}

export function ClubLogo({ branding, name, size = 40, className }: { branding: ClubBranding; name: string; size?: number; className?: string }) {
  const { logo, accent } = branding;
  const radius = Math.round(size * 0.26);
  if (logo.kind === 'image') {
    return <img src={logo.dataUrl} alt="" className={cx('shrink-0 object-cover', className)} style={{ width: size, height: size, borderRadius: radius }} />;
  }
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center font-semibold select-none', className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        color: accent,
        background: `color-mix(in oklab, ${accent} 16%, #0f151c)`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${accent} 38%, transparent) inset`,
        fontSize: Math.round(size * 0.36),
        letterSpacing: '-0.02em',
      }}
      role="img"
      aria-label={name}
    >
      {logo.kind === 'glyph' ? <Glyph glyph={logo.glyph} className="size-[54%]" /> : logo.text}
    </span>
  );
}

/** The club's mark on its own (no tile), for watermarks. Inherits the text colour. */
export function ClubMark({ branding, size = 32 }: { branding: ClubBranding; size?: number }) {
  const { logo } = branding;
  if (logo.kind === 'image') return <img src={logo.dataUrl} alt="" className="rounded-[20%] object-cover opacity-60 grayscale" style={{ width: size, height: size }} />;
  if (logo.kind === 'glyph') {
    return (
      <span className="block" style={{ width: size, height: size }}>
        <Glyph glyph={logo.glyph} className="size-full" />
      </span>
    );
  }
  return (
    <span className="font-semibold" style={{ fontSize: size * 0.7, lineHeight: 1 }}>
      {logo.text}
    </span>
  );
}

export const COVER_PATTERNS: CoverPattern[] = ['constellation', 'currents', 'deco', 'felt', 'grid'];

function CoverArt({ pattern, accent, seed }: { pattern: CoverPattern; accent: string; seed: number }) {
  const art = useMemo(() => {
    const rng = seededRng(seed);
    if (pattern === 'constellation') {
      const stars = Array.from({ length: 54 }, () => ({ x: rng.float() * 800, y: rng.float() * 200, r: 0.8 + rng.float() * 2, o: 0.45 + rng.float() * 0.55 }));
      const links: [number, number][] = [];
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const d = Math.hypot(stars[i]!.x - stars[j]!.x, stars[i]!.y - stars[j]!.y);
          if (d < 78 && links.length < 34) links.push([i, j]);
        }
      }
      return (
        <>
          {links.map(([a, b], i) => (
            <line key={i} x1={stars[a]!.x} y1={stars[a]!.y} x2={stars[b]!.x} y2={stars[b]!.y} stroke={accent} strokeOpacity="0.4" strokeWidth="1" />
          ))}
          {stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={i % 5 === 0 ? '#ffffff' : accent} fillOpacity={s.o} />
          ))}
        </>
      );
    }
    if (pattern === 'currents') {
      return (
        <>
          {Array.from({ length: 14 }, (_, i) => {
            const y = 14 + i * 18;
            const amp = 10 + (i % 4) * 5;
            let d = `M-20 ${y}`;
            for (let x = 0; x <= 840; x += 120) d += ` q 30 ${-amp} 60 0 t 60 0`;
            return <path key={i} d={d} fill="none" stroke={accent} strokeOpacity={0.2 + (i % 3) * 0.12} strokeWidth={i % 4 === 0 ? 1.8 : 1.1} />;
          })}
        </>
      );
    }
    if (pattern === 'deco') {
      return (
        <>
          {Array.from({ length: 5 }, (_, k) => {
            const cx0 = 80 + k * 160;
            return (
              <g key={k}>
                {Array.from({ length: 9 }, (_, i) => {
                  const a = Math.PI + (i * Math.PI) / 8;
                  return (
                    <line key={i} x1={cx0} y1={250} x2={cx0 + Math.cos(a) * 170} y2={250 + Math.sin(a) * 170} stroke={accent} strokeOpacity={0.28 + (i % 2) * 0.16} strokeWidth="1" />
                  );
                })}
                {[60, 110, 160].map((r) => (
                  <path key={r} d={`M${cx0 - r} 250 A${r} ${r} 0 0 1 ${cx0 + r} 250`} fill="none" stroke={accent} strokeOpacity="0.36" strokeWidth="1" />
                ))}
              </g>
            );
          })}
        </>
      );
    }
    if (pattern === 'felt') {
      return (
        <>
          <ellipse cx="400" cy="150" rx="330" ry="120" fill="none" stroke={accent} strokeOpacity="0.28" strokeWidth="1.500" />
          <ellipse cx="400" cy="150" rx="250" ry="78" fill="none" stroke={accent} strokeOpacity="0.16" strokeWidth="1" />
          {Array.from({ length: 9 }, (_, i) => {
            const a = Math.PI + ((i + 0.5) * Math.PI) / 9;
            return <circle key={i} cx={400 + Math.cos(a) * 330} cy={150 + Math.sin(a) * 120} r="7" fill={accent} fillOpacity="0.3" />;
          })}
        </>
      );
    }
    return (
      <>
        {Array.from({ length: 21 }, (_, i) => (
          <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="240" stroke={accent} strokeOpacity={i % 5 === 0 ? 0.2 : 0.08} strokeWidth="1" />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 40} x2="800" y2={i * 40} stroke={accent} strokeOpacity={i % 3 === 0 ? 0.2 : 0.08} strokeWidth="1" />
        ))}
      </>
    );
  }, [pattern, accent, seed]);
  return (
    <svg viewBox="0 0 800 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
      {art}
    </svg>
  );
}

export function ClubCover({ branding, seed = 1, className, children }: { branding: ClubBranding; seed?: number; className?: string; children?: ReactNode }) {
  const { cover, accent } = branding;
  return (
    <div
      className={cx('relative isolate overflow-hidden', className)}
      style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 26%, #0e141b), #0e141b 96%)` }}
    >
      {cover.kind === 'image' ? (
        <img src={cover.dataUrl} alt="" className="absolute inset-0 size-full object-cover opacity-70" />
      ) : (
        <CoverArt pattern={cover.pattern} accent={accent} seed={seed} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/25 to-transparent" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}

export function ClubName({ club, className }: { club: Pick<Club, 'name' | 'branding'>; className?: string }) {
  return <span className={cx(club.branding.titleFont === 'serif' && 'font-serif font-medium tracking-[0]', className)}>{club.name}</span>;
}

export const BANNERS: BannerStyle[] = ['aurora', 'ember', 'tide', 'onyx', 'gilded'];
export const bannerClass = (style: BannerStyle): string => `banner-${style}`;

export function codeFor(club: Pick<Club, 'code'>): string {
  // A no-break space keeps the two groups in order inside right-to-left text.
  return `${club.code.slice(0, 3)}\u00a0${club.code.slice(3)}`;
}
