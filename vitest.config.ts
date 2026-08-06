import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['spec/unit/**/*.spec.ts', 'spec/integration/**/*.spec.ts'],
  },
});
