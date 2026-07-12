import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  // Bundle workspace TS-source packages; leave real node deps external.
  noExternal: ['@divzy/shared'],
});
