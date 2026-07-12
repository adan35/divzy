import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export type ColorScheme = 'light' | 'dark';

/** Color tokens per docs/STYLE.md. Both schemes expose the same keys. */
export interface ThemeColors {
  /** Page background. */
  page: string;
  /** Card / sheet surface. */
  surface: string;
  /** Raised / pressed surface. */
  surface2: string;
  /** Hairline borders and separators. */
  hairline: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  ink2: string;
  /** Muted text. */
  ink3: string;
  /** Brand / primary actions. */
  brand: string;
  /** Brand pressed/hover. */
  brandHover: string;
  /** Text/icons rendered on brand or danger fills. */
  onBrand: string;
  /** Money positive — owed to you. */
  pos: string;
  /** Money negative — you owe. */
  neg: string;
  danger: string;
  warning: string;
  /** Modal backdrop. */
  overlay: string;
}

export const lightColors: ThemeColors = {
  page: '#f9f9f7',
  surface: '#fcfcfb',
  surface2: '#f0efec',
  hairline: 'rgba(11,11,11,0.10)',
  ink: '#0b0b0b',
  ink2: '#52514e',
  ink3: '#898781',
  brand: '#2a78d6',
  brandHover: '#256abf',
  onBrand: '#ffffff',
  pos: '#006300',
  neg: '#d03b3b',
  danger: '#d03b3b',
  warning: '#c98500',
  overlay: 'rgba(11,11,11,0.45)',
};

export const darkColors: ThemeColors = {
  page: '#0d0d0d',
  surface: '#1a1a19',
  surface2: '#242422',
  hairline: 'rgba(255,255,255,0.10)',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  ink3: '#898781',
  brand: '#3987e5',
  brandHover: '#5598e7',
  onBrand: '#ffffff',
  pos: '#0ca30c',
  neg: '#e66767',
  danger: '#e66767',
  warning: '#eda100',
  overlay: 'rgba(0,0,0,0.55)',
};

/** Spacing scale on the 4px grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Corner radii: cards 16, buttons/inputs 10–12, avatars full. */
export const radii = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

/** Typography sizes. */
export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  hero: 32,
} as const;

/**
 * Tint helper: '#rrggbb' -> 'rgba(r,g,b,alpha)'. Non-hex inputs (already
 * rgba tokens) are returned unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!match) return color;
  const int = parseInt(match[1]!, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface Theme {
  colors: ThemeColors;
  scheme: ColorScheme;
}

const ThemeContext = createContext<Theme | null>(null);

function resolveScheme(system: ColorScheme | null | undefined): ColorScheme {
  return system === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = resolveScheme(useColorScheme());
  const value = useMemo<Theme>(
    () => ({ scheme, colors: scheme === 'dark' ? darkColors : lightColors }),
    [scheme],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

/**
 * Current theme ({colors, scheme}), driven by the system color scheme.
 * Falls back to a scheme-derived theme when used outside ThemeProvider so
 * isolated components never crash.
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  const scheme = resolveScheme(useColorScheme());
  if (ctx) return ctx;
  return { scheme, colors: scheme === 'dark' ? darkColors : lightColors };
}
