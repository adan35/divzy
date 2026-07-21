import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { Easing } from 'react-native-reanimated';
import { darkColors, lightColors, type ColorScheme, type ThemeColors } from './tokens';

/**
 * Theme entry point. Token VALUES (colors, spacing, radii, fontSize, motion,
 * spring, pressScale, chartPalette, withAlpha…) live in `./tokens` — a pure
 * module with no RN imports so vitest (plain Node env) can test them; this
 * module re-exports all of it and adds the React/reanimated-coupled pieces.
 * WI-068 note: `easing` lives here (not tokens.ts) because reanimated's
 * `Easing.bezier` cannot load under the Node test environment; the planned
 * `src/lib/motion.ts` therefore hosts only the MoneyText ticker helpers.
 */
export * from './tokens';

/** Ease-out-expo, the WI-068 motion curve (spec §4): cubic-bezier(0.16, 1, 0.3, 1). */
export const easing = { outExpo: Easing.bezier(0.16, 1, 0.3, 1) } as const;

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
