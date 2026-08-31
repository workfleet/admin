import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every module under test is pure arithmetic or date handling - none of
    // them touch a DOM, so there is no reason to pay for jsdom.
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
