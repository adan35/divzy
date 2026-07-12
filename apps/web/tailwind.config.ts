import type { Config } from 'tailwindcss';

/**
 * Divzy Tailwind theme — maps the design tokens defined as CSS custom
 * properties in `src/app/globals.css` (light on :root, dark on .dark).
 * Components must use these token utilities, never raw hex values.
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
        hairline: 'var(--hairline)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        brand: 'var(--brand)',
        'brand-hover': 'var(--brand-hover)',
        pos: 'var(--pos)',
        neg: 'var(--neg)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        'brand-soft': 'var(--brand-soft)',
        'pos-soft': 'var(--pos-soft)',
        'neg-soft': 'var(--neg-soft)',
        'warn-soft': 'var(--warn-soft)',
        overlay: 'var(--overlay)',
        'page-veil': 'var(--page-veil)',
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
