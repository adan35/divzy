import type { Config } from 'tailwindcss';

/**
 * Divzy Tailwind theme — maps the design tokens defined as CSS custom
 * properties in `src/app/globals.css` (light on :root, dark on .dark).
 * Components must use these token utilities, never raw hex values
 * (WI-068 story AC-2 — enforced by src/app/wi068-no-raw-hex.test.ts).
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        elevated: 'var(--elevated)',
        hairline: 'var(--hairline)',
        'hairline-strong': 'var(--hairline-strong)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        brand: 'var(--brand)',
        'brand-hover': 'var(--brand-hover)',
        'brand-fill': 'var(--brand-fill)',
        'brand-fill-hover': 'var(--brand-fill-hover)',
        'on-brand': 'var(--on-brand)',
        pos: 'var(--pos)',
        neg: 'var(--neg)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        accent: 'var(--accent)',
        'brand-soft': 'var(--brand-soft)',
        'pos-soft': 'var(--pos-soft)',
        'neg-soft': 'var(--neg-soft)',
        'warn-soft': 'var(--warn-soft)',
        'accent-soft': 'var(--accent-soft)',
        ring: 'var(--ring)',
        overlay: 'var(--overlay)',
        'page-veil': 'var(--page-veil)',
        'chart-1': 'var(--chart-1)',
        'chart-grid': 'var(--chart-grid)',
      },
      boxShadow: {
        /** Resting card elevation (light; resolves to none in dark). */
        card: 'var(--shadow-1)',
        /** Popover/dialog elevation (light; resolves to none in dark). */
        pop: 'var(--shadow-2)',
        /**
         * Dark-mode elevation: machined top-edge highlight instead of a drop
         * shadow (spec §1.1) — pair as `dark:shadow-top-edge`.
         */
        'top-edge': 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      },
      borderRadius: {
        xl2: '16px',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
