import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Mobile has no React Native component-test harness yet (no jest-expo /
 * @testing-library/react-native in the repo) — this config covers the
 * pure business-logic modules under src/lib (dedupe, gating, DTO-shaping
 * helpers) that back the settlements screens, run in a plain Node
 * environment with no RN/Expo module resolution required.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
