/**
 * WI-068 "private-banking slate" design tokens — the PURE half of the theme
 * (no react / react-native / reanimated imports), so unit tests and other
 * pure modules can consume token values under vitest's plain-Node
 * environment. `@/theme` (index.ts) re-exports everything here plus the
 * React-coupled pieces (ThemeProvider/useTheme) and the reanimated `easing`
 * export. Values mirror `apps/web/src/app/globals.css` per spec §1.1/§1.3.
 */

export type ColorScheme = 'light' | 'dark';

/** Color tokens per docs/STYLE.md + WI-068 spec §1.1. Both schemes expose the same keys. */
export interface ThemeColors {
  /** Page background (cool slate / deep navy-charcoal; never pure #000). */
  page: string;
  /** Cards, sheets, nav. */
  surface: string;
  /** Raised / hover / pressed surface. */
  surface2: string;
  /** Popovers, dialogs, dropdowns (pairs with the shadow tier on light). */
  elevated: string;
  /** Hairline borders and separators. */
  hairline: string;
  /** Input borders, focused control outlines. */
  hairlineStrong: string;
  /** Primary text (the "trust navy" doubles as light ink). */
  ink: string;
  /** Secondary text. */
  ink2: string;
  /** Muted text, labels, axes. */
  ink3: string;
  /** Interactive text/icons/links, active nav, focus. NOT button fills — see brandFill. */
  brand: string;
  /** Hover/pressed state of interactive text. */
  brandHover: string;
  /**
   * Button/FAB fills. Separate from `brand`: dark `brand` is a light blue
   * tuned for 7:1 text contrast, but white text on it would be ~2.4:1 —
   * fills use this darker step so onBrand text clears 4.5:1 (spec §1.1).
   */
  brandFill: string;
  /** Pressed state of brandFill (web: --brand-fill-hover). */
  brandFillPressed: string;
  /** Text/icons rendered on brandFill or danger fills. */
  onBrand: string;
  /** Money positive — owed to you (WI-055: green). */
  pos: string;
  /** Money negative — you owe (WI-055: red). */
  neg: string;
  /** Destructive actions (same steps as neg). */
  danger: string;
  /** Warnings (always icon-paired). */
  warning: string;
  /**
   * Premium gold — Pulse insight glyph, celebration particles, "settled"
   * flourish. Never a fill behind body text, never a chart series color.
   */
  accent: string;
  /** Gold wash (insight chip). */
  accentSoft: string;
  /** Focus outline color. */
  ring: string;
  /** Modal backdrop (pro-rules 40–60% band). */
  overlay: string;
  /** Single-series chart marks (decoupled from `brand`, spec §8). */
  chart1: string;
  /** Hairline chart gridlines. */
  chartGrid: string;
}

export const lightColors: ThemeColors = {
  page: '#f4f6f9',
  surface: '#ffffff',
  surface2: '#eef1f6',
  elevated: '#ffffff',
  hairline: 'rgba(15,23,42,0.10)',
  hairlineStrong: 'rgba(15,23,42,0.16)',
  ink: '#0f172a',
  ink2: '#475569',
  ink3: '#5d6b7d',
  brand: '#1d4ed8',
  brandHover: '#1e40af',
  brandFill: '#1d4ed8',
  brandFillPressed: '#1e40af',
  onBrand: '#ffffff',
  pos: '#047857',
  neg: '#c02626',
  danger: '#c02626',
  warning: '#b45309',
  accent: '#a16207',
  accentSoft: 'rgba(161,98,7,0.10)',
  ring: '#1d4ed8',
  overlay: 'rgba(15,23,42,0.45)',
  chart1: '#2a78d6',
  chartGrid: '#e6eaf1',
};

export const darkColors: ThemeColors = {
  page: '#0a0e14',
  surface: '#11161e',
  surface2: '#1a212b',
  elevated: '#18202b',
  hairline: 'rgba(255,255,255,0.09)',
  hairlineStrong: 'rgba(255,255,255,0.16)',
  ink: '#f4f7fb',
  ink2: '#a9b4c4',
  ink3: '#7e8a9c',
  brand: '#60a5fa',
  brandHover: '#93c5fd',
  brandFill: '#2563eb',
  brandFillPressed: '#1d4ed8',
  onBrand: '#ffffff',
  pos: '#34d399',
  neg: '#f87171',
  danger: '#f87171',
  warning: '#fbbf24',
  accent: '#e3b341',
  accentSoft: 'rgba(227,179,65,0.12)',
  ring: '#60a5fa',
  overlay: 'rgba(0,0,0,0.60)',
  chart1: '#3987e5',
  chartGrid: '#232b36',
};

/**
 * Dark elevation uses borders + a machined top edge, not shadows (spec §1.1):
 * dark Card/elevated surfaces render this 1px top-edge highlight.
 */
export const topEdgeHighlight = 'rgba(255,255,255,0.04)';

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

/** Typography sizes (spec §2). `display` is the Pulse hero figure size. */
export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  hero: 32,
  display: 36,
} as const;

/** Motion durations in ms (spec §1.3/§4). `count` is the money count-up. */
export const motion = { fast: 120, base: 160, slow: 240, count: 600 } as const;

/** Sheet/modal spring (spec §4 "slow" tier on mobile). */
export const spring = { damping: 20, stiffness: 90 } as const;

/** Press scale for PressableScale (spec §4: 0.97 -> 1.0, transform-only). */
export const pressScale = 0.97;

/**
 * Categorical chart palette, spec §8.1 — the validator-proven slot order
 * (dataviz validate_palette.js, ALL PASS on the new surfaces, 2026-07-19).
 * Slots are assigned in fixed order, never cycled; >8 categories fold into
 * "Other" (`chartOtherColor`). Consumed by S6/S7 chart helpers instead of
 * local constants.
 */
export const chartPalette: Record<ColorScheme, readonly string[]> = {
  light: ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'],
};

/** ">8 categories" fold color — cool grey, both modes (spec §8.1). */
export const chartOtherColor = '#7e8a9c';

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
