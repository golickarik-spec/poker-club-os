/**
 * Table branding: what a tournament shows on its felt. Pure functions shared by the
 * creation wizard (preview), the live table and the home-page cameo, so every preview
 * is computed the same way as the real thing.
 */
import { isHex, tableVars } from './color.ts';
import { DEFAULT_TABLE_BRANDING, TABLE_LOGO_LIMITS, type Club, type ClubBranding, type TableBranding, type TableColors, type TableThemeId, type Tournament } from './types.ts';

export interface ResolvedTableBranding {
  /** A built-in theme class, or 'custom' when `vars` carry the colours. */
  theme: TableThemeId | 'custom';
  /** CSS variables for a custom scheme (felt / rail shades); undefined for built-in themes. */
  vars?: Record<string, string>;
  /** null when no logo is shown. */
  logo: ClubBranding['logo'] | null;
  opacity: number;
  scale: number;
}

export const THEMES: readonly TableThemeId[] = ['midnight', 'emerald', 'royal', 'burgundy', 'graphite'];

/** Reference colours of the built-in themes, so a preset or custom scheme can start from one. */
export const THEME_COLORS: Record<TableThemeId, TableColors> = {
  midnight: { felt: '#1a3d64', rail: '#232a33' },
  emerald: { felt: '#14664e', rail: '#241e17' },
  royal: { felt: '#363688', rail: '#241f2d' },
  burgundy: { felt: '#671b32', rail: '#2b2015' },
  graphite: { felt: '#363e47', rail: '#1b1f24' },
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

const validTheme = (theme: unknown): theme is TableBranding['theme'] =>
  theme === 'club' || theme === 'custom' || (typeof theme === 'string' && (theme.startsWith('preset:') || THEMES.includes(theme as TableThemeId)));

/** Brings any stored value back inside the safe limits. */
export function normaliseTableBranding(input: Partial<TableBranding> | undefined): TableBranding {
  const b = { ...DEFAULT_TABLE_BRANDING, ...(input ?? {}) };
  const colors = b.colors && isHex(b.colors.felt) && isHex(b.colors.rail) ? { felt: b.colors.felt, rail: b.colors.rail } : undefined;
  return {
    source: b.source === 'custom' || b.source === 'hidden' ? b.source : 'club',
    logoDataUrl: typeof b.logoDataUrl === 'string' && b.logoDataUrl.startsWith('data:image/') ? b.logoDataUrl : null,
    opacity: clamp(b.opacity, TABLE_LOGO_LIMITS.opacity.min, TABLE_LOGO_LIMITS.opacity.max),
    scale: clamp(b.scale, TABLE_LOGO_LIMITS.scale.min, TABLE_LOGO_LIMITS.scale.max),
    theme: validTheme(b.theme) ? (b.theme === 'custom' && !colors ? 'club' : b.theme) : 'club',
    ...(colors ? { colors } : {}),
  };
}

/** The felt and rail a tournament uses, with the club as the fallback for anything unset or missing. */
export function resolveTableColors(b: TableBranding, club: Pick<Club, 'branding'>): { theme: TableThemeId | 'custom'; vars?: Record<string, string>; colors: TableColors } {
  if (b.theme === 'custom' && b.colors) return { theme: 'custom', vars: tableVars(b.colors.felt, b.colors.rail), colors: b.colors };
  if (typeof b.theme === 'string' && b.theme.startsWith('preset:')) {
    const preset = club.branding.tablePresets?.find((p) => p.id === b.theme.slice('preset:'.length));
    // A preset that was deleted since falls back to the club default.
    if (preset) return { theme: 'custom', vars: tableVars(preset.colors.felt, preset.colors.rail), colors: preset.colors };
  }
  const theme = b.theme !== 'club' && THEMES.includes(b.theme as TableThemeId) ? (b.theme as TableThemeId) : club.branding.tableTheme;
  return { theme, colors: THEME_COLORS[theme] };
}

/** What the felt shows for a tournament, falling back to the club for anything unset. */
export function resolveTableBranding(tournament: Pick<Tournament, 'tableBranding'> | { tableBranding?: Partial<TableBranding> }, club: Pick<Club, 'branding'>): ResolvedTableBranding {
  const b = normaliseTableBranding(tournament.tableBranding);
  const { theme, vars } = resolveTableColors(b, club);
  const base = { theme, vars, opacity: b.opacity, scale: b.scale };
  if (b.source === 'hidden') return { ...base, logo: null };
  if (b.source === 'custom' && b.logoDataUrl) return { ...base, logo: { kind: 'image', dataUrl: b.logoDataUrl } };
  // 'club', or 'custom' with nothing uploaded yet: the club's own mark.
  return { ...base, logo: club.branding.logo };
}

/** Problems with a branding draft, as message keys. */
export function validateTableBranding(b: TableBranding): string[] {
  const problems: string[] = [];
  if (b.source === 'custom' && b.logoDataUrl && b.logoDataUrl.length > TABLE_LOGO_LIMITS.maxBytes * 1.37) problems.push('table.logo.too_large');
  if (b.theme === 'custom' && !(b.colors && isHex(b.colors.felt) && isHex(b.colors.rail))) problems.push('table.colors.invalid');
  return problems;
}
